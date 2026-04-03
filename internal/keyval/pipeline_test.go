package keyval_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/darkraise/llm-proxy/internal/keyval"
)

func TestValidate_DefaultPipeline(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"data":[{"id":"model-a"}]}`))
	}))
	defer srv.Close()

	results := keyval.Validate(context.Background(), keyval.ProviderInfo{
		Name:      "test",
		ModelsURL: srv.URL + "/models",
		AuthType:  "bearer",
	}, "key", nil)

	if len(results) != 1 {
		t.Fatalf("expected 1 result (default pipeline), got %d", len(results))
	}
	if !results[0].Success {
		t.Errorf("expected success, got error: %s", results[0].Error)
	}
	if results[0].Step != "models_fetch" {
		t.Errorf("expected models_fetch step, got %s", results[0].Step)
	}
}

func TestValidate_MultiStep(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			w.Write([]byte(`{"data":[{"id":"test-model"}]}`))
			return
		}
		w.Write([]byte(`{"id":"chatcmpl-1","choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer srv.Close()

	steps := []keyval.StepConfig{
		{Step: "models_fetch"},
		{Step: "chat_completion", Params: map[string]any{"max_tokens": float64(5)}},
	}

	results := keyval.Validate(context.Background(), keyval.ProviderInfo{
		Name:      "test",
		BaseURL:   srv.URL,
		ModelsURL: srv.URL + "/models",
		AuthType:  "bearer",
	}, "key", steps)

	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if !results[0].Success {
		t.Errorf("step 1 failed: %s", results[0].Error)
	}
	if !results[1].Success {
		t.Errorf("step 2 failed: %s", results[1].Error)
	}
}

func TestValidate_ShortCircuitOnFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		w.Write([]byte(`{"error":{"message":"unauthorized"}}`))
	}))
	defer srv.Close()

	steps := []keyval.StepConfig{
		{Step: "models_fetch"},
		{Step: "chat_completion", Params: map[string]any{"model": "test"}},
	}

	results := keyval.Validate(context.Background(), keyval.ProviderInfo{
		Name:      "test",
		ModelsURL: srv.URL + "/models",
		BaseURL:   srv.URL,
		AuthType:  "bearer",
	}, "key", steps)

	if len(results) != 1 {
		t.Fatalf("expected 1 result (short-circuit), got %d", len(results))
	}
	if results[0].Success {
		t.Error("expected failure")
	}
}

func TestValidate_UnknownStep(t *testing.T) {
	results := keyval.Validate(context.Background(), keyval.ProviderInfo{
		Name: "test",
	}, "key", []keyval.StepConfig{{Step: "nonexistent"}})

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Success {
		t.Error("expected failure for unknown step")
	}
	if results[0].Error != "unknown step type: nonexistent" {
		t.Errorf("unexpected error: %s", results[0].Error)
	}
}
