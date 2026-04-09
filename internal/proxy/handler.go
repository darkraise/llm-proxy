package proxy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/darkraise/llm-proxy/internal/adapter"
	"github.com/darkraise/llm-proxy/internal/keyval"
	"github.com/darkraise/llm-proxy/internal/crypto"
	"github.com/darkraise/llm-proxy/internal/notify"
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
	db            *store.DB
	logFunc       LogFunc
	rateLimitChan chan RateLimitUpdate
	notifier      *notify.Notifier

	// configMu protects fields below — written by SetConfig/SetFallback,
	// read by concurrent request goroutines.
	configMu   sync.RWMutex
	client     *http.Client
	maxRetries int
	timeout    time.Duration
	fallback   *FallbackConfig
}

type FallbackConfig struct {
	Enabled        bool
	BaseURL        string
	ChatModel      string
	EmbeddingModel string
	Timeout        time.Duration
}

func NewHandler(pool *provider.Pool, db *store.DB, logFunc LogFunc) *Handler {
	return &Handler{
		pool:       pool,
		db:         db,
		logFunc:    logFunc,
		client:     &http.Client{Timeout: 15 * time.Second},
		maxRetries: 12,
		timeout:    15 * time.Second,
	}
}

// SetRateLimitChan configures the channel used to deliver parsed rate limit
// header updates to the server's background writer goroutine.
func (h *Handler) SetRateLimitChan(ch chan RateLimitUpdate) {
	h.rateLimitChan = ch
}

func (h *Handler) SetFallback(cfg FallbackConfig) {
	h.configMu.Lock()
	defer h.configMu.Unlock()
	h.fallback = &cfg
}

func (h *Handler) SetConfig(maxRetries int, timeout time.Duration) {
	h.configMu.Lock()
	defer h.configMu.Unlock()
	h.maxRetries = maxRetries
	h.timeout = timeout
	h.client = &http.Client{Timeout: timeout}
}

func (h *Handler) SetNotifier(n *notify.Notifier) {
	h.notifier = n
}

// config returns a snapshot of the current config, safe for use in a request.
func (h *Handler) config() (int, time.Duration, *http.Client, *FallbackConfig) {
	h.configMu.RLock()
	defer h.configMu.RUnlock()
	return h.maxRetries, h.timeout, h.client, h.fallback
}

func (h *Handler) httpClient() *http.Client {
	h.configMu.RLock()
	defer h.configMu.RUnlock()
	return h.client
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
	maxRetries, timeout, _, fallback := h.config()

	logEntry := store.RequestLog{
		Model:  req.Model,
		Status: "error",
	}

	providerFailures := make(map[string]int)
	skipProviders := make(map[string]bool)

	for attempt := 0; attempt < maxRetries; attempt++ {
		prov, err := h.pool.SelectExcluding(req.Model, store.CategoryEmbedding, maxRetries, skipProviders)
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

		isTimeout := err != nil && (latency >= timeout || isTimeoutError(err))

		if err != nil {
			slog.Warn("embedding provider error", "provider", prov.Name, "type", prov.Type, "error", err)
			h.pool.RecordError(prov.Name, 15*time.Second)
			providerFailures[prov.Type]++
			if isTimeout || providerFailures[prov.Type] >= 3 {
				reason := "consecutive failures"
				if isTimeout {
					reason = "request timeout"
				}
				h.markProviderUnstable(prov.Type, reason)
				if h.notifier != nil {
					h.notifier.Alert(notify.NewProviderUnstableAlert(prov.Type, reason))
				}
				skipProviders[prov.Type] = true
			}
			continue
		}

		if statusCode == 429 {
			slog.Warn("embedding rate limited", "provider", prov.Name, "type", prov.Type)
			h.pool.RecordRateLimit(prov.Name, 60*time.Second)
			providerFailures[prov.Type]++
			if providerFailures[prov.Type] >= 3 {
				reason := "rate limited across accounts"
				h.markProviderUnstable(prov.Type, reason)
				if h.notifier != nil {
					h.notifier.Alert(notify.NewProviderUnstableAlert(prov.Type, reason))
				}
				skipProviders[prov.Type] = true
			}
			continue
		}

		if statusCode >= 400 {
			slog.Warn("embedding error", "provider", prov.Name, "type", prov.Type, "status", statusCode)
			h.pool.RecordError(prov.Name, 15*time.Second)
			if (statusCode == 401 || statusCode == 403) && h.notifier != nil {
				h.notifier.Alert(notify.NewAccountAuthFailureAlert(prov.Name, statusCode))
			}
			providerFailures[prov.Type]++
			if providerFailures[prov.Type] >= 3 {
				reason := fmt.Sprintf("errors (status %d)", statusCode)
				h.markProviderUnstable(prov.Type, reason)
				if h.notifier != nil {
					h.notifier.Alert(notify.NewProviderUnstableAlert(prov.Type, reason))
				}
				skipProviders[prov.Type] = true
			}
			continue
		}

		// Success
		if resp != nil {
			logEntry.PromptTokens = resp.Usage.PromptTokens
			h.pool.RecordSuccessForModel(prov.Name, logEntry.Model, resp.Usage.TotalTokens)
			h.pool.RecordInputsForModel(prov.Name, logEntry.Model, req.InputCount())
			logEntry.Model = resp.Model
		}
		logEntry.Status = "success"
		slog.Info("embedding ok", "provider", prov.Name, "model", logEntry.Model, "latency_ms", latency.Milliseconds())
		return resp, logEntry
	}

	// All providers exhausted — try Ollama fallback for embeddings
	if fallback != nil && fallback.Enabled && fallback.EmbeddingModel != "" {
		slog.Warn("all embedding providers exhausted, trying Ollama fallback")
		fallbackClient := &http.Client{Timeout: fallback.Timeout}
		req.Model = fallback.EmbeddingModel

		data, _ := json.Marshal(req)
		fallbackURL := strings.TrimRight(fallback.BaseURL, "/")
		if !strings.HasSuffix(fallbackURL, "/v1") {
			fallbackURL += "/v1"
		}
		httpReq, err := http.NewRequest("POST", fallbackURL+"/embeddings", bytes.NewReader(data))
		if err == nil {
			httpReq.Header.Set("Content-Type", "application/json")
			resp, err := fallbackClient.Do(httpReq)
			if err == nil {
				defer resp.Body.Close()
				body, _ := io.ReadAll(resp.Body)
				if resp.StatusCode == 200 {
					var parsed adapter.EmbeddingResponse
					if err := json.Unmarshal(body, &parsed); err == nil {
						logEntry.Status = "success"
						logEntry.AccountName = "ollama-fallback"
						logEntry.Model = fallback.EmbeddingModel
						logEntry.PromptTokens = parsed.Usage.PromptTokens
						return &parsed, logEntry
					}
				}
			}
		}
		slog.Error("Ollama embedding fallback also failed")
	}

	if h.notifier != nil {
		h.notifier.Alert(notify.NewProvidersExhaustedAlert(req.Model))
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
	setProviderAuth(httpReq, prov)

	embedURL := baseURL + "/embeddings"
	slog.Debug("egress", "method", "POST", "url", embedURL, "provider", prov.Name, "model", req.Model)
	resp, err := h.httpClient().Do(httpReq)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	slog.Debug("egress response", "url", embedURL, "provider", prov.Name, "status", resp.StatusCode)

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
	setProviderAuth(httpReq, prov)

	cohereURL := "https://api.cohere.ai/v2/embed"
	slog.Debug("egress", "method", "POST", "url", cohereURL, "provider", prov.Name, "model", req.Model)
	resp, err := h.httpClient().Do(httpReq)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	slog.Debug("egress response", "url", cohereURL, "provider", prov.Name, "status", resp.StatusCode)

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
	maxRetries, timeout, _, fallback := h.config()

	logEntry := store.RequestLog{
		Model:  req.Model,
		Status: "error",
	}

	req.Stream = false

	// Track failures per provider type during this request
	providerFailures := make(map[string]int)
	skipProviders := make(map[string]bool)

	for attempt := 0; attempt < maxRetries; attempt++ {
		prov, err := h.pool.SelectExcluding(req.Model, category, maxRetries, skipProviders)
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

		switch prov.APIStandard {
		case "google":
			resp, statusCode, err = h.callGoogle(prov, req)
		default:
			resp, statusCode, respHeaders, err = h.callOpenAI(prov, req)
		}

		latency := time.Since(t0)
		logEntry.LatencyMs = int(latency.Milliseconds())
		logEntry.StatusCode = statusCode

		isTimeout := err != nil && (latency >= timeout || isTimeoutError(err))

		if err != nil {
			slog.Warn("provider error", "provider", prov.Name, "type", prov.Type, "error", err)
			h.pool.RecordError(prov.Name, 15*time.Second)
			providerFailures[prov.Type]++
			if isTimeout {
				reason := "request timeout"
				h.markProviderUnstable(prov.Type, reason)
				if h.notifier != nil {
					h.notifier.Alert(notify.NewProviderUnstableAlert(prov.Type, reason))
				}
				skipProviders[prov.Type] = true
			} else if providerFailures[prov.Type] >= 3 {
				reason := fmt.Sprintf("%d consecutive failures", providerFailures[prov.Type])
				h.markProviderUnstable(prov.Type, reason)
				if h.notifier != nil {
					h.notifier.Alert(notify.NewProviderUnstableAlert(prov.Type, reason))
				}
				skipProviders[prov.Type] = true
			}
			continue
		}

		if statusCode == 429 {
			slog.Warn("rate limited", "provider", prov.Name, "type", prov.Type)
			h.pool.RecordRateLimit(prov.Name, 60*time.Second)
			providerFailures[prov.Type]++
			if providerFailures[prov.Type] >= 3 {
				reason := "rate limited across accounts"
				h.markProviderUnstable(prov.Type, reason)
				if h.notifier != nil {
					h.notifier.Alert(notify.NewProviderUnstableAlert(prov.Type, reason))
				}
				skipProviders[prov.Type] = true
			}
			continue
		}

		if statusCode >= 500 {
			slog.Warn("server error", "provider", prov.Name, "type", prov.Type, "status", statusCode)
			h.pool.RecordError(prov.Name, 10*time.Second)
			providerFailures[prov.Type]++
			if providerFailures[prov.Type] >= 3 {
				reason := fmt.Sprintf("server errors (status %d)", statusCode)
				h.markProviderUnstable(prov.Type, reason)
				if h.notifier != nil {
					h.notifier.Alert(notify.NewProviderUnstableAlert(prov.Type, reason))
				}
				skipProviders[prov.Type] = true
			}
			continue
		}

		if statusCode >= 400 {
			slog.Warn("client error", "provider", prov.Name, "type", prov.Type, "status", statusCode)
			h.pool.RecordError(prov.Name, 15*time.Second)
			if (statusCode == 401 || statusCode == 403) && h.notifier != nil {
				h.notifier.Alert(notify.NewAccountAuthFailureAlert(prov.Name, statusCode))
			}
			providerFailures[prov.Type]++
			if providerFailures[prov.Type] >= 3 {
				reason := fmt.Sprintf("client errors (status %d)", statusCode)
				h.markProviderUnstable(prov.Type, reason)
				if h.notifier != nil {
					h.notifier.Alert(notify.NewProviderUnstableAlert(prov.Type, reason))
				}
				skipProviders[prov.Type] = true
			}
			continue
		}

		// Success
		if resp == nil {
			continue
		}
		logEntry.PromptTokens = resp.Usage.PromptTokens
		logEntry.CompletionTokens = resp.Usage.CompletionTokens
		h.pool.RecordSuccessForModel(prov.Name, logEntry.Model, resp.Usage.TotalTokens)
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
	if fallback != nil && fallback.Enabled && fallback.ChatModel != "" {
		slog.Warn("all cloud providers exhausted, trying Ollama fallback")
		fallbackClient := &http.Client{Timeout: fallback.Timeout}
		req.Model = fallback.ChatModel
		req.Stream = false
		data, _ := adapter.FormatOpenAIRequest(req)

		fallbackURL := strings.TrimRight(fallback.BaseURL, "/")
		if !strings.HasSuffix(fallbackURL, "/v1") {
			fallbackURL += "/v1"
		}
		httpReq, err := http.NewRequest("POST", fallbackURL+"/chat/completions", bytes.NewReader(data))
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
						logEntry.Model = fallback.ChatModel
						logEntry.PromptTokens = parsed.Usage.PromptTokens
						logEntry.CompletionTokens = parsed.Usage.CompletionTokens
						return &parsed, logEntry
					}
				}
			}
		}
		slog.Error("Ollama fallback also failed")
	}

	if h.notifier != nil {
		h.notifier.Alert(notify.NewProvidersExhaustedAlert(req.Model))
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
	setProviderAuth(httpReq, prov)

	chatURL := baseURL + "/chat/completions"
	slog.Debug("egress", "method", "POST", "url", chatURL, "provider", prov.Name, "model", req.Model)
	resp, err := h.httpClient().Do(httpReq)
	if err != nil {
		return nil, 0, nil, err
	}
	defer resp.Body.Close()
	slog.Debug("egress response", "url", chatURL, "provider", prov.Name, "status", resp.StatusCode)

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

	slog.Debug("egress", "method", "POST", "url", url, "provider", prov.Name, "model", req.Model)
	resp, err := h.httpClient().Do(httpReq)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	slog.Debug("egress response", "url", url, "provider", prov.Name, "status", resp.StatusCode)

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
func (h *Handler) markProviderUnstable(providerType, reason string) {
	if h.db != nil {
		if err := h.db.MarkProviderUnstable(providerType, reason); err != nil {
			slog.Warn("failed to mark provider unstable", "provider", providerType, "error", err)
		} else {
			slog.Warn("provider marked unstable", "provider", providerType, "reason", reason)
		}
	}
}

func isTimeoutError(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "timeout") || strings.Contains(s, "deadline exceeded")
}

func resolveBaseURL(prov *provider.AccountInfo) string {
	return prov.ProviderURL
}

func setProviderAuth(httpReq *http.Request, prov *provider.AccountInfo) {
	keyval.SetAuth(httpReq, prov.AuthType, prov.AuthHeader, prov.DecryptedKey)
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
				writeError(w, 503, "proxy auth enabled but no API key configured")
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

