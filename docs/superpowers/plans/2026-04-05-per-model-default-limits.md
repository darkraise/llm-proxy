# Per-Model Default Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the default limit row (`model=""`) from a shared account-wide counter to a per-model template that gives each model its own independent counter, and simplify account creation to copy provider rate limit definitions as-is instead of fanning them out.

**Architecture:** The RateLimiter gains a template concept — `model=""` limits become templates that are lazily cloned into per-model counters on first access. Models with any explicit override use only their explicit limits (all-or-nothing, no merging). `GetDefaultLimits` is simplified to pass-through without fan-out. Proxy handlers switch from account-level to model-level recording.

**Tech Stack:** Go (backend), React/TypeScript (frontend)

---

### Task 1: Rewrite RateLimiter with template + lazy clone

**Files:**
- Modify: `internal/provider/ratelimit.go`

- [ ] **Step 1: Add template field to RateLimiter and update Configure**

Replace the entire `internal/provider/ratelimit.go` with the new implementation. Key changes:
- Add `templates map[string]*providerState` field to `RateLimiter`
- `Configure` stores `model=""` limits as a template under `accountName` key in `templates`, not in `states`
- `Configure` creates per-model states in `states` — if a model has any explicit limits, use only those (all-or-nothing); otherwise skip (will be lazy-cloned later)
- Account-level `states[accountName]` only stores backoff, no rate counters

```go
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
```

Update `Configure`:

```go
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
	}

	// All-or-nothing: model-specific limits fully replace the template.
	for model, ml := range modelLimits {
		key := stateKey(accountName, model)
		rl.states[key] = newProviderState(ml)
	}
}
```

- [ ] **Step 2: Add getOrCloneState helper for lazy cloning**

```go
// getOrCloneState returns the per-model state, lazily cloning from the
// template if no explicit state exists. Must be called with rl.mu held.
func (rl *RateLimiter) getOrCloneState(accountName, model string) *providerState {
	key := stateKey(accountName, model)
	if state, ok := rl.states[key]; ok {
		return state
	}

	tmpl, ok := rl.templates[accountName]
	if !ok {
		return nil
	}

	// Clone template into a fresh per-model state.
	cloned := cloneProviderState(tmpl)
	rl.states[key] = cloned
	return cloned
}
```

Add the `cloneProviderState` function:

```go
func cloneProviderState(src *providerState) *providerState {
	now := time.Now()
	dst := &providerState{
		requestMetrics: make(map[string]*metricCounter, len(src.requestMetrics)),
		tokenMetrics:   make(map[string]*metricCounter, len(src.tokenMetrics)),
	}
	for k, mc := range src.requestMetrics {
		dst.requestMetrics[k] = &metricCounter{config: mc.config, windowStart: now}
	}
	for k, mc := range src.tokenMetrics {
		dst.tokenMetrics[k] = &metricCounter{config: mc.config, windowStart: now}
	}
	return dst
}
```

- [ ] **Step 3: Update AllowForModel to use lazy clone**

```go
func (rl *RateLimiter) AllowForModel(accountName, model string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	// Check account-level backoff first.
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
		return true // no limits configured
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
	return true
}
```

- [ ] **Step 4: Update RecordRequestForModel and RecordTokensForModel**

```go
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
```

- [ ] **Step 5: Remove old account-level methods, add AllowTokensForModel and StatusForModel**

Remove `Allow`, `RecordRequest`, `RecordTokens`, `AllowTokens` methods. Add:

```go
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
	return status
}
```

Update `Status` to return template info:

```go
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

	// Check backoff on account-level state.
	if acct, ok := rl.states[accountName]; ok {
		if time.Now().Before(acct.backoffUntil) {
			status.Available = false
			status.Reason = "backoff"
		}
	}
	return status
}
```

- [ ] **Step 6: Run tests to verify compilation**

Run: `go build ./internal/provider/...`
Expected: compilation errors in tests (they reference removed methods). That's expected — we fix tests in the next task.

- [ ] **Step 7: Commit**

```bash
git add internal/provider/ratelimit.go
git commit -m "refactor(ratelimit): template-based lazy per-model counters"
```

---

### Task 2: Rewrite RateLimiter tests

**Files:**
- Modify: `internal/provider/ratelimit_test.go`

- [ ] **Step 1: Rewrite all tests for new semantics**

Replace the entire test file. Key changes:
- All tests use `AllowForModel` / `RecordRequestForModel` / `RecordTokensForModel` instead of `Allow` / `RecordRequest` / `RecordTokens`
- `TestRateLimiter_TemplateInheritance`: default row limits apply independently per model
- `TestRateLimiter_AllOrNothingOverride`: model with explicit limits ignores template entirely
- `TestRateLimiter_AccountLevelLimit_BlocksAllModels` is removed (no shared counter)
- `TestRateLimiter_PerModelTokens` no longer checks account-level token counter

```go
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

	// Each model gets its own independent counter from the template.
	rl.RecordRequestForModel("acct", "model-a")
	rl.RecordRequestForModel("acct", "model-a")

	// model-a exhausted
	if rl.AllowForModel("acct", "model-a") {
		t.Error("model-a should be exhausted (2/2 rpm)")
	}

	// model-b is independent — still has full budget
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

	// "special" has explicit RPM=2, so template is fully ignored (no TPM limit).
	rl.RecordRequestForModel("acct", "special")
	rl.RecordRequestForModel("acct", "special")
	if rl.AllowForModel("acct", "special") {
		t.Error("special should be exhausted (2/2 rpm)")
	}

	// "normal" inherits template: RPM=10, TPM=5000
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

	// model-b has independent token counter
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

	// RPM has headroom (2/10) but RPD is exhausted (2/2)
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

	// Other models use the template (100 rpm), unaffected by llama
	if !rl.AllowForModel("acct", "mixtral") {
		t.Error("mixtral should be allowed (0/100 rpm from template)")
	}
}
```

- [ ] **Step 2: Run tests**

Run: `go test ./internal/provider/ -v`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add internal/provider/ratelimit_test.go
git commit -m "test(ratelimit): rewrite tests for per-model template semantics"
```

---

### Task 3: Update Pool to use model-level methods

**Files:**
- Modify: `internal/provider/pool.go`

- [ ] **Step 1: Replace RecordSuccess with RecordSuccessForModel**

Remove `RecordSuccess` method. Update `RecordSuccessForModel` to only record per-model (no account-level):

```go
func (p *Pool) RecordSuccessForModel(name, model string, tokens int) {
	p.rateLimiter.RecordRequestForModel(name, model)
	if tokens > 0 {
		p.rateLimiter.RecordTokensForModel(name, model, tokens)
	}
}
```

- [ ] **Step 2: Replace AllowTokens with AllowTokensForModel**

Remove:
```go
func (p *Pool) AllowTokens(name string, estimated int) bool {
	return p.rateLimiter.AllowTokens(name, estimated)
}
```

Add:
```go
func (p *Pool) AllowTokensForModel(name, model string, estimated int) bool {
	return p.rateLimiter.AllowTokensForModel(name, model, estimated)
}
```

- [ ] **Step 3: Verify compilation**

Run: `go build ./internal/provider/...`
Expected: Passes (pool_test.go references `RecordSuccess` — fixed next task).

- [ ] **Step 4: Commit**

```bash
git add internal/provider/pool.go
git commit -m "refactor(pool): switch to model-level rate limit methods"
```

---

### Task 4: Update Pool tests

**Files:**
- Modify: `internal/provider/pool_test.go`

- [ ] **Step 1: Replace RecordSuccess calls with RecordSuccessForModel**

In `TestPool_AutoRouting_RoundRobin`, replace:
```go
pool.RecordSuccess(p.Name, 0)
```
with:
```go
pool.RecordSuccessForModel(p.Name, "auto", 0)
```

In `TestPool_SkipsExhaustedProviders`, the test exhausts groq's RPM. Since limits are now per-model, set the limit on the account's actual model and exhaust that specific model. Update `makeTestProviders` — groq's limit is already `model=""` which becomes a template. Exhaust the groq account's model `llama-3.3-70b-versatile`:

```go
func TestPool_SkipsExhaustedProviders(t *testing.T) {
	pool := NewPool(makeTestProviders(), nil)

	// Exhaust groq's RPM for its model
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
```

In `TestPool_AllExhausted_ReturnsError`, the account has a single model `m` with `model=""` RPM=1 template:

```go
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
```

- [ ] **Step 2: Run pool tests**

Run: `go test ./internal/provider/ -v`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add internal/provider/pool_test.go
git commit -m "test(pool): update tests for model-level rate limit methods"
```

---

### Task 5: Update proxy handlers to pass model

**Files:**
- Modify: `internal/proxy/handler.go`
- Modify: `internal/proxy/stream.go`

- [ ] **Step 1: Update embedding handler (handler.go:318)**

Change:
```go
h.pool.RecordSuccess(prov.Name, resp.Usage.TotalTokens)
```
to:
```go
h.pool.RecordSuccessForModel(prov.Name, logEntry.Model, resp.Usage.TotalTokens)
```

`logEntry.Model` is set at line 245 via `firstModel(prov, req.Model, store.CategoryEmbedding)` before this point.

- [ ] **Step 2: Update chat non-streaming handler (handler.go:555)**

Change:
```go
h.pool.RecordSuccess(prov.Name, resp.Usage.TotalTokens)
```
to:
```go
h.pool.RecordSuccessForModel(prov.Name, logEntry.Model, resp.Usage.TotalTokens)
```

`logEntry.Model` is set at line 459 via `firstModel(prov, req.Model, category)` before this point.

- [ ] **Step 3: Update streaming handler (stream.go:104)**

Change:
```go
h.pool.RecordSuccess(prov.Name, totalTokens)
```
to:
```go
h.pool.RecordSuccessForModel(prov.Name, logEntry.Model, totalTokens)
```

`logEntry.Model` is set at line 42 via `firstModel(prov, req.Model, category)` before this point.

- [ ] **Step 4: Verify full build**

Run: `go build ./...`
Expected: Passes.

- [ ] **Step 5: Run all tests**

Run: `go test ./...`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add internal/proxy/handler.go internal/proxy/stream.go
git commit -m "fix(proxy): pass model to RecordSuccessForModel for per-model counters"
```

---

### Task 6: Simplify GetDefaultLimits to pass-through

**Files:**
- Modify: `internal/store/ratelimit_def.go`

- [ ] **Step 1: Rewrite GetDefaultLimits**

Replace the function. The new version queries defs, falls back to provider `default_limits`, and returns them as-is without fan-out. The `models` parameter is removed.

```go
// GetDefaultLimits returns rate limit definitions for the given provider as
// AccountLimit entries, preserving model="" as-is (no fan-out). Falls back to
// the provider's default_limits JSON when no admin definitions exist.
func (d *DB) GetDefaultLimits(provider string) ([]AccountLimit, error) {
	defs, err := d.ListRateLimitDefs(provider)
	if err != nil {
		return nil, err
	}

	if len(defs) == 0 {
		prov, pErr := d.GetProvider(provider)
		if pErr == nil {
			for _, pl := range prov.ParseDefaultLimits() {
				defs = append(defs, RateLimitDef{
					Provider:   provider,
					Metric:     pl.Metric,
					MaxValue:   pl.MaxValue,
					WindowSecs: pl.WindowSecs,
				})
			}
		}
	}

	if len(defs) == 0 {
		return []AccountLimit{}, nil
	}

	limits := make([]AccountLimit, 0, len(defs))
	for _, def := range defs {
		limits = append(limits, AccountLimit{
			Model:      def.Model,
			Metric:     def.Metric,
			MaxValue:   def.MaxValue,
			WindowSecs: def.WindowSecs,
		})
	}

	sort.Slice(limits, func(i, j int) bool {
		if limits[i].Model != limits[j].Model {
			return limits[i].Model < limits[j].Model
		}
		return limits[i].Metric < limits[j].Metric
	})
	return limits, nil
}
```

- [ ] **Step 2: Update the admin handler caller**

In `internal/admin/ratelimit_handler.go`, `HandleGetDefaultLimits` currently parses `models` from the query string and passes them. Update it to drop the `models` parameter:

Change:
```go
limits, err := h.db.GetDefaultLimits(provider, models)
```
to:
```go
limits, err := h.db.GetDefaultLimits(provider)
```

The `models` variable and its parsing block (lines 122-129) can be left in place for now (unused variable won't compile — remove the block):

Remove lines 122-129:
```go
	var models []string
	if raw := r.URL.Query().Get("models"); raw != "" {
		for _, m := range strings.Split(raw, ",") {
			if m = strings.TrimSpace(m); m != "" {
				models = append(models, m)
			}
		}
	}
```

The handler becomes:

```go
func (h *AdminHandler) HandleGetDefaultLimits(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")
	if provider == "" {
		writeJSON(w, 400, map[string]string{"error": "provider is required"})
		return
	}

	limits, err := h.db.GetDefaultLimits(provider)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	if limits == nil {
		limits = []store.AccountLimit{}
	}
	writeJSON(w, 200, limits)
}
```

- [ ] **Step 3: Check for other callers of GetDefaultLimits**

Run: `grep -r "GetDefaultLimits" --include="*.go" internal/`

If there are other callers, update them to drop the `models` parameter.

- [ ] **Step 4: Verify build**

Run: `go build ./...`
Expected: Passes.

- [ ] **Step 5: Commit**

```bash
git add internal/store/ratelimit_def.go internal/admin/ratelimit_handler.go
git commit -m "refactor(store): simplify GetDefaultLimits to pass-through without fan-out"
```

---

### Task 7: Update GetDefaultLimits tests

**Files:**
- Modify: `internal/store/ratelimit_def_test.go`

- [ ] **Step 1: Rewrite GetDefaultLimits tests**

Update the four `TestGetDefaultLimits_*` tests for the new pass-through behavior. The signature no longer takes `models`.

Replace `TestGetDefaultLimits_ProviderOnly`:
```go
func TestGetDefaultLimits_ProviderOnly(t *testing.T) {
	db := newTestDB(t)

	db.SetRateLimitDef(RateLimitDef{Provider: "groq", Model: "", Metric: "rpm", MaxValue: 30, WindowSecs: 60})
	db.SetRateLimitDef(RateLimitDef{Provider: "groq", Model: "", Metric: "rpd", MaxValue: 1000, WindowSecs: 86400})

	limits, err := db.GetDefaultLimits("groq")
	if err != nil {
		t.Fatalf("GetDefaultLimits: %v", err)
	}
	// 2 provider-level defs returned as-is (model="").
	if len(limits) != 2 {
		t.Fatalf("limits count: got %d, want 2", len(limits))
	}
	for _, l := range limits {
		if l.Model != "" {
			t.Errorf("expected model=\"\" in returned limits, got %q for metric %s", l.Model, l.Metric)
		}
	}
}
```

Replace `TestGetDefaultLimits_ModelOverridesProvider`:
```go
func TestGetDefaultLimits_ModelOverridesProvider(t *testing.T) {
	db := newTestDB(t)

	db.SetRateLimitDef(RateLimitDef{Provider: "groq", Model: "", Metric: "rpm", MaxValue: 30, WindowSecs: 60})
	db.SetRateLimitDef(RateLimitDef{Provider: "groq", Model: "llama-3.3-70b", Metric: "rpm", MaxValue: 20, WindowSecs: 60})

	limits, err := db.GetDefaultLimits("groq")
	if err != nil {
		t.Fatalf("GetDefaultLimits: %v", err)
	}
	// Both defs returned as-is: one model="", one model="llama-3.3-70b".
	if len(limits) != 2 {
		t.Fatalf("limits count: got %d, want 2", len(limits))
	}

	sort.Slice(limits, func(i, j int) bool { return limits[i].Model < limits[j].Model })

	if limits[0].Model != "" || limits[0].MaxValue != 30 {
		t.Errorf("expected model=\"\" rpm=30, got model=%q rpm=%d", limits[0].Model, limits[0].MaxValue)
	}
	if limits[1].Model != "llama-3.3-70b" || limits[1].MaxValue != 20 {
		t.Errorf("expected model=llama rpm=20, got model=%q rpm=%d", limits[1].Model, limits[1].MaxValue)
	}
}
```

Replace `TestGetDefaultLimits_EmptyModels` (rename since `models` param is gone):
```go
func TestGetDefaultLimits_NoDefsReturnsEmpty(t *testing.T) {
	db := newTestDB(t)
	// No defs set for this provider, and "unknown" has no seeded default_limits.
	limits, err := db.GetDefaultLimits("unknown-provider")
	if err != nil {
		t.Fatalf("GetDefaultLimits: %v", err)
	}
	if len(limits) != 0 {
		t.Errorf("expected empty for unknown provider, got %d", len(limits))
	}
}
```

Replace `TestGetDefaultLimits_ReturnsEmptyWithNoAdminDefs`:
```go
func TestGetDefaultLimits_FallsBackToProviderDefaults(t *testing.T) {
	db := newTestDB(t)

	// No admin-defined limits — falls back to provider's default_limits.
	// Groq has rpm, rpd, tpm seeded.
	limits, err := db.GetDefaultLimits("groq")
	if err != nil {
		t.Fatalf("GetDefaultLimits: %v", err)
	}
	if len(limits) == 0 {
		t.Errorf("expected provider default limits for groq, got 0")
	}
	// All should have model="" since provider defaults have no model.
	for _, l := range limits {
		if l.Model != "" {
			t.Errorf("provider default should have model=\"\", got %q", l.Model)
		}
	}
}
```

- [ ] **Step 2: Run store tests**

Run: `go test ./internal/store/ -v -run TestGetDefaultLimits`
Expected: All four tests pass.

- [ ] **Step 3: Run full test suite**

Run: `go test ./...`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add internal/store/ratelimit_def_test.go
git commit -m "test(store): update GetDefaultLimits tests for pass-through behavior"
```

---

### Task 8: Update frontend AddModelsDialog

**Files:**
- Modify: `web/src/components/AddModelsDialog.tsx`

- [ ] **Step 1: Stop filtering out default limits in handleFinish**

In `handleFinish` (around line 147-158), change:

```tsx
      // Only pass non-default limits (model-specific ones the user set)
      const newLimits = limits.filter((l) => l.model !== '')
```

to:

```tsx
      const newLimits = limits
```

This sends both `model=""` and model-specific limits to the backend.

- [ ] **Step 2: Verify frontend builds**

Run: `cd web && npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/AddModelsDialog.tsx
git commit -m "fix(ui): preserve default limit row when adding models"
```

---

### Task 9: Update frontend API client (drop models param)

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/pages/Accounts.tsx`
- Modify: `web/src/pages/Scanner.tsx`

- [ ] **Step 1: Update API client defaults method**

In `web/src/lib/api.ts` (around line 447-451), change:

```tsx
    defaults: (provider: string, models: string[]) =>
      request<AccountLimit[]>(
        'GET',
        `/ratelimits/${provider}/defaults${models.length > 0 ? '?models=' + models.join(',') : ''}`,
      ),
```

to:

```tsx
    defaults: (provider: string) =>
      request<AccountLimit[]>('GET', `/ratelimits/${provider}/defaults`),
```

- [ ] **Step 2: Update Accounts.tsx caller**

In `web/src/pages/Accounts.tsx` (around line 362), change:

```tsx
        api.ratelimits.defaults(s1.type, models),
```

to:

```tsx
        api.ratelimits.defaults(s1.type),
```

The `models` variable computed on line 358 is still used elsewhere in `goToStep3` — keep it.

- [ ] **Step 3: Update Scanner.tsx caller**

In `web/src/pages/Scanner.tsx` (around line 694), change:

```tsx
      limits = await api.ratelimits.defaults(group.provider, allModels)
```

to:

```tsx
      limits = await api.ratelimits.defaults(group.provider)
```

- [ ] **Step 4: Verify frontend builds**

Run: `cd web && npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/api.ts web/src/pages/Accounts.tsx web/src/pages/Scanner.tsx
git commit -m "refactor(ui): drop models param from defaults API call"
```

---

### Task 10: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full backend test suite**

Run: `go test ./...`
Expected: All tests pass.

- [ ] **Step 2: Run full frontend build**

Run: `cd web && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Build the Go binary**

Run: `go build ./cmd/llm-proxy`
Expected: Binary compiles successfully.
