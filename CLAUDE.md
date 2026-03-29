# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

LLM Proxy is a multi-provider LLM gateway written in Go with a React admin dashboard. It presents a unified OpenAI-compatible API that routes requests across configured providers (OpenAI, Anthropic, Google, Groq, Cohere, etc.) with rate limiting, automatic retries, and Ollama fallback.

## Commands

```bash
# Development — backend only (frontend runs separately)
./start-dev-backend.sh              # Go on :4000 (proxy) + :4001 (admin)
cd web && npm run dev               # Vite on :5173, proxies /api → :4001

# Development — backend + frontend together
./start-dev-server.sh

# Build
go build ./cmd/llm-proxy
cd web && npm run build             # output: web/dist/ (embedded via go:embed)

# Test
go test ./...                       # all tests
go test ./internal/config -run TestExportYAML -v   # single test
go test ./test -v                   # integration tests

# Docker
./build.sh v1.0.0                   # build + push
./build.sh --no-push               # build only

# Utilities
go run ./cmd/llm-proxy -hash-password "mypassword"  # generate bcrypt hash
```

Required env: `ADMIN_PASSWORD_HASH` (bcrypt hash).

## Architecture

### Two Servers, One Binary

The binary runs two independent HTTP servers:

- **Proxy server** (`:4000`) — OpenAI-compatible API endpoints (`/v1/chat/completions`, `/v1/messages`, `/v1/embeddings`, `/v1/models`). Optional bearer token auth.
- **Admin server** (`:4001`) — REST API (`/api/*`) + embedded React SPA. Session cookie auth (bcrypt-verified password).

In production, the frontend is embedded via `go:embed all:web/dist` (see `embed.go`). In dev mode (`-dev -ui-proxy`), the admin server reverse-proxies to Vite.

### Request Flow (Proxy)

```
Client → ProxyAuthMiddleware → Handler → Pool.SelectExcluding()
  → RateLimiter check → Adapter (format conversion) → upstream HTTP call
  → on failure: retry with next provider (skip failed ones)
  → on all exhausted: Ollama fallback (if enabled)
  → async log via channel → background batch writer → SQLite
```

Key concurrency detail: `proxy.Handler` config fields (timeout, retries, fallback) are guarded by `sync.RWMutex`. The `config()` method returns a snapshot for each request. Settings changes from admin UI take effect immediately without restart via `onSettingsChange` callback in `server.go`.

### Package Responsibilities

| Package | Role |
|---------|------|
| `server` | Wires everything: creates DB, pool, handlers, background workers, shutdown |
| `proxy` | Request handling for chat/embeddings/streaming, fallback logic, proxy auth middleware |
| `provider` | Pool with round-robin selection + rate limit checks, `AccountInfo` with decrypted keys |
| `adapter` | Format translation between OpenAI/Anthropic/Google/Cohere request/response shapes |
| `store` | SQLite via modernc.org/sqlite (pure Go). Accounts, limits, logs, settings. AES-GCM encrypted API keys |
| `admin` | Session auth, account CRUD, stats queries, settings management, model discovery, config import/export |
| `ratelimit` | Parses `X-RateLimit-*` headers from provider responses into sliding window counters |
| `crypto` | bcrypt password hashing, PBKDF2 key derivation, AES-GCM encrypt/decrypt |
| `config` | YAML parsing/export for config import/export feature |
| `notify` | Email/Telegram/Discord alerting with cooldown |

### Encryption Chain

`ADMIN_PASSWORD_HASH` (env) → PBKDF2 with per-DB salt → AES-GCM key → encrypts all stored API keys. The salt is generated once and stored in the `settings` table. Changing the password hash re-encrypts all keys.

### Frontend

React 19 + TypeScript, Vite, TailwindCSS 4, Radix UI primitives, Recharts. The typed API client (`web/src/lib/api.ts`) wraps fetch with auto-redirect on 401. Vite dev server proxies `/api` to `localhost:4001`.

### Async Pipelines

Three background goroutines started by `StartBackgroundWorkers()`:
- **logWriter**: batches `RequestLog` entries from a channel into SQLite
- **rateLimitWriter**: batches rate limit counter updates
- **logPruner**: periodically deletes old logs based on `log_retention_days` setting

Non-blocking sends (`select { case ch <- entry: default: }`) ensure proxy requests never block on logging.

## Testing Patterns

Integration tests (`test/integration_test.go`) spin up a mock upstream provider via `httptest.NewServer`, create a full `server.Server` with `t.TempDir()` for the DB, then make real HTTP requests with a `cookiejar` for session persistence. Proxy and admin get separate test servers via `ProxyHandler()` and `AdminHandler()`.
