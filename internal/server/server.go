package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"time"

	llmproxy "github.com/darkraise/llm-proxy"
	"github.com/darkraise/llm-proxy/internal/admin"
	"github.com/darkraise/llm-proxy/internal/config"
	cryptopkg "github.com/darkraise/llm-proxy/internal/crypto"
	"github.com/darkraise/llm-proxy/internal/provider"
	"github.com/darkraise/llm-proxy/internal/proxy"
	"github.com/darkraise/llm-proxy/internal/store"
)

type Config struct {
	Port       int
	DataDir    string
	Dev        bool
	UIProxy    string
	SeedConfig string
	Version    string
}

type Server struct {
	cfg           Config
	http          *http.Server
	mux           *http.ServeMux
	db            *store.DB
	pool          *provider.Pool
	proxy         *proxy.Handler
	admin         *admin.AdminHandler
	auth          *admin.Auth
	logChan       chan store.RequestLog
	rateLimitChan chan proxy.RateLimitUpdate
}

func New(cfg Config) (*Server, error) {
	db, err := store.NewDB(cfg.DataDir + "/llm-proxy.db")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// Initialize admin auth and encryption key
	adminPassword := os.Getenv("ADMIN_PASSWORD")
	auth := admin.NewAuth(db, adminPassword)

	// Derive encryption key from admin password
	var encryptionKey []byte
	if adminPassword != "" {
		saltHex, _ := db.GetSetting("encryption_key_salt")
		var salt []byte
		if saltHex == "" {
			salt = cryptopkg.GenerateSalt()
			db.SetSetting("encryption_key_salt", fmt.Sprintf("%x", salt))
		} else {
			fmt.Sscanf(saltHex, "%x", &salt)
		}
		encryptionKey = cryptopkg.DeriveKey(adminPassword, salt)
	}

	// Load accounts from DB
	accounts, err := db.ListAccounts()
	if err != nil {
		return nil, fmt.Errorf("load accounts: %w", err)
	}

	// Seed from YAML if DB is empty
	if len(accounts) == 0 && cfg.SeedConfig != "" {
		if data, err := os.ReadFile(cfg.SeedConfig); err == nil {
			slog.Info("seeding accounts from config", "path", cfg.SeedConfig)
			if yamlCfg, err := config.ParseYAML(data); err == nil {
				for _, p := range yamlCfg.ToAccounts() {
					if _, err := db.CreateAccount(p); err != nil {
						slog.Warn("seed account failed", "name", p.Name, "error", err)
					}
				}
				// Store proxy settings
				if yamlCfg.Proxy.RequestTimeout > 0 {
					db.SetSetting("request_timeout", fmt.Sprintf("%d", yamlCfg.Proxy.RequestTimeout))
				}
				if yamlCfg.Proxy.MaxRetries > 0 {
					db.SetSetting("max_retries", fmt.Sprintf("%d", yamlCfg.Proxy.MaxRetries))
				}
				// Reload accounts
				accounts, _ = db.ListAccounts()
			} else {
				slog.Warn("failed to parse seed config", "error", err)
			}
		}
	}

	// Decrypt API keys before passing to pool
	for i := range accounts {
		if encryptionKey != nil {
			if plain, err := cryptopkg.Decrypt(encryptionKey, accounts[i].APIKey); err == nil {
				accounts[i].APIKey = plain
			}
		}
	}

	pool := provider.NewPool(accounts)

	// Async request logger
	logChan := make(chan store.RequestLog, 1000)
	logFunc := func(entry store.RequestLog) {
		select {
		case logChan <- entry:
		default:
			slog.Warn("log channel full, dropping entry")
		}
	}

	proxyHandler := proxy.NewHandler(pool, db, logFunc)
	adminHandler := admin.NewAdminHandler(db, auth, pool, encryptionKey)

	// Async rate limit header writer
	rateLimitChan := make(chan proxy.RateLimitUpdate, 500)
	proxyHandler.SetRateLimitChan(rateLimitChan)

	// Load proxy config from settings
	if retries, _ := db.GetSetting("max_retries"); retries != "" {
		var r int
		fmt.Sscanf(retries, "%d", &r)
		if r > 0 {
			t := 15 * time.Second
			if ts, _ := db.GetSetting("request_timeout"); ts != "" {
				var sec int
				fmt.Sscanf(ts, "%d", &sec)
				if sec > 0 {
					t = time.Duration(sec) * time.Second
				}
			}
			proxyHandler.SetConfig(r, t)
		}
	} else if ts, _ := db.GetSetting("request_timeout"); ts != "" {
		var sec int
		fmt.Sscanf(ts, "%d", &sec)
		if sec > 0 {
			proxyHandler.SetConfig(3, time.Duration(sec)*time.Second)
		}
	}

	// Load fallback config from settings
	fallbackEnabled, _ := db.GetSetting("fallback_enabled")
	if fallbackEnabled == "true" {
		fallbackURL, _ := db.GetSetting("fallback_url")
		fallbackModel, _ := db.GetSetting("fallback_model")
		fallbackTimeout, _ := db.GetSetting("fallback_timeout")
		timeout := 30
		fmt.Sscanf(fallbackTimeout, "%d", &timeout)
		proxyHandler.SetFallback(proxy.FallbackConfig{
			Enabled: true,
			BaseURL: fallbackURL,
			Model:   fallbackModel,
			Timeout: time.Duration(timeout) * time.Second,
		})
	}

	mux := http.NewServeMux()
	s := &Server{
		cfg:           cfg,
		mux:           mux,
		db:            db,
		pool:          pool,
		proxy:         proxyHandler,
		admin:         adminHandler,
		auth:          auth,
		logChan:       logChan,
		rateLimitChan: rateLimitChan,
		http: &http.Server{
			Addr:    fmt.Sprintf(":%d", cfg.Port),
			Handler: mux,
		},
	}

	s.routes()
	return s, nil
}

func (s *Server) routes() {
	// Proxy endpoints (with optional API key gate)
	proxyAuth := proxy.ProxyAuthMiddleware(s.db)
	s.mux.Handle("POST /v1/chat/completions", proxyAuth(http.HandlerFunc(s.proxy.HandleChatCompletions)))
	s.mux.Handle("POST /v1/messages", proxyAuth(http.HandlerFunc(s.proxy.HandleAnthropicMessages)))
	s.mux.Handle("POST /v1/embeddings", proxyAuth(http.HandlerFunc(s.proxy.HandleEmbeddings)))
	s.mux.Handle("GET /v1/models", proxyAuth(http.HandlerFunc(s.proxy.HandleListModels)))

	// Health
	s.mux.HandleFunc("GET /health", s.handleHealth)
	// Redirect /admin (no trailing slash) to /admin/
	s.mux.HandleFunc("GET /admin", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/admin/", http.StatusMovedPermanently)
	})
	s.mux.HandleFunc("/", s.handleRoot)

	// Admin auth (no session required)
	s.mux.HandleFunc("GET /admin/api/auth/setup-status", s.auth.HandleSetupStatus)
	s.mux.HandleFunc("POST /admin/api/auth/setup", s.auth.HandleSetup)
	s.mux.HandleFunc("POST /admin/api/auth/login", s.auth.HandleLogin)
	s.mux.HandleFunc("POST /admin/api/auth/logout", s.auth.HandleLogout)

	// Admin API (session required)
	protected := func(handler http.HandlerFunc) http.Handler {
		return s.auth.RequireAuth(handler)
	}

	s.mux.Handle("GET /admin/api/accounts", protected(s.admin.HandleListAccounts))
	s.mux.Handle("PATCH /admin/api/accounts/bulk", protected(s.admin.HandleBulkUpdateAccounts))
	s.mux.Handle("POST /admin/api/accounts", protected(s.admin.HandleCreateAccount))
	s.mux.Handle("PUT /admin/api/accounts/{id}", protected(s.admin.HandleUpdateAccount))
	s.mux.Handle("DELETE /admin/api/accounts/{id}", protected(s.admin.HandleDeleteAccount))
	s.mux.Handle("POST /admin/api/accounts/{id}/test", protected(s.admin.HandleTestAccount))

	s.mux.Handle("GET /admin/api/stats/overview", protected(s.admin.HandleStatsOverview))
	s.mux.Handle("GET /admin/api/stats/requests", protected(s.admin.HandleStatsRequests))
	s.mux.Handle("GET /admin/api/stats/accounts", protected(s.admin.HandleStatsAccounts))
	s.mux.Handle("GET /admin/api/stats/providers", protected(s.admin.HandleStatsProviders))
	s.mux.Handle("GET /admin/api/stats/models", protected(s.admin.HandleStatsModels))

	s.mux.Handle("GET /admin/api/settings", protected(s.admin.HandleGetSettings))
	s.mux.Handle("PUT /admin/api/settings", protected(s.admin.HandleUpdateSettings))

	s.mux.Handle("POST /admin/api/config/import", protected(s.admin.HandleConfigImport))
	s.mux.Handle("GET /admin/api/config/export", protected(s.admin.HandleConfigExport))

	// Provider metric configuration (separate prefix to avoid wildcard conflicts)
	s.mux.Handle("GET /admin/api/provider-metrics/{provider}", protected(s.admin.HandleGetProviderMetrics))
	s.mux.Handle("PUT /admin/api/provider-metrics/{provider}", protected(s.admin.HandleSetProviderMetrics))

	// Rate limit definitions — more-specific sub-paths must be registered before
	// /{provider} so the exact patterns win over the wildcard.
	s.mux.Handle("GET /admin/api/ratelimits/{provider}/defaults", protected(s.admin.HandleGetDefaultLimits))
	s.mux.Handle("GET /admin/api/ratelimits/{provider}", protected(s.admin.HandleListRateLimitDefs))
	s.mux.Handle("PUT /admin/api/ratelimits", protected(s.admin.HandleSetRateLimitDef))
	s.mux.Handle("DELETE /admin/api/ratelimits/{id}", protected(s.admin.HandleDeleteRateLimitDef))

	// Account model discovery
	s.mux.Handle("POST /admin/api/accounts/discover", protected(s.admin.HandleDiscoverModels))
	s.mux.Handle("POST /admin/api/accounts/{id}/discover", protected(s.admin.HandleDiscoverByAccount))

	// Admin UI: dev proxy or embedded SPA
	if s.cfg.Dev && s.cfg.UIProxy != "" {
		target, _ := url.Parse(s.cfg.UIProxy)
		s.mux.Handle("/admin/", httputil.NewSingleHostReverseProxy(target))
	} else {
		subFS, err := fs.Sub(llmproxy.WebAssets, "web/dist")
		if err != nil {
			slog.Error("failed to sub web assets FS", "error", err)
		} else {
			fileServer := http.FileServer(http.FS(subFS))
			s.mux.Handle("/admin/", http.StripPrefix("/admin", &spaHandler{
				fileServer: fileServer,
				root:       subFS,
			}))
		}
	}
}

// spaHandler serves static files from the embedded FS, falling back to
// index.html for any path that does not match a real file (SPA client routing).
type spaHandler struct {
	fileServer http.Handler
	root       fs.FS
}

func (h *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Check whether the requested path exists as a real file.
	if _, err := h.root.Open(r.URL.Path); err == nil {
		h.fileServer.ServeHTTP(w, r)
		return
	}
	// Also try with a leading slash stripped (http.FS wraps with "." prefix).
	clean := r.URL.Path
	if len(clean) > 0 && clean[0] == '/' {
		clean = clean[1:]
	}
	if _, err := h.root.Open(clean); err == nil {
		h.fileServer.ServeHTTP(w, r)
		return
	}
	// Fall back to index.html for SPA client-side routing.
	r2 := r.Clone(r.Context())
	r2.URL.Path = "/"
	h.fileServer.ServeHTTP(w, r2)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	status := s.pool.Status()
	available := 0
	for _, st := range status {
		if st.Available {
			available++
		}
	}

	health := "healthy"
	if available == 0 {
		health = "unhealthy"
	} else if available < len(status) {
		health = "degraded"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":             health,
		"available_accounts": available,
		"total_accounts":     len(status),
		"accounts":           status,
		"version":            s.cfg.Version,
	})
}

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"service": "llm-proxy",
		"version": s.cfg.Version,
		"admin":   "/admin/",
	})
}

// Handler returns the HTTP handler for the server (used in tests).
func (s *Server) Handler() http.Handler {
	return s.mux
}

// StartBackgroundWorkers launches the async log writer, rate limit writer, and
// log pruner goroutines. Called automatically by Start; exposed for tests that
// use httptest.NewServer.
func (s *Server) StartBackgroundWorkers() {
	go s.logWriter()
	go s.rateLimitWriter()
	go s.logPruner()
}

func (s *Server) Start() error {
	go s.logWriter()
	go s.rateLimitWriter()
	go s.logPruner()

	slog.Info("server started",
		"port", s.cfg.Port,
		"accounts", len(s.pool.Accounts()),
		"version", s.cfg.Version,
	)
	return s.http.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	close(s.logChan)
	close(s.rateLimitChan)
	s.db.Close()
	return s.http.Shutdown(ctx)
}

func (s *Server) logWriter() {
	batch := make([]store.RequestLog, 0, 100)
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	flush := func() {
		for _, entry := range batch {
			if err := s.db.InsertRequestLog(entry); err != nil {
				slog.Error("log insert failed", "error", err)
			}
		}
		batch = batch[:0]
	}

	for {
		select {
		case entry, ok := <-s.logChan:
			if !ok {
				flush()
				return
			}
			batch = append(batch, entry)
			if len(batch) >= 100 {
				flush()
			}
		case <-ticker.C:
			if len(batch) > 0 {
				flush()
			}
		}
	}
}

// rateLimitWriter drains the rateLimitChan and upserts each definition into
// the database. It mirrors the logWriter pattern: async and non-blocking to
// the proxy request path.
func (s *Server) rateLimitWriter() {
	for update := range s.rateLimitChan {
		for _, def := range update.Defs {
			if err := s.db.SetRateLimitDef(def); err != nil {
				slog.Error("rate limit upsert failed",
					"provider", def.Provider,
					"model", def.Model,
					"metric", def.Metric,
					"error", err,
				)
			}
		}
	}
}

func (s *Server) logPruner() {
	for {
		time.Sleep(24 * time.Hour)
		retentionStr, _ := s.db.GetSetting("log_retention_days")
		retention := 30
		if v, err := fmt.Sscanf(retentionStr, "%d", &retention); err != nil || v == 0 {
			retention = 30
		}
		// Roll up expiring logs into daily_stats before pruning
		if err := s.db.RollupDailyStats(retention); err != nil {
			slog.Error("daily rollup failed", "error", err)
		}
		pruned, err := s.db.PruneOldLogs(retention)
		if err != nil {
			slog.Error("log prune failed", "error", err)
		} else if pruned > 0 {
			slog.Info("pruned old logs", "count", pruned, "retention_days", retention)
		}
	}
}
