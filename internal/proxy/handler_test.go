package proxy

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/darkraise/llm-proxy/internal/provider"
	"github.com/darkraise/llm-proxy/internal/store"
)

func mockOpenAIProvider(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"id":      "chatcmpl-test",
			"object":  "chat.completion",
			"created": 1700000000,
			"model":   "test-model",
			"choices": []map[string]any{{
				"index":         0,
				"message":       map[string]any{"role": "assistant", "content": "Hello from mock!"},
				"finish_reason": "stop",
			}},
			"usage": map[string]any{"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
		})
	}))
}

func TestHandleChatCompletions_NonStreaming(t *testing.T) {
	mock := mockOpenAIProvider(t)
	defer mock.Close()

	providers := []store.Account{{
		ID: 1, Name: "test", Type: "openai-compatible", BaseURL: mock.URL,
		APIKey: []byte("test-key"), Models: `{"chat":["test-model"]}`, Enabled: true,
	}}

	pool := provider.NewPool(providers)
	h := NewHandler(pool, nil, nil) // nil logger for now

	body := `{"model":"auto","messages":[{"role":"user","content":"Hi"}]}`
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.HandleChatCompletions(w, req)

	resp := w.Result()
	if resp.StatusCode != 200 {
		t.Fatalf("status: %d", resp.StatusCode)
	}

	respBody, _ := io.ReadAll(resp.Body)
	var result map[string]any
	json.Unmarshal(respBody, &result)

	choices := result["choices"].([]any)
	msg := choices[0].(map[string]any)["message"].(map[string]any)
	if msg["content"] != "Hello from mock!" {
		t.Errorf("content: %v", msg["content"])
	}
}

func TestHandleChatCompletions_AllExhausted(t *testing.T) {
	providers := []store.Account{{
		ID: 1, Name: "test", Type: "openai-compatible", BaseURL: "http://unreachable",
		APIKey: []byte("k"), Models: `{"chat":["m"]}`, Enabled: true,
		Limits: []store.AccountLimit{{Metric: "rpm", MaxValue: 0, WindowSecs: 60}},
	}}

	pool := provider.NewPool(providers)
	h := NewHandler(pool, nil, nil)

	body := `{"model":"auto","messages":[{"role":"user","content":"Hi"}]}`
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
	w := httptest.NewRecorder()

	h.HandleChatCompletions(w, req)

	if w.Code != 503 {
		t.Errorf("status: got %d, want 503", w.Code)
	}
}

func TestHandleAnthropicMessages_NonStreaming(t *testing.T) {
	mock := mockOpenAIProvider(t)
	defer mock.Close()

	providers := []store.Account{{
		ID: 1, Name: "test", Type: "openai-compatible", BaseURL: mock.URL,
		APIKey: []byte("test-key"), Models: `{"chat":["test-model"]}`, Enabled: true,
	}}

	pool := provider.NewPool(providers)
	h := NewHandler(pool, nil, nil)

	body := `{"model":"auto","max_tokens":1024,"messages":[{"role":"user","content":"Hi"}]}`
	req := httptest.NewRequest("POST", "/v1/messages", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.HandleAnthropicMessages(w, req)

	resp := w.Result()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status: %d, body: %s", resp.StatusCode, body)
	}

	respBody, _ := io.ReadAll(resp.Body)
	var result map[string]any
	json.Unmarshal(respBody, &result)

	if result["type"] != "message" {
		t.Errorf("type: %v", result["type"])
	}
	if result["role"] != "assistant" {
		t.Errorf("role: %v", result["role"])
	}
}
