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
	inputMetrics   map[string]*metricCounter // "ipm"
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
	mu        sync.RWMutex
	states    map[string]*providerState
	templates map[string]*providerState // model="" limits, keyed by account name
}

func NewRateLimiter() *RateLimiter {
	return &RateLimiter{
		states:    make(map[string]*providerState),
		templates: make(map[string]*providerState),
	}
}

// stateKey returns the map key for a given account name and optional model.
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
		inputMetrics:   make(map[string]*metricCounter),
	}
	for _, l := range limits {
		mc := &metricCounter{config: l, windowStart: now}
		switch l.Metric {
		case "rpm", "rpd", "rps", "rpmo", "rph":
			state.requestMetrics[l.Metric] = mc
		case "tpm", "tpd", "tpmo", "tph":
			state.tokenMetrics[l.Metric] = mc
		case "ipm":
			state.inputMetrics[l.Metric] = mc
		}
	}
	return state
}

// Configure registers limits for an account. Limits with Model=="" are stored
// as a template for lazy cloning into per-model states. Limits with a non-empty
// Model are stored under "accountName:model" keys using all-or-nothing semantics
// (explicit limits fully replace the template for that model).
func (rl *RateLimiter) Configure(accountName string, limits []LimitConfig) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	var templateLimits []LimitConfig
	modelLimits := make(map[string][]LimitConfig)

	for _, l := range limits {
		if l.Model == "" {
			templateLimits = append(templateLimits, l)
		} else {
			modelLimits[l.Model] = append(modelLimits[l.Model], l)
		}
	}

	// Store template for lazy cloning.
	if len(templateLimits) > 0 {
		rl.templates[accountName] = newProviderState(templateLimits)
	}

	// Account-level key: backoff only (no rate counters).
	rl.states[accountName] = &providerState{
		requestMetrics: make(map[string]*metricCounter),
		tokenMetrics:   make(map[string]*metricCounter),
		inputMetrics:   make(map[string]*metricCounter),
	}

	// All-or-nothing: model-specific limits fully replace the template.
	for model, ml := range modelLimits {
		key := stateKey(accountName, model)
		rl.states[key] = newProviderState(ml)
	}
}

// getOrCloneState returns the per-model state, lazily cloning from the template
// if the model has not been seen before. Must be called with rl.mu held.
func (rl *RateLimiter) getOrCloneState(accountName, model string) *providerState {
	key := stateKey(accountName, model)
	if state, ok := rl.states[key]; ok {
		return state
	}

	tmpl, ok := rl.templates[accountName]
	if !ok {
		return nil
	}

	cloned := cloneProviderState(tmpl)
	rl.states[key] = cloned
	return cloned
}

func cloneProviderState(src *providerState) *providerState {
	now := time.Now()
	dst := &providerState{
		requestMetrics: make(map[string]*metricCounter, len(src.requestMetrics)),
		tokenMetrics:   make(map[string]*metricCounter, len(src.tokenMetrics)),
		inputMetrics:   make(map[string]*metricCounter, len(src.inputMetrics)),
	}
	for k, mc := range src.requestMetrics {
		dst.requestMetrics[k] = &metricCounter{config: mc.config, windowStart: now}
	}
	for k, mc := range src.tokenMetrics {
		dst.tokenMetrics[k] = &metricCounter{config: mc.config, windowStart: now}
	}
	for k, mc := range src.inputMetrics {
		dst.inputMetrics[k] = &metricCounter{config: mc.config, windowStart: now}
	}
	return dst
}

// AllowForModel checks backoff and model-specific rate limits.
func (rl *RateLimiter) AllowForModel(accountName, model string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	if acct, ok := rl.states[accountName]; ok {
		if time.Now().Before(acct.backoffUntil) {
			return false
		}
	}

	if model == "" || model == "auto" {
		return true
	}

	state := rl.getOrCloneState(accountName, model)
	if state == nil {
		return true
	}

	now := time.Now()
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
	for _, mc := range state.inputMetrics {
		if !mc.available(now) {
			return false
		}
	}
	return true
}

func (rl *RateLimiter) AllowTokensForModel(accountName, model string, estimatedTokens int) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	state := rl.getOrCloneState(accountName, model)
	if state == nil {
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

// RecordRequestForModel increments request counters for the model-specific state.
func (rl *RateLimiter) RecordRequestForModel(accountName, model string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	if model == "" || model == "auto" {
		return
	}

	state := rl.getOrCloneState(accountName, model)
	if state == nil {
		return
	}
	now := time.Now()
	for _, mc := range state.requestMetrics {
		mc.reset(now)
		mc.count++
	}
}

// RecordTokensForModel increments token counters for the model-specific state.
func (rl *RateLimiter) RecordTokensForModel(accountName, model string, tokens int) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	if model == "" || model == "auto" {
		return
	}

	state := rl.getOrCloneState(accountName, model)
	if state == nil {
		return
	}
	now := time.Now()
	for _, mc := range state.tokenMetrics {
		mc.reset(now)
		mc.count += tokens
	}
}

// RecordInputsForModel increments input counters (e.g. ipm) for the model-specific state.
func (rl *RateLimiter) RecordInputsForModel(accountName, model string, inputs int) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	if model == "" || model == "auto" {
		return
	}

	state := rl.getOrCloneState(accountName, model)
	if state == nil {
		return
	}
	now := time.Now()
	for _, mc := range state.inputMetrics {
		mc.reset(now)
		mc.count += inputs
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

// StatusForModel returns the live rate limit status for a specific model.
func (rl *RateLimiter) StatusForModel(accountName, model string) AccountStatus {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	state := rl.getOrCloneState(accountName, model)
	if state == nil {
		return AccountStatus{Available: true}
	}

	now := time.Now()
	status := AccountStatus{Available: true}

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
	for _, mc := range state.inputMetrics {
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

// Status returns template-level metrics and backoff state for an account.
func (rl *RateLimiter) Status(accountName string) AccountStatus {
	rl.mu.RLock()
	defer rl.mu.RUnlock()

	tmpl, ok := rl.templates[accountName]
	if !ok {
		return AccountStatus{Available: true}
	}

	status := AccountStatus{Available: true}
	for _, mc := range tmpl.requestMetrics {
		status.Metrics = append(status.Metrics, MetricStatus{
			Metric: mc.config.Metric, Used: 0, Max: mc.config.MaxValue,
		})
	}
	for _, mc := range tmpl.tokenMetrics {
		status.Metrics = append(status.Metrics, MetricStatus{
			Metric: mc.config.Metric, Used: 0, Max: mc.config.MaxValue,
		})
	}
	for _, mc := range tmpl.inputMetrics {
		status.Metrics = append(status.Metrics, MetricStatus{
			Metric: mc.config.Metric, Used: 0, Max: mc.config.MaxValue,
		})
	}

	if acct, ok := rl.states[accountName]; ok {
		if time.Now().Before(acct.backoffUntil) {
			status.Available = false
			status.Reason = "backoff"
		}
	}
	return status
}
