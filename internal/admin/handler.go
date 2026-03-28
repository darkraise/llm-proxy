package admin

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/darkraise/llm-proxy/internal/config"
	"github.com/darkraise/llm-proxy/internal/crypto"
	"github.com/darkraise/llm-proxy/internal/notify"
	"github.com/darkraise/llm-proxy/internal/provider"
	"github.com/darkraise/llm-proxy/internal/store"
)

type AdminHandler struct {
	db              *store.DB
	auth            *Auth
	pool            *provider.Pool
	encryptionKey   []byte
	notifier        *notify.Notifier
	onSettingsChange func() // called after settings are saved to reload runtime config
}

func NewAdminHandler(db *store.DB, auth *Auth, pool *provider.Pool, encryptionKey []byte) *AdminHandler {
	return &AdminHandler{db: db, auth: auth, pool: pool, encryptionKey: encryptionKey}
}

func (h *AdminHandler) SetNotifier(n *notify.Notifier) {
	h.notifier = n
}

func (h *AdminHandler) SetOnSettingsChange(fn func()) {
	h.onSettingsChange = fn
}

func (h *AdminHandler) HandleTestNotification(w http.ResponseWriter, r *http.Request) {
	if h.notifier == nil {
		writeJSON(w, 500, map[string]string{"error": "notifier not configured"})
		return
	}
	if err := h.notifier.SendTest(); err != nil {
		writeJSON(w, 200, map[string]any{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true})
}

type accountRequest struct {
	Name          string               `json:"name"`
	Type          string               `json:"type"`
	BaseURL       string               `json:"base_url"`
	APIKey        string               `json:"api_key"`
	Models        map[string][]string  `json:"models"`
	Priority      int                  `json:"priority"`
	Enabled       *bool                `json:"enabled"`
	DefaultModels map[string]string    `json:"default_models"`
	Limits        []store.AccountLimit `json:"limits"`
}

func (h *AdminHandler) HandleListAccounts(w http.ResponseWriter, r *http.Request) {
	accounts, err := h.db.ListAccounts()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	// Enrich with live rate limit status and lifetime totals
	status := h.pool.Status()
	totals, _ := h.db.GetAccountTotals()

	type enriched struct {
		store.Account
		Status        *provider.AccountStatus `json:"status,omitempty"`
		TotalRequests int                     `json:"total_requests"`
		TotalTokens   int                     `json:"total_tokens"`
	}

	result := make([]enriched, len(accounts))
	for i, p := range accounts {
		p.APIKey = nil // never expose encrypted key
		result[i] = enriched{Account: p}
		if s, ok := status[p.Name]; ok {
			result[i].Status = &s
		}
		if t, ok := totals[p.Name]; ok {
			result[i].TotalRequests = t.TotalRequests
			result[i].TotalTokens = t.TotalTokens
		}
	}

	writeJSON(w, 200, result)
}

func (h *AdminHandler) HandleCreateAccount(w http.ResponseWriter, r *http.Request) {
	var req accountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}

	apiKeyEnc := []byte(req.APIKey) // encrypt when encryption key is available
	if h.encryptionKey != nil {
		enc, err := crypto.Encrypt(h.encryptionKey, []byte(req.APIKey))
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "encryption failed"})
			return
		}
		apiKeyEnc = enc
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	p := store.Account{
		Name:          req.Name,
		Type:          req.Type,
		BaseURL:       req.BaseURL,
		APIKey:        apiKeyEnc,
		Models:        store.FormatCategorizedModels(req.Models),
		Priority:      req.Priority,
		Enabled:       enabled,
		DefaultModels: store.FormatDefaultModels(req.DefaultModels),
		Limits:        req.Limits,
	}

	id, err := h.db.CreateAccount(p)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}

	// If this is the first account for this provider and rate_limit_definitions
	// is empty for this provider, back-populate definitions from the account's limits.
	if len(req.Limits) > 0 {
		existingDefs, _ := h.db.ListRateLimitDefs(req.Type)
		if len(existingDefs) == 0 {
			for _, l := range req.Limits {
				h.db.SetRateLimitDef(store.RateLimitDef{
					Provider:   req.Type,
					Model:      l.Model,
					Metric:     l.Metric,
					MaxValue:   l.MaxValue,
					WindowSecs: l.WindowSecs,
				})
			}
		}
	}

	h.reloadPool()

	writeJSON(w, 201, map[string]any{"id": id, "name": req.Name})
}

func (h *AdminHandler) HandleUpdateAccount(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid id"})
		return
	}

	var req accountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}

	// If API key is blank, preserve existing key (blank = keep current)
	var apiKeyEnc []byte
	if req.APIKey != "" {
		apiKeyEnc = []byte(req.APIKey)
		if h.encryptionKey != nil {
			enc, _ := crypto.Encrypt(h.encryptionKey, []byte(req.APIKey))
			apiKeyEnc = enc
		}
	} else {
		existing, err := h.db.GetAccount(id)
		if err != nil {
			writeJSON(w, 404, map[string]string{"error": "account not found"})
			return
		}
		apiKeyEnc = existing.APIKey
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	p := store.Account{
		Name:          req.Name,
		Type:          req.Type,
		BaseURL:       req.BaseURL,
		APIKey:        apiKeyEnc,
		Models:        store.FormatCategorizedModels(req.Models),
		Priority:      req.Priority,
		Enabled:       enabled,
		DefaultModels: store.FormatDefaultModels(req.DefaultModels),
		Limits:        req.Limits,
	}

	if err := h.db.UpdateAccount(id, p); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}

	h.reloadPool()
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *AdminHandler) HandleDeleteAccount(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid id"})
		return
	}

	if err := h.db.DeleteAccount(id); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	h.reloadPool()
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// HandleBulkUpdateAccounts sets enabled/disabled for multiple accounts in one request.
// PATCH /admin/api/accounts/bulk
func (h *AdminHandler) HandleBulkUpdateAccounts(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs     []int64 `json:"ids"`
		Enabled *bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	if req.Enabled == nil {
		writeJSON(w, 400, map[string]string{"error": "enabled field is required"})
		return
	}

	enabled := 0
	if *req.Enabled {
		enabled = 1
	}

	tx, err := h.db.Begin()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()

	for _, id := range req.IDs {
		if _, err := tx.Exec("UPDATE accounts SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", enabled, id); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	h.reloadPool()
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *AdminHandler) HandleTestAccount(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid id"})
		return
	}

	p, err := h.db.GetAccount(id)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "account not found"})
		return
	}

	// Decrypt API key
	var apiKey string
	if h.encryptionKey != nil {
		plain, err := crypto.Decrypt(h.encryptionKey, p.APIKey)
		if err != nil {
			writeJSON(w, 200, map[string]any{"success": false, "error": "failed to decrypt API key: " + err.Error()})
			return
		}
		apiKey = strings.TrimSpace(string(plain))
	} else {
		apiKey = strings.TrimSpace(string(p.APIKey))
	}

	// Test connectivity using GET /models — no tokens consumed, no request quota used.
	client := &http.Client{Timeout: 10 * time.Second}

	var testURL string
	var testReq *http.Request

	switch p.Type {
	case "google":
		testURL = "https://generativelanguage.googleapis.com/v1beta/openai/models"
		testReq, _ = http.NewRequest("GET", testURL, nil)
		testReq.Header.Set("Authorization", "Bearer "+apiKey)
	default:
		testURL = p.BaseURL + "/models"
		testReq, _ = http.NewRequest("GET", testURL, nil)
		if p.Type != "ollama" {
			testReq.Header.Set("Authorization", "Bearer "+apiKey)
		}
	}

	resp, err := client.Do(testReq)
	if err != nil {
		writeJSON(w, 200, map[string]any{"success": false, "error": err.Error()})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		errMsg := string(body)
		if len(errMsg) > 500 {
			errMsg = errMsg[:500]
		}
		writeJSON(w, 200, map[string]any{"success": false, "status_code": resp.StatusCode, "error": errMsg})
		return
	}

	writeJSON(w, 200, map[string]any{"success": true, "status_code": resp.StatusCode})
}

func adminFirstModel(modelsJSON string) string {
	parsed := store.ParseCategorizedModels(modelsJSON)
	all := store.AllModels(parsed)
	if len(all) > 0 {
		return all[0]
	}
	return "test"
}

// parseTimeRange extracts optional from/to query params (RFC 3339).
// Falls back to start-of-day → now when absent.
func parseTimeRange(r *http.Request) (from, to time.Time) {
	now := time.Now()
	from = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	to = now

	if v := r.URL.Query().Get("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			from = t
		}
	}
	if v := r.URL.Query().Get("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			to = t
		}
	}
	return
}

func (h *AdminHandler) HandleStatsOverview(w http.ResponseWriter, r *http.Request) {
	from, to := parseTimeRange(r)

	stats, err := h.db.GetOverviewStats(from, to)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	// Add account count
	status := h.pool.Status()
	active := 0
	for _, s := range status {
		if s.Available {
			active++
		}
	}

	writeJSON(w, 200, map[string]any{
		"total_requests":          stats.TotalRequests,
		"success_count":           stats.SuccessCount,
		"error_count":             stats.ErrorCount,
		"avg_latency_ms":          stats.AvgLatencyMs,
		"total_tokens":            stats.TotalTokens,
		"prompt_tokens":           stats.PromptTokens,
		"completion_tokens":       stats.CompletionTokens,
		"yesterday_requests":      stats.YesterdayRequests,
		"yesterday_avg_latency_ms": stats.YesterdayLatencyMs,
		"active_accounts":         active,
		"total_accounts":          len(status),
	})
}

func (h *AdminHandler) HandleStatsRequests(w http.ResponseWriter, r *http.Request) {
	filter := store.RequestLogFilter{
		AccountName: r.URL.Query().Get("account"),
		Status:      r.URL.Query().Get("status"),
		Model:       r.URL.Query().Get("model"),
		Limit:       50,
	}

	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 && l <= 200 {
		filter.Limit = l
	}
	if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && o >= 0 {
		filter.Offset = o
	}
	if v := r.URL.Query().Get("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			filter.From = &t
		}
	}
	if v := r.URL.Query().Get("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			filter.To = &t
		}
	}
	if v, err := strconv.ParseInt(r.URL.Query().Get("min_latency"), 10, 64); err == nil && v > 0 {
		filter.MinLatencyMs = v
	}

	logs, total, err := h.db.QueryRequestLogs(filter)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, 200, map[string]any{"data": logs, "total": total})
}

func (h *AdminHandler) HandleStatsAccounts(w http.ResponseWriter, r *http.Request) {
	from, to := parseTimeRange(r)

	stats, err := h.db.GetAccountStats(from, to)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, 200, stats)
}

func (h *AdminHandler) HandleStatsProviders(w http.ResponseWriter, r *http.Request) {
	from, to := parseTimeRange(r)
	stats, err := h.db.GetProviderStats(from, to)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, stats)
}

func (h *AdminHandler) HandleStatsModels(w http.ResponseWriter, r *http.Request) {
	provider := r.URL.Query().Get("provider")
	from, to := parseTimeRange(r)
	stats, err := h.db.GetModelStats(from, to, provider)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, stats)
}

func (h *AdminHandler) HandleGetSettings(w http.ResponseWriter, r *http.Request) {
	all, err := h.db.GetAllSettings()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	// Filter out sensitive keys
	safe := make(map[string]string)
	for k, v := range all {
		switch k {
		case "admin_password_hash", "encryption_key_salt", "proxy_api_key_hash":
			continue
		default:
			safe[k] = v
		}
	}
	// Indicate whether a proxy key is configured (without exposing the hash)
	if hash, ok := all["proxy_api_key_hash"]; ok && hash != "" {
		safe["proxy_api_key_configured"] = "true"
	}
	writeJSON(w, 200, safe)
}

func (h *AdminHandler) HandleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var settings map[string]string
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}

	for k, v := range settings {
		switch k {
		case "admin_password_hash", "encryption_key_salt":
			continue // block direct writes to hashed keys
		case "admin_password":
			// Hash the password before storing
			hash, err := crypto.HashPassword(v)
			if err != nil {
				writeJSON(w, 500, map[string]string{"error": "failed to hash password"})
				return
			}
			if err := h.db.SetSetting("admin_password_hash", hash); err != nil {
				writeJSON(w, 500, map[string]string{"error": err.Error()})
				return
			}
			continue
		case "proxy_api_key":
			// Hash the API key before storing
			if v == "" {
				// Clear proxy auth key
				h.db.SetSetting("proxy_api_key_hash", "")
			} else {
				hash, err := crypto.HashPassword(v)
				if err != nil {
					writeJSON(w, 500, map[string]string{"error": "failed to hash API key"})
					return
				}
				if err := h.db.SetSetting("proxy_api_key_hash", hash); err != nil {
					writeJSON(w, 500, map[string]string{"error": err.Error()})
					return
				}
			}
			continue
		}
		if err := h.db.SetSetting(k, v); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
	}

	if h.onSettingsChange != nil {
		h.onSettingsChange()
	}

	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *AdminHandler) HandleConfigImport(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "failed to read body"})
		return
	}

	cfg, err := config.ParseYAML(body)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid YAML: " + err.Error()})
		return
	}

	imported := 0
	for _, p := range cfg.ToAccounts() {
		apiKeyEnc := p.APIKey
		if h.encryptionKey != nil {
			enc, err := crypto.Encrypt(h.encryptionKey, p.APIKey)
			if err == nil {
				apiKeyEnc = enc
			}
		}
		p.APIKey = apiKeyEnc
		if _, err := h.db.CreateAccount(p); err != nil {
			slog.Warn("import account failed", "name", p.Name, "error", err)
		} else {
			imported++
		}
	}

	// Import proxy settings
	if cfg.Proxy.RequestTimeout > 0 {
		h.db.SetSetting("request_timeout", fmt.Sprintf("%d", cfg.Proxy.RequestTimeout))
	}
	if cfg.Proxy.MaxRetries > 0 {
		h.db.SetSetting("max_retries", fmt.Sprintf("%d", cfg.Proxy.MaxRetries))
	}

	h.reloadPool()
	writeJSON(w, 200, map[string]any{"imported": imported})
}

func (h *AdminHandler) HandleConfigExport(w http.ResponseWriter, r *http.Request) {
	accounts, err := h.db.ListAccounts()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	// Decrypt API keys for export
	for i := range accounts {
		if h.encryptionKey != nil {
			if plain, err := crypto.Decrypt(h.encryptionKey, accounts[i].APIKey); err == nil {
				accounts[i].APIKey = plain
			}
		}
	}

	settings, _ := h.db.GetAllSettings()
	data, err := config.ExportYAML(accounts, settings)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/x-yaml")
	w.Header().Set("Content-Disposition", "attachment; filename=llm-proxy-config.yml")
	w.Write(data)
}

func (h *AdminHandler) reloadPool() {
	accounts, err := h.db.ListAccounts()
	if err != nil {
		slog.Error("failed to reload accounts", "error", err)
		return
	}
	// Decrypt API keys before reloading the pool
	for i := range accounts {
		if h.encryptionKey != nil {
			if plain, err := crypto.Decrypt(h.encryptionKey, accounts[i].APIKey); err == nil {
				accounts[i].APIKey = plain
			}
		}
	}
	h.pool.Reload(accounts)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
