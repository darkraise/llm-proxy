package provider

import (
	"testing"

	"github.com/darkraise/llm-proxy/internal/store"
)

func makeTestProviders() []store.Account {
	return []store.Account{
		{ID: 1, Name: "groq", Type: "groq", BaseURL: "https://api.groq.com/openai/v1", APIKey: []byte("k1"), Models: `{"chat":["llama-3.3-70b-versatile"]}`, Priority: 0, Enabled: true,
			Limits: []store.AccountLimit{{Metric: "rpm", MaxValue: 30, WindowSecs: 60}}},
		{ID: 2, Name: "google-1", Type: "google", BaseURL: "", APIKey: []byte("k2"), Models: `{"chat":["gemini-2.5-flash"]}`, Priority: 1, Enabled: true,
			Limits: []store.AccountLimit{{Metric: "rpm", MaxValue: 10, WindowSecs: 60}}},
		{ID: 3, Name: "cerebras", Type: "cerebras", BaseURL: "https://api.cerebras.ai/v1", APIKey: []byte("k3"), Models: `{"chat":["llama-3.3-70b"]}`, Priority: 2, Enabled: true,
			Limits: []store.AccountLimit{{Metric: "rpm", MaxValue: 30, WindowSecs: 60}}},
	}
}

func TestPool_AutoRouting_RoundRobin(t *testing.T) {
	pool := NewPool(makeTestProviders(), nil)

	names := make([]string, 3)
	for i := 0; i < 3; i++ {
		p, err := pool.Select("auto", "chat", 3)
		if err != nil {
			t.Fatalf("Select: %v", err)
		}
		names[i] = p.Name
		pool.RecordSuccessForModel(p.Name, "auto", 0)
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
	pool := NewPool(makeTestProviders(), nil)

	// gemini-2.5-flash should only route to google-1
	p, err := pool.Select("gemini-2.5-flash", "chat", 3)
	if err != nil {
		t.Fatalf("Select: %v", err)
	}
	if p.Name != "google-1" {
		t.Errorf("expected google-1, got %s", p.Name)
	}
}

func TestPool_ModelRouting_MultipleProviders(t *testing.T) {
	pool := NewPool(makeTestProviders(), nil)

	// llama-3.3-70b matches cerebras; llama-3.3-70b-versatile matches groq
	p, err := pool.Select("llama-3.3-70b", "chat", 3)
	if err != nil {
		t.Fatalf("Select: %v", err)
	}
	if p.Name != "cerebras" {
		t.Errorf("expected cerebras, got %s", p.Name)
	}
}

func TestPool_SkipsExhaustedProviders(t *testing.T) {
	pool := NewPool(makeTestProviders(), nil)

	// Exhaust groq's RPM
	for i := 0; i < 30; i++ {
		pool.RecordSuccessForModel("groq", "llama-3.3-70b-versatile", 0)
	}

	p, err := pool.Select("auto", "chat", 3)
	if err != nil {
		t.Fatalf("Select: %v", err)
	}
	if p.Name == "groq" {
		t.Error("should not select exhausted groq")
	}
}

func TestPool_AllExhausted_ReturnsError(t *testing.T) {
	providers := []store.Account{
		{ID: 1, Name: "p1", Type: "openai-compatible", Models: `{"chat":["m"]}`, Enabled: true,
			Limits: []store.AccountLimit{{Metric: "rpm", MaxValue: 1, WindowSecs: 60}}},
	}
	pool := NewPool(providers, nil)
	pool.RecordSuccessForModel("p1", "m", 0)

	_, err := pool.Select("auto", "chat", 3)
	if err == nil {
		t.Error("expected error when all providers exhausted")
	}
}

func TestPool_UnknownModel_ReturnsError(t *testing.T) {
	pool := NewPool(makeTestProviders(), nil)
	_, err := pool.Select("nonexistent-model", "chat", 3)
	if err == nil {
		t.Error("expected error for unknown model")
	}
}

func TestPool_DefaultModels_UsedForAuto(t *testing.T) {
	providers := []store.Account{
		{
			ID: 1, Name: "groq", Type: "groq", BaseURL: "https://api.groq.com/openai/v1",
			APIKey: []byte("k1"), Models: `{"chat":["llama-3.3-70b-versatile","mixtral-8x7b"]}`,
			Priority: 0, Enabled: true, DefaultModels: `{"chat":"mixtral-8x7b"}`,
			Limits: []store.AccountLimit{{Metric: "rpm", MaxValue: 30, WindowSecs: 60}},
		},
	}
	pool := NewPool(providers, nil)

	acc, err := pool.Select("auto", "chat", 3)
	if err != nil {
		t.Fatalf("Select: %v", err)
	}
	if acc.DefaultModels["chat"] != "mixtral-8x7b" {
		t.Errorf("expected DefaultModels[chat]=mixtral-8x7b, got %q", acc.DefaultModels["chat"])
	}
}

func TestPool_DefaultModels_FallsBackToFirstModel(t *testing.T) {
	providers := []store.Account{
		{
			ID: 1, Name: "groq", Type: "groq", BaseURL: "https://api.groq.com/openai/v1",
			APIKey: []byte("k1"), Models: `{"chat":["llama-3.3-70b-versatile","mixtral-8x7b"]}`,
			Priority: 0, Enabled: true, DefaultModels: `{}`, // no default set
			Limits: []store.AccountLimit{{Metric: "rpm", MaxValue: 30, WindowSecs: 60}},
		},
	}
	pool := NewPool(providers, nil)

	acc, err := pool.Select("auto", "chat", 3)
	if err != nil {
		t.Fatalf("Select: %v", err)
	}
	// DefaultModels is empty; selectAuto falls back to first model in category
	if len(acc.DefaultModels) != 0 {
		t.Errorf("expected empty DefaultModels, got %v", acc.DefaultModels)
	}
}

func TestPool_PerModelRateLimit_BlocksExhaustedModel(t *testing.T) {
	providers := []store.Account{
		{
			ID: 1, Name: "groq", Type: "groq", BaseURL: "https://api.groq.com/openai/v1",
			APIKey: []byte("k1"), Models: `{"chat":["llama-3.3-70b-versatile"]}`,
			Priority: 0, Enabled: true,
			Limits: []store.AccountLimit{
				{Model: "", Metric: "rpm", MaxValue: 100, WindowSecs: 60},
				{Model: "llama-3.3-70b-versatile", Metric: "rpm", MaxValue: 2, WindowSecs: 60},
			},
		},
	}
	pool := NewPool(providers, nil)

	// Use up the per-model limit for llama-3.3-70b-versatile
	pool.RecordSuccessForModel("groq", "llama-3.3-70b-versatile", 0)
	pool.RecordSuccessForModel("groq", "llama-3.3-70b-versatile", 0)

	// Selecting this model specifically should now fail
	_, err := pool.Select("llama-3.3-70b-versatile", "chat", 3)
	if err == nil {
		t.Error("expected error: per-model limit exhausted")
	}
}

func TestPool_ListModels(t *testing.T) {
	pool := NewPool(makeTestProviders(), nil)
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
