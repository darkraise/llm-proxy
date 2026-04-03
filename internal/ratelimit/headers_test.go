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

func TestParseRateLimitHeaders_UnknownProviderNoHeaders(t *testing.T) {
	headers := http.Header{}
	headers.Set("content-type", "application/json")

	defs := ratelimit.ParseRateLimitHeaders("some-unknown-provider", headers, "model-x")
	if len(defs) != 0 {
		t.Errorf("expected 0 defs for unknown provider with no rate limit headers, got %d", len(defs))
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

func TestParseRateLimitHeaders_OpenAI(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "500")
	headers.Set("x-ratelimit-limit-tokens", "200000")

	defs := ratelimit.ParseRateLimitHeaders("openai", headers, "gpt-4o")

	if len(defs) != 2 {
		t.Fatalf("expected 2 defs, got %d", len(defs))
	}

	byMetric := map[string]int{}
	byWindow := map[string]int{}
	for _, d := range defs {
		if d.Provider != "openai" {
			t.Errorf("expected provider openai, got %s", d.Provider)
		}
		if d.Model != "gpt-4o" {
			t.Errorf("expected model gpt-4o, got %s", d.Model)
		}
		byMetric[d.Metric] = d.MaxValue
		byWindow[d.Metric] = d.WindowSecs
	}

	if byMetric["rpm"] != 500 {
		t.Errorf("rpm: expected 500, got %d", byMetric["rpm"])
	}
	if byMetric["tpm"] != 200000 {
		t.Errorf("tpm: expected 200000, got %d", byMetric["tpm"])
	}
	if byWindow["rpm"] != 60 {
		t.Errorf("rpm window: expected 60, got %d", byWindow["rpm"])
	}
	if byWindow["tpm"] != 60 {
		t.Errorf("tpm window: expected 60, got %d", byWindow["tpm"])
	}
}

func TestParseRateLimitHeaders_Anthropic(t *testing.T) {
	headers := http.Header{}
	headers.Set("anthropic-ratelimit-requests-limit", "1000")
	headers.Set("anthropic-ratelimit-tokens-limit", "80000")

	defs := ratelimit.ParseRateLimitHeaders("anthropic", headers, "claude-sonnet-4-20250514")

	if len(defs) != 2 {
		t.Fatalf("expected 2 defs, got %d", len(defs))
	}

	byMetric := map[string]int{}
	for _, d := range defs {
		if d.Provider != "anthropic" {
			t.Errorf("expected provider anthropic, got %s", d.Provider)
		}
		byMetric[d.Metric] = d.MaxValue
	}

	if byMetric["rpm"] != 1000 {
		t.Errorf("rpm: expected 1000, got %d", byMetric["rpm"])
	}
	if byMetric["tpm"] != 80000 {
		t.Errorf("tpm: expected 80000, got %d", byMetric["tpm"])
	}
}

func TestParseRateLimitHeaders_XAI(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "1200")
	headers.Set("x-ratelimit-limit-tokens", "100000")

	defs := ratelimit.ParseRateLimitHeaders("xai", headers, "grok-2")

	if len(defs) != 2 {
		t.Fatalf("expected 2 defs, got %d", len(defs))
	}

	byMetric := map[string]int{}
	byWindow := map[string]int{}
	for _, d := range defs {
		byMetric[d.Metric] = d.MaxValue
		byWindow[d.Metric] = d.WindowSecs
	}

	if byMetric["rpd"] != 1200 {
		t.Errorf("rpd: expected 1200, got %d", byMetric["rpd"])
	}
	if byMetric["tpm"] != 100000 {
		t.Errorf("tpm: expected 100000, got %d", byMetric["tpm"])
	}
	if byWindow["rpd"] != 86400 {
		t.Errorf("rpd window: expected 86400, got %d", byWindow["rpd"])
	}
}

func TestParseRateLimitHeaders_Together(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit", "60")
	headers.Set("x-tokenlimit-limit", "100000")

	defs := ratelimit.ParseRateLimitHeaders("together", headers, "meta-llama/Llama-3-70b")

	if len(defs) != 2 {
		t.Fatalf("expected 2 defs, got %d", len(defs))
	}

	byMetric := map[string]int{}
	byWindow := map[string]int{}
	for _, d := range defs {
		byMetric[d.Metric] = d.MaxValue
		byWindow[d.Metric] = d.WindowSecs
	}

	if byMetric["rps"] != 60 {
		t.Errorf("rps: expected 60, got %d", byMetric["rps"])
	}
	if byMetric["tps"] != 100000 {
		t.Errorf("tps: expected 100000, got %d", byMetric["tps"])
	}
	if byWindow["rps"] != 1 {
		t.Errorf("rps window: expected 1, got %d", byWindow["rps"])
	}
}

func TestParseRateLimitHeaders_Fireworks(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "600")

	defs := ratelimit.ParseRateLimitHeaders("fireworks", headers, "accounts/fireworks/models/llama-v3-70b")

	if len(defs) != 1 {
		t.Fatalf("expected 1 def, got %d", len(defs))
	}
	if defs[0].Metric != "rpm" {
		t.Errorf("expected rpm, got %s", defs[0].Metric)
	}
	if defs[0].MaxValue != 600 {
		t.Errorf("expected 600, got %d", defs[0].MaxValue)
	}
	if defs[0].WindowSecs != 60 {
		t.Errorf("expected window 60, got %d", defs[0].WindowSecs)
	}
}

func TestParseRateLimitHeaders_DeepSeek(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "60")

	defs := ratelimit.ParseRateLimitHeaders("deepseek", headers, "deepseek-chat")

	if len(defs) != 1 {
		t.Fatalf("expected 1 def, got %d", len(defs))
	}
	if defs[0].Metric != "rpm" || defs[0].MaxValue != 60 || defs[0].WindowSecs != 60 {
		t.Errorf("unexpected def: %+v", defs[0])
	}
}

func TestParseRateLimitHeaders_OpenRouter(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "200")

	defs := ratelimit.ParseRateLimitHeaders("openrouter", headers, "anthropic/claude-sonnet-4-20250514")

	if len(defs) != 1 {
		t.Fatalf("expected 1 def, got %d", len(defs))
	}
	if defs[0].Metric != "rpm" || defs[0].MaxValue != 200 || defs[0].WindowSecs != 60 {
		t.Errorf("unexpected def: %+v", defs[0])
	}
}
