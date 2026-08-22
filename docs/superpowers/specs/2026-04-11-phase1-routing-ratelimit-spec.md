# Phase 1 Spec — Routing and Rate-Limit Refactor

**Status:** Draft for review. This is a design document, not an implementation plan. The implementation plan will be written against this spec after the design decisions are accepted.

**Scope:** Items A1–A6 from the 9router borrow list. No other sections of the borrow list are in scope for Phase 1.

**Non-goals:** Per-key API rate limiting (H1), provider OAuth support (B1), combos (C1), cost tracking (D2). Those belong to later phases.

---

## 1. Overview

Phase 1 makes the llm-proxy router smarter about degraded-provider recovery and about spreading load across multiple accounts of the same provider. Six concrete changes:

- **A1** Per-model account cooldowns — when a provider returns 429 on a specific model, cool down only that `(account, model)` pair so the same key keeps serving other models.
- **A2** Exponential backoff ladder — when provider responses lack usable `X-RateLimit-*` headers, fall back to a per-account ladder (1s → 2s → 4s → 8s → 15s → 30s → 60s → 120s) that resets on success.
- **A3** Sticky round-robin — optional per-provider `sticky_limit` that keeps a single account selected for N consecutive uses before rotating, to preserve prompt caching and session affinity.
- **A4** Global strategy toggle — `round-robin` (current behavior) versus `fill-first` (always prefer the first healthy account; rotate only when the leader is unavailable).
- **A5** Per-provider strategy override — individual providers can opt out of the global default.
- **A6** Expanded failover matrix — 401, 402, 403, 408, 429, 5xx each trigger failover with per-code backoff semantics instead of today's blanket handling.

---

## 1.1 Terminology

Used consistently throughout the rest of the spec:

- **Provider type** — the identifier string stored in `accounts.type` and `providers.name`. Example: `openai`, `anthropic`. A single provider type is represented by one row in the `providers` table.
- **Provider row** — the `store.Provider` record describing a provider type's configuration (base URL, auth type, default limits, etc.).
- **Account** — a single credential for a provider type, represented by a row in `accounts`. Many accounts can share the same provider type.
- **Provider subset** — the set of currently-selectable accounts that belong to a single provider type AND meet the current request's filter criteria (matching model, or matching category when the client used `auto`). The routing strategy applies within a provider subset.
- **Provider health signal** — a response from an upstream provider that indicates the provider is reachable and functioning, regardless of whether the request was itself successful. Concretely: any HTTP response with a status code that is NOT one of {408, 429, 500, 502, 503, 504, 401, 402, 403} and was NOT a network-level error (connection refused, TLS failure, client timeout). 2xx, 3xx, 404, 400 (non-auth client error), 422 — all count as health signals. They reset the backoff ladder for the account that served them.

---

## 2. Design decisions

### 2.1 Per-model cooldown data model (A1)

**Decision:** Piggyback on the existing `RateLimiter.states` map. Its keys are already `stateKey(accountName, model)` (see `internal/provider/ratelimit.go:73`), and `providerState` already has a `backoffUntil` field (line 44). The per-model state object is lazily cloned from a template via `getOrCloneState`.

`RecordBackoff` currently writes `backoffUntil` on the account-level entry (`rl.states[providerName]`, line 297). Phase 1 changes its signature to `RecordBackoff(accountName, model string, duration time.Duration)`. When `model == ""`, it writes the account-level state (today's behavior). When `model != ""`, it writes the per-model state, lazily cloning from the template if needed.

`AllowForModel` already checks account-level `backoffUntil` (line 182). Add a second check against the per-model state's `backoffUntil` after the existing check.

**No schema change.** State is in-memory only, same as everything else in `RateLimiter`. This matches how the newly-landed `ipm` metric works.

**Rationale:** The file already has 90% of the scaffolding. This is a surgical extension, not a rewrite.

### 2.2 Backoff level state keying (A2)

**Decision:** Per-account, not per-model. The ladder tracks "how degraded is this account overall" — repeated failures on the same account, even across models, should escalate. Per-model ladders add state size and confuse the recovery model.

New field on `providerState`: `backoffLevel int` (next to `backoffUntil`). Lives on the account-level entry only (`rl.states[accountName]`). In-memory.

New package-private slice constant in `internal/provider/ratelimit.go`:

```go
var backoffLadder = []time.Duration{
    1 * time.Second,
    2 * time.Second,
    4 * time.Second,
    8 * time.Second,
    15 * time.Second,
    30 * time.Second,
    60 * time.Second,
    120 * time.Second,
}
```

New package-private helper: `ladderDuration(level int) time.Duration` that returns `backoffLadder[min(level, len(backoffLadder)-1)]`.

New `RateLimiter` method (package-private): `recordLadderBackoff(accountName string) time.Duration`. Reads the current account-level `backoffLevel`, computes the duration via `ladderDuration`, increments the level (capped at `len(backoffLadder)-1`), writes both `backoffUntil = now.Add(duration)` and `backoffLevel`, and returns the duration so the caller can log it.

New `RateLimiter` method (package-private): `resetLadder(accountName string)`. Sets `backoffLevel` back to 0 for the named account. Does NOT touch `backoffUntil` — an existing cooldown window stays honored until it naturally elapses; the reset only affects the next escalation.

**Persistence:** None. If the process crashes, the ladder resets. That's acceptable because `backoffUntil` is also in-memory — both need to come back together, and the cost of a transient reset is bounded (worst case: the account gets one free retry attempt after a restart, which is fine).

### 2.3 Backoff level reset criteria (A2 continued)

**Decision:** Reset the ladder to 0 on any **provider health signal** (see §1.1) received from the account. Reset happens via a new `Pool.RecordHealthy(accountName string)` method that internally calls `rl.resetLadder(accountName)`. No time-based auto-reset.

The proxy handler calls `Pool.RecordHealthy` from two places: the success path (after receiving a 2xx, before calling `RecordSuccessForModel`), and the non-retry error path (after receiving a 4xx that isn't 408/429/401/402/403, before returning the error to the client). `Pool.RecordSuccessForModel` internally also calls `RecordHealthy` for symmetry, so callers that only know about the success path still reset the ladder.

**Rationale:** A response from the provider — even a client error like 400 — proves the provider is reachable and functioning, which is what the ladder is tracking. Only provider-side failures (5xx, 408, 429) and account-state failures (401/402/403) should leave the ladder elevated. Basing the reset on "the provider answered us" rather than "the request succeeded" is the correct granularity. This also matches 9router's behavior for the affected cases.

### 2.4 Sticky round-robin counter semantics (A3)

**Decision:** Sticky state is keyed by **provider type only** — not per-model, not global-per-pool, not per-(provider-type, model). A single `stickyState` entry per provider type covers both `auto` and model-specific selection, since the affinity benefit (prompt caching, warm connections, session continuity) is provider-side and doesn't depend on which model the next request happens to use.

New types (package-private in `internal/provider/pool.go`):
```go
type stickyState struct {
    accountName string // currently sticky account for this provider type
    remaining   int    // consecutive uses remaining before forced rotation
}
```

New field on `Pool`: `stickyStates map[string]*stickyState` keyed by provider type (e.g., `"openai"`, `"anthropic"`).

**Concurrency:** All reads and mutations of `stickyStates` happen under `Pool.mu` write lock, same as the existing `Pool.index` field. The spec does not introduce a second mutex.

**Selection algorithm (within a single provider subset, for a fresh request):**

1. If `stickyStates[providerType]` exists, points to an account that is still in the candidate list, is healthy (backoff not active, rate-limit checks pass), and has `remaining > 0`: use it, decrement `remaining`.
2. Otherwise advance: find the next healthy candidate in round-robin order starting from the index after the previously-sticky account (or from index 0 if there was no previous sticky). Write a new `stickyState{accountName, remaining: effectiveStickyLimit - 1}`. Subtracting 1 counts this first use as one of the allotted uses.
3. If no candidate in the provider subset is healthy, return "unavailable for this provider" and let the outer loop try the next provider type.

Here `effectiveStickyLimit` is the result of the resolution in §2.6 (per-provider override if set, else global).

**Reset conditions for `remaining`:**

- **Decrement on each use** by the sticky account.
- **Force to 0** (immediate rotation on the next selection) when any failure is recorded against the sticky account — `Pool.RecordStatusCode` with a backoff-triggering status, or `Pool.RecordError` for a network error. Failure on any model counts; the account is demonstrating unreliability and should rotate regardless of which model the client is asking for next.
- **Not reset** on a time-window boundary. We rotate by success count, not elapsed time.

**Default effective sticky_limit:** `1` at the global level. Reproduces today's behavior (rotate every request). Users can raise it per-provider or globally via the resolution in §2.6.

**Stickiness during retry within one request:** Retries bypass sticky state. Concretely: when `SelectExcluding` is called with a non-nil `skipProviders` map (which is how the proxy handler signals "this is a retry"), the selection algorithm reads `stickyStates[providerType]` for ordering reference but does NOT treat the sticky account as preferred if it's in `skipProviders`, and does NOT mutate `stickyStates` as a result of the retry. Stickiness only gates the first selection of a fresh request.

**`Reload` behavior:** `Pool.Reload` clears `stickyStates` entirely and starts fresh. Sticky assignments form naturally on subsequent selections. Rationale: reliably tracking stickiness across an account-set change is complex (accounts may have been added, removed, or reordered) and the cost of resetting is zero — the next few requests establish new sticky entries. Note the UX implication: admins editing provider configs will see the sticky state reset on every save, which is acceptable since saves are infrequent and the reset is invisible to clients.

### 2.5 `fill-first` vs `round-robin` precise meaning (A4)

**Decision:** Two semantics, enumerated:

- **`round-robin`** — Current behavior, generalized. Rotate through accounts within a provider subset. `sticky_limit` controls how many consecutive times each account is used before rotating. With `sticky_limit = 1`, every request rotates; with `sticky_limit = 5`, each account gets five consecutive requests before the next one.
- **`fill-first`** — Always scan from account index 0 within the provider subset and use the first healthy account. Only move to subsequent accounts when earlier ones are in backoff, rate-limited, or failing. When the leader recovers, traffic flips back to it on the next request. `sticky_limit` is ignored under fill-first.

**Account order within a provider subset:** Defined by their order in `Pool.accounts`, which in turn follows the `store.Account` order returned by the DB. If the admin UI exposes per-account priority in a later phase, the order derives from that. For Phase 1, DB insertion order is the priority order.

**Rationale:** Two distinct, well-understood semantics. Fill-first is the "prefer primary with automatic failover" pattern common in HA load balancers. Round-robin with sticky is the "fair share with affinity" pattern. Users can express both.

### 2.6 Per-provider strategy override resolution (A5)

**Decision:** Strategy lives at two levels: global (in settings) and per-provider (in the provider row). Per-provider wins when set; otherwise the global default applies.

Schema:
- New settings key: `routing_strategy` with enum values `round-robin` or `fill-first`. Default `round-robin`.
- New settings key: `routing_sticky_limit` with integer value. Default `1`.
- New columns on the `providers` table: `strategy TEXT NOT NULL DEFAULT 'inherit'` (enum: `inherit`, `round-robin`, `fill-first`) and `sticky_limit_override INTEGER` (nullable; `NULL` means inherit from global).

**Resolution order at selection time:**
1. Given a provider type, look up its row.
2. If `strategy = 'inherit'`, use the global `routing_strategy`. Else use the provider's value.
3. If `sticky_limit_override IS NULL`, use the global `routing_sticky_limit`. Else use the override.

**Cross-provider failover order during retry:** Unchanged from today. The proxy handler's retry loop iterates across providers using `skipProviders`; each provider applies its own resolved strategy to its own accounts. No "global failover strategy" concept — that's a separate design question.

**Rationale:** Two-level resolution is the minimum that gives users global defaults plus per-provider escape hatches. Storing the override on the provider row (not a separate settings table) means it travels with the provider and is visible in the existing provider management UI.

### 2.7 Failover status code weights (A6)

**Decision:** Each HTTP status code maps to a fixed handler that determines the backoff behavior. Network-level errors (connection refused, TLS failure, client timeout before headers) are treated as synthetic status codes.

**Uniform `Retry-After` precedence rule:** For any status code that would otherwise trigger the exponential ladder (408, 429, 500, 502, 503, 504), if a `Retry-After` or `X-RateLimit-Reset` header is present AND the parsed duration is sane (> 0 seconds, ≤ 1 hour), that header value is used as the backoff duration instead of the ladder. If the header is absent or out of range, the exponential ladder is invoked. This applies uniformly — not just to 429 and 503 — so provider hints are always respected when sensible.

| Status | Classification | Backoff handler |
|---|---|---|
| 2xx | Success | Provider health signal (§1.1). Reset ladder. |
| 3xx | Redirect | Provider health signal. Reset ladder. (Proxy follows redirects if configured; otherwise returned to client.) |
| 400 | Client error | Provider health signal. Reset ladder. Return to client. |
| 401 | Auth broken | Account-level fixed 10-minute cooldown. Bypasses ladder. Does NOT increment or reset the ladder. Log warning. Needs admin intervention. |
| 402 | Billing issue | Account-level fixed 30-minute cooldown. Bypasses ladder. Log warning. |
| 403 | Forbidden | Account-level fixed 10-minute cooldown. Bypasses ladder. Same treatment as 401. |
| 404/422/Other non-auth 4xx | Client error | Provider health signal. Reset ladder. Return to client. |
| 408 | Request timeout | Ladder (with Retry-After precedence). Per-model cooldown. |
| 429 | Rate limited | Ladder (with Retry-After precedence). Per-model cooldown. |
| 500 | Server error | Ladder (with Retry-After precedence). Account-level cooldown. |
| 502 | Bad gateway | Ladder (with Retry-After precedence). Account-level cooldown. |
| 503 | Service unavailable | Ladder (with Retry-After precedence). Account-level cooldown. |
| 504 | Gateway timeout | Ladder (with Retry-After precedence). Account-level cooldown. |
| Network error | Connection refused, TLS handshake failure, client timeout before headers | Ladder. Account-level cooldown. |

**Per-model vs account-level cooldown scope:**

- **Per-model** (writes to `rl.states[accountName:model]`): 408 and 429. The rate limit or timeout is almost always model-specific in practice.
- **Account-level** (writes to `rl.states[accountName]`): 401, 402, 403, 500, 502, 503, 504, network errors. These are all conditions that affect the whole account or the whole provider endpoint, not a specific model.

**Ladder reset timing:** The ladder is reset to 0 when the account returns any **provider health signal** (§1.1). Reset happens via `Pool.RecordHealthy` (§2.3), which is called from the proxy handler on 2xx responses (via `RecordSuccessForModel`) and on non-retry 4xx responses directly. The 401/402/403 fixed cooldowns do NOT reset the ladder — they're a separate mechanism that bypasses it entirely.

**Rationale:** Different failure modes deserve different responses. Auth/billing failures are slow to resolve and don't benefit from retry; fixed long cooldowns are correct. Rate limits and server errors auto-resolve with time; the ladder lets us recover without thrashing, and respecting provider hints via `Retry-After` is polite. Non-auth 4xx errors prove the provider is responsive — resetting the ladder on them is correct because the provider is demonstrably healthy.

### 2.8 Admin UI surface (A3/A4/A5)

**Settings page — new `Routing` section:**
- **Strategy**: dropdown, options `Round-robin` and `Fill-first`. Binds to `routing_strategy`. Help text: "How to spread requests across accounts of the same provider."
- **Sticky limit**: number input, min 1, default 1. Binds to `routing_sticky_limit`. Help text: "Number of consecutive requests that use the same account before rotating. Set to 1 for pure round-robin."
- Placement: a new collapsible section after the existing "General" section, above "Proxy Auth". Uses the existing `FormSection` and form components from darkraise-ui.

**Provider sheet — new fields in the edit form:**
- **Strategy override**: dropdown, options `Inherit (global)`, `Round-robin`, `Fill-first`. Binds to provider's `strategy` column.
- **Sticky limit override**: number input, nullable, placeholder shows the global value. When empty, the override is removed.
- Placement: new fieldset at the end of the existing provider form, before the save button. Labeled "Routing".

**Accounts page — no new fields.** Per-model cooldowns and backoff levels surface via the existing per-account status drawer. The drawer needs two small additions:
- **Backoff level indicator**: if `backoffLevel > 0`, show as a badge (e.g., "Backoff L3 — resets in 8s").
- **Per-model cooldown list**: under the existing metrics table, show any `(model, backoffUntil)` entries that are in the future. This reuses the same visual treatment as the existing metric rows.

**Admin API surface:**
- `GET /api/settings` adds `routing_strategy` and `routing_sticky_limit` to the existing payload.
- `PATCH /api/settings` accepts them.
- `GET /api/providers/:name` adds `strategy` and `sticky_limit_override` to the response.
- `PATCH /api/providers/:name` accepts them.
- `GET /api/accounts/:name/status` extends the existing `AccountStatus` struct with `BackoffLevel int` and `ModelCooldowns []ModelCooldown` (where `ModelCooldown = { Model string, Until time.Time }`).

### 2.9 Test strategy

**Clock injection:** The ladder-based tests (cases 1, 2, 14) rely on time arithmetic that would otherwise require real `time.Sleep`. The plan should introduce a minimal `clock` abstraction in `internal/provider` — either a hand-rolled interface with a `fakeClock` implementation, or a dependency on `github.com/jonboulle/clockwork`. `RateLimiter` and `Pool` read the current time through this clock. Tests can advance the fake clock synthetically without wall-clock sleeps. Production code uses a real clock wrapper. This is a plan-level implementation detail but the spec calls it out so the plan writer does not ship flaky sleep-based tests.

**Unit tests in `internal/provider/ratelimit_test.go`:**
1. Ladder progression: repeat `recordLadderBackoff` calls return 1s, 2s, 4s, 8s, 15s, 30s, 60s, 120s, 120s (capped).
2. Ladder reset: `resetLadder` after three failures returns the level to 0; the next failure starts at 1s again.
3. Per-model backoff isolation: set `backoffUntil` on `(account, modelA)` via `RecordBackoff(name, modelA, dur)`; `AllowForModel(account, modelA)` returns false but `AllowForModel(account, modelB)` returns true.
4. Per-model backoff lazy clone: recording backoff on a previously-unseen model clones from the template correctly.
5. Account-level backoff still works: setting `backoffUntil` on the account-level entry blocks all model requests for that account.

**Unit tests in `internal/provider/pool_test.go`:**
6. Round-robin strategy with `sticky_limit = 1`: three consecutive `Select` calls return three different accounts (current behavior preserved).
7. Round-robin strategy with `sticky_limit = 3`: three consecutive `Select` calls return the same account, fourth rotates.
8. Fill-first strategy: `Select` always returns account index 0 when healthy.
9. Fill-first failover: when account 0 is in backoff, `Select` returns account 1; when 0 recovers, the next call flips back to 0.
10. Sticky rotation on failure: after `RecordStatusCode(name, model, 429, 0)` on the sticky account, the next `Select` rotates (the sticky counter was forced to 0 per §2.4).
11. Per-provider strategy override: provider A set to `fill-first`, provider B set to `round-robin`; a mix of selections follows each provider's rule.
12. Strategy inheritance: provider set to `inherit`, global set to `fill-first`; provider uses fill-first.
13. `sticky_limit` override resolution: provider override of 5 takes precedence over a global of 1.

**Integration tests in `test/integration_test.go`:**
14. 429 → ladder → recover flow. Mock upstream returns 429 with no `Retry-After` header on the first request, then 200 on a subsequent request after waiting past the ladder duration. Verify the pool waits (returns "exhausted" or selects a different account in the interim) and then succeeds.
15. Per-model 429 isolation: mock upstream returns 429 for model X and 200 for model Y on the same account. Make two requests, one for each model, at roughly the same time. Verify model X request goes through the ladder while model Y succeeds on the same account.
16. 401 fixed cooldown: mock upstream returns 401. Verify the account is cooled down for the full 10 minutes (by asserting the status API shows `backoffUntil` is ~10 minutes out) and no ladder progression happens.
17. Non-auth 4xx pass-through: mock upstream returns 400. Verify the client gets 400 back and the account is NOT put into backoff.

### 2.10 Migration story

**Settings migration:** No schema change. The `settings` table is a generic key-value store. On first read, `routing_strategy` defaults to `"round-robin"` and `routing_sticky_limit` defaults to `1`. Add these defaults to the settings-loader function that returns a `Settings` struct.

**Provider migration:** Schema change required. Add two columns to the `providers` table:
```sql
ALTER TABLE providers ADD COLUMN strategy TEXT NOT NULL DEFAULT 'inherit';
ALTER TABLE providers ADD COLUMN sticky_limit_override INTEGER;
```
Existing rows get `strategy = 'inherit'` and `sticky_limit_override = NULL` automatically. `store.Provider` struct grows two new fields.

**Runtime compatibility:** All defaults reproduce current behavior. Existing deployments see no change unless they opt in via settings or provider edits. No data loss or rollback hazard.

---

## 3. Data model summary

### Go types

**`internal/provider/ratelimit.go`**
- `providerState` grows `backoffLevel int` alongside existing `backoffUntil`. Only populated on the account-level entry; per-model entries use `backoffUntil` without the level.
- Existing `ipm` support (`providerState.inputMetrics`, `RateLimiter.RecordInputsForModel`, the `ipm` case in `newProviderState` and `cloneProviderState`) is preserved unchanged. Phase 1 must not touch `inputMetrics`, `RecordInputsForModel`, or the input-counter branch of `AllowForModel` — they stay functionally identical.
- `RateLimiter.RecordBackoff` signature changes to `RecordBackoff(accountName, model string, duration time.Duration)`. When `model == ""`, writes to `rl.states[accountName]` (account-level cooldown, today's behavior). When `model != ""`, writes to `rl.states[stateKey(accountName, model)]`, lazily cloning from the template via `getOrCloneState`.
- New package-private slice: `backoffLadder []time.Duration` (see §2.2 for values).
- New package-private helper: `ladderDuration(level int) time.Duration`.
- New package-private method: `recordLadderBackoff(accountName string) time.Duration`.
- New package-private method: `resetLadder(accountName string)`.
- New exported method: `ModelCooldowns(accountName string) []ModelCooldown` — iterates `rl.states` for entries keyed `accountName:*` with `backoffUntil.After(now)`, returns the list. O(states) per call; acceptable since the only caller is the admin status API.
- New exported type: `ModelCooldown struct { Model string; Until time.Time }`.
- `AccountStatus` grows `BackoffLevel int` and `ModelCooldowns []ModelCooldown`.
- `AllowForModel` extends the existing account-level `backoffUntil` check with a second check against the per-model entry's `backoffUntil` after the account-level check passes.

**`internal/provider/pool.go`**
- `Pool` grows `stickyStates map[string]*stickyState` (keyed by provider type), guarded by the existing `Pool.mu` write lock.
- New package-private type: `stickyState struct { accountName string; remaining int }`.
- `SelectExcluding` is refactored to group filtered candidates by provider type into provider subsets, then apply the resolved strategy per subset (§2.4 and §2.5). The cross-provider iteration order is preserved from today — Phase 1 does not introduce a global provider priority concept.
- `Reload` clears `stickyStates` entirely in addition to its existing `accounts`/`rateLimiter`/`index` rebuild.
- **`Pool.RecordStatusCode(accountName, model string, statusCode int, retryAfter time.Duration)` is the new canonical entry point** for the proxy handler's post-response bookkeeping. It dispatches to the right underlying action based on the failover matrix (§2.7): per-model ladder for 408/429, account-level ladder for 5xx, fixed cooldowns for 401/402/403, and `RecordHealthy` for non-retry status codes. Retry-After precedence is applied inside `RecordStatusCode`.
- **`Pool.RecordHealthy(accountName string)` is the new canonical health-signal method.** It calls `rl.resetLadder(accountName)` and also forces `stickyStates[providerType].remaining` decrement (no-op if no sticky entry). Used from the proxy handler on provider health signals (§2.3).
- **`Pool.RecordRateLimit` and `Pool.RecordError` are deleted.** The proxy handler migrates to `RecordStatusCode` exclusively. Any callers outside the proxy handler (if any) migrate in the same commit.
- `Pool.RecordSuccessForModel` is kept; internally it now also calls `RecordHealthy(accountName)` so the ladder reset is guaranteed on 2xx.
- New package-private helper: `resolveStrategy(providerType string) (strategy string, stickyLimit int)` — reads the provider row, applies the inherit/override rules, returns the effective values.
- New package-private helper: `candidatesByProviderType(filtered []*AccountInfo) map[string][]*AccountInfo` — groups the flat candidate list into provider subsets.

**`internal/proxy/handler.go`**
- The retry loop stops calling `Pool.RecordRateLimit` and `Pool.RecordError` directly. Instead, after every upstream response, it calls `Pool.RecordStatusCode(accountName, model, statusCode, retryAfter)` with the full response details. `retryAfter` is parsed from `Retry-After` / `X-RateLimit-Reset` headers in the handler before the call (or zero if absent).
- On non-retry status codes, the handler continues to propagate the response to the client. `RecordStatusCode` has already called `RecordHealthy` internally, so no separate call is needed from the handler.
- No changes to the external HTTP semantics — only internal bookkeeping.

**`internal/store/sqlite.go`**
- Migration to add `strategy` and `sticky_limit_override` columns to `providers`.
- `store.Provider` struct grows `Strategy string` and `StickyLimitOverride *int`.
- Settings loader adds defaults for `routing_strategy` and `routing_sticky_limit`.

**`internal/admin/` handlers**
- Settings and provider handlers expose/accept the new fields.
- Account status handler extends the response.

### SQL changes

```sql
-- Migration: add routing columns to providers
ALTER TABLE providers ADD COLUMN strategy TEXT NOT NULL DEFAULT 'inherit';
ALTER TABLE providers ADD COLUMN sticky_limit_override INTEGER;
```

No changes to `accounts`, `request_logs`, `rate_limits`, `settings` schema. The `settings` table gets two new row-level entries with default values, but no ALTER.

### Frontend changes

- `web/src/routes/_authenticated/settings.tsx` gains a new form section.
- `web/src/routes/_authenticated/providers.tsx` and the provider sheet component gain two new fields.
- `web/src/routes/_authenticated/accounts.tsx` account status drawer grows a backoff-level badge and per-model cooldown list.
- `web/src/lib/api.ts` typed client adds the new fields to the relevant response/request types.

---

## 4. Defaults table

| Setting | Default | Reproduces current behavior? |
|---|---|---|
| `routing_strategy` | `round-robin` | Yes |
| `routing_sticky_limit` | `1` | Yes |
| `strategy` (per provider) | `inherit` | Yes |
| `sticky_limit_override` (per provider) | `NULL` | Yes |
| Ladder max duration | `120s` | N/A (new) |
| Ladder progression | `[1, 2, 4, 8, 15, 30, 60, 120]` seconds | N/A (new) |
| 401 cooldown | `10min` fixed, account-level | Stricter than today (today it's retried) |
| 402 cooldown | `30min` fixed, account-level | Stricter than today |
| 403 cooldown | `10min` fixed, account-level | Stricter than today |
| 408 cooldown | Header if sane, else ladder; per-model | More nuanced than today |
| 429 cooldown | Header if sane, else ladder; per-model | More nuanced than today |
| 500/502/504 cooldown | Header if sane, else ladder; account-level | More nuanced than today |
| 503 cooldown | Header if sane, else ladder; account-level | More nuanced than today |
| Non-auth 4xx | No backoff; returned to client; resets ladder | Different: today some paths still retried |
| Network error | Ladder; account-level | Same or stricter |

Note the one behavioral difference for existing deployments: 401/402/403 responses will now block the account for the fixed cooldown window instead of being retried. **This is arguably a behavior change users should know about.** If that's a concern, we could make the fixed cooldowns opt-in or gate them behind a setting.

---

## 5. Open questions for the user to decide

1. **Are the 401/402/403 fixed cooldown durations (10min/30min/10min) the right values?** My recommendation: yes. 9router uses similar ranges. Billing problems resolve slower than auth mistakes, so 402 gets the longest window. If your experience suggests different numbers, name them and I'll adjust.

2. **Should the fixed cooldown durations be user-configurable in Phase 1, or hardcoded?** My recommendation: hardcoded for Phase 1, with a follow-up phase to expose them as settings if users ask. Keeps the scope tight and the UI simple.

3. **Is the 401/402/403 behavior change from "retry" to "long cooldown" OK, or does it need a migration escape hatch?** My recommendation: document the change in the Phase 1 release notes and proceed. Existing users who relied on the retry behavior were getting poor behavior anyway — auth failures don't get better by retrying.

4. **Does `sticky_limit` apply during `auto` model selection too, or only when the client specifies a model?** My recommendation: yes, applies to both — the sticky state is keyed by provider type (§2.4), so both selection paths share the same entry and benefit equally from session affinity.

5. **Should the backoff level reset be logged as an event?** My recommendation: yes, at debug level — useful for diagnosing why a provider recovered. Not worth info/warn since it's the happy path.

6. **Should the per-provider strategy override UI show the resolved effective value (e.g., "Inherit → round-robin (global)") so users don't have to look in two places?** My recommendation: yes, render the effective value next to the dropdown as muted text. Small usability win.

7. **`sticky_limit_override` validation:** sticky_limit values less than 1 make no sense (no account would ever be selected). My recommendation: the admin API rejects `sticky_limit` or `sticky_limit_override` values less than 1 at the validation layer, returning a 400 with a clear message. `NULL` for `sticky_limit_override` continues to mean "inherit global".

8. **When the user picks `fill-first` as the strategy, should the sticky_limit input be hidden or disabled in the UI?** `fill-first` ignores `sticky_limit` entirely (§2.5), so leaving the input active is confusing. My recommendation: disable (not hide) the input when fill-first is selected, with helper text explaining that sticky limit is only used by round-robin.

---

## 6. Out of scope for Phase 1

- Combos / model aliases (C1/C2). The current pool still selects by model name or `auto`; combos are a Phase 3 concept that sits on top of routing.
- OAuth provider support (B1). Doesn't affect routing semantics.
- Cost tracking (D1/D2). Independent of routing.
- Per-API-key rate limiting (H1). That's about client-facing limits, not provider-facing.
- A new "routing failover order" concept (which provider to try first globally). Provider iteration order remains today's.
- Observability / metrics for the routing decisions. We'll expose state via the existing status API but won't build dashboards or alerts in Phase 1. That's a Phase 5 concern.
- Persistence of backoff state across restarts. In-memory only.

---

## 7. What happens next

Once this spec is accepted (with any markup from the user), the implementation plan gets written against it. The plan will break the work into concrete TDD-style tasks following the same granularity as the Phase 0 plan, each task with exact file paths, code blocks, test cases, and verification steps. Expected plan size: 15–20 tasks grouped into four rough phases — rate-limiter extensions, pool refactor, proxy handler rewiring, admin UI + migration.

The plan will not be executed as part of this review — only written and presented for a second review. Execution happens after the plan itself is accepted.
