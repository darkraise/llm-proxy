package keyval_test

import (
	"net/http"
	"testing"

	"github.com/darkraise/llm-proxy/internal/keyval"
)

func TestSetAuth_Bearer(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/models", nil)
	keyval.SetAuth(req, "bearer", "", "sk-test-key")
	if got := req.Header.Get("Authorization"); got != "Bearer sk-test-key" {
		t.Errorf("expected Bearer auth, got %q", got)
	}
}

func TestSetAuth_DefaultIsBearerToken(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/models", nil)
	keyval.SetAuth(req, "", "", "sk-test-key")
	if got := req.Header.Get("Authorization"); got != "Bearer sk-test-key" {
		t.Errorf("expected Bearer auth for empty authType, got %q", got)
	}
}

func TestSetAuth_APIKeyHeader(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/models", nil)
	keyval.SetAuth(req, "api-key-header", "x-api-key", "sk-ant-key")
	if got := req.Header.Get("x-api-key"); got != "sk-ant-key" {
		t.Errorf("expected x-api-key header, got %q", got)
	}
	if got := req.Header.Get("anthropic-version"); got != "2023-06-01" {
		t.Errorf("expected anthropic-version header, got %q", got)
	}
}

func TestSetAuth_APIKeyHeaderCustom(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/models", nil)
	keyval.SetAuth(req, "api-key-header", "X-Custom-Key", "my-key")
	if got := req.Header.Get("X-Custom-Key"); got != "my-key" {
		t.Errorf("expected X-Custom-Key header, got %q", got)
	}
	if got := req.Header.Get("anthropic-version"); got != "" {
		t.Errorf("anthropic-version should not be set for custom header, got %q", got)
	}
}

func TestSetAuth_QueryParam(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/models", nil)
	keyval.SetAuth(req, "query-param", "", "AIzaSyTestKey")
	if got := req.URL.Query().Get("key"); got != "AIzaSyTestKey" {
		t.Errorf("expected key query param, got %q", got)
	}
}

func TestSetAuth_None(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/models", nil)
	keyval.SetAuth(req, "none", "", "ignored-key")
	if got := req.Header.Get("Authorization"); got != "" {
		t.Errorf("expected no auth header, got %q", got)
	}
	if got := req.URL.Query().Get("key"); got != "" {
		t.Errorf("expected no query param, got %q", got)
	}
}
