package test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	cryptopkg "github.com/darkraise/llm-proxy/internal/crypto"
	"github.com/darkraise/llm-proxy/internal/server"
)

// mockOpenAIHandler returns a valid OpenAI chat completion response for any request.
func mockOpenAIHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"id":      "chatcmpl-test",
		"object":  "chat.completion",
		"created": 1700000000,
		"model":   "test-model",
		"choices": []map[string]any{{
			"index": 0,
			"message": map[string]any{
				"role":    "assistant",
				"content": "Hello from integration test!",
			},
			"finish_reason": "stop",
		}},
		"usage": map[string]any{
			"prompt_tokens":     10,
			"completion_tokens": 5,
			"total_tokens":      15,
		},
	})
}

func TestIntegration_FullFlow(t *testing.T) {
	// 1. Start mock LLM provider
	mockProvider := httptest.NewServer(http.HandlerFunc(mockOpenAIHandler))
	defer mockProvider.Close()

	// 2. Set ADMIN_PASSWORD_HASH env var for the server
	dataDir := t.TempDir()

	hash, err := cryptopkg.HashPassword("test-password")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	t.Setenv("ADMIN_PASSWORD_HASH", hash)

	// 3. Create proxy server
	cfg := server.Config{
		Port:      0,
		AdminPort: 0,
		DataDir:   dataDir,
		Version:   "test",
	}
	srv, err := server.New(cfg)
	if err != nil {
		t.Fatalf("server.New: %v", err)
	}

	// Start async background workers (log writer, pruner).
	// Normally launched by srv.Start(); since we use httptest we do it here.
	srv.StartBackgroundWorkers()

	ts := httptest.NewServer(srv.ProxyHandler())
	adminTS := httptest.NewServer(srv.AdminHandler())
	t.Cleanup(func() {
		ts.Close()
		adminTS.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		srv.Shutdown(ctx) //nolint:errcheck
	})

	// HTTP client with cookie jar so the session cookie persists across requests.
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookiejar.New: %v", err)
	}
	client := &http.Client{Jar: jar}

	proxyBase := ts.URL
	adminBase := adminTS.URL

	// ── a. Login ──────────────────────────────────────────────────────────────
	t.Run("login", func(t *testing.T) {
		resp := mustPost(t, client, adminBase+"/api/auth/login",
			`{"password":"test-password"}`)
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("login: got %d: %s", resp.StatusCode, body)
		}
	})

	// ── b. Create account ─────────────────────────────────────────────────────
	var accountID float64
	t.Run("create_account", func(t *testing.T) {
		payload, _ := json.Marshal(map[string]any{
			"name":     "mock-account",
			"type":     "openai-compatible",
			"base_url": mockProvider.URL,
			"api_key":  "test-key",
			"models":   map[string][]string{"chat": {"test-model"}},
			"priority": 1,
		})
		resp := mustPost(t, client, adminBase+"/api/accounts", string(payload))
		defer resp.Body.Close()
		if resp.StatusCode != 201 {
			raw, _ := io.ReadAll(resp.Body)
			t.Fatalf("create account: got %d: %s", resp.StatusCode, raw)
		}
		var result map[string]any
		json.NewDecoder(resp.Body).Decode(&result)
		id, ok := result["id"].(float64)
		if !ok || id == 0 {
			t.Fatalf("create account: unexpected id: %v", result)
		}
		accountID = id
	})

	// ── c. List accounts ──────────────────────────────────────────────────────
	t.Run("list_accounts", func(t *testing.T) {
		resp := mustGet(t, client, adminBase+"/api/accounts")
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("list accounts: got %d", resp.StatusCode)
		}
		var accounts []map[string]any
		json.NewDecoder(resp.Body).Decode(&accounts)
		if len(accounts) == 0 {
			t.Fatal("list accounts: expected at least 1 account")
		}
		found := false
		for _, p := range accounts {
			if p["name"] == "mock-account" {
				found = true
			}
		}
		if !found {
			t.Fatalf("list accounts: mock-account not found, got: %v", accounts)
		}
	})

	// ── d. Chat completion (OpenAI) ───────────────────────────────────────────
	t.Run("chat_completion", func(t *testing.T) {
		body := `{"model":"test-model","messages":[{"role":"user","content":"Hello"}]}`
		resp := mustPost(t, client, proxyBase+"/v1/chat/completions", body)
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			raw, _ := io.ReadAll(resp.Body)
			t.Fatalf("chat completions: got %d: %s", resp.StatusCode, raw)
		}
		var result map[string]any
		json.NewDecoder(resp.Body).Decode(&result)
		choices, ok := result["choices"].([]any)
		if !ok || len(choices) == 0 {
			t.Fatalf("chat completions: no choices in response: %v", result)
		}
		choice := choices[0].(map[string]any)
		msg := choice["message"].(map[string]any)
		if msg["content"] != "Hello from integration test!" {
			t.Errorf("chat completions: unexpected content: %v", msg["content"])
		}
	})

	// ── e. Anthropic messages ─────────────────────────────────────────────────
	t.Run("anthropic_messages", func(t *testing.T) {
		body := `{"model":"test-model","max_tokens":100,"messages":[{"role":"user","content":"Hello"}]}`
		resp := mustPost(t, client, proxyBase+"/v1/messages", body)
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			raw, _ := io.ReadAll(resp.Body)
			t.Fatalf("anthropic messages: got %d: %s", resp.StatusCode, raw)
		}
		var result map[string]any
		json.NewDecoder(resp.Body).Decode(&result)
		if result["type"] != "message" {
			t.Errorf("anthropic messages: expected type=message, got: %v", result["type"])
		}
		content, ok := result["content"].([]any)
		if !ok || len(content) == 0 {
			t.Fatalf("anthropic messages: no content in response: %v", result)
		}
		block := content[0].(map[string]any)
		if block["type"] != "text" {
			t.Errorf("anthropic messages: expected content[0].type=text, got: %v", block["type"])
		}
		if block["text"] != "Hello from integration test!" {
			t.Errorf("anthropic messages: unexpected text: %v", block["text"])
		}
	})

	// ── f. Stats overview (wait for async log flush) ──────────────────────────
	t.Run("stats_overview", func(t *testing.T) {
		// The log writer batches on a 1-second ticker; wait for a full flush cycle.
		time.Sleep(1500 * time.Millisecond)

		resp := mustGet(t, client, adminBase+"/api/stats/overview")
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("stats overview: got %d", resp.StatusCode)
		}
		var stats map[string]any
		json.NewDecoder(resp.Body).Decode(&stats)
		total, _ := stats["total_requests"].(float64)
		if total < 2 {
			t.Errorf("stats overview: expected >=2 requests recorded, got %v", total)
		}
	})

	// ── g. Health ─────────────────────────────────────────────────────────────
	t.Run("health", func(t *testing.T) {
		resp := mustGet(t, client, proxyBase+"/health")
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("health: got %d", resp.StatusCode)
		}
		var result map[string]any
		json.NewDecoder(resp.Body).Decode(&result)
		status, _ := result["status"].(string)
		if status != "healthy" {
			t.Errorf("health: expected healthy, got %q (full: %v)", status, result)
		}
	})

	// ── h. List models ────────────────────────────────────────────────────────
	t.Run("list_models", func(t *testing.T) {
		resp := mustGet(t, client, proxyBase+"/v1/models")
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("list models: got %d", resp.StatusCode)
		}
		var result map[string]any
		json.NewDecoder(resp.Body).Decode(&result)
		data, ok := result["data"].([]any)
		if !ok {
			t.Fatalf("list models: no data field: %v", result)
		}
		ids := make(map[string]bool)
		for _, m := range data {
			model := m.(map[string]any)
			if id, ok := model["id"].(string); ok {
				ids[id] = true
			}
		}
		if !ids["auto"] {
			t.Errorf("list models: expected 'auto' model, got: %v", ids)
		}
		if !ids["test-model"] {
			t.Errorf("list models: expected 'test-model', got: %v", ids)
		}
	})

	_ = accountID
}

// ── helpers ────────────────────────────────────────────────────────────────────

func mustPost(t *testing.T, client *http.Client, url, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest("POST", url, strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s: build request: %v", url, err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	return resp
}

func mustGet(t *testing.T, client *http.Client, url string) *http.Response {
	t.Helper()
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		t.Fatalf("GET %s: build request: %v", url, err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	return resp
}
