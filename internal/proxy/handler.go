package proxy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/darkraise/llm-proxy/internal/adapter"
	"github.com/darkraise/llm-proxy/internal/crypto"
	"github.com/darkraise/llm-proxy/internal/provider"
	"github.com/darkraise/llm-proxy/internal/ratelimit"
	"github.com/darkraise/llm-proxy/internal/store"
)

type LogFunc func(entry store.RequestLog)

// RateLimitUpdate carries parsed rate limit definitions from a provider
// response, keyed by provider type and the model used in the request.
type RateLimitUpdate struct {
	Provider string
	Model    string
	Defs     []store.RateLimitDef
}

type Handler struct {
	pool          *provider.Pool
	logFunc       LogFunc
	client        *http.Client
	maxRetries    int
	timeout       time.Duration
	fallback      *FallbackConfig
	rateLimitChan chan RateLimitUpdate
}

type FallbackConfig struct {
	Enabled bool
	BaseURL string
	Model   string
	Timeout time.Duration
}

func NewHandler(pool *provider.Pool, logFunc LogFunc) *Handler {
	return &Handler{
		pool:       pool,
		logFunc:    logFunc,
		client:     &http.Client{Timeout: 15 * time.Second},
		maxRetries: 3,
		timeout:    15 * time.Second,
	}
}

// SetRateLimitChan configures the channel used to deliver parsed rate limit
// header updates to the server's background writer goroutine.
func (h *Handler) SetRateLimitChan(ch chan RateLimitUpdate) {
	h.rateLimitChan = ch
}

func (h *Handler) SetFallback(cfg FallbackConfig) {
	h.fallback = &cfg
}

func (h *Handler) SetConfig(maxRetries int, timeout time.Duration) {
	h.maxRetries = maxRetries
	h.timeout = timeout
	h.client.Timeout = timeout
}

func (h *Handler) HandleChatCompletions(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, 400, "failed to read request body")
		return
	}

	req, err := adapter.ParseOpenAIRequest(body)
	if err != nil {
		writeError(w, 400, "invalid request: "+err.Error())
		return
	}

	if req.Stream {
		h.handleStreaming(w, r, req, "openai", store.CategoryChat)
		return
	}

	h.handleNonStreaming(w, req, "openai", store.CategoryChat)
}

func (h *Handler) HandleAnthropicMessages(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, 400, "failed to read request body")
		return
	}

	req, err := adapter.AnthropicToOpenAI(body)
	if err != nil {
		writeError(w, 400, "invalid request: "+err.Error())
		return
	}

	if req.Stream {
		h.handleStreaming(w, r, req, "anthropic", store.CategoryChat)
		return
	}

	resp, logEntry := h.forwardNonStreaming(req, store.CategoryChat)
	logEntry.Endpoint = "anthropic"

	if resp == nil {
		if h.logFunc != nil {
			h.logFunc(logEntry)
		}
		writeError(w, 503, "all providers exhausted")
		return
	}

	// Convert response to Anthropic format
	anthropicData, err := adapter.OpenAIToAnthropic(*resp)
	if err != nil {
		writeError(w, 500, "response translation error")
		return
	}

	if h.logFunc != nil {
		h.logFunc(logEntry)
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(anthropicData)
}

func (h *Handler) handleNonStreaming(w http.ResponseWriter, req adapter.ChatCompletionRequest, endpoint string, category string) {
	resp, logEntry := h.forwardNonStreaming(req, category)
	logEntry.Endpoint = endpoint

	if h.logFunc != nil {
		h.logFunc(logEntry)
	}

	if resp == nil {
		writeError(w, 503, "all providers exhausted")
		return
	}

	data, _ := adapter.FormatOpenAIResponse(*resp)
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// ─── Embeddings ──────────────────────────────────────────────────────────────

func (h *Handler) HandleEmbeddings(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, 400, "failed to read request body")
		return
	}

	req, err := adapter.ParseEmbeddingRequest(body)
	if err != nil {
		writeError(w, 400, "invalid request: "+err.Error())
		return
	}

	if req.Model == "" {
		writeError(w, 400, "model is required")
		return
	}

	resp, logEntry := h.forwardEmbedding(req)
	logEntry.Endpoint = "embeddings"

	if h.logFunc != nil {
		h.logFunc(logEntry)
	}

	if resp == nil {
		writeError(w, 503, "all providers exhausted")
		return
	}

	data, _ := json.Marshal(resp)
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func (h *Handler) forwardEmbedding(req adapter.EmbeddingRequest) (*adapter.EmbeddingResponse, store.RequestLog) {
	logEntry := store.RequestLog{
		Model:  req.Model,
		Status: "error",
	}

	for attempt := 0; attempt < h.maxRetries; attempt++ {
		prov, err := h.pool.Select(req.Model, store.CategoryEmbedding, h.maxRetries)
		if err != nil {
			break
		}

		logEntry.AccountName = prov.Name
		logEntry.AccountID = &prov.ID
		logEntry.ProviderType = prov.Type
		logEntry.Model = firstModel(prov, req.Model, store.CategoryEmbedding)
		t0 := time.Now()

		var resp *adapter.EmbeddingResponse
		var statusCode int

		switch prov.Type {
		case "cohere":
			resp, statusCode, err = h.callCohereEmbedding(prov, req)
		default:
			resp, statusCode, err = h.callOpenAIEmbedding(prov, req)
		}

		latency := time.Since(t0)
		logEntry.LatencyMs = int(latency.Milliseconds())
		logEntry.StatusCode = statusCode

		if err != nil {
			slog.Warn("embedding provider error", "provider", prov.Name, "error", err)
			h.pool.RecordError(prov.Name, 15*time.Second)
			continue
		}

		if statusCode == 429 {
			slog.Warn("embedding rate limited", "provider", prov.Name)
			h.pool.RecordRateLimit(prov.Name, 60*time.Second)
			continue
		}

		if statusCode >= 500 {
			slog.Warn("embedding server error", "provider", prov.Name, "status", statusCode)
			h.pool.RecordError(prov.Name, 10*time.Second)
			continue
		}

		if statusCode >= 400 {
			logEntry.StatusCode = statusCode
			logEntry.ErrorMessage = fmt.Sprintf("provider returned status %d", statusCode)
			break
		}

		// Success
		if resp != nil {
			logEntry.PromptTokens = resp.Usage.PromptTokens
			h.pool.RecordSuccess(prov.Name, resp.Usage.TotalTokens)
			logEntry.Model = resp.Model
		}
		logEntry.Status = "success"
		slog.Info("embedding ok", "provider", prov.Name, "model", logEntry.Model, "latency_ms", latency.Milliseconds())
		return resp, logEntry
	}

	logEntry.ErrorMessage = "all providers exhausted"
	return nil, logEntry
}

func (h *Handler) callOpenAIEmbedding(prov *provider.AccountInfo, req adapter.EmbeddingRequest) (*adapter.EmbeddingResponse, int, error) {
	req.Model = firstModel(prov, req.Model, store.CategoryEmbedding)
	data, err := adapter.FormatEmbeddingRequest(req)
	if err != nil {
		return nil, 0, err
	}

	baseURL := resolveBaseURL(prov)
	httpReq, err := http.NewRequest("POST", baseURL+"/embeddings", bytes.NewReader(data))
	if err != nil {
		return nil, 0, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+prov.DecryptedKey)

	resp, err := h.client.Do(httpReq)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}

	if resp.StatusCode != 200 {
		return nil, resp.StatusCode, nil
	}

	parsed, err := adapter.ParseEmbeddingResponse(body)
	return &parsed, 200, err
}

func (h *Handler) callCohereEmbedding(prov *provider.AccountInfo, req adapter.EmbeddingRequest) (*adapter.EmbeddingResponse, int, error) {
	req.Model = firstModel(prov, req.Model, store.CategoryEmbedding)
	data, err := adapter.OpenAIToCohereEmbed(req)
	if err != nil {
		return nil, 0, err
	}

	// Cohere native embed endpoint: https://api.cohere.ai/v2/embed
	httpReq, err := http.NewRequest("POST", "https://api.cohere.ai/v2/embed", bytes.NewReader(data))
	if err != nil {
		return nil, 0, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+prov.DecryptedKey)

	resp, err := h.client.Do(httpReq)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}

	if resp.StatusCode != 200 {
		return nil, resp.StatusCode, nil
	}

	parsed, err := adapter.CohereEmbedToOpenAI(body, req.Model)
	return &parsed, 200, err
}

// ─── Chat Completions ────────────────────────────────────────────────────────

func (h *Handler) forwardNonStreaming(req adapter.ChatCompletionRequest, category string) (*adapter.ChatCompletionResponse, store.RequestLog) {
	logEntry := store.RequestLog{
		Model:  req.Model,
		Status: "error",
	}

	req.Stream = false

	for attempt := 0; attempt < h.maxRetries; attempt++ {
		prov, err := h.pool.Select(req.Model, category, h.maxRetries)
		if err != nil {
			break
		}

		logEntry.AccountName = prov.Name
		logEntry.AccountID = &prov.ID
		logEntry.ProviderType = prov.Type
		logEntry.Model = firstModel(prov, req.Model, category)
		t0 := time.Now()

		var resp *adapter.ChatCompletionResponse
		var statusCode int
		var respHeaders http.Header

		switch prov.Type {
		case "google":
			resp, statusCode, err = h.callGoogle(prov, req)
		default:
			resp, statusCode, respHeaders, err = h.callOpenAI(prov, req)
		}

		latency := time.Since(t0)
		logEntry.LatencyMs = int(latency.Milliseconds())
		logEntry.StatusCode = statusCode

		if err != nil {
			slog.Warn("provider error", "provider", prov.Name, "error", err)
			h.pool.RecordError(prov.Name, 15*time.Second)
			continue
		}

		if statusCode == 429 {
			slog.Warn("rate limited", "provider", prov.Name)
			h.pool.RecordRateLimit(prov.Name, 60*time.Second)
			continue
		}

		if statusCode >= 500 {
			slog.Warn("server error", "provider", prov.Name, "status", statusCode)
			h.pool.RecordError(prov.Name, 10*time.Second)
			continue
		}

		// Success
		tokens := 0
		if resp != nil {
			tokens = resp.Usage.TotalTokens
			logEntry.PromptTokens = resp.Usage.PromptTokens
			logEntry.CompletionTokens = resp.Usage.CompletionTokens
		}
		h.pool.RecordSuccess(prov.Name, tokens)
		logEntry.Status = "success"
		logEntry.Model = resp.Model

		// Parse rate limit capacity headers and forward to async writer.
		if h.rateLimitChan != nil && respHeaders != nil {
			if defs := ratelimit.ParseRateLimitHeaders(prov.Type, respHeaders, resp.Model); len(defs) > 0 {
				select {
				case h.rateLimitChan <- RateLimitUpdate{Provider: prov.Type, Model: resp.Model, Defs: defs}:
				default:
					slog.Warn("rate limit chan full, dropping header update")
				}
			}
		}

		slog.Info("request ok", "provider", prov.Name, "model", resp.Model, "latency_ms", latency.Milliseconds())
		return resp, logEntry
	}

	// All cloud providers exhausted — try Ollama fallback
	if h.fallback != nil && h.fallback.Enabled {
		slog.Warn("all cloud providers exhausted, trying Ollama fallback")
		fallbackClient := &http.Client{Timeout: h.fallback.Timeout}
		req.Model = h.fallback.Model
		req.Stream = false
		data, _ := adapter.FormatOpenAIRequest(req)

		httpReq, err := http.NewRequest("POST", h.fallback.BaseURL+"/chat/completions", bytes.NewReader(data))
		if err == nil {
			httpReq.Header.Set("Content-Type", "application/json")
			resp, err := fallbackClient.Do(httpReq)
			if err == nil {
				defer resp.Body.Close()
				body, _ := io.ReadAll(resp.Body)
				if resp.StatusCode == 200 {
					parsed, err := adapter.ParseOpenAIResponse(body)
					if err == nil {
						logEntry.Status = "success"
						logEntry.AccountName = "ollama-fallback"
						logEntry.Model = h.fallback.Model
						logEntry.PromptTokens = parsed.Usage.PromptTokens
						logEntry.CompletionTokens = parsed.Usage.CompletionTokens
						return &parsed, logEntry
					}
				}
			}
		}
		slog.Error("Ollama fallback also failed")
	}

	logEntry.Status = "error"
	logEntry.ErrorMessage = "all providers exhausted"
	return nil, logEntry
}

func (h *Handler) callOpenAI(prov *provider.AccountInfo, req adapter.ChatCompletionRequest) (*adapter.ChatCompletionResponse, int, http.Header, error) {
	req.Model = firstModel(prov, req.Model, store.CategoryChat)
	data, err := adapter.FormatOpenAIRequest(req)
	if err != nil {
		return nil, 0, nil, err
	}

	baseURL := resolveBaseURL(prov)
	httpReq, err := http.NewRequest("POST", baseURL+"/chat/completions", bytes.NewReader(data))
	if err != nil {
		return nil, 0, nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+prov.DecryptedKey)

	resp, err := h.client.Do(httpReq)
	if err != nil {
		return nil, 0, nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, resp.Header, err
	}

	if resp.StatusCode != 200 {
		return nil, resp.StatusCode, resp.Header, nil
	}

	parsed, err := adapter.ParseOpenAIResponse(body)
	return &parsed, 200, resp.Header, err
}

func (h *Handler) callGoogle(prov *provider.AccountInfo, req adapter.ChatCompletionRequest) (*adapter.ChatCompletionResponse, int, error) {
	req.Model = firstModel(prov, req.Model, store.CategoryChat)
	url, body, err := adapter.OpenAIToGoogle(req, prov.DecryptedKey)
	if err != nil {
		return nil, 0, err
	}

	httpReq, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := h.client.Do(httpReq)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}

	if resp.StatusCode != 200 {
		return nil, resp.StatusCode, nil
	}

	parsed, err := adapter.GoogleToOpenAI(respBody, req.Model)
	return &parsed, 200, err
}

// knownProviderURLs maps provider types to their canonical API base URLs.
// For these providers, the stored base_url is ignored.
var knownProviderURLs = map[string]string{
	"groq":       "https://api.groq.com/openai/v1",
	"openrouter": "https://openrouter.ai/api/v1",
	"cerebras":   "https://api.cerebras.ai/v1",
	"mistral":    "https://api.mistral.ai/v1",
	"github":     "https://models.inference.ai.azure.com",
	"cohere":     "https://api.cohere.ai/compatibility/v1",
}

// resolveBaseURL returns the canonical URL for known providers, or falls back to the stored base URL.
func resolveBaseURL(prov *provider.AccountInfo) string {
	if url, ok := knownProviderURLs[prov.Type]; ok {
		return url
	}
	return prov.BaseURL
}

// firstModel resolves the actual model name to send to a provider.
// For "auto" requests it prefers the category-specific default model, then
// falls back to the first model in that category from the account's JSON map.
func firstModel(prov *provider.AccountInfo, requested string, category string) string {
	if requested != "auto" {
		return requested
	}
	if dm, ok := prov.DefaultModels[category]; ok && dm != "" {
		return dm
	}
	parsed := store.ParseCategorizedModels(prov.Models)
	catModels := store.ModelsForCategory(parsed, category)
	if len(catModels) > 0 {
		return catModels[0]
	}
	return requested
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{
			"message": msg,
			"type":    "server_error",
		},
	})
}

// ProxyAuthMiddleware returns middleware that checks for Bearer token on proxy endpoints when enabled.
func ProxyAuthMiddleware(db *store.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			enabled, _ := db.GetSetting("proxy_auth_enabled")
			if enabled != "true" {
				next.ServeHTTP(w, r)
				return
			}

			expectedHash, _ := db.GetSetting("proxy_api_key_hash")
			if expectedHash == "" {
				next.ServeHTTP(w, r) // no key configured, allow through
				return
			}

			auth := r.Header.Get("Authorization")
			if !strings.HasPrefix(auth, "Bearer ") {
				writeError(w, 401, "missing API key")
				return
			}
			token := strings.TrimPrefix(auth, "Bearer ")

			if !crypto.VerifyPassword(expectedHash, token) {
				writeError(w, 401, "invalid API key")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

