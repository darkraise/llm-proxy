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
