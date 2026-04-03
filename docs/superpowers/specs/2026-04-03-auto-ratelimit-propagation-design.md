# Auto Rate Limit Propagation from Provider Responses

**Date:** 2026-04-03
**Status:** Approved

## Problem

The proxy parses rate limit headers from provider API responses and stores them in the `rate_limit_definitions` table, but this data never reaches the in-memory rate limiter used for provider selection. The `rate_limit_definitions` table is disconnected from `account_limits`, which is what the pool's `RateLimiter` actually reads. Additionally, only Groq and Cerebras headers are parsed, despite 30+ supported providers.

## Decisions

- **Fill gaps only:** Discovered limits never overwrite manually configured `account_limits` entries. They only insert where no limit exists for a given account + model + metric combination.
- **Persist to `account_limits` + pool reload:** Discovered limits are written to the `account_limits` table and trigger a `pool.Reload()`, making them persistent across restarts and visible in the admin UI.
- **Generic fallback parser:** Providers without explicit header mappings get a generic OpenAI-compatible fallback that tries `x-ratelimit-limit-requests` (rpm) and `x-ratelimit-limit-tokens` (tpm) with 60s windows.
- **Dedup before reload:** Skip the write and pool reload if the discovered value matches what's already stored. Limits rarely change between requests, so this prevents nearly all redundant work.

## Section 1: Header Parsing Expansion

Expand `ProviderHeaderMappings` in `internal/ratelimit/headers.go`:

| Provider | Header | Metric | Window |
|---|---|---|---|
| openai | `x-ratelimit-limit-requests` | rpm | 60s |
| openai | `x-ratelimit-limit-tokens` | tpm | 60s |
| anthropic | `anthropic-ratelimit-requests-limit` | rpm | 60s |
| anthropic | `anthropic-ratelimit-tokens-limit` | tpm | 60s |
| groq | `x-ratelimit-limit-requests` | rpd | 86400s |
| groq | `x-ratelimit-limit-tokens` | tpm | 60s |
| cerebras | `x-ratelimit-limit-requests-day` | rpd | 86400s |
| cerebras | `x-ratelimit-limit-tokens-minute` | tpm | 60s |
| xai | `x-ratelimit-limit-requests` | rpd | 86400s |
| xai | `x-ratelimit-limit-tokens` | tpm | 60s |
| together | `x-ratelimit-limit` | rps | 1s |
| together | `x-tokenlimit-limit` | tps | 1s |
| fireworks | `x-ratelimit-limit-requests` | rpm | 60s |
| deepseek | `x-ratelimit-limit-requests` | rpm | 60s |
| openrouter | `x-ratelimit-limit-requests` | rpm | 60s |

For providers not in the explicit map, a generic fallback tries `x-ratelimit-limit-requests` (rpm, 60s) and `x-ratelimit-limit-tokens` (tpm, 60s). Explicit mappings always take priority.

## Section 2: Propagation Pipeline

Updated flow:

```
Response headers
  -> ParseRateLimitHeaders() (expanded + fallback)
  -> non-blocking send to rateLimitChan
  -> rateLimitWriter goroutine:
      -> db.SetRateLimitDef()  (unchanged)
      -> db.FillAccountLimitsFromDiscovered(providerType, defs)
          - queries enabled accounts with type = providerType
          - for each account, checks which models it supports
          - inserts account_limits rows only where none exist (fill gaps)
          - returns modified = true if any rows inserted
      -> if modified: pool.Reload(accounts, providers)
```

## Section 3: Database Changes

No schema changes. Both tables already exist:

- `rate_limit_definitions` — stores raw discovered limits (unchanged)
- `account_limits` — gains new rows when gaps are filled

New store method:

```go
func (d *DB) FillAccountLimitsFromDiscovered(providerType string, defs []RateLimitDef) (modified bool, err error)
```

Logic:
1. Query all enabled accounts with `type = providerType`
2. For each account, parse its `models` field to get model list
3. For each def, check if a matching `account_limits` row exists (account_id + model + metric)
4. Insert only where missing
5. Return `modified = true` if any rows were inserted

## Section 4: Integration Points

**`internal/ratelimit/headers.go`** — Expand `ProviderHeaderMappings` with 7 new providers. Modify `ParseRateLimitHeaders` to fall back to generic OpenAI-compatible headers for unknown providers.

**`internal/server/server.go`** — Modify `rateLimitWriter` goroutine. After `db.SetRateLimitDef()`, call `db.FillAccountLimitsFromDiscovered()`. If `modified`, call `pool.Reload()` (same pattern as admin handler's `reloadPool`).

**No changes to:** proxy handler, streaming handler, admin handler, rate limiter, or pool selection logic. The channel mechanism and non-blocking send are unchanged.

## Testing

- Create an account with no limits
- Simulate a rate limit header discovery via channel
- Verify the account gains the discovered limit in `account_limits`
- Verify a second identical discovery doesn't trigger a reload
- Test that manually configured limits are not overwritten
- Test the generic fallback for unmapped providers
