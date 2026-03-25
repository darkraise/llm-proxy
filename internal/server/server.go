package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"time"

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
	cfg     Config
	http    *http.Server
	mux     *http.ServeMux
	db      *store.DB
	pool    *provider.Pool
	proxy   *proxy.Handler
	admin   *admin.AdminHandler
	auth    *admin.Auth
	logChan chan store.RequestLog
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

	// Load providers from DB
	providers, err := db.ListProviders()
	if err != nil {
		return nil, fmt.Errorf("load providers: %w", err)
	}

	// Seed from YAML if DB is empty
	if len(providers) == 0 && cfg.SeedConfig != "" {
		if data, err := os.ReadFile(cfg.SeedConfig); err == nil {
			slog.Info("seeding providers from config", "path", cfg.SeedConfig)
			if yamlCfg, err := config.ParseYAML(data); err == nil {
				for _, p := range yamlCfg.ToProviders() {
					if _, err := db.CreateProvider(p); err != nil {
						slog.Warn("seed provider failed", "name", p.Name, "error", err)
					}
				}
				// Store proxy settings
				if yamlCfg.Proxy.RequestTimeout > 0 {
					db.SetSetting("request_timeout", fmt.Sprintf("%d", yamlCfg.Proxy.RequestTimeout))
				}
				if yamlCfg.Proxy.MaxRetries > 0 {
					db.SetSetting("max_retries", fmt.Sprintf("%d", yamlCfg.Proxy.MaxRetries))
				}
				// Reload providers
				providers, _ = db.ListProviders()
			} else {
				slog.Warn("failed to parse seed config", "error", err)
			}
		}
	}

	pool := provider.NewPool(providers)

	// Async request logger
	logChan := make(chan store.RequestLog, 1000)
	logFunc := func(entry store.RequestLog) {
		select {
		case logChan <- entry:
		default:
			slog.Warn("log channel full, dropping entry")
		}
	}

	proxyHandler := proxy.NewHandler(pool, logFunc)
	adminHandler := admin.NewAdminHandler(db, auth, pool, encryptionKey)

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
		cfg:     cfg,
		mux:     mux,
		db:      db,
		pool:    pool,
		proxy:   proxyHandler,
		admin:   adminHandler,
		auth:    auth,
		logChan: logChan,
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
	s.mux.Handle("GET /v1/models", proxyAuth(http.HandlerFunc(s.proxy.HandleListModels)))

	// Health
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /", s.handleRoot)

	// Admin auth (no session required)
	s.mux.HandleFunc("POST /admin/api/auth/login", s.auth.HandleLogin)
	s.mux.HandleFunc("POST /admin/api/auth/logout", s.auth.HandleLogout)

	// Admin API (session required)
	protected := func(handler http.HandlerFunc) http.Handler {
		return s.auth.RequireAuth(handler)
	}

	s.mux.Handle("GET /admin/api/providers", protected(s.admin.HandleListProviders))
	s.mux.Handle("POST /admin/api/providers", protected(s.admin.HandleCreateProvider))
	s.mux.Handle("PUT /admin/api/providers/{id}", protected(s.admin.HandleUpdateProvider))
	s.mux.Handle("DELETE /admin/api/providers/{id}", protected(s.admin.HandleDeleteProvider))
	s.mux.Handle("POST /admin/api/providers/{id}/test", protected(s.admin.HandleTestProvider))

	s.mux.Handle("GET /admin/api/stats/overview", protected(s.admin.HandleStatsOverview))
	s.mux.Handle("GET /admin/api/stats/requests", protected(s.admin.HandleStatsRequests))
	s.mux.Handle("GET /admin/api/stats/providers", protected(s.admin.HandleStatsProviders))

	s.mux.Handle("GET /admin/api/settings", protected(s.admin.HandleGetSettings))
	s.mux.Handle("PUT /admin/api/settings", protected(s.admin.HandleUpdateSettings))

	s.mux.Handle("POST /admin/api/config/import", protected(s.admin.HandleConfigImport))
	s.mux.Handle("GET /admin/api/config/export", protected(s.admin.HandleConfigExport))

	// Admin UI (dev proxy or embedded SPA — Task 21)
	if s.cfg.Dev && s.cfg.UIProxy != "" {
		target, _ := url.Parse(s.cfg.UIProxy)
		s.mux.Handle("/admin/", httputil.NewSingleHostReverseProxy(target))
	}
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
		"status":              health,
		"available_providers": available,
		"total_providers":     len(status),
		"providers":           status,
		"version":             s.cfg.Version,
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

func (s *Server) Start() error {
	// Start async log writer
	go s.logWriter()
	// Start daily log pruner
	go s.logPruner()

	slog.Info("server started",
		"port", s.cfg.Port,
		"providers", len(s.pool.Providers()),
		"version", s.cfg.Version,
	)
	return s.http.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	close(s.logChan)
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
