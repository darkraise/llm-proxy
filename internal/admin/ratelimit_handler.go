package admin

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/darkraise/llm-proxy/internal/store"
)

// HandleListRateLimitDefs returns all rate limit definitions for a provider.
//
// GET /admin/api/ratelimits/{provider}
func (h *AdminHandler) HandleListRateLimitDefs(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")
	if provider == "" {
		writeJSON(w, 400, map[string]string{"error": "provider is required"})
		return
	}

	defs, err := h.db.ListRateLimitDefs(provider)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	if defs == nil {
		defs = []store.RateLimitDef{}
	}
	writeJSON(w, 200, defs)
}

// HandleSetRateLimitDef upserts a rate limit definition.
//
// PUT /admin/api/ratelimits
func (h *AdminHandler) HandleSetRateLimitDef(w http.ResponseWriter, r *http.Request) {
	var def store.RateLimitDef
	if err := json.NewDecoder(r.Body).Decode(&def); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}

	if def.Provider == "" || def.Metric == "" {
		writeJSON(w, 400, map[string]string{"error": "provider and metric are required"})
		return
	}

	if err := h.db.SetRateLimitDef(def); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// HandleDeleteRateLimitDef removes a rate limit definition by ID.
//
// DELETE /admin/api/ratelimits/{id}
func (h *AdminHandler) HandleDeleteRateLimitDef(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid id"})
		return
	}

	if err := h.db.DeleteRateLimitDef(id); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// HandleGetProviderMetrics returns the supported metric keys for a provider.
//
// GET /admin/api/provider-metrics/{provider}
func (h *AdminHandler) HandleGetProviderMetrics(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")
	raw, _ := h.db.GetSetting("ratelimit_metrics:" + provider)
	if raw == "" {
		writeJSON(w, 200, []string{"rpm", "rpd", "tpm", "tpd"})
		return
	}
	var metrics []string
	if err := json.Unmarshal([]byte(raw), &metrics); err != nil {
		writeJSON(w, 200, []string{"rpm", "rpd", "tpm", "tpd"})
		return
	}
	writeJSON(w, 200, metrics)
}

// HandleSetProviderMetrics saves the supported metric keys for a provider.
//
// PUT /admin/api/provider-metrics/{provider}
func (h *AdminHandler) HandleSetProviderMetrics(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")
	var metrics []string
	if err := json.NewDecoder(r.Body).Decode(&metrics); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	data, _ := json.Marshal(metrics)
	if err := h.db.SetSetting("ratelimit_metrics:"+provider, string(data)); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// HandleGetDefaultLimits returns merged default limits for a provider+models
// combination, suitable for pre-populating a new account's rate limits.
//
// GET /admin/api/ratelimits/{provider}/defaults?models=m1,m2
func (h *AdminHandler) HandleGetDefaultLimits(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")
	if provider == "" {
		writeJSON(w, 400, map[string]string{"error": "provider is required"})
		return
	}

	var models []string
	if raw := r.URL.Query().Get("models"); raw != "" {
		for _, m := range strings.Split(raw, ",") {
			if m = strings.TrimSpace(m); m != "" {
				models = append(models, m)
			}
		}
	}

	limits, err := h.db.GetDefaultLimits(provider, models)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	if limits == nil {
		limits = []store.AccountLimit{}
	}
	writeJSON(w, 200, limits)
}
