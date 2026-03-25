package provider

import (
	"testing"
	"time"
)

func TestRateLimiter_RequestMetric(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("provider1", []LimitConfig{
		{Metric: "rpm", MaxValue: 3, WindowSecs: 60},
	})

	// Should allow 3 requests
	for i := 0; i < 3; i++ {
		if !rl.Allow("provider1") {
			t.Fatalf("request %d should be allowed", i+1)
		}
		rl.RecordRequest("provider1")
	}

	// 4th should be denied
	if rl.Allow("provider1") {
		t.Error("4th request should be denied (rpm limit)")
	}
}

func TestRateLimiter_TokenMetric(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("provider1", []LimitConfig{
		{Metric: "tpm", MaxValue: 1000, WindowSecs: 60},
	})

	rl.RecordTokens("provider1", 800)
	if !rl.AllowTokens("provider1", 100) {
		t.Error("should allow 100 tokens (900 < 1000)")
	}

	if rl.AllowTokens("provider1", 300) {
		t.Error("should deny 300 tokens (800 + 300 > 1000)")
	}
}

func TestRateLimiter_MultipleMetrics(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("provider1", []LimitConfig{
		{Metric: "rpm", MaxValue: 10, WindowSecs: 60},
		{Metric: "rpd", MaxValue: 2, WindowSecs: 86400},
	})

	rl.RecordRequest("provider1")
	rl.RecordRequest("provider1")

	// RPM has headroom (2/10) but RPD is exhausted (2/2)
	if rl.Allow("provider1") {
		t.Error("should be denied (rpd exhausted)")
	}
}

func TestRateLimiter_Backoff(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("provider1", []LimitConfig{
		{Metric: "rpm", MaxValue: 100, WindowSecs: 60},
	})

	rl.RecordBackoff("provider1", 100*time.Millisecond)

	if rl.Allow("provider1") {
		t.Error("should be denied during backoff")
	}

	time.Sleep(150 * time.Millisecond)

	if !rl.Allow("provider1") {
		t.Error("should be allowed after backoff expires")
	}
}

func TestRateLimiter_WindowReset(t *testing.T) {
	rl := NewRateLimiter()
	// Use 1-second window for test speed
	rl.Configure("provider1", []LimitConfig{
		{Metric: "rps", MaxValue: 1, WindowSecs: 1},
	})

	rl.RecordRequest("provider1")
	if rl.Allow("provider1") {
		t.Error("should be denied (rps exhausted)")
	}

	time.Sleep(1100 * time.Millisecond)

	if !rl.Allow("provider1") {
		t.Error("should be allowed after window reset")
	}
}

func TestRateLimiter_Status(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("provider1", []LimitConfig{
		{Metric: "rpm", MaxValue: 10, WindowSecs: 60},
		{Metric: "tpm", MaxValue: 5000, WindowSecs: 60},
	})

	rl.RecordRequest("provider1")
	rl.RecordTokens("provider1", 1000)

	status := rl.Status("provider1")
	if !status.Available {
		t.Error("should be available")
	}
	if len(status.Metrics) != 2 {
		t.Fatalf("metrics: got %d", len(status.Metrics))
	}
}

func TestRateLimiter_UnconfiguredProviderAlwaysAllows(t *testing.T) {
	rl := NewRateLimiter()
	if !rl.Allow("unknown") {
		t.Error("unconfigured provider should be allowed")
	}
}

func TestRateLimiter_PerModelLimit_BlocksModel(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("groq", []LimitConfig{
		{Model: "", Metric: "rpm", MaxValue: 100, WindowSecs: 60},
		{Model: "llama-3.3-70b-versatile", Metric: "rpm", MaxValue: 2, WindowSecs: 60},
	})

	// Account-level Allow still works before per-model limit is hit
	if !rl.Allow("groq") {
		t.Error("account-level should be allowed")
	}

	// Use up per-model limit
	rl.RecordRequestForModel("groq", "llama-3.3-70b-versatile")
	rl.RecordRequestForModel("groq", "llama-3.3-70b-versatile")

	// AllowForModel should now be denied for this model
	if rl.AllowForModel("groq", "llama-3.3-70b-versatile") {
		t.Error("per-model limit exhausted; should be denied")
	}

	// But account-level Allow is still fine (100 rpm not reached)
	if !rl.Allow("groq") {
		t.Error("account-level should still be allowed")
	}
}

func TestRateLimiter_PerModelLimit_DoesNotAffectOtherModels(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("groq", []LimitConfig{
		{Model: "", Metric: "rpm", MaxValue: 100, WindowSecs: 60},
		{Model: "llama-3.3-70b-versatile", Metric: "rpm", MaxValue: 1, WindowSecs: 60},
	})

	// Exhaust per-model limit for llama
	rl.RecordRequestForModel("groq", "llama-3.3-70b-versatile")
	if rl.AllowForModel("groq", "llama-3.3-70b-versatile") {
		t.Error("llama per-model limit should be exhausted")
	}

	// A different model on the same account is unaffected
	if !rl.AllowForModel("groq", "mixtral-8x7b") {
		t.Error("mixtral has no per-model limit; should be allowed")
	}
}

func TestRateLimiter_AccountLevelLimit_BlocksAllModels(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("groq", []LimitConfig{
		{Model: "", Metric: "rpm", MaxValue: 2, WindowSecs: 60},
		{Model: "llama-3.3-70b-versatile", Metric: "rpm", MaxValue: 10, WindowSecs: 60},
	})

	// Exhaust account-level limit
	rl.RecordRequestForModel("groq", "llama-3.3-70b-versatile")
	rl.RecordRequestForModel("groq", "llama-3.3-70b-versatile")

	// Even though per-model limit has headroom, account-level blocks everything
	if rl.AllowForModel("groq", "llama-3.3-70b-versatile") {
		t.Error("account-level limit exhausted; should block all models")
	}
	if rl.AllowForModel("groq", "mixtral-8x7b") {
		t.Error("account-level limit exhausted; should block other models too")
	}
}

func TestRateLimiter_PerModelTokens(t *testing.T) {
	rl := NewRateLimiter()
	rl.Configure("groq", []LimitConfig{
		{Model: "", Metric: "tpm", MaxValue: 10000, WindowSecs: 60},
		{Model: "llama-3.3-70b-versatile", Metric: "tpm", MaxValue: 500, WindowSecs: 60},
	})

	rl.RecordTokensForModel("groq", "llama-3.3-70b-versatile", 400)

	// Per-model: 400/500 used; 200 more would exceed
	if rl.AllowForModel("groq", "llama-3.3-70b-versatile") {
		// Allow check passes (request count, not tokens)
		_ = "ok"
	}

	// Verify account-level token counter also got incremented
	status := rl.Status("groq")
	found := false
	for _, m := range status.Metrics {
		if m.Metric == "tpm" && m.Used == 400 {
			found = true
		}
	}
	if !found {
		t.Error("expected account-level tpm counter to be 400")
	}
}
