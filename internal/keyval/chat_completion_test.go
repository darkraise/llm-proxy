package keyval_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/darkraise/llm-proxy/internal/keyval"
)

func TestChatCompletionStep_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		json.NewDecoder(r.Body).Decode(&req)
		if req["model"] != "gpt-4o" {
			t.Errorf("expected model gpt-4o, got %v", req["model"])
		}
		w.Header().Set("X-RateLimit-Limit-Requests", "500")
		w.Write([]byte(`{"id":"chatcmpl-1","choices":[{"message":{"content":"ok"}}],"usage":{"total_tokens":10}}`))
	}))
	defer srv.Close()

	step := keyval.ChatCompletionStep{Model: "gpt-4o", Message: "say ok", MaxTokens: 5}
	result := step.Run(context.Background(), srv.Client(), keyval.ProviderInfo{
		Name:     "openai",
		BaseURL:  srv.URL,
		AuthType: "bearer",
	}, "test-key", nil)

	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}
	if result.StatusCode != 200 {
		t.Errorf("expected 200, got %d", result.StatusCode)
	}
	if result.Response == nil {
		t.Error("expected response body")
	}
}

func TestChatCompletionStep_AutoModelFromPrior(t *testing.T) {
	var receivedModel string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		json.NewDecoder(r.Body).Decode(&req)
		receivedModel = req["model"].(string)
		w.Write([]byte(`{"id":"chatcmpl-1","choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer srv.Close()

	prior := []keyval.StepResult{
		{Step: "models_fetch", Success: true, Models: []string{"llama-3.3-70b", "mixtral-8x7b"}},
	}

	step := keyval.ChatCompletionStep{Message: "hi", MaxTokens: 5}
	result := step.Run(context.Background(), srv.Client(), keyval.ProviderInfo{
		Name:     "groq",
		BaseURL:  srv.URL,
		AuthType: "bearer",
	}, "key", prior)

	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}
	if receivedModel != "llama-3.3-70b" {
		t.Errorf("expected auto-selected llama-3.3-70b, got %s", receivedModel)
	}
}

func TestChatCompletionStep_NoModel(t *testing.T) {
	step := keyval.ChatCompletionStep{Message: "hi", MaxTokens: 5}
	result := step.Run(context.Background(), http.DefaultClient, keyval.ProviderInfo{
		Name:     "openai",
		BaseURL:  "http://localhost",
		AuthType: "bearer",
	}, "key", nil)

	if result.Success {
		t.Fatal("expected failure with no model")
	}
	if result.Error != "no model specified and none found from prior steps" {
		t.Errorf("unexpected error: %s", result.Error)
	}
}

func TestChatCompletionStep_ProviderError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(429)
		w.Write([]byte(`{"error":{"message":"rate limit exceeded"}}`))
	}))
	defer srv.Close()

	step := keyval.ChatCompletionStep{Model: "gpt-4o", Message: "hi", MaxTokens: 5}
	result := step.Run(context.Background(), srv.Client(), keyval.ProviderInfo{
		Name:     "openai",
		BaseURL:  srv.URL,
		AuthType: "bearer",
	}, "key", nil)

	if result.Success {
		t.Fatal("expected failure on 429")
	}
	if result.StatusCode != 429 {
		t.Errorf("expected 429, got %d", result.StatusCode)
	}
}
