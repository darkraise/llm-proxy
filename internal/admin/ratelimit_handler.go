package admin

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/darkraise/llm-proxy/internal/ratelimit"
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

// HandleFetchProviderDocs fetches live rate limit definitions from provider
// documentation pages and returns them as AccountLimit entries.
//
// POST /admin/api/ratelimits/{provider}/fetch-docs
func (h *AdminHandler) HandleFetchProviderDocs(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")
	if provider == "" {
		writeJSON(w, 400, map[string]string{"error": "provider is required"})
		return
	}

	defs, err := ratelimit.FetchProviderRateLimits(provider)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": err.Error()})
		return
	}

	limits := make([]store.AccountLimit, len(defs))
	for i, d := range defs {
		limits[i] = store.AccountLimit{
			Model:      d.Model,
			Metric:     d.Metric,
			MaxValue:   d.MaxValue,
			WindowSecs: d.WindowSecs,
		}
	}
	writeJSON(w, 200, limits)
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
