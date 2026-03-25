package proxy

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/darkraise/llm-proxy/internal/provider"
	"github.com/darkraise/llm-proxy/internal/store"
)

func mockStreamingProvider(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("expected flusher")
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")

		chunks := []string{
			`{"id":"1","object":"chat.completion.chunk","created":1700000000,"model":"test","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}`,
			`{"id":"1","object":"chat.completion.chunk","created":1700000000,"model":"test","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}`,
			`{"id":"1","object":"chat.completion.chunk","created":1700000000,"model":"test","choices":[{"index":0,"delta":{"content":" World"},"finish_reason":null}]}`,
			`{"id":"1","object":"chat.completion.chunk","created":1700000000,"model":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}`,
		}

		for _, chunk := range chunks {
			fmt.Fprintf(w, "data: %s\n\n", chunk)
			flusher.Flush()
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
	}))
}

func TestHandleChatCompletions_Streaming(t *testing.T) {
	mock := mockStreamingProvider(t)
	defer mock.Close()

	providers := []store.Account{{
		ID: 1, Name: "test", Type: "openai-compatible", BaseURL: mock.URL,
		APIKey: []byte("test-key"), Models: `["test-model"]`, Enabled: true,
	}}

	pool := provider.NewPool(providers)
	h := NewHandler(pool, nil)

	body := `{"model":"auto","messages":[{"role":"user","content":"Hi"}],"stream":true}`
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.HandleChatCompletions(w, req)

	resp := w.Result()
	if resp.StatusCode != 200 {
		t.Fatalf("status: %d", resp.StatusCode)
	}

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/event-stream") {
		t.Errorf("content-type: %q", ct)
	}

	// Parse SSE events
	scanner := bufio.NewScanner(resp.Body)
	var chunks []string
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data: ") {
			data := strings.TrimPrefix(line, "data: ")
			chunks = append(chunks, data)
		}
	}

	if len(chunks) < 4 {
		t.Fatalf("expected at least 4 chunks, got %d", len(chunks))
	}

	// Last should be [DONE]
	if chunks[len(chunks)-1] != "[DONE]" {
		t.Errorf("last chunk: %q", chunks[len(chunks)-1])
	}

	// Verify content in chunks
	var content string
	for _, c := range chunks {
		if c == "[DONE]" {
			continue
		}
		var chunk map[string]any
		json.Unmarshal([]byte(c), &chunk)
		choices := chunk["choices"].([]any)
		delta := choices[0].(map[string]any)["delta"].(map[string]any)
		if text, ok := delta["content"].(string); ok {
			content += text
		}
	}
	if content != "Hello World" {
		t.Errorf("streamed content: %q", content)
	}
}
