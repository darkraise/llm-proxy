package provider

import (
	"testing"

	"github.com/darkraise/llm-proxy/internal/store"
)

func makeTestProviders() []store.Provider {
	return []store.Provider{
		{ID: 1, Name: "groq", Type: "groq", BaseURL: "https://api.groq.com/openai/v1", APIKey: []byte("k1"), Models: `["llama-3.3-70b-versatile"]`, Priority: 0, Enabled: true,
			Limits: []store.ProviderLimit{{Metric: "rpm", MaxValue: 30, WindowSecs: 60}}},
		{ID: 2, Name: "google-1", Type: "google", BaseURL: "", APIKey: []byte("k2"), Models: `["gemini-2.5-flash"]`, Priority: 1, Enabled: true,
			Limits: []store.ProviderLimit{{Metric: "rpm", MaxValue: 10, WindowSecs: 60}}},
		{ID: 3, Name: "cerebras", Type: "cerebras", BaseURL: "https://api.cerebras.ai/v1", APIKey: []byte("k3"), Models: `["llama-3.3-70b"]`, Priority: 2, Enabled: true,
			Limits: []store.ProviderLimit{{Metric: "rpm", MaxValue: 30, WindowSecs: 60}}},
	}
}

func TestPool_AutoRouting_RoundRobin(t *testing.T) {
	pool := NewPool(makeTestProviders())

	names := make([]string, 3)
	for i := 0; i < 3; i++ {
		p, err := pool.Select("auto", 3)
		if err != nil {
			t.Fatalf("Select: %v", err)
		}
		names[i] = p.Name
		pool.RecordSuccess(p.Name, 0)
	}

	// Should cycle through all 3 providers
	seen := map[string]bool{}
	for _, n := range names {
		seen[n] = true
	}
	if len(seen) != 3 {
		t.Errorf("expected 3 unique providers, got %v", names)
	}
}

func TestPool_ModelRouting(t *testing.T) {
	pool := NewPool(makeTestProviders())

	// gemini-2.5-flash should only route to google-1
	p, err := pool.Select("gemini-2.5-flash", 3)
	if err != nil {
		t.Fatalf("Select: %v", err)
	}
	if p.Name != "google-1" {
		t.Errorf("expected google-1, got %s", p.Name)
	}
}

func TestPool_ModelRouting_MultipleProviders(t *testing.T) {
	pool := NewPool(makeTestProviders())

	// llama-3.3-70b matches cerebras; llama-3.3-70b-versatile matches groq
	p, err := pool.Select("llama-3.3-70b", 3)
	if err != nil {
		t.Fatalf("Select: %v", err)
	}
	if p.Name != "cerebras" {
		t.Errorf("expected cerebras, got %s", p.Name)
	}
}

func TestPool_SkipsExhaustedProviders(t *testing.T) {
	pool := NewPool(makeTestProviders())

	// Exhaust groq's RPM
	for i := 0; i < 30; i++ {
		pool.RecordSuccess("groq", 0)
	}

	p, err := pool.Select("auto", 3)
	if err != nil {
		t.Fatalf("Select: %v", err)
	}
	if p.Name == "groq" {
		t.Error("should not select exhausted groq")
	}
}

func TestPool_AllExhausted_ReturnsError(t *testing.T) {
	providers := []store.Provider{
		{ID: 1, Name: "p1", Type: "openai-compatible", Models: `["m"]`, Enabled: true,
			Limits: []store.ProviderLimit{{Metric: "rpm", MaxValue: 1, WindowSecs: 60}}},
	}
	pool := NewPool(providers)
	pool.RecordSuccess("p1", 0)

	_, err := pool.Select("auto", 3)
	if err == nil {
		t.Error("expected error when all providers exhausted")
	}
}

func TestPool_UnknownModel_ReturnsError(t *testing.T) {
	pool := NewPool(makeTestProviders())
	_, err := pool.Select("nonexistent-model", 3)
	if err == nil {
		t.Error("expected error for unknown model")
	}
}

func TestPool_ListModels(t *testing.T) {
	pool := NewPool(makeTestProviders())
	models := pool.ListModels()

	if len(models) < 3 { // auto + 3 provider models
		t.Errorf("expected at least 3 models, got %d", len(models))
	}

	found := false
	for _, m := range models {
		if m == "auto" {
			found = true
		}
	}
	if !found {
		t.Error("auto model should be in list")
	}
}
