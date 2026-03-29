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
	cryptopkg "github.com/darkraise/llm-proxy/internal/crypto"
	"github.com/darkraise/llm-proxy/internal/notify"
	"github.com/darkraise/llm-proxy/internal/provider"
	"github.com/darkraise/llm-proxy/internal/proxy"
	"github.com/darkraise/llm-proxy/internal/store"
)

type Config struct {
	Port      int
	AdminPort int
	DataDir   string
	Dev       bool
	UIProxy   string
	Version   string
}

type Server struct {
	cfg           Config
	http          *http.Server
	mux           *http.ServeMux
	adminHttp     *http.Server
	adminMux      *http.ServeMux
	db            *store.DB
	pool          *provider.Pool
	proxy         *proxy.Handler
	admin         *admin.AdminHandler
	auth          *admin.Auth
	logChan       chan store.RequestLog
	rateLimitChan chan proxy.RateLimitUpdate
	notifier      *notify.Notifier
	notifyStop    chan struct{}
}

func New(cfg Config) (*Server, error) {
	db, err := store.NewDB(cfg.DataDir + "/llm-proxy.db")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// Initialize admin auth from ADMIN_PASSWORD_HASH env var
	adminPasswordHash := os.Getenv("ADMIN_PASSWORD_HASH")
	if adminPasswordHash == "" {
		return nil, fmt.Errorf("ADMIN_PASSWORD_HASH environment variable is required")
	}
	auth := admin.NewAuth(adminPasswordHash)

	// Derive encryption key from password hash
	saltHex, _ := db.GetSetting("encryption_key_salt")
	var salt []byte
	if saltHex == "" {
		salt = cryptopkg.GenerateSalt()
		db.SetSetting("encryption_key_salt", fmt.Sprintf("%x", salt))
	} else {
		fmt.Sscanf(saltHex, "%x", &salt)
	}
	encryptionKey := cryptopkg.DeriveKey(adminPasswordHash, salt)

	// Load accounts from DB
	accounts, err := db.ListAccounts()
	if err != nil {
		return nil, fmt.Errorf("load accounts: %w", err)
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

	// Notification system
	notifier := notify.NewNotifier(db)
	proxyHandler.SetNotifier(notifier)
	adminHandler.SetNotifier(notifier)

	// Load proxy config from settings (also called on settings change)
	reloadProxyConfig := func() {
		// Max retries + request timeout
		maxRetries := 12
		timeout := 15 * time.Second
		if retries, _ := db.GetSetting("max_retries"); retries != "" {
			var r int
			fmt.Sscanf(retries, "%d", &r)
			if r > 0 {
				maxRetries = r
			}
		}
		if ts, _ := db.GetSetting("request_timeout"); ts != "" {
			var sec int
			fmt.Sscanf(ts, "%d", &sec)
			if sec > 0 {
				timeout = time.Duration(sec) * time.Second
			}
		}
		proxyHandler.SetConfig(maxRetries, timeout)

		// Fallback config
		fallbackEnabled, _ := db.GetSetting("fallback_enabled")
		if fallbackEnabled == "true" {
			fallbackURL, _ := db.GetSetting("fallback_url")
			chatModel, _ := db.GetSetting("fallback_chat_model")
			embeddingModel, _ := db.GetSetting("fallback_embedding_model")
			fallbackTimeout, _ := db.GetSetting("fallback_timeout")
			t := 30
			fmt.Sscanf(fallbackTimeout, "%d", &t)
			proxyHandler.SetFallback(proxy.FallbackConfig{
				Enabled:        true,
				BaseURL:        fallbackURL,
				ChatModel:      chatModel,
				EmbeddingModel: embeddingModel,
				Timeout:        time.Duration(t) * time.Second,
			})
		} else {
			proxyHandler.SetFallback(proxy.FallbackConfig{Enabled: false})
		}

		slog.Info("proxy config reloaded from settings")
	}
	reloadProxyConfig()
	adminHandler.SetOnSettingsChange(reloadProxyConfig)

	notifyStop := make(chan struct{})
	mux := http.NewServeMux()
	adminMux := http.NewServeMux()
	s := &Server{
		cfg:           cfg,
		mux:           mux,
		adminMux:      adminMux,
		db:            db,
		pool:          pool,
		proxy:         proxyHandler,
		admin:         adminHandler,
		auth:          auth,
		logChan:       logChan,
		rateLimitChan: rateLimitChan,
		notifier:      notifier,
		notifyStop:    notifyStop,
		http: &http.Server{
			Addr:    fmt.Sprintf(":%d", cfg.Port),
			Handler: mux,
		},
		adminHttp: &http.Server{
			Addr:    fmt.Sprintf(":%d", cfg.AdminPort),
			Handler: adminMux,
		},
	}

	s.proxyRoutes()
	s.adminRoutes()
	return s, nil
}

func (s *Server) proxyRoutes() {
	proxyAuth := proxy.ProxyAuthMiddleware(s.db)
	s.mux.Handle("POST /v1/chat/completions", proxyAuth(http.HandlerFunc(s.proxy.HandleChatCompletions)))
	s.mux.Handle("POST /v1/messages", proxyAuth(http.HandlerFunc(s.proxy.HandleAnthropicMessages)))
	s.mux.Handle("POST /v1/embeddings", proxyAuth(http.HandlerFunc(s.proxy.HandleEmbeddings)))
	s.mux.Handle("GET /v1/models", proxyAuth(http.HandlerFunc(s.proxy.HandleListModels)))

	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("/", s.handleRoot)
}

func (s *Server) adminRoutes() {
	m := s.adminMux

	// Auth (no session required)
	m.HandleFunc("POST /api/auth/login", s.auth.HandleLogin)
	m.HandleFunc("POST /api/auth/logout", s.auth.HandleLogout)

	// Admin API (session required)
	protected := func(handler http.HandlerFunc) http.Handler {
		return s.auth.RequireAuth(handler)
	}

	m.Handle("GET /api/accounts", protected(s.admin.HandleListAccounts))
	m.Handle("PATCH /api/accounts/bulk", protected(s.admin.HandleBulkUpdateAccounts))
	m.Handle("POST /api/accounts", protected(s.admin.HandleCreateAccount))
	m.Handle("PUT /api/accounts/{id}", protected(s.admin.HandleUpdateAccount))
	m.Handle("DELETE /api/accounts/{id}", protected(s.admin.HandleDeleteAccount))
	m.Handle("POST /api/accounts/{id}/test", protected(s.admin.HandleTestAccount))

	m.Handle("GET /api/stats/overview", protected(s.admin.HandleStatsOverview))
	m.Handle("GET /api/stats/requests", protected(s.admin.HandleStatsRequests))
	m.Handle("GET /api/stats/accounts", protected(s.admin.HandleStatsAccounts))
	m.Handle("GET /api/stats/providers", protected(s.admin.HandleStatsProviders))
	m.Handle("GET /api/stats/models", protected(s.admin.HandleStatsModels))

	m.Handle("GET /api/settings", protected(s.admin.HandleGetSettings))
	m.Handle("PUT /api/settings", protected(s.admin.HandleUpdateSettings))

	m.Handle("POST /api/config/import", protected(s.admin.HandleConfigImport))
	m.Handle("GET /api/config/export", protected(s.admin.HandleConfigExport))

	m.Handle("GET /api/provider-metrics/{provider}", protected(s.admin.HandleGetProviderMetrics))
	m.Handle("PUT /api/provider-metrics/{provider}", protected(s.admin.HandleSetProviderMetrics))

	m.Handle("GET /api/ratelimits/{provider}/defaults", protected(s.admin.HandleGetDefaultLimits))
	m.Handle("GET /api/ratelimits/{provider}", protected(s.admin.HandleListRateLimitDefs))
	m.Handle("PUT /api/ratelimits", protected(s.admin.HandleSetRateLimitDef))
	m.Handle("DELETE /api/ratelimits/{id}", protected(s.admin.HandleDeleteRateLimitDef))

	m.Handle("POST /api/accounts/discover", protected(s.admin.HandleDiscoverModels))
	m.Handle("POST /api/accounts/{id}/discover", protected(s.admin.HandleDiscoverByAccount))

	m.Handle("POST /api/notifications/test", protected(s.admin.HandleTestNotification))

	m.Handle("POST /api/ollama/discover", protected(s.admin.HandleDiscoverOllama))

	// Admin UI: dev proxy or embedded SPA
	if s.cfg.Dev && s.cfg.UIProxy != "" {
		target, _ := url.Parse(s.cfg.UIProxy)
		m.Handle("/", httputil.NewSingleHostReverseProxy(target))
	} else {
		subFS, err := fs.Sub(llmproxy.WebAssets, "web/dist")
		if err != nil {
			slog.Error("failed to sub web assets FS", "error", err)
		} else {
			fileServer := http.FileServer(http.FS(subFS))
			m.Handle("/", &spaHandler{
				fileServer: fileServer,
				root:       subFS,
			})
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
	json.NewEncoder(w).Encode(map[string]any{
		"service":    "llm-proxy",
		"version":    s.cfg.Version,
		"admin_port": s.cfg.AdminPort,
	})
}

// ProxyHandler returns the proxy HTTP handler (used in tests).
func (s *Server) ProxyHandler() http.Handler {
	return s.mux
}

// AdminHandler returns the admin HTTP handler (used in tests).
func (s *Server) AdminHandler() http.Handler {
	return s.adminMux
}

// StartBackgroundWorkers launches the async log writer, rate limit writer, and
// log pruner goroutines. Called automatically by Start; exposed for tests that
// use httptest.NewServer.
func (s *Server) StartBackgroundWorkers() {
	go s.logWriter()
	go s.rateLimitWriter()
	go s.logPruner()
	go s.notifier.Run(s.notifyStop)
}

func (s *Server) Start() error {
	s.StartBackgroundWorkers()

	slog.Info("server started",
		"proxy_port", s.cfg.Port,
		"admin_port", s.cfg.AdminPort,
		"accounts", len(s.pool.Accounts()),
		"version", s.cfg.Version,
	)

	errCh := make(chan error, 2)
	go func() {
		if err := s.adminHttp.ListenAndServe(); err != nil {
			errCh <- fmt.Errorf("admin server: %w", err)
		}
	}()
	go func() {
		if err := s.http.ListenAndServe(); err != nil {
			errCh <- fmt.Errorf("proxy server: %w", err)
		}
	}()

	// First error (bind failure or shutdown) surfaces to caller.
	return <-errCh
}

func (s *Server) Shutdown(ctx context.Context) error {
	// Drain active requests before closing channels to avoid send-on-closed-channel panic.
	_ = s.adminHttp.Shutdown(ctx)
	_ = s.http.Shutdown(ctx)
	close(s.notifyStop)
	close(s.logChan)
	close(s.rateLimitChan)
	s.db.Close()
	return nil
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
