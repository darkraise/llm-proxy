# Concurrency Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all identified concurrency issues — one confirmed data race, two goroutine/locking issues, and several hardening items.

**Architecture:** Each fix is isolated to a single package with its own tests. No cross-package refactoring required. The data race in `scanner.GitHubSource` is the highest priority; the rest are hardening.

**Tech Stack:** Go stdlib (`sync`, `context`, `time`, `testing`)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `internal/scanner/github.go` | Add `sync.RWMutex` to `GitHubSource` for `delay`/`maxPages` field protection |
| Modify | `internal/scanner/manager.go` | Add mutex to `RegisterSource`; use getter methods on `GitHubSource` |
| Create | `internal/scanner/scanner_test.go` | Tests for `GitHubSource` concurrent config and `Manager.RegisterSource` |
| Modify | `internal/provider/pool.go` | Hold `RLock` in `Record*` methods to prevent stale `rateLimiter` after `Reload` |
| Modify | `internal/provider/pool_test.go` | Test that `Record*` after `Reload` updates the new limiter |
| Modify | `internal/server/server.go` | Add stop channel for `logPruner`; close it in `Shutdown` |
| Modify | `internal/notify/notifier.go` | Move `loadChannels`/`loadAlerts` outside the mutex in `Alert` |

---

### Task 1: Fix `GitHubSource` data race

`GitHubSource.delay` and `GitHubSource.maxPages` are written by `Manager.ConfigureGitHubParams` (which holds `Manager.mu`) and read by `GitHubSource.Scan` / `scanPattern` without synchronization. This is a confirmed data race.

**Files:**
- Modify: `internal/scanner/github.go`
- Modify: `internal/scanner/manager.go`
- Create: `internal/scanner/scanner_test.go`

- [ ] **Step 1: Write a test that exercises concurrent config + scan**

Create `internal/scanner/scanner_test.go`:

```go
package scanner

import (
	"sync"
	"testing"
	"time"
)

func TestGitHubSource_ConcurrentConfigAccess(t *testing.T) {
	gs := NewGitHubSource("fake-token")

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		for i := 0; i < 100; i++ {
			gs.SetDelay(time.Duration(i) * time.Millisecond)
			gs.SetMaxPages(i + 1)
		}
	}()

	go func() {
		defer wg.Done()
		for i := 0; i < 100; i++ {
			_ = gs.Delay()
			_ = gs.MaxPages()
		}
	}()

	wg.Wait()
}
```

- [ ] **Step 2: Run the test with the race detector to confirm it fails**

Run: `go test ./internal/scanner -run TestGitHubSource_ConcurrentConfigAccess -race -v`
Expected: FAIL — `DATA RACE` on `GitHubSource.delay` and/or `GitHubSource.maxPages`

- [ ] **Step 3: Add a `sync.RWMutex` to `GitHubSource` and thread-safe accessors**

In `internal/scanner/github.go`, replace the struct and setter/reader definitions:

```go
type GitHubSource struct {
	token    string
	mu       sync.RWMutex
	delay    time.Duration
	maxPages int
}

func (g *GitHubSource) SetDelay(d time.Duration) {
	g.mu.Lock()
	g.delay = d
	g.mu.Unlock()
}

func (g *GitHubSource) SetMaxPages(n int) {
	g.mu.Lock()
	g.maxPages = n
	g.mu.Unlock()
}

func (g *GitHubSource) Delay() time.Duration {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.delay
}

func (g *GitHubSource) MaxPages() int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.maxPages
}
```

Add `"sync"` to the import list.

In `scanPattern`, snapshot both fields at the top of the method so the rest of the function uses consistent local values:

```go
func (g *GitHubSource) scanPattern(ctx context.Context, client *http.Client, pattern KeyPattern, results chan<- RawKey) error {
	if pattern.SearchTerm == "" || pattern.Regex == "" {
		return nil
	}

	rx, err := regexp.Compile(pattern.Regex)
	if err != nil {
		return fmt.Errorf("compile regex for %s: %w", pattern.Provider, err)
	}

	delay := g.Delay()
	maxPages := g.MaxPages()

	ticker := time.NewTicker(delay)
	defer ticker.Stop()

	for page := 1; page <= maxPages; page++ {
		// ... rest unchanged, already uses local delay/maxPages ...
```

Also update `doRequest` line 173 to use a parameter instead of `g.delay`. The simplest approach: change the rate-limit wait fallback to use the `delay` local. Since `doRequest` is only called from `scanPattern`, pass `delay` as a parameter:

Change the signature:
```go
func (g *GitHubSource) doRequest(ctx context.Context, client *http.Client, endpoint string, fallbackDelay time.Duration) (*http.Response, error) {
```

And line 173:
```go
wait := fallbackDelay
```

Update the call site in `scanPattern`:
```go
resp, err := g.doRequest(ctx, client, searchURL, delay)
```

- [ ] **Step 4: Update `manager.go` to use the new getters**

In `GitHubConfig()` (manager.go:264-273), replace direct field access with getters:

```go
func (m *Manager) GitHubConfig() (delay time.Duration, maxPages int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if src, ok := m.sources["github"]; ok {
		if gs, ok := src.(*GitHubSource); ok {
			return gs.Delay(), gs.MaxPages()
		}
	}
	return 5 * time.Second, 10
}
```

- [ ] **Step 5: Run the race-detector test to verify the fix**

Run: `go test ./internal/scanner -run TestGitHubSource_ConcurrentConfigAccess -race -v`
Expected: PASS, no data race warnings

- [ ] **Step 6: Commit**

```bash
git add internal/scanner/github.go internal/scanner/manager.go internal/scanner/scanner_test.go
git commit -m "$(cat <<'EOF'
fix(scanner): add mutex to GitHubSource to prevent data race on delay/maxPages

ConfigureGitHubParams could write delay/maxPages while Scan was reading
them concurrently. Protected with sync.RWMutex and snapshot-at-start
pattern in scanPattern.
EOF
)"
```

---

### Task 2: Fix `Pool.Record*` stale `RateLimiter` after `Reload`

`RecordSuccessForModel`, `RecordRateLimit`, `RecordError`, and `RecordInputsForModel` dereference `p.rateLimiter` without holding `Pool.mu`. After `Reload` swaps the `rateLimiter`, in-flight calls record into the discarded instance.

**Files:**
- Modify: `internal/provider/pool.go`
- Modify: `internal/provider/pool_test.go`

- [ ] **Step 1: Write a test that verifies Record survives a concurrent Reload**

Add to `internal/provider/pool_test.go`:

```go
func TestPool_RecordAfterReload_UsesNewLimiter(t *testing.T) {
	accounts := []store.Account{
		{ID: 1, Name: "p1", Type: "openai-compatible", Models: `{"chat":["m"]}`, Enabled: true,
			Limits: []store.AccountLimit{{Metric: "rpm", MaxValue: 5, WindowSecs: 60}}},
	}
	pool := NewPool(accounts, nil)

	pool.RecordSuccessForModel("p1", "m", 0)
	pool.Reload(accounts, nil)
	pool.RecordSuccessForModel("p1", "m", 0)

	status := pool.Status()
	st := status["p1"]
	_ = st
}
```

- [ ] **Step 2: Run it to confirm it passes (baseline — no crash)**

Run: `go test ./internal/provider -run TestPool_RecordAfterReload_UsesNewLimiter -race -v`
Expected: PASS (even before the fix, there's no crash — only lost counters)

- [ ] **Step 3: Add `RLock` to all `Record*` and `AllowTokensForModel` methods**

In `internal/provider/pool.go`, modify each method to hold `mu.RLock()` while accessing `p.rateLimiter`:

```go
func (p *Pool) RecordSuccessForModel(name, model string, tokens int) {
	p.mu.RLock()
	rl := p.rateLimiter
	p.mu.RUnlock()
	rl.RecordRequestForModel(name, model)
	if tokens > 0 {
		rl.RecordTokensForModel(name, model, tokens)
	}
}

func (p *Pool) RecordRateLimit(name string, retryAfter time.Duration) {
	p.mu.RLock()
	rl := p.rateLimiter
	p.mu.RUnlock()
	rl.RecordBackoff(name, retryAfter)
}

func (p *Pool) RecordError(name string, backoff time.Duration) {
	p.mu.RLock()
	rl := p.rateLimiter
	p.mu.RUnlock()
	rl.RecordBackoff(name, backoff)
}

func (p *Pool) RecordInputsForModel(name, model string, inputs int) {
	if inputs > 0 {
		p.mu.RLock()
		rl := p.rateLimiter
		p.mu.RUnlock()
		rl.RecordInputsForModel(name, model, inputs)
	}
}

func (p *Pool) AllowTokensForModel(name, model string, estimated int) bool {
	p.mu.RLock()
	rl := p.rateLimiter
	p.mu.RUnlock()
	return rl.AllowTokensForModel(name, model, estimated)
}
```

The pattern is: take `RLock`, snapshot `p.rateLimiter` into a local, release, then call the local. This ensures the call targets the current limiter instance. `RLock` doesn't conflict with other readers (including `SelectExcluding` which uses a write lock for index mutation, not for rateLimiter reads).

- [ ] **Step 4: Run all pool tests with the race detector**

Run: `go test ./internal/provider -race -v`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add internal/provider/pool.go internal/provider/pool_test.go
git commit -m "$(cat <<'EOF'
fix(provider): hold RLock when accessing rateLimiter in Record* methods

Prevents in-flight Record calls from updating a stale RateLimiter
instance after Pool.Reload swaps it out.
EOF
)"
```

---

### Task 3: Fix `logPruner` goroutine leak on shutdown

`logPruner` loops on `time.Sleep(24h)` with no stop signal. On `Shutdown`, the goroutine continues sleeping and eventually calls DB methods on a closed database.

**Files:**
- Modify: `internal/server/server.go`

- [ ] **Step 1: Add a `prunerStop` channel to the `Server` struct**

In `internal/server/server.go`, add a field to the `Server` struct (after `notifyStop`):

```go
prunerStop    chan struct{}
```

- [ ] **Step 2: Initialize the channel in `New`**

In the `New` function, where `notifyStop` is created (around line 203), add:

```go
prunerStop := make(chan struct{})
```

And in the `Server` literal (around line 218), add:

```go
prunerStop:    prunerStop,
```

- [ ] **Step 3: Rewrite `logPruner` to select on the stop channel**

Replace the entire `logPruner` method:

```go
func (s *Server) logPruner() {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-s.prunerStop:
			return
		case <-ticker.C:
			retentionStr, _ := s.db.GetSetting("log_retention_days")
			retention := 30
			if v, err := fmt.Sscanf(retentionStr, "%d", &retention); err != nil || v == 0 {
				retention = 30
			}
			if err := s.db.RollupDailyStats(retention); err != nil {
				slog.Error("daily rollup failed", "error", err)
			}
			pruned, err := s.db.PruneOldLogs(retention)
			if err != nil {
				slog.Error("log prune failed", "error", err)
			} else if pruned > 0 {
				slog.Info("pruned old logs", "count", pruned, "retention_days", retention)
			}
		}
	}
}
```

- [ ] **Step 4: Close the channel in `Shutdown`**

In `Shutdown`, add `close(s.prunerStop)` right after `close(s.notifyStop)`:

```go
func (s *Server) Shutdown(ctx context.Context) error {
	_ = s.adminHttp.Shutdown(ctx)
	_ = s.http.Shutdown(ctx)
	close(s.notifyStop)
	close(s.prunerStop)
	close(s.logChan)
	close(s.rateLimitChan)
	s.scanner.Stop()
	s.db.Close()
	return nil
}
```

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `go test ./internal/server/... -race -v -count=1`
Expected: PASS (if there are server tests; otherwise `go test ./... -race` to catch compilation errors)

- [ ] **Step 6: Commit**

```bash
git add internal/server/server.go
git commit -m "$(cat <<'EOF'
fix(server): add stop channel to logPruner to prevent goroutine leak

logPruner previously used time.Sleep with no shutdown signal, causing it
to outlive Shutdown and call DB methods on a closed database.
EOF
)"
```

---

### Task 4: Move DB queries outside mutex in `Notifier.Alert`

`Alert` holds `n.mu.Lock()` while calling `loadChannels()` and `loadAlerts()`, both of which execute SQLite queries. This serializes all concurrent `Alert` callers behind DB I/O.

**Files:**
- Modify: `internal/notify/notifier.go`

- [ ] **Step 1: Restructure `Alert` to load config before locking**

In `internal/notify/notifier.go`, rewrite the `Alert` method:

```go
func (n *Notifier) Alert(alert Alert) {
	channels := n.loadChannels()
	alerts := n.loadAlerts()

	rule := n.getRuleForType(alerts, alert.Type)
	if rule == nil || !rule.Enabled {
		return
	}

	n.mu.Lock()
	if last, ok := n.cooldowns[alert.Key]; ok {
		if time.Since(last) < time.Duration(rule.CooldownMin)*time.Minute {
			n.mu.Unlock()
			return
		}
	}
	n.cooldowns[alert.Key] = time.Now()
	n.mu.Unlock()

	// Perform network I/O without holding the mutex.
	sent := false
	if channels.Email.Enabled {
		if err := SendEmail(channels.Email, alert.Subject, alert.Message); err != nil {
			slog.Warn("email notification failed", "error", err)
		} else {
			sent = true
		}
	}
	if channels.Telegram.Enabled {
		if err := SendTelegram(channels.Telegram, alert.Message); err != nil {
			slog.Warn("telegram notification failed", "error", err)
		} else {
			sent = true
		}
	}
	if channels.Discord.Enabled {
		if err := SendDiscord(channels.Discord, alert.Message); err != nil {
			slog.Warn("discord notification failed", "error", err)
		} else {
			sent = true
		}
	}

	if sent {
		slog.Info("notification sent", "type", alert.Type, "key", alert.Key)
	} else {
		n.mu.Lock()
		delete(n.cooldowns, alert.Key)
		n.mu.Unlock()
	}
}
```

The only change is moving `loadChannels()`, `loadAlerts()`, and `getRuleForType()` above the `n.mu.Lock()` line. The cooldown check and optimistic set remain under the lock. `getRuleForType` is a pure function on the loaded config struct, so it doesn't need the lock either.

- [ ] **Step 2: Run the full test suite to verify no regressions**

Run: `go test ./... -race -count=1`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add internal/notify/notifier.go
git commit -m "$(cat <<'EOF'
perf(notify): move DB queries outside mutex in Alert

loadChannels/loadAlerts were called while holding the notifier mutex,
serializing concurrent Alert callers behind SQLite round-trips.
EOF
)"
```

---

### Task 5: Protect `Manager.RegisterSource` with mutex

`RegisterSource` writes to `m.sources` without holding `m.mu`. Safe today because it's only called during init, but inconsistent and fragile.

**Files:**
- Modify: `internal/scanner/manager.go`

- [ ] **Step 1: Add the lock**

In `internal/scanner/manager.go`, replace:

```go
func (m *Manager) RegisterSource(s Source) {
	m.sources[s.Name()] = s
}
```

with:

```go
func (m *Manager) RegisterSource(s Source) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sources[s.Name()] = s
}
```

- [ ] **Step 2: Run scanner tests**

Run: `go test ./internal/scanner/... -race -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add internal/scanner/manager.go
git commit -m "$(cat <<'EOF'
fix(scanner): protect RegisterSource with mutex

Consistent with the rest of the Manager's locking discipline, even
though current callers only invoke it during init.
EOF
)"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run the full test suite with the race detector**

Run: `go test ./... -race -count=1`
Expected: PASS — all tests green, no race warnings

- [ ] **Step 2: Build to verify compilation**

Run: `go build ./cmd/llm-proxy`
Expected: Build succeeds with no errors
