package ratelimit_test

import (
	"net/http"
	"testing"

	"github.com/darkraise/llm-proxy/internal/ratelimit"
)

func TestParseRateLimitHeaders_Groq(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "14400")
	headers.Set("x-ratelimit-limit-tokens", "6000")

	defs := ratelimit.ParseRateLimitHeaders("groq", headers, "llama-3.1-8b-instant")

	if len(defs) != 2 {
		t.Fatalf("expected 2 defs, got %d", len(defs))
	}

	byMetric := map[string]int{}
	for _, d := range defs {
		if d.Provider != "groq" {
			t.Errorf("expected provider groq, got %s", d.Provider)
		}
		if d.Model != "llama-3.1-8b-instant" {
			t.Errorf("expected model llama-3.1-8b-instant, got %s", d.Model)
		}
		byMetric[d.Metric] = d.MaxValue
	}

	if byMetric["rpd"] != 14400 {
		t.Errorf("rpd: expected 14400, got %d", byMetric["rpd"])
	}
	if byMetric["tpm"] != 6000 {
		t.Errorf("tpm: expected 6000, got %d", byMetric["tpm"])
	}
}

func TestParseRateLimitHeaders_Cerebras(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests-day", "1000")
	headers.Set("x-ratelimit-limit-tokens-minute", "64000")

	defs := ratelimit.ParseRateLimitHeaders("cerebras", headers, "llama-3.3-70b")

	if len(defs) != 2 {
		t.Fatalf("expected 2 defs, got %d", len(defs))
	}

	byMetric := map[string]int{}
	for _, d := range defs {
		byMetric[d.Metric] = d.MaxValue
	}

	if byMetric["rpd"] != 1000 {
		t.Errorf("rpd: expected 1000, got %d", byMetric["rpd"])
	}
	if byMetric["tpm"] != 64000 {
		t.Errorf("tpm: expected 64000, got %d", byMetric["tpm"])
	}
}

func TestParseRateLimitHeaders_UnknownProvider(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "100")

	defs := ratelimit.ParseRateLimitHeaders("openai", headers, "gpt-4o")
	if defs != nil {
		t.Errorf("expected nil for unknown provider, got %v", defs)
	}
}

func TestParseRateLimitHeaders_MissingHeaders(t *testing.T) {
	defs := ratelimit.ParseRateLimitHeaders("groq", http.Header{}, "llama-3.1-8b-instant")
	if len(defs) != 0 {
		t.Errorf("expected empty result for missing headers, got %d defs", len(defs))
	}
}

func TestParseRateLimitHeaders_PartialHeaders(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "500")
	// tokens header absent

	defs := ratelimit.ParseRateLimitHeaders("groq", headers, "llama-3.3-70b-versatile")

	if len(defs) != 1 {
		t.Fatalf("expected 1 def, got %d", len(defs))
	}
	if defs[0].Metric != "rpd" {
		t.Errorf("expected rpd, got %s", defs[0].Metric)
	}
	if defs[0].MaxValue != 500 {
		t.Errorf("expected 500, got %d", defs[0].MaxValue)
	}
}

func TestParseRateLimitHeaders_InvalidValue(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "not-a-number")
	headers.Set("x-ratelimit-limit-tokens", "6000")

	defs := ratelimit.ParseRateLimitHeaders("groq", headers, "llama-3.1-8b-instant")

	// Only the tpm entry should be returned.
	if len(defs) != 1 {
		t.Fatalf("expected 1 def, got %d", len(defs))
	}
	if defs[0].Metric != "tpm" {
		t.Errorf("expected tpm, got %s", defs[0].Metric)
	}
}

func TestParseRateLimitHeaders_ZeroValue(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "0")

	defs := ratelimit.ParseRateLimitHeaders("groq", headers, "llama-3.1-8b-instant")
	if len(defs) != 0 {
		t.Errorf("expected zero-value header to be skipped, got %d defs", len(defs))
	}
}

func TestParseRateLimitHeaders_WindowSecs(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "1000")
	headers.Set("x-ratelimit-limit-tokens", "60000")

	defs := ratelimit.ParseRateLimitHeaders("groq", headers, "some-model")

	byMetric := map[string]int{}
	for _, d := range defs {
		byMetric[d.Metric] = d.WindowSecs
	}

	if byMetric["rpd"] != 86400 {
		t.Errorf("rpd window: expected 86400, got %d", byMetric["rpd"])
	}
	if byMetric["tpm"] != 60 {
		t.Errorf("tpm window: expected 60, got %d", byMetric["tpm"])
	}
}
