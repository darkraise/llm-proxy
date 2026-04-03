package keyval_test

import (
	"net/http"
	"testing"

	"github.com/darkraise/llm-proxy/internal/keyval"
)

func TestParseModelList_OpenAI(t *testing.T) {
	data := []byte(`{"data":[{"id":"gpt-4o"},{"id":"gpt-3.5-turbo"}]}`)
	models := keyval.ParseModelList(data)
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}
	if models[0].ID != "gpt-4o" {
		t.Errorf("expected gpt-4o, got %s", models[0].ID)
	}
}

func TestParseModelList_Google(t *testing.T) {
	data := []byte(`{"models":[{"name":"models/gemini-2.0-flash"},{"name":"models/gemma-3-27b-it"}]}`)
	models := keyval.ParseModelList(data)
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}
	if models[0].ID != "models/gemini-2.0-flash" {
		t.Errorf("expected models/gemini-2.0-flash, got %s", models[0].ID)
	}
}

func TestParseModelList_PlainArray(t *testing.T) {
	data := []byte(`[{"id":"model-a","name":"Model A"},{"id":"model-b"}]`)
	models := keyval.ParseModelList(data)
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}
}

func TestParseModelList_Empty(t *testing.T) {
	models := keyval.ParseModelList([]byte(`{}`))
	if models != nil {
		t.Errorf("expected nil for empty response, got %v", models)
	}
}

func TestParseModelIDs_Sorted(t *testing.T) {
	data := []byte(`{"data":[{"id":"z-model"},{"id":"a-model"}]}`)
	ids := keyval.ParseModelIDs(data)
	if len(ids) != 2 || ids[0] != "a-model" || ids[1] != "z-model" {
		t.Errorf("expected sorted [a-model z-model], got %v", ids)
	}
}

func TestExtractRateLimitHeaders(t *testing.T) {
	h := http.Header{}
	h.Set("X-RateLimit-Limit-Requests", "100")
	h.Set("X-RateLimit-Remaining-Requests", "99")
	h.Set("Content-Type", "application/json")

	limits := keyval.ExtractRateLimitHeaders(h)
	if len(limits) != 2 {
		t.Fatalf("expected 2 rate limit headers, got %d", len(limits))
	}
	if _, ok := limits["Content-Type"]; ok {
		t.Error("should not include Content-Type")
	}
}

func TestExtractRateLimitHeaders_None(t *testing.T) {
	h := http.Header{}
	h.Set("Content-Type", "application/json")

	limits := keyval.ExtractRateLimitHeaders(h)
	if limits != nil {
		t.Errorf("expected nil for no rate limit headers, got %v", limits)
	}
}

func TestParseProviderModelList_OpenAI(t *testing.T) {
	data := []byte(`{"data":[{"id":"gpt-4o"},{"id":"gpt-3.5-turbo"}]}`)
	models := keyval.ParseProviderModelList("openai", data)
	if len(models) != 2 {
		t.Fatalf("expected 2, got %d", len(models))
	}
}

func TestParseProviderModelList_Google(t *testing.T) {
	data := []byte(`{"models":[{"name":"models/gemini-2.0-flash"}]}`)
	models := keyval.ParseProviderModelList("google", data)
	if len(models) != 1 || models[0] != "models/gemini-2.0-flash" {
		t.Errorf("expected [models/gemini-2.0-flash], got %v", models)
	}
}

func TestParseRateLimitsFromHeaders(t *testing.T) {
	h := http.Header{}
	h.Set("X-Ratelimit-Limit-Requests", "500")
	h.Set("X-Ratelimit-Limit-Tokens", "200000")
	h.Set("X-Ratelimit-Remaining-Requests", "499")

	limits := keyval.ParseRateLimitsFromHeaders(h)
	if len(limits) != 2 {
		t.Fatalf("expected 2 parsed limits, got %d", len(limits))
	}

	byMetric := map[string]keyval.ParsedLimit{}
	for _, l := range limits {
		byMetric[l.Metric] = l
	}
	if byMetric["rpm"].MaxValue != 500 {
		t.Errorf("rpm: expected 500, got %d", byMetric["rpm"].MaxValue)
	}
	if byMetric["tpm"].MaxValue != 200000 {
		t.Errorf("tpm: expected 200000, got %d", byMetric["tpm"].MaxValue)
	}
}
