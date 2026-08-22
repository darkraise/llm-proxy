package admin

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/darkraise/llm-proxy/internal/keyval"
)

type discoverRequest struct {
	Type     string `json:"type"`
	BaseURL  string `json:"base_url"`
	APIKey   string `json:"api_key"`
	FreeOnly bool   `json:"free_only"`
}

// HandleDiscoverModels fetches the model list from an external provider using
// the credentials supplied in the request body.
//
// POST /admin/api/accounts/discover
func (h *AdminHandler) HandleDiscoverModels(w http.ResponseWriter, r *http.Request) {
	var req discoverRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, 400, "invalid request")
		return
	}
	if req.Type == "" {
		writeJSONError(w, 400, "type is required")
		return
	}

	info := h.providerInfo(req.Type, "")
	if req.BaseURL != "" {
		if info.BaseURL != "" && strings.HasPrefix(info.ModelsURL, info.BaseURL) {
			info.ModelsURL = ""
		}
		info.BaseURL = req.BaseURL
	}
	results := keyval.Validate(r.Context(), info, req.APIKey, []keyval.StepConfig{{Step: "models_fetch"}})
	last := results[len(results)-1]

	if !last.Success {
		status := 502
		if last.StatusCode == 401 || last.StatusCode == 403 {
			status = 401
		}
		writeJSONError(w, status, last.Error)
		return
	}

	models := make([]map[string]string, len(last.Models))
	for i, m := range last.Models {
		models[i] = map[string]string{"id": m, "name": m}
	}

	if req.FreeOnly {
		var filtered []map[string]string
		for _, m := range models {
			if strings.HasSuffix(m["id"], ":free") {
				filtered = append(filtered, m)
			}
		}
		if len(filtered) > 0 {
			models = filtered
		}
	}

	writeJSON(w, 200, map[string]any{"models": models})
}

// HandleDiscoverByAccount fetches models using a stored account's credentials.
//
// POST /admin/api/accounts/{id}/discover
func (h *AdminHandler) HandleDiscoverByAccount(w http.ResponseWriter, r *http.Request) {
	id, ok := parsePathID(w, r)
	if !ok {
		return
	}
	account, err := h.db.GetAccount(id)
	if err != nil {
		writeJSONError(w, 404, "account not found")
		return
	}
	apiKey, err := h.decryptAccountKey(account)
	if err != nil {
		writeJSONError(w, 500, "failed to decrypt API key")
		return
	}

	info := h.providerInfo(account.Type, account.BaseURL)
	results := keyval.Validate(r.Context(), info, apiKey, []keyval.StepConfig{{Step: "models_fetch"}})
	last := results[len(results)-1]

	if !last.Success {
		writeJSONError(w, 502, last.Error)
		return
	}

	models := make([]map[string]string, len(last.Models))
	for i, m := range last.Models {
		models[i] = map[string]string{"id": m, "name": m}
	}
	writeJSON(w, 200, map[string]any{"models": models})
}

// HandleDiscoverOllama fetches models from an Ollama instance by URL.
// No auth or account needed — used by the fallback settings UI.
//
// POST /api/ollama/discover
func (h *AdminHandler) HandleDiscoverOllama(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
		writeJSONError(w, 400, "url is required")
		return
	}

	baseURL := strings.TrimRight(req.URL, "/")
	// Ollama native API: GET /api/tags
	fetchURL := strings.TrimSuffix(baseURL, "/v1") + "/api/tags"

	client := &http.Client{Timeout: 7 * time.Second}
	httpReq, err := http.NewRequestWithContext(r.Context(), "GET", fetchURL, nil)
	if err != nil {
		writeJSONError(w, 500, "failed to build request")
		return
	}

	slog.Debug("egress", "method", "GET", "url", fetchURL, "target", "ollama")
	resp, err := client.Do(httpReq)
	if err != nil {
		writeJSONError(w, 502, "failed to reach Ollama: " + err.Error())
		return
	}
	defer resp.Body.Close()
	slog.Debug("egress response", "url", fetchURL, "status", resp.StatusCode)

	if resp.StatusCode >= 400 {
		writeJSONError(w, 502, fmt.Sprintf("Ollama returned status %d", resp.StatusCode))
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeJSONError(w, 502, "failed to read response")
		return
	}

	// Ollama /api/tags returns {"models": [{"name": "llama3.2:latest", ...}]}
	var tagsResp struct {
		Models []struct {
			Name    string `json:"name"`
			Details struct {
				Family string `json:"family"`
			} `json:"details"`
		} `json:"models"`
	}
	if err := json.Unmarshal(body, &tagsResp); err != nil || len(tagsResp.Models) == 0 {
		writeJSONError(w, 502, "no models found")
		return
	}

	type ollamaModel struct {
		Name   string `json:"name"`
		Family string `json:"family"`
	}
	models := make([]ollamaModel, 0, len(tagsResp.Models))
	for _, m := range tagsResp.Models {
		models = append(models, ollamaModel{
			Name:   m.Name,
			Family: m.Details.Family,
		})
	}

	writeJSON(w, 200, models)
}
