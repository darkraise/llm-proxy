package keyval_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/darkraise/llm-proxy/internal/keyval"
)

func TestModelsFetchStep_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("X-RateLimit-Limit-Requests", "100")
		w.Write([]byte(`{"data":[{"id":"gpt-4o"},{"id":"gpt-3.5-turbo"}]}`))
	}))
	defer srv.Close()

	step := keyval.ModelsFetchStep{}
	result := step.Run(context.Background(), srv.Client(), keyval.ProviderInfo{
		Name:      "openai",
		ModelsURL: srv.URL + "/models",
		AuthType:  "bearer",
	}, "test-key", nil)

	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}
	if len(result.Models) != 2 {
		t.Errorf("expected 2 models, got %d", len(result.Models))
	}
	if result.RateLimits == nil {
		t.Error("expected rate limits to be captured")
	}
}

func TestModelsFetchStep_AuthFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		w.Write([]byte(`{"error":{"message":"invalid api key"}}`))
	}))
	defer srv.Close()

	step := keyval.ModelsFetchStep{}
	result := step.Run(context.Background(), srv.Client(), keyval.ProviderInfo{
		Name:      "openai",
		ModelsURL: srv.URL + "/models",
		AuthType:  "bearer",
	}, "bad-key", nil)

	if result.Success {
		t.Fatal("expected failure")
	}
	if result.StatusCode != 401 {
		t.Errorf("expected 401, got %d", result.StatusCode)
	}
	if result.Error != "invalid api key" {
		t.Errorf("expected error message, got %q", result.Error)
	}
}

func TestModelsFetchStep_GoogleFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("key") == "" {
			w.WriteHeader(401)
			return
		}
		w.Write([]byte(`{"models":[{"name":"models/gemini-2.0-flash"}]}`))
	}))
	defer srv.Close()

	step := keyval.ModelsFetchStep{}
	result := step.Run(context.Background(), srv.Client(), keyval.ProviderInfo{
		Name:      "google",
		ModelsURL: srv.URL + "/models",
		AuthType:  "query-param",
	}, "AIzaSyTest", nil)

	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}
	if len(result.Models) != 1 || result.Models[0] != "models/gemini-2.0-flash" {
		t.Errorf("expected [models/gemini-2.0-flash], got %v", result.Models)
	}
}

func TestModelsFetchStep_NoURL(t *testing.T) {
	step := keyval.ModelsFetchStep{}
	result := step.Run(context.Background(), http.DefaultClient, keyval.ProviderInfo{
		Name: "test",
	}, "key", nil)

	if result.Success {
		t.Fatal("expected failure with no URL")
	}
}
