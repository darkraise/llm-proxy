package admin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/darkraise/llm-proxy/internal/crypto"
)

type discoverRequest struct {
	Type    string `json:"type"`
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key"`
	FreeOnly bool  `json:"free_only"`
}

type discoverModel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// HandleDiscoverModels fetches the model list from an external provider using
// the credentials supplied in the request body.
//
// POST /admin/api/accounts/discover
func (h *AdminHandler) HandleDiscoverModels(w http.ResponseWriter, r *http.Request) {
	var req discoverRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}

	if req.Type == "" {
		writeJSON(w, 400, map[string]string{"error": "type is required"})
		return
	}

	client := &http.Client{Timeout: 7 * time.Second}

	var fetchURL string
	var fetchReq *http.Request
	var err error

	switch req.Type {
	case "google":
		fetchURL = fmt.Sprintf(
			"https://generativelanguage.googleapis.com/v1beta/openai/models?key=%s",
			req.APIKey,
		)
		fetchReq, err = http.NewRequestWithContext(r.Context(), "GET", fetchURL, nil)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "failed to build request: " + err.Error()})
			return
		}
		// No Authorization header for Google key-based auth.

	case "ollama":
		fetchURL = req.BaseURL + "/models"
		fetchReq, err = http.NewRequestWithContext(r.Context(), "GET", fetchURL, nil)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "failed to build request: " + err.Error()})
			return
		}
		// Ollama needs no auth header.

	default:
		fetchURL = req.BaseURL + "/models"
		fetchReq, err = http.NewRequestWithContext(r.Context(), "GET", fetchURL, nil)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "failed to build request: " + err.Error()})
			return
		}
		fetchReq.Header.Set("Authorization", "Bearer "+req.APIKey)
	}

	resp, err := client.Do(fetchReq)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "failed to reach provider: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		writeJSON(w, 401, map[string]string{"error": "authentication failed"})
		return
	}
	if resp.StatusCode >= 400 {
		writeJSON(w, 502, map[string]string{"error": fmt.Sprintf("provider returned status %d", resp.StatusCode)})
		return
	}

	// Parse OpenAI-compatible response: {"object":"list","data":[{"id":"..."},...]}
	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		writeJSON(w, 502, map[string]string{"error": "failed to parse provider response: " + err.Error()})
		return
	}

	models := make([]discoverModel, 0, len(body.Data))
	for _, item := range body.Data {
		if item.ID == "" {
			continue
		}
		// For openrouter with free_only: keep only models with ":free" suffix.
		if req.FreeOnly && req.Type == "openrouter" && !strings.HasSuffix(item.ID, ":free") {
			continue
		}
		models = append(models, discoverModel{ID: item.ID, Name: item.ID})
	}

	writeJSON(w, 200, map[string]any{"models": models})
}

// HandleDiscoverByAccount fetches models using a stored account's credentials.
// This is used by the Rate Limits page to refresh the model list.
//
// POST /admin/api/accounts/{id}/discover
func (h *AdminHandler) HandleDiscoverByAccount(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid id"})
		return
	}

	account, err := h.db.GetAccount(id)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "account not found"})
		return
	}

	// Decrypt API key
	apiKey := string(account.APIKey)
	if h.encryptionKey != nil {
		if plain, err := crypto.Decrypt(h.encryptionKey, account.APIKey); err == nil {
			apiKey = string(plain)
		}
	}

	// Reuse the discover logic by constructing a discoverRequest
	req := discoverRequest{
		Type:    account.Type,
		BaseURL: account.BaseURL,
		APIKey:  apiKey,
	}

	client := &http.Client{Timeout: 7 * time.Second}

	var fetchURL string
	var fetchReq *http.Request

	switch req.Type {
	case "google":
		fetchURL = fmt.Sprintf(
			"https://generativelanguage.googleapis.com/v1beta/openai/models?key=%s",
			req.APIKey,
		)
		fetchReq, err = http.NewRequest("GET", fetchURL, nil)
	case "ollama":
		fetchURL = req.BaseURL + "/models"
		fetchReq, err = http.NewRequest("GET", fetchURL, nil)
	default:
		fetchURL = req.BaseURL + "/models"
		fetchReq, err = http.NewRequest("GET", fetchURL, nil)
		if err == nil {
			fetchReq.Header.Set("Authorization", "Bearer "+req.APIKey)
		}
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "failed to build request"})
		return
	}

	resp, err := client.Do(fetchReq)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "failed to reach provider: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		writeJSON(w, 502, map[string]string{"error": fmt.Sprintf("provider returned status %d", resp.StatusCode)})
		return
	}

	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		writeJSON(w, 502, map[string]string{"error": "failed to parse response"})
		return
	}

	models := make([]discoverModel, 0, len(body.Data))
	for _, item := range body.Data {
		if item.ID != "" {
			models = append(models, discoverModel{ID: item.ID, Name: item.ID})
		}
	}

	writeJSON(w, 200, map[string]any{"models": models})
}
