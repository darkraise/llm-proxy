package provider

import (
	"fmt"
	"sync"
	"time"
)

type LimitConfig struct {
	Model      string // "" = account-level; non-empty = per-model
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

type AccountStatus struct {
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

// stateKey returns the map key for a given account name and optional model.
// Account-level limits use key = accountName; per-model limits use accountName:model.
func stateKey(accountName, model string) string {
	if model == "" {
		return accountName
	}
	return fmt.Sprintf("%s:%s", accountName, model)
}

func newProviderState(limits []LimitConfig) *providerState {
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
	return state
}

// Configure registers limits for an account. Limits with Model=="" are stored
// under the account name key; limits with a non-empty Model are stored under
// "accountName:model" keys.
func (rl *RateLimiter) Configure(accountName string, limits []LimitConfig) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	var accountLimits []LimitConfig
	modelLimits := make(map[string][]LimitConfig)

	for _, l := range limits {
		if l.Model == "" {
			accountLimits = append(accountLimits, l)
		} else {
			modelLimits[l.Model] = append(modelLimits[l.Model], l)
		}
	}

	rl.states[accountName] = newProviderState(accountLimits)

	for model, ml := range modelLimits {
		key := stateKey(accountName, model)
		rl.states[key] = newProviderState(ml)
	}
}

// Allow checks whether the account is within its account-level rate limits.
func (rl *RateLimiter) Allow(accountName string) bool {
	rl.mu.RLock()
	defer rl.mu.RUnlock()

	return rl.allowState(accountName)
}

// AllowForModel checks both account-level and model-specific rate limits.
func (rl *RateLimiter) AllowForModel(accountName, model string) bool {
	rl.mu.RLock()
	defer rl.mu.RUnlock()

	if !rl.allowState(accountName) {
		return false
	}
	if model != "" && model != "auto" {
		if !rl.allowState(stateKey(accountName, model)) {
			return false
		}
	}
	return true
}

// allowState is the internal check — must be called with rl.mu held (at least read).
func (rl *RateLimiter) allowState(key string) bool {
	state, ok := rl.states[key]
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

	rl.recordRequestForKey(providerName)
}

// RecordRequestForModel increments counters for both account-level and model-specific keys.
func (rl *RateLimiter) RecordRequestForModel(accountName, model string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	rl.recordRequestForKey(accountName)
	if model != "" && model != "auto" {
		rl.recordRequestForKey(stateKey(accountName, model))
	}
}

func (rl *RateLimiter) recordRequestForKey(key string) {
	state, ok := rl.states[key]
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

	rl.recordTokensForKey(providerName, tokens)
}

// RecordTokensForModel increments token counters for both account-level and model-specific keys.
func (rl *RateLimiter) RecordTokensForModel(accountName, model string, tokens int) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	rl.recordTokensForKey(accountName, tokens)
	if model != "" && model != "auto" {
		rl.recordTokensForKey(stateKey(accountName, model), tokens)
	}
}

func (rl *RateLimiter) recordTokensForKey(key string, tokens int) {
	state, ok := rl.states[key]
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

func (rl *RateLimiter) Status(providerName string) AccountStatus {
	rl.mu.RLock()
	defer rl.mu.RUnlock()

	state, ok := rl.states[providerName]
	if !ok {
		return AccountStatus{Available: true}
	}

	now := time.Now()
	status := AccountStatus{Available: true}

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
