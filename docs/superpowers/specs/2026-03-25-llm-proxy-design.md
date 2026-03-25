# LLM Proxy — Design Specification

**Date:** 2026-03-25
**Status:** Approved

## Overview

A self-hosted, multi-provider LLM proxy that round-robins requests across free-tier cloud LLM providers (Google AI Studio, OpenRouter, Groq, Cerebras, Mistral, GitHub Models) with automatic failover, rate limit tracking, and an admin web UI. Exposes both OpenAI-compatible and Anthropic-compatible APIs.

Replaces the existing single-file Python/FastAPI proxy with a Go binary that embeds a React admin dashboard.

## Goals

- Provide a unified LLM gateway for homelab services (mem0, memora) and development tools (Claude Code, Cursor, Continue.dev)
- Support streaming and tool call passthrough (no complex tool/function call rewriting)
- Offer a modern admin UI to manage providers, monitor usage, and configure the proxy
- Ship as a single Docker image under `darkraise/llm-proxy`
- Keep operational simplicity: single binary, single container, SQLite storage

## Non-Goals

- Multi-user / multi-tenant support (admin-only, self-hosted)
- Request/response body logging (use Loki/Grafana for deep observability)
- Complex tool/function call processing (passthrough only)
- Cost tracking beyond token counts (no pricing database)

## Architecture

### System Diagram

```
┌──────────────────────────────────────────────────────────┐
│                   llm-proxy (Go binary)                   │
│                                                            │
│  ┌──────────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │ Proxy Router  │  │  Admin API    │  │  Embedded UI  │  │
│  │  /v1/*        │  │ /admin/api/*  │  │  /admin/*     │  │
│  └──────┬───────┘  └──────┬────────┘  └───────────────┘  │
│         │                 │                                │
│  ┌──────▼─────────────────▼──────────┐                    │
│  │          Core Engine               │                    │
│  │  ┌────────────┐  ┌─────────────┐  │                    │
│  │  │ Normalizer  │  │  Provider   │  │                    │
│  │  │ (OpenAI ↔   │  │    Pool     │  │                    │
│  │  │  Anthropic   │  │ (routing,   │  │                    │
│  │  │  ↔ Google)   │  │ round-robin │  │                    │
│  │  └────────────┘  │  failover)   │  │                    │
│  │                   └─────────────┘  │                    │
│  │  ┌────────────┐  ┌─────────────┐  │                    │
│  │  │Rate Limiter │  │  Request    │  │                    │
│  │  │(flexible    │  │   Logger    │  │                    │
│  │  │ metrics)    │  │             │  │                    │
│  │  └────────────┘  └─────────────┘  │                    │
│  └───────────────────────────────────┘                    │
│         │                                                  │
│  ┌──────▼──────┐                                          │
│  │   SQLite     │                                          │
│  │ (config,     │                                          │
│  │  usage logs, │                                          │
│  │  sessions)   │                                          │
│  └─────────────┘                                          │
└──────────────────────────────────────────────────────────┘
         │
         ▼ outbound to providers
   ┌─────┴──────┬───────────┬───────────┬───────────┬───────────┐
   Groq    Google AI   OpenRouter  Cerebras   Mistral   GitHub
```

### Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language | Go | Low memory, fast startup, excellent concurrency for I/O-bound proxy work, single binary |
| Storage | SQLite | No external dependencies, single file, sufficient for single-node admin proxy |
| Config management | SQLite + YAML import/export | Dynamic management via UI, YAML for backup/migration/seed |
| Internal format | OpenAI | All current providers are OpenAI-compatible or get translated. Anthropic is an adapter layer on top |
| Deployment | Single binary with embedded SPA | One container, one image, operational simplicity |
| UI framework | React + Tailwind CSS | Modern, fast, large ecosystem. Embedded in Go binary for production |

## Provider System

### Supported Providers

| Provider | Type | Outbound Adapter | Notes |
|---|---|---|---|
| Groq | `openai` | None (native) | |
| OpenRouter | `openai` | None (native) | |
| Cerebras | `openai` | None (native) | |
| GitHub Models | `openai` | None (native) | Azure-hosted inference |
| Mistral | `openai` | None (native) | Mistral API is OpenAI-compatible |
| Google AI Studio | `google` | OpenAI ↔ `generateContent` | Requires format translation |

Multiple accounts per provider are supported (e.g., `google-1`, `google-2`).

### Provider Configuration

Stored in SQLite `providers` table:

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT UNIQUE | Display name: "groq", "google-1" |
| `type` | TEXT | "openai" or "google" |
| `base_url` | TEXT | Provider API base URL |
| `api_key_enc` | BLOB | AES-256-GCM encrypted API key |
| `models` | TEXT | JSON array of model IDs this account exposes |
| `priority` | INTEGER | Ordering for round-robin (lower = higher priority) |
| `enabled` | BOOLEAN | Toggle without deleting |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

### Flexible Rate Limits

Rate limits stored in a separate table to support varying limit types per provider:

| Column | Type | Description |
|---|---|---|
| `provider_id` | INTEGER FK | References `providers.id` |
| `metric` | TEXT | "rpm", "rpd", "tpm", "tpd", "rps" |
| `max_value` | INTEGER | Limit threshold |
| `window_secs` | INTEGER | 60 for per-minute, 86400 for per-day, 1 for per-second |

Provider rate limit landscape:

| Provider | RPM | RPD | TPM | TPD | RPS |
|---|---|---|---|---|---|
| Google AI Studio | ✅ | ✅ | ✅ | — | — |
| Groq | ✅ | ✅ | ✅ | — | — |
| Cerebras | ✅ | — | ✅ | — | — |
| OpenRouter | ✅ | ✅ | — | — | — |
| Mistral | — | — | ✅ | — | ✅ |
| GitHub Models | ✅ | ✅ | ✅ | — | — |

A provider is available only if ALL configured limits have headroom. Adding new limit types requires zero code changes.

### Model Routing

- `model="auto"` → round-robin across all available providers by priority order. Each provider's first configured model is used. The caller gets whichever model the selected provider serves — the intent is "give me any LLM response" without model preference.
- `model="gemini-2.5-flash"` → route to provider(s) offering that model
- `model="llama-3.3-70b"` → may match multiple providers (groq, cerebras), round-robin among them
- `/v1/models` returns the union of all models from enabled providers

### Google Provider Base URL

`google`-type providers use a hardcoded base URL (`https://generativelanguage.googleapis.com/v1beta`). The `base_url` field in the `providers` table is optional for `google` type — if empty, the default is used. This avoids requiring users to know the internal Google API URL.

## Request Flow

```
1. Request arrives at /v1/chat/completions or /v1/messages

2. Optional API key check (if proxy auth enabled in settings)

3. Inbound adapter normalizes to OpenAI internal format:
   - OpenAI endpoint: pass through
   - Anthropic endpoint: translate messages, system prompt, tool calls

4. Resolve target provider:
   - model="auto" → pick next available provider (round-robin)
   - model="<specific>" → find provider(s) offering that model

5. Rate limit check:
   - Check all configured metrics for the provider
   - For token metrics (TPM/TPD): estimate request size (len(json)/4 heuristic)
   - Skip provider if any limit exceeded, try next

6. Outbound adapter translates to provider's native format:
   - openai type: pass through (set model field)
   - google type: translate to generateContent format

7. Forward request (streaming or non-streaming)

8. On success:
   - Outbound adapter translates response back to OpenAI internal format
   - Inbound adapter translates back to caller's format (OpenAI or Anthropic)
   - Record actual token usage from response
   - Log request metadata to SQLite (async, non-blocking)

9. On failure (429/5xx/timeout):
   - Record rate limit or error backoff for the provider
   - Retry with next available provider (transparent to caller)
   - For streaming: failover only before first chunk sent

10. If all providers exhausted:
    - Try Ollama fallback (if enabled)
    - Return 503 with provider status details
```

## Streaming

- **OpenAI SSE:** Passthrough for `openai`-type providers. Translate on-the-fly for `google`-type (using `streamGenerateContent` endpoint, converting each chunk to OpenAI SSE `data:` lines).
- **Anthropic SSE:** Translate OpenAI SSE chunks to Anthropic event types (`message_start`, `content_block_start`, `content_block_delta`, `message_delta`, `message_stop`).
- Go uses `http.Flusher` to push chunks immediately — no buffering.
- Tool call payloads are passed through without modification in both streaming and non-streaming modes.
- Failover only before first chunk is sent; after streaming begins, errors propagate to the caller.

## Admin API

All admin endpoints require authentication via session cookie (from login).

### Authentication

| Method | Path | Description |
|---|---|---|
| `POST` | `/admin/api/auth/login` | Login with admin password, returns session cookie |
| `POST` | `/admin/api/auth/logout` | Invalidate session |

### Provider Management

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/api/providers` | List all providers with current rate limit status |
| `POST` | `/admin/api/providers` | Create provider |
| `PUT` | `/admin/api/providers/:id` | Update provider |
| `DELETE` | `/admin/api/providers/:id` | Delete provider |
| `POST` | `/admin/api/providers/:id/test` | Test provider connectivity (sends a small request) |

### Usage & Stats

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/api/stats/overview` | Dashboard summary: today's requests, error rate, active providers, avg latency |
| `GET` | `/admin/api/stats/requests` | Request log with filters: date range, provider, status, model. Paginated. |
| `GET` | `/admin/api/stats/providers` | Per-provider aggregates: request count, token count, error rate, avg latency |

### Settings & Config

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/api/settings` | Get proxy settings |
| `PUT` | `/admin/api/settings` | Update settings (fallback config, timeouts, API key gate, retention) |
| `POST` | `/admin/api/config/import` | Import YAML config (creates/updates providers) |
| `GET` | `/admin/api/config/export` | Export current config as YAML |

## Data Model

### SQLite Schema

```sql
-- Provider accounts
CREATE TABLE providers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('openai', 'google')),
    base_url    TEXT NOT NULL,
    api_key_enc BLOB NOT NULL,
    models      TEXT NOT NULL DEFAULT '[]',  -- JSON array
    priority    INTEGER NOT NULL DEFAULT 0,
    enabled     BOOLEAN NOT NULL DEFAULT 1,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Flexible rate limits per provider
CREATE TABLE provider_limits (
    provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    metric      TEXT NOT NULL,       -- "rpm", "rpd", "tpm", "tpd", "rps"
    max_value   INTEGER NOT NULL,
    window_secs INTEGER NOT NULL,    -- 60, 86400, 1
    PRIMARY KEY (provider_id, metric)
);

-- Per-request log
CREATE TABLE request_logs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    provider_id       INTEGER REFERENCES providers(id) ON DELETE SET NULL,
    provider_name     TEXT NOT NULL,
    model             TEXT NOT NULL,
    endpoint          TEXT NOT NULL,  -- "openai" or "anthropic"
    status            TEXT NOT NULL,  -- "success", "rate_limited", "error", "timeout"
    latency_ms        INTEGER,
    prompt_tokens     INTEGER,
    completion_tokens INTEGER,
    status_code       INTEGER,
    error_message     TEXT
);

CREATE INDEX idx_request_logs_timestamp ON request_logs(timestamp);
CREATE INDEX idx_request_logs_provider ON request_logs(provider_id, timestamp);

-- Daily aggregation (rolled up from request_logs, kept indefinitely)
CREATE TABLE daily_stats (
    date          TEXT NOT NULL,      -- "2026-03-25"
    provider_id   INTEGER REFERENCES providers(id) ON DELETE SET NULL,
    provider_name TEXT NOT NULL,
    total_requests  INTEGER NOT NULL DEFAULT 0,
    success_count   INTEGER NOT NULL DEFAULT 0,
    error_count     INTEGER NOT NULL DEFAULT 0,
    total_prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    total_completion_tokens INTEGER NOT NULL DEFAULT 0,
    avg_latency_ms  INTEGER,
    PRIMARY KEY (date, provider_id)
);

-- Key-value settings
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL  -- JSON-encoded
);
-- Keys: admin_password_hash, encryption_key_salt, fallback_config,
--        request_timeout, max_retries, log_retention_days,
--        proxy_api_key_hash, proxy_auth_enabled
```

### Request Log Retention

- Raw `request_logs` auto-pruned after configurable retention period (default: 30 days)
- Daily goroutine rolls up expiring logs into `daily_stats` before deletion
- `daily_stats` kept indefinitely for trend charts

## Authentication & Security

### Admin Authentication

- Single admin password set via `ADMIN_PASSWORD` env var on first run (or through initial setup page)
- Password hashed with Argon2id and stored in `settings`
- Login returns an HTTP-only session cookie (stored server-side in memory, expires after 24h)
- All `/admin/api/*` routes require valid session

### Proxy API Key (Optional)

- Toggle via settings: "Require API Key for Proxy Endpoints"
- When enabled, `/v1/chat/completions` and `/v1/messages` require `Authorization: Bearer <key>`
- API key generated via admin UI, hash stored in `settings`
- Useful when exposing proxy beyond LAN (e.g., via reverse proxy)

### API Key Encryption at Rest

- Provider API keys encrypted with AES-256-GCM before writing to SQLite
- Encryption key derived from admin password + salt via Argon2id
- Salt generated randomly on first run and stored in `settings` table under `encryption_key_salt`
- Keys decrypted in memory on startup (admin password required — either from env var or cached from last login session)
- On admin password change: derive new encryption key from new password + same salt, re-encrypt all provider API keys in a single transaction
- YAML export includes plaintext keys (admin-only action, logged)

## Admin UI

### Technology

- React 18+ with TypeScript
- Tailwind CSS for styling
- Vite for build tooling
- React Router for client-side routing
- Recharts (or similar lightweight library) for dashboard charts
- Dark theme throughout, consistent with homelab aesthetic

### Layout

Fixed sidebar navigation with content area:

- **Sidebar:** Logo/title, navigation links (Dashboard, Providers, Usage Logs, Settings), version info
- **Content area:** Page-specific content

### Pages

**1. Dashboard**
- Stat cards: Requests Today (with trend), Active Providers, Avg Latency (with P95), Error Rate
- Request volume chart (24h bar chart)
- Per-provider distribution (horizontal bars)
- Live provider status strip (name, status dot, current RPM/TPM usage)

**2. Providers**
- List of provider cards: status dot, name, type, model(s), rate limit usage bars, Test/Edit/Delete actions
- "Add Provider" button → modal/form with: name, type, base URL, API key, models, limits (dynamic "Add Limit" for each metric)
- "Import YAML" button → file upload
- "Test" button → sends a small completion request, shows success/error result

**3. Usage Logs**
- Filterable table: provider, status, time range, model
- Columns: timestamp, provider, model, endpoint, status, latency, tokens
- Pagination with configurable page size
- Color-coded status badges (green=success, red=error, yellow=timeout, orange=rate_limited)

**4. Settings**
- Grouped sections with card layout:
  - **General:** request timeout, max retries, log retention
  - **Security:** proxy API key toggle + key display, change admin password
  - **Ollama Fallback:** enable toggle, URL, model, timeout
  - **Configuration:** export YAML, import YAML buttons

### Production Embedding

React SPA built to `web/dist/`, embedded in Go binary via `//go:embed`. Served at `/admin/*` with SPA fallback (all unmatched routes → `index.html`).

### Development Mode

`--dev` flag + `--ui-proxy=http://localhost:5173` proxies UI requests to Vite dev server for hot module replacement.

## Project Structure

```
llm-proxy/
├── cmd/
│   └── llm-proxy/
│       └── main.go              # entrypoint, CLI flags, startup
├── internal/
│   ├── server/
│   │   └── server.go            # HTTP server setup, route registration
│   ├── proxy/
│   │   ├── handler.go           # /v1/chat/completions, /v1/messages handlers
│   │   ├── stream.go            # SSE streaming logic
│   │   └── models.go            # /v1/models handler
│   ├── adapter/
│   │   ├── openai.go            # OpenAI format (canonical internal format)
│   │   ├── anthropic.go         # Anthropic ↔ OpenAI translation
│   │   └── google.go            # Google generateContent ↔ OpenAI translation
│   ├── provider/
│   │   ├── pool.go              # round-robin, model routing, failover
│   │   ├── client.go            # HTTP client for outbound requests
│   │   └── ratelimit.go         # flexible sliding window rate limiter
│   ├── admin/
│   │   ├── handler.go           # /admin/api/* REST handlers
│   │   ├── auth.go              # session auth, password hashing
│   │   └── middleware.go        # admin auth middleware
│   ├── store/
│   │   ├── sqlite.go            # DB init, migrations
│   │   ├── provider.go          # provider CRUD
│   │   ├── settings.go          # settings key-value store
│   │   └── log.go               # request log insert, query, aggregation
│   └── config/
│       └── yaml.go              # YAML import/export
├── web/                          # React SPA
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Providers.tsx
│   │   │   ├── UsageLogs.tsx
│   │   │   └── Settings.tsx
│   │   ├── components/
│   │   │   ├── Layout.tsx        # sidebar + content shell
│   │   │   ├── StatCard.tsx
│   │   │   ├── ProviderRow.tsx
│   │   │   └── Chart.tsx
│   │   ├── lib/
│   │   │   └── api.ts            # admin API client
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── tailwind.config.js
│   ├── vite.config.ts
│   └── package.json
├── embed.go                      # //go:embed web/dist
├── Dockerfile                    # multi-stage: node → go → distroless
├── compose.yml                   # production
├── compose.dev.yml               # development (Go + Vite)
├── build.sh                      # build + push to darkraise/llm-proxy
├── config.example.yml            # seed YAML config example
└── go.mod
```

## Build & Deployment

### Build Pipeline (`build.sh`)

```
1. cd web && npm ci && npm run build       → web/dist/
2. go build -o llm-proxy ./cmd/llm-proxy   → embeds web/dist via embed.go
3. docker build -t darkraise/llm-proxy:$TAG .
4. docker push darkraise/llm-proxy:$TAG    (unless --no-push)
```

### Multi-Stage Dockerfile

```
Stage 1 (node:22-alpine): Install deps, build React SPA → /dist
Stage 2 (golang:1.23-alpine): Copy /dist, go build with CGO_ENABLED=0 → single static binary
Stage 3 (gcr.io/distroless/static): Copy binary, expose 4000, create /data volume
```

Final image size: ~20-30MB.

### Production compose.yml

```yaml
services:
  llm-proxy:
    image: darkraise/llm-proxy:latest
    container_name: llm-proxy
    ports:
      - "4000:4000"
    volumes:
      - ./data:/data                        # SQLite database
      - ./config.yml:/app/seed.yml:ro       # optional seed config
    environment:
      - ADMIN_PASSWORD=changeme             # initial admin password
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "/llm-proxy", "healthcheck"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 10s
```

### Development compose.dev.yml

```yaml
services:
  llm-proxy:
    build: .
    command: ["./llm-proxy", "--dev", "--ui-proxy=http://web:5173"]
    ports:
      - "4000:4000"
    volumes:
      - ./data:/data
  web:
    image: node:22-alpine
    working_dir: /app
    command: npm run dev -- --host 0.0.0.0
    volumes:
      - ./web:/app
    ports:
      - "5173:5173"
```

### Seed Config Format

```yaml
proxy:
  request_timeout: 15
  max_retries: 3

fallback:
  enabled: true
  base_url: http://192.168.0.196:11434/v1
  model: llama3.1:8b
  timeout: 30

providers:
  - name: groq
    type: openai
    base_url: https://api.groq.com/openai/v1
    api_key: gsk_...
    models: ["llama-3.3-70b-versatile"]
    limits:
      - metric: rpm
        max_value: 30
      - metric: rpd
        max_value: 1000
      - metric: tpm
        max_value: 12000
    enabled: true

  - name: google-1
    type: google
    api_key: AIza...
    models: ["gemini-2.5-flash"]
    limits:
      - metric: rpm
        max_value: 10
      - metric: rpd
        max_value: 250
      - metric: tpm
        max_value: 1000000
    enabled: true
```
