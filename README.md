# LLM Proxy

A multi-provider LLM gateway that presents a unified OpenAI-compatible API. Route requests across multiple providers with automatic rate limiting, retries, and fallback — managed through a built-in admin dashboard.

## Features

- **Unified API** — OpenAI-compatible endpoints for chat completions, Anthropic messages, embeddings, and model listing
- **Multi-provider routing** — OpenAI, Anthropic, Google, Groq, Cohere, OpenRouter, Cerebras, Mistral, GitHub Models, NVIDIA NIM, Ollama
- **Automatic retries** — Round-robin provider selection with rate-limit-aware failover
- **Ollama fallback** — Configurable local fallback for chat, streaming, and embeddings when all cloud providers are exhausted
- **Rate limit tracking** — Parses provider `X-RateLimit-*` headers into sliding window counters (RPM, RPD, TPM, TPD, etc.)
- **Admin dashboard** — React SPA for managing accounts, viewing usage logs, configuring settings, and monitoring stats
- **API key encryption** — AES-GCM encryption at rest, derived from admin password via PBKDF2
- **Notifications** — Email, Telegram, and Discord alerts when providers are exhausted
- **Config import/export** — YAML-based configuration for backup and migration
- **Single binary** — Frontend embedded via `go:embed`, runs as one binary with two ports

## Quick Start

### 1. Generate a password hash

```bash
go run ./cmd/llm-proxy -hash-password "your-admin-password"
```

### 2. Run with Docker Compose

```bash
echo "ADMIN_PASSWORD_HASH=\$2a\$12\$..." > .env
mkdir -p data
docker compose up -d
```

### 3. Access

| Service | URL | Purpose |
|---------|-----|---------|
| Proxy API | `http://localhost:4000` | OpenAI-compatible LLM endpoint |
| Admin UI | `http://localhost:4001` | Dashboard and configuration |

### 4. Configure providers

Log in to the admin dashboard at `:4001`, add provider accounts with API keys, and start routing requests through `:4000`.

## API Endpoints

### Proxy (`:4000`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat completions |
| `POST` | `/v1/messages` | Anthropic-compatible messages |
| `POST` | `/v1/embeddings` | Embedding generation |
| `GET` | `/v1/models` | List available models |
| `GET` | `/health` | Health check |

All proxy endpoints support optional bearer token authentication (configured in admin settings).

### Admin (`:4001`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Authenticate |
| `GET/POST/PUT/DELETE` | `/api/accounts/*` | Provider account management |
| `GET` | `/api/stats/*` | Usage statistics |
| `GET/PUT` | `/api/settings` | Configuration |
| `GET/POST` | `/api/config/export`, `/api/config/import` | YAML config |

## Usage

Point any OpenAI-compatible client at the proxy:

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-proxy-key" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

Or use the Anthropic messages format:

```bash
curl http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-proxy-key" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Configuration

All configuration is managed through the admin dashboard. The only required environment variable is:

| Variable | Description |
|----------|-------------|
| `ADMIN_PASSWORD_HASH` | bcrypt hash of the admin password |

CLI flags:

| Flag | Default | Description |
|------|---------|-------------|
| `-port` | `4000` | Proxy API port |
| `-admin-port` | `4001` | Admin UI/API port |
| `-data` | `/data` | Data directory for SQLite database |
| `-dev` | `false` | Development mode |
| `-ui-proxy` | | Reverse proxy admin UI to this URL (dev mode) |
| `-hash-password` | | Hash a password and exit |
| `-healthcheck` | | Run health check and exit |

## Development

### Prerequisites

- Go 1.26+
- Node.js 22+

### Backend + Frontend together

```bash
./start-dev-server.sh
```

### Backend and frontend separately

```bash
# Terminal 1: Go backend
./start-dev-backend.sh

# Terminal 2: Vite dev server (HMR)
cd web && npm run dev
```

The Vite dev server on `:5173` proxies `/api` requests to the admin server on `:4001`.

### Build

```bash
go build ./cmd/llm-proxy
cd web && npm run build
```

### Test

```bash
go test ./...                                       # all tests
go test ./internal/config -run TestExportYAML -v    # single test
go test ./test -v                                   # integration tests
```

### Docker

```bash
./build.sh v1.0.0        # build + push
./build.sh --no-push     # build only
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    One Binary                        │
│                                                      │
│  :4000 Proxy Server          :4001 Admin Server      │
│  ┌─────────────────┐        ┌──────────────────┐    │
│  │ /v1/chat/...    │        │ /api/*           │    │
│  │ /v1/messages    │        │ React SPA (embed)│    │
│  │ /v1/embeddings  │        │ Session auth     │    │
│  │ /v1/models      │        └────────┬─────────┘    │
│  │ Bearer auth     │                 │               │
│  └────────┬────────┘                 │               │
│           │                          │               │
│  ┌────────▼──────────────────────────▼─────────┐    │
│  │              SQLite (encrypted keys)         │    │
│  │   accounts │ settings │ logs │ rate_limits   │    │
│  └──────────────────────────────────────────────┘    │
│           │                                          │
│  ┌────────▼────────┐   ┌────────────────────┐       │
│  │  Provider Pool   │   │ Background Workers │       │
│  │  Round-robin     │   │ Log batcher        │       │
│  │  Rate-limit gate │   │ Rate limit writer  │       │
│  │  Retry + skip    │   │ Log pruner         │       │
│  └────────┬─────────┘  └────────────────────┘       │
│           │                                          │
└───────────┼──────────────────────────────────────────┘
            │
   ┌────────▼────────┐
   │   LLM Providers  │
   │ OpenAI, Google,  │
   │ Anthropic, Groq, │
   │ Cohere, Ollama...│
   └──────────────────┘
```

## License

MIT
