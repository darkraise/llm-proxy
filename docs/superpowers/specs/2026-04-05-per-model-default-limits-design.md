# Per-Model Default Limits

**Date:** 2026-04-05
**Status:** Approved

## Problem

The default limit row (`model=""`) in the account rate limit table currently creates a **shared account-wide counter**. If the default row says RPM=30, the account gets 30 requests per minute total across all models combined. This is counterintuitive — the UI suggests each model inherits the default independently, but enforcement pools them together.

Additionally, when creating an account, `GetDefaultLimits` fans out the provider's default row into per-model `account_limits` entries for every selected model. This creates unnecessary duplication and loses the template/override structure that the provider rate limit definitions use.

## Design

### Approach: Lazy Per-Model Counter Creation

Store `model=""` limits as a **template** in the RateLimiter rather than a shared counter. When a model is first encountered (via `AllowForModel`, `RecordRequestForModel`, etc.), lazily clone the template to create an independent counter for that model. Models with explicit overrides bypass the template entirely (all-or-nothing — no partial merging).

### 1. RateLimiter (`internal/provider/ratelimit.go`)

#### Template storage

Add a `template` field to the per-account state. During `Configure(accountName, limits)`:

- Limits with `Model=""` are stored as a template (not as a live counter under the `accountName` key).
- Limits with a specific model create live counters at `accountName:model`. If a model has any explicit limits, only those limits are used — the template is **not** merged in (all-or-nothing override).
- The account-level key stores only backoff state (backoff applies to the whole account).

#### Lazy cloning

When `AllowForModel(accountName, model)` is called:

1. Check account-level backoff — if in backoff, deny.
2. Look up `accountName:model` state. If it exists, check its counters.
3. If no state exists, clone the template to create a new `providerState` for that model. If no template exists either, allow (unconfigured = no limits).

`RecordRequestForModel`, `RecordTokensForModel` follow the same lazy-clone pattern: if no per-model state exists, clone from template before recording.

#### All-or-nothing override

No partial merging between template and model-specific limits. If the template has RPM=30 and TPM=6000, and a model has an explicit RPM=50 only, that model gets RPM=50 with no TPM limit. The presence of any explicit limit for a model means the template is ignored entirely for that model.

#### Status reporting

Add `StatusForModel(accountName, model)` that returns the status for a specific model (with lazy clone from template). The existing `Status(accountName)` returns template info (max values, zero usage) as a summary.

### 2. GetDefaultLimits (`internal/store/ratelimit_def.go`)

Simplify to a direct pass-through:

- Query `rate_limit_definitions` for the provider.
- Fall back to `providers.default_limits` JSON if no definitions exist.
- Return results as-is: `model=""` stays `model=""`, model-specific stays model-specific.
- Remove the fan-out loop and the `models []string` parameter.

Callers write these directly into `account_limits`. The account ends up with the same structure as the provider's rate limit definitions.

### 3. Pool (`internal/provider/pool.go`)

- Remove `RecordSuccess(name, tokens)` — replace all call sites with `RecordSuccessForModel(name, model, tokens)`.
- `RecordSuccessForModel` no longer increments account-level counters (only per-model).
- Add `AllowTokensForModel(name, model, estimated)` with the same lazy-clone logic. Remove or deprecate `AllowTokens(name, estimated)`.

### 4. Proxy Handlers (`internal/proxy/handler.go`, `internal/proxy/stream.go`)

Three call sites currently call `pool.RecordSuccess(prov.Name, tokens)`:

- `handler.go` chat non-streaming (line ~318)
- `handler.go` embeddings (line ~555)
- `stream.go` streaming (line ~104)

All have the model available in the request context. Change to `RecordSuccessForModel(prov.Name, model, tokens)`.

If `AllowTokens` is used anywhere, change to `AllowTokensForModel` with the model parameter.

### 5. Frontend

#### `AddModelsDialog` (`web/src/components/AddModelsDialog.tsx`)

Currently at line 152, `handleFinish` filters out `model=""` limits before saving: `limits.filter((l) => l.model !== '')`. Remove this filter — send both default and model-specific limits so the backend preserves the default row.

#### No other frontend changes

`RateLimitTable` already displays the correct visual behavior (gray placeholder inheritance, amber overrides). `AccountDrawer` already sends the full limits array including `model=""` entries.

### 6. FillAccountLimitsFromDiscovered

No changes. Continues writing per-model overrides into `account_limits`. Only inserts for model+metric combinations that don't already exist.

## Files Changed

| File | Change |
|------|--------|
| `internal/provider/ratelimit.go` | Template storage, lazy clone, all-or-nothing override, `StatusForModel` |
| `internal/provider/ratelimit_test.go` | Update tests for new semantics |
| `internal/provider/pool.go` | Remove `RecordSuccess`, add `AllowTokensForModel`, update `RecordSuccessForModel` |
| `internal/provider/pool_test.go` | Update tests |
| `internal/store/ratelimit_def.go` | Simplify `GetDefaultLimits` to pass-through |
| `internal/proxy/handler.go` | `RecordSuccess` -> `RecordSuccessForModel` |
| `internal/proxy/stream.go` | `RecordSuccess` -> `RecordSuccessForModel` |
| `web/src/components/AddModelsDialog.tsx` | Stop filtering out `model=""` limits |

## Not Changed

- `internal/store/sqlite.go` — schema unchanged, `model=""` rows already supported
- `internal/ratelimit/headers.go` — header parsing unchanged
- `internal/store/ratelimit_def.go` `FillAccountLimitsFromDiscovered` — unchanged
- `web/src/components/RateLimitTable.tsx` — UI component unchanged
- `web/src/components/AccountDrawer.tsx` — already sends full limits array
