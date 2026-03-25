package provider

import (
	"sync"
	"time"
)

type LimitConfig struct {
	Metric     string
	MaxValue   int
	WindowSecs int
}

type metricCounter struct {
	config      LimitConfig
	count       int
	windowStart time.Time
}

func (m *metricCounter) reset(now time.Time) {
	window := time.Duration(m.config.WindowSecs) * time.Second
	if now.Sub(m.windowStart) >= window {
		m.count = 0
		m.windowStart = now
	}
}

func (m *metricCounter) available(now time.Time) bool {
	m.reset(now)
	return m.count < m.config.MaxValue
}

func (m *metricCounter) headroom(now time.Time) int {
	m.reset(now)
	return m.config.MaxValue - m.count
}

type providerState struct {
	requestMetrics map[string]*metricCounter // "rpm", "rpd", "rps"
	tokenMetrics   map[string]*metricCounter // "tpm", "tpd"
	backoffUntil   time.Time
}

type ProviderStatus struct {
	Available bool           `json:"available"`
	Reason    string         `json:"reason,omitempty"`
	Metrics   []MetricStatus `json:"metrics"`
}

type MetricStatus struct {
	Metric string `json:"metric"`
	Used   int    `json:"used"`
	Max    int    `json:"max"`
}

type RateLimiter struct {
	mu     sync.RWMutex
	states map[string]*providerState
}

func NewRateLimiter() *RateLimiter {
	return &RateLimiter{
		states: make(map[string]*providerState),
	}
}

func (rl *RateLimiter) Configure(providerName string, limits []LimitConfig) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	state := &providerState{
		requestMetrics: make(map[string]*metricCounter),
		tokenMetrics:   make(map[string]*metricCounter),
	}

	for _, l := range limits {
		mc := &metricCounter{config: l, windowStart: now}
		switch l.Metric {
		case "rpm", "rpd", "rps":
			state.requestMetrics[l.Metric] = mc
		case "tpm", "tpd":
			state.tokenMetrics[l.Metric] = mc
		}
	}

	rl.states[providerName] = state
}

func (rl *RateLimiter) Allow(providerName string) bool {
	rl.mu.RLock()
	defer rl.mu.RUnlock()

	state, ok := rl.states[providerName]
	if !ok {
		return true // unconfigured = no limits
	}

	now := time.Now()
	if now.Before(state.backoffUntil) {
		return false
	}

	for _, mc := range state.requestMetrics {
		if !mc.available(now) {
			return false
		}
	}
	for _, mc := range state.tokenMetrics {
		if !mc.available(now) {
			return false
		}
	}
	return true
}

func (rl *RateLimiter) AllowTokens(providerName string, estimatedTokens int) bool {
	rl.mu.RLock()
	defer rl.mu.RUnlock()

	state, ok := rl.states[providerName]
	if !ok {
		return true
	}

	now := time.Now()
	for _, mc := range state.tokenMetrics {
		if mc.headroom(now) < estimatedTokens {
			return false
		}
	}
	return true
}

func (rl *RateLimiter) RecordRequest(providerName string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	state, ok := rl.states[providerName]
	if !ok {
		return
	}
	now := time.Now()
	for _, mc := range state.requestMetrics {
		mc.reset(now)
		mc.count++
	}
}

func (rl *RateLimiter) RecordTokens(providerName string, tokens int) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	state, ok := rl.states[providerName]
	if !ok {
		return
	}
	now := time.Now()
	for _, mc := range state.tokenMetrics {
		mc.reset(now)
		mc.count += tokens
	}
}

func (rl *RateLimiter) RecordBackoff(providerName string, duration time.Duration) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	state, ok := rl.states[providerName]
	if !ok {
		return
	}
	state.backoffUntil = time.Now().Add(duration)
}

func (rl *RateLimiter) Status(providerName string) ProviderStatus {
	rl.mu.RLock()
	defer rl.mu.RUnlock()

	state, ok := rl.states[providerName]
	if !ok {
		return ProviderStatus{Available: true}
	}

	now := time.Now()
	status := ProviderStatus{Available: true}

	if now.Before(state.backoffUntil) {
		status.Available = false
		status.Reason = "backoff"
	}

	for _, mc := range state.requestMetrics {
		mc.reset(now)
		status.Metrics = append(status.Metrics, MetricStatus{
			Metric: mc.config.Metric, Used: mc.count, Max: mc.config.MaxValue,
		})
		if mc.count >= mc.config.MaxValue {
			status.Available = false
			status.Reason = mc.config.Metric + "_exhausted"
		}
	}
	for _, mc := range state.tokenMetrics {
		mc.reset(now)
		status.Metrics = append(status.Metrics, MetricStatus{
			Metric: mc.config.Metric, Used: mc.count, Max: mc.config.MaxValue,
		})
		if mc.count >= mc.config.MaxValue {
			status.Available = false
			status.Reason = mc.config.Metric + "_exhausted"
		}
	}
	return status
}
