# Notification System Design Spec

**Date:** 2026-03-29
**Status:** Approved

## Overview

Add a notification system to the LLM Proxy that alerts administrators via email, Telegram, or Discord when operational issues occur. Runs as a background goroutine inside the Go proxy server.

## Alert Cases

| # | Alert | Trigger | Default Cooldown |
|---|---|---|---|
| 1 | Provider unstable | `MarkProviderUnstable` called (3+ failures or timeout) | 30 min |
| 2 | Error rate exceeded | Error % in sliding window exceeds threshold | 15 min |
| 3 | All providers exhausted | Request returns "all providers exhausted" | 5 min |
| 4 | Account auth failure | Persistent 401/403 from an account | 60 min |
| 5 | Daily usage summary | Scheduled digest at configurable time (default 08:00) | 24 hours |
| 6 | Provider recovered | Previously unstable provider starts working | 30 min |

### Alert Configuration
Each alert has:
- `enabled: bool` — on/off toggle
- `cooldown_min: int` — minimum minutes between repeat notifications for the same alert key
- Alert-specific thresholds (e.g., error_rate_threshold: 10, error_rate_window_min: 5)

## Notification Channels

### Email (SMTP)
```json
{
  "enabled": true,
  "smtp_host": "smtp.gmail.com",
  "smtp_port": 587,
  "smtp_user": "user@gmail.com",
  "smtp_password": "app-password",
  "from": "llm-proxy@example.com",
  "to": ["admin@example.com"]
}
```

### Telegram
```json
{
  "enabled": true,
  "bot_token": "123456:ABC-DEF...",
  "chat_id": "-1001234567890"
}
```
Sends via `https://api.telegram.org/bot{token}/sendMessage`.

### Discord
```json
{
  "enabled": true,
  "webhook_url": "https://discord.com/api/webhooks/..."
}
```
Sends via POST to webhook URL with `{"content": "..."}`.

## Storage

All notification config stored in the `settings` table:
- `notification_channels` → JSON object with email/telegram/discord configs
- `notification_alerts` → JSON object with per-alert enable/cooldown/threshold settings

No new tables needed.

## Backend Architecture

### Package: `internal/notify/`

**Files:**
- `notify.go` — `Notifier` struct, alert evaluation loop, cooldown tracking
- `channels.go` — `SendEmail`, `SendTelegram`, `SendDiscord` functions
- `alerts.go` — alert condition checkers, message formatters

### Notifier struct
```go
type Notifier struct {
    db        *store.DB
    pool      *provider.Pool
    interval  time.Duration          // check interval (30s)
    cooldowns map[string]time.Time   // alert_key → last sent
    channels  ChannelConfig
    alerts    AlertConfig
}
```

### Alert Evaluation Loop
- Runs every 30 seconds in a background goroutine
- Each tick: reload config from settings, evaluate each enabled alert
- Cooldown tracked in memory: `map[alertKey]lastSentTime`
- Alert key format: `{alert_type}:{context}` (e.g., `provider_unstable:groq`, `auth_failure:account-123`)

### Alert Triggers

**Reactive alerts** (triggered inline, not by the background loop):
- Provider unstable — called from `markProviderUnstable()` in handler.go
- All providers exhausted — called from `forwardNonStreaming()` when all retries fail
- Account auth failure — called when status 401/403 detected

**Periodic alerts** (checked by background loop):
- Error rate exceeded — query recent logs, calculate error %
- Provider recovered — check provider_stability table for previously unstable → now stable
- Daily summary — check if scheduled time has passed since last send

### Message Format
Each alert produces a structured message:
```
🔴 Provider Unstable: groq
Reason: 3 consecutive failures
Time: 2026-03-29 14:30:05 UTC
Accounts affected: groq-free, groq-paid
```

For daily summary:
```
📊 Daily Usage Summary (2026-03-28)
Requests: 1,247 | Tokens: 2.4M | Errors: 4 (0.3%)
By Provider:
  openai: 500 req, 1.2M tok
  cohere: 400 req, 800K tok
  ...
```

## Frontend: Settings Page

### New "Notifications" section

**Channel Cards:**
Three collapsible cards (Email, Telegram, Discord), each with:
- Enable/disable toggle
- Channel-specific config fields
- "Test" button to send a test notification
- Save button

**Alert Configuration:**
Table or list of alert cases, each row has:
- Alert name and description
- Enable/disable toggle
- Cooldown (minutes) input
- Threshold input (where applicable)
- Save button

### API Endpoints

Existing `GET/PUT /admin/api/settings` handles the notification config since it's stored as settings keys. No new endpoints needed except:
- `POST /admin/api/notifications/test` — send a test notification to verify channel config

## Integration Points

### handler.go changes
In `forwardNonStreaming` and `forwardEmbedding`:
- After `markProviderUnstable()`: call `notifier.Alert("provider_unstable", providerType, reason)`
- After "all providers exhausted": call `notifier.Alert("providers_exhausted", model, "")`
- After 401/403 detection: call `notifier.Alert("auth_failure", accountName, statusCode)`

### server.go changes
- Create `Notifier` during server startup
- Start background goroutine: `go notifier.Run(ctx)`
- Pass `notifier` to proxy handler

### Provider recovery detection
In the background loop:
- Query `provider_stability WHERE unstable = 1`
- For each unstable provider, attempt a lightweight check (e.g., test one account)
- If successful, mark stable and send recovery notification

## Files to Create/Modify

**New:**
- `internal/notify/notify.go` — Notifier, Run loop, Alert method
- `internal/notify/channels.go` — email/telegram/discord senders
- `internal/notify/alerts.go` — alert checkers and formatters

**Modify:**
- `internal/server/server.go` — create and start Notifier
- `internal/proxy/handler.go` — call notifier on alert conditions
- `web/src/pages/Settings.tsx` — add Notifications section
- `web/src/lib/api.ts` — add test notification endpoint

## Verification
1. `go build ./...` and `cd web && npm run build` pass
2. Configure Telegram channel in Settings → Test → receive message
3. Trigger provider unstable → notification sent (with cooldown respected)
4. Daily summary sent at scheduled time
5. Cooldown prevents duplicate notifications
