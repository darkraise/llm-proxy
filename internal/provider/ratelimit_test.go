package provider

import (
	"testing"
	"time"
)

func TestRateLimiter_TemplateInheritance(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("acct", []LimitConfig{
		{Metric: "rpm", MaxValue: 2, WindowSecs: 60},
	})

	rl.RecordRequestForModel("acct", "model-a")
	rl.RecordRequestForModel("acct", "model-a")

	if rl.AllowForModel("acct", "model-a") {
		t.Error("model-a should be exhausted (2/2 rpm)")
	}

	if !rl.AllowForModel("acct", "model-b") {
		t.Error("model-b should be allowed (0/2 rpm)")
	}
	rl.RecordRequestForModel("acct", "model-b")
	rl.RecordRequestForModel("acct", "model-b")
	if rl.AllowForModel("acct", "model-b") {
		t.Error("model-b should be exhausted (2/2 rpm)")
	}
}

func TestRateLimiter_AllOrNothingOverride(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("acct", []LimitConfig{
		{Metric: "rpm", MaxValue: 10, WindowSecs: 60},
		{Metric: "tpm", MaxValue: 5000, WindowSecs: 60},
		{Model: "special", Metric: "rpm", MaxValue: 2, WindowSecs: 60},
	})

	rl.RecordRequestForModel("acct", "special")
	rl.RecordRequestForModel("acct", "special")
	if rl.AllowForModel("acct", "special") {
		t.Error("special should be exhausted (2/2 rpm)")
	}

	for i := 0; i < 10; i++ {
		if !rl.AllowForModel("acct", "normal") {
			t.Fatalf("normal request %d should be allowed", i+1)
		}
		rl.RecordRequestForModel("acct", "normal")
	}
	if rl.AllowForModel("acct", "normal") {
		t.Error("normal should be exhausted (10/10 rpm)")
	}
}

func TestRateLimiter_TokenMetric(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("acct", []LimitConfig{
		{Metric: "tpm", MaxValue: 1000, WindowSecs: 60},
	})

	rl.RecordTokensForModel("acct", "model-a", 800)
	if !rl.AllowTokensForModel("acct", "model-a", 100) {
		t.Error("should allow 100 tokens (900 < 1000)")
	}
	if rl.AllowTokensForModel("acct", "model-a", 300) {
		t.Error("should deny 300 tokens (800 + 300 > 1000)")
	}

	if !rl.AllowTokensForModel("acct", "model-b", 900) {
		t.Error("model-b should allow 900 tokens (0 + 900 < 1000)")
	}
}

func TestRateLimiter_MultipleMetrics(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("acct", []LimitConfig{
		{Metric: "rpm", MaxValue: 10, WindowSecs: 60},
		{Metric: "rpd", MaxValue: 2, WindowSecs: 86400},
	})

	rl.RecordRequestForModel("acct", "model-a")
	rl.RecordRequestForModel("acct", "model-a")

	if rl.AllowForModel("acct", "model-a") {
		t.Error("should be denied (rpd exhausted)")
	}
}

func TestRateLimiter_Backoff(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("acct", []LimitConfig{
		{Metric: "rpm", MaxValue: 100, WindowSecs: 60},
	})

	rl.RecordBackoff("acct", 100*time.Millisecond)

	if rl.AllowForModel("acct", "model-a") {
		t.Error("should be denied during backoff")
	}

	time.Sleep(150 * time.Millisecond)

	if !rl.AllowForModel("acct", "model-a") {
		t.Error("should be allowed after backoff expires")
	}
}

func TestRateLimiter_WindowReset(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("acct", []LimitConfig{
		{Metric: "rps", MaxValue: 1, WindowSecs: 1},
	})

	rl.RecordRequestForModel("acct", "model-a")
	if rl.AllowForModel("acct", "model-a") {
		t.Error("should be denied (rps exhausted)")
	}

	time.Sleep(1100 * time.Millisecond)

	if !rl.AllowForModel("acct", "model-a") {
		t.Error("should be allowed after window reset")
	}
}

func TestRateLimiter_StatusForModel(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("acct", []LimitConfig{
		{Metric: "rpm", MaxValue: 10, WindowSecs: 60},
		{Metric: "tpm", MaxValue: 5000, WindowSecs: 60},
	})

	rl.RecordRequestForModel("acct", "model-a")
	rl.RecordTokensForModel("acct", "model-a", 1000)

	status := rl.StatusForModel("acct", "model-a")
	if !status.Available {
		t.Error("should be available")
	}
	if len(status.Metrics) != 2 {
		t.Fatalf("metrics: got %d, want 2", len(status.Metrics))
	}
}

func TestRateLimiter_StatusTemplate(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("acct", []LimitConfig{
		{Metric: "rpm", MaxValue: 10, WindowSecs: 60},
	})

	status := rl.Status("acct")
	if !status.Available {
		t.Error("template status should be available")
	}
	if len(status.Metrics) != 1 {
		t.Fatalf("expected 1 template metric, got %d", len(status.Metrics))
	}
	if status.Metrics[0].Used != 0 {
		t.Error("template metrics should show zero usage")
	}
}

func TestRateLimiter_UnconfiguredAlwaysAllows(t *testing.T) {
	rl := NewRateLimiter()
	if !rl.AllowForModel("unknown", "model") {
		t.Error("unconfigured account should be allowed")
	}
}

func TestRateLimiter_PerModelOverrideDoesNotAffectOthers(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("acct", []LimitConfig{
		{Metric: "rpm", MaxValue: 100, WindowSecs: 60},
		{Model: "llama", Metric: "rpm", MaxValue: 1, WindowSecs: 60},
	})

	rl.RecordRequestForModel("acct", "llama")
	if rl.AllowForModel("acct", "llama") {
		t.Error("llama should be exhausted (1/1 rpm)")
	}

	if !rl.AllowForModel("acct", "mixtral") {
		t.Error("mixtral should be allowed (0/100 rpm from template)")
	}
}
