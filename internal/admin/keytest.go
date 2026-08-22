package admin

import (
	"encoding/json"
	"net/http"

	"github.com/darkraise/llm-proxy/internal/keyval"
)

// HandleTestKey tests an arbitrary API key against its provider.
//
// POST /api/keys/test
func (h *AdminHandler) HandleTestKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Provider string `json:"provider"`
		Key      string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, 400, "invalid request body")
		return
	}
	if req.Provider == "" || req.Key == "" {
		writeJSONError(w, 400, "provider and key are required")
		return
	}

	info := h.providerInfo(req.Provider, "")
	results := keyval.Validate(r.Context(), info, req.Key, []keyval.StepConfig{{Step: "models_fetch"}})
	last := results[len(results)-1]

	resp := map[string]any{
		"valid":       last.Success,
		"status_code": last.StatusCode,
	}
	if last.Error != "" {
		resp["error"] = last.Error
	}
	if last.Models != nil {
		resp["models"] = last.Models
	}
	if last.RateLimits != nil {
		resp["rate_limits"] = last.RateLimits
	}

	writeJSON(w, 200, resp)
}

// HandleChatTestKey sends a chat completion using a raw API key.
//
// POST /api/keys/chat-test
func (h *AdminHandler) HandleChatTestKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Provider string `json:"provider"`
		Key      string `json:"key"`
		Model    string `json:"model"`
		Message  string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, 400, "invalid request body")
		return
	}
	if req.Provider == "" || req.Key == "" || req.Model == "" {
		writeJSONError(w, 400, "provider, key, and model are required")
		return
	}
	if req.Message == "" {
		req.Message = "say ok"
	}

	info := h.providerInfo(req.Provider, "")
	steps := []keyval.StepConfig{
		{Step: "chat_completion", Params: map[string]any{
			"model": req.Model, "message": req.Message, "max_tokens": float64(20),
		}},
	}
	results := keyval.Validate(r.Context(), info, req.Key, steps)
	last := results[len(results)-1]

	writeJSON(w, 200, map[string]any{
		"status_code": last.StatusCode,
		"response":    last.Response,
		"rate_limits": last.RateLimits,
		"error":       last.Error,
	})
}
