# Notification System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a notification system that alerts admins via email, Telegram, or Discord when operational issues occur (unstable providers, error spikes, auth failures, outages) and sends daily usage summaries.

**Architecture:** Background goroutine inside the Go server evaluates alert conditions every 30 seconds. Reactive alerts (provider unstable, providers exhausted, auth failure) fire inline from the proxy handler via a non-blocking channel. Periodic alerts (error rate, daily summary, provider recovery) are checked by the background loop. Per-alert cooldowns prevent spam. Config stored in settings table as JSON.

**Tech Stack:** Go (net/smtp, net/http for Telegram/Discord webhooks), React + Tailwind (Settings UI), SQLite (settings storage).

**Spec:** `docs/superpowers/specs/2026-03-29-notifications-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `internal/notify/channels.go` | Channel senders: SendEmail, SendTelegram, SendDiscord |
| `internal/notify/config.go` | Config types: ChannelConfig, AlertConfig, parsing from settings |
| `internal/notify/notifier.go` | Notifier struct, Run loop, Alert method, cooldown tracking |
| `internal/notify/alerts.go` | Alert condition checkers, message formatters |
| `internal/notify/notifier_test.go` | Tests for cooldown, config parsing, alert evaluation |

### Modified Files

| File | Changes |
|---|---|
| `internal/server/server.go` | Create Notifier, start background goroutine, pass to proxy handler |
| `internal/proxy/handler.go` | Add notifier field, call Alert() on failure conditions |
| `internal/admin/handler.go` | Add test notification endpoint |
| `internal/store/log.go` | Add GetErrorRate() query method |
| `web/src/lib/api.ts` | Add notifications.test() endpoint |
| `web/src/pages/Settings.tsx` | Add NotificationSettings section |

---

## Task 1: Channel Senders

**Files:**
- Create: `internal/notify/channels.go`

- [ ] **Step 1: Create the channels file with all three senders**

```go
// internal/notify/channels.go
package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/smtp"
	"strings"
	"time"
)

func SendEmail(cfg EmailConfig, subject, body string) error {
	addr := fmt.Sprintf("%s:%d", cfg.SMTPHost, cfg.SMTPPort)
	auth := smtp.PlainAuth("", cfg.SMTPUser, cfg.SMTPPassword, cfg.SMTPHost)

	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s",
		cfg.From, strings.Join(cfg.To, ","), subject, body)

	return smtp.SendMail(addr, auth, cfg.From, cfg.To, []byte(msg))
}

func SendTelegram(cfg TelegramConfig, message string) error {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", cfg.BotToken)
	payload, _ := json.Marshal(map[string]any{
		"chat_id":    cfg.ChatID,
		"text":       message,
		"parse_mode": "HTML",
	})

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("telegram API returned %d", resp.StatusCode)
	}
	return nil
}

func SendDiscord(cfg DiscordConfig, message string) error {
	payload, _ := json.Marshal(map[string]string{"content": message})

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(cfg.WebhookURL, "application/json", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("discord webhook returned %d", resp.StatusCode)
	}
	return nil
}
```

- [ ] **Step 2: Verify build**

```bash
go build ./internal/notify/...
```

- [ ] **Step 3: Commit**

```bash
git add internal/notify/channels.go
git commit -m "feat(notify): add email, telegram, discord channel senders"
```

---

## Task 2: Config Types

**Files:**
- Create: `internal/notify/config.go`

- [ ] **Step 1: Create config types and JSON parsing**

```go
// internal/notify/config.go
package notify

import "encoding/json"

type EmailConfig struct {
	Enabled      bool     `json:"enabled"`
	SMTPHost     string   `json:"smtp_host"`
	SMTPPort     int      `json:"smtp_port"`
	SMTPUser     string   `json:"smtp_user"`
	SMTPPassword string   `json:"smtp_password"`
	From         string   `json:"from"`
	To           []string `json:"to"`
}

type TelegramConfig struct {
	Enabled  bool   `json:"enabled"`
	BotToken string `json:"bot_token"`
	ChatID   string `json:"chat_id"`
}

type DiscordConfig struct {
	Enabled    bool   `json:"enabled"`
	WebhookURL string `json:"webhook_url"`
}

type ChannelConfig struct {
	Email    EmailConfig    `json:"email"`
	Telegram TelegramConfig `json:"telegram"`
	Discord  DiscordConfig  `json:"discord"`
}

type AlertRule struct {
	Enabled     bool `json:"enabled"`
	CooldownMin int  `json:"cooldown_min"`
}

type ErrorRateAlertRule struct {
	AlertRule
	ThresholdPct  float64 `json:"threshold_pct"`
	WindowMinutes int     `json:"window_minutes"`
}

type DailySummaryRule struct {
	AlertRule
	Hour int `json:"hour"` // 0-23, hour of day to send
}

type AlertConfig struct {
	ProviderUnstable    AlertRule          `json:"provider_unstable"`
	ErrorRateExceeded   ErrorRateAlertRule `json:"error_rate_exceeded"`
	ProvidersExhausted  AlertRule          `json:"providers_exhausted"`
	AccountAuthFailure  AlertRule          `json:"account_auth_failure"`
	DailySummary        DailySummaryRule   `json:"daily_summary"`
	ProviderRecovered   AlertRule          `json:"provider_recovered"`
}

func DefaultAlertConfig() AlertConfig {
	return AlertConfig{
		ProviderUnstable:   AlertRule{Enabled: true, CooldownMin: 30},
		ErrorRateExceeded:  ErrorRateAlertRule{AlertRule: AlertRule{Enabled: true, CooldownMin: 15}, ThresholdPct: 10, WindowMinutes: 5},
		ProvidersExhausted: AlertRule{Enabled: true, CooldownMin: 5},
		AccountAuthFailure: AlertRule{Enabled: true, CooldownMin: 60},
		DailySummary:       DailySummaryRule{AlertRule: AlertRule{Enabled: false, CooldownMin: 1440}, Hour: 8},
		ProviderRecovered:  AlertRule{Enabled: true, CooldownMin: 30},
	}
}

func ParseChannelConfig(raw string) ChannelConfig {
	var cfg ChannelConfig
	if raw != "" {
		json.Unmarshal([]byte(raw), &cfg)
	}
	return cfg
}

func ParseAlertConfig(raw string) AlertConfig {
	cfg := DefaultAlertConfig()
	if raw != "" {
		json.Unmarshal([]byte(raw), &cfg)
	}
	return cfg
}

func FormatChannelConfig(cfg ChannelConfig) string {
	data, _ := json.Marshal(cfg)
	return string(data)
}

func FormatAlertConfig(cfg AlertConfig) string {
	data, _ := json.Marshal(cfg)
	return string(data)
}
```

- [ ] **Step 2: Verify build**

```bash
go build ./internal/notify/...
```

- [ ] **Step 3: Commit**

```bash
git add internal/notify/config.go
git commit -m "feat(notify): add config types for channels and alerts"
```

---

## Task 3: Alert Formatters

**Files:**
- Create: `internal/notify/alerts.go`

- [ ] **Step 1: Create alert message formatters**

```go
// internal/notify/alerts.go
package notify

import (
	"fmt"
	"strings"
	"time"
)

type AlertType string

const (
	AlertProviderUnstable   AlertType = "provider_unstable"
	AlertErrorRateExceeded  AlertType = "error_rate_exceeded"
	AlertProvidersExhausted AlertType = "providers_exhausted"
	AlertAccountAuthFailure AlertType = "account_auth_failure"
	AlertDailySummary       AlertType = "daily_summary"
	AlertProviderRecovered  AlertType = "provider_recovered"
)

type Alert struct {
	Type    AlertType
	Key     string // unique key for cooldown: e.g. "provider_unstable:groq"
	Subject string
	Message string
}

func NewProviderUnstableAlert(provider, reason string) Alert {
	return Alert{
		Type:    AlertProviderUnstable,
		Key:     fmt.Sprintf("provider_unstable:%s", provider),
		Subject: fmt.Sprintf("[LLM Proxy] Provider Unstable: %s", provider),
		Message: fmt.Sprintf("Provider '%s' marked unstable.\nReason: %s\nTime: %s",
			provider, reason, time.Now().UTC().Format(time.RFC3339)),
	}
}

func NewProvidersExhaustedAlert(model string) Alert {
	return Alert{
		Type:    AlertProvidersExhausted,
		Key:     "providers_exhausted",
		Subject: "[LLM Proxy] All Providers Exhausted",
		Message: fmt.Sprintf("Request failed: all providers exhausted.\nModel: %s\nTime: %s",
			model, time.Now().UTC().Format(time.RFC3339)),
	}
}

func NewAccountAuthFailureAlert(account string, statusCode int) Alert {
	return Alert{
		Type:    AlertAccountAuthFailure,
		Key:     fmt.Sprintf("auth_failure:%s", account),
		Subject: fmt.Sprintf("[LLM Proxy] Auth Failure: %s", account),
		Message: fmt.Sprintf("Account '%s' returned auth error (HTTP %d).\nThe API key may be expired or revoked.\nTime: %s",
			account, statusCode, time.Now().UTC().Format(time.RFC3339)),
	}
}

func NewErrorRateAlert(rate float64, threshold float64, window int, totalRequests, errorCount int) Alert {
	return Alert{
		Type:    AlertErrorRateExceeded,
		Key:     "error_rate_exceeded",
		Subject: "[LLM Proxy] Error Rate Exceeded",
		Message: fmt.Sprintf("Error rate %.1f%% exceeds threshold %.1f%% (last %d min).\nTotal requests: %d, Errors: %d\nTime: %s",
			rate, threshold, window, totalRequests, errorCount, time.Now().UTC().Format(time.RFC3339)),
	}
}

func NewProviderRecoveredAlert(provider string) Alert {
	return Alert{
		Type:    AlertProviderRecovered,
		Key:     fmt.Sprintf("provider_recovered:%s", provider),
		Subject: fmt.Sprintf("[LLM Proxy] Provider Recovered: %s", provider),
		Message: fmt.Sprintf("Provider '%s' is healthy again.\nTime: %s",
			provider, time.Now().UTC().Format(time.RFC3339)),
	}
}

type ProviderSummary struct {
	Provider string
	Requests int64
	Tokens   int64
	Errors   int64
}

func NewDailySummaryAlert(date string, providers []ProviderSummary) Alert {
	var totalReq, totalTok, totalErr int64
	var lines []string
	for _, p := range providers {
		totalReq += p.Requests
		totalTok += p.Tokens
		totalErr += p.Errors
		lines = append(lines, fmt.Sprintf("  %s: %d req, %d tok, %d err", p.Provider, p.Requests, p.Tokens, p.Errors))
	}

	msg := fmt.Sprintf("Daily Usage Summary (%s)\nRequests: %d | Tokens: %d | Errors: %d\n\nBy Provider:\n%s",
		date, totalReq, totalTok, totalErr, strings.Join(lines, "\n"))

	return Alert{
		Type:    AlertDailySummary,
		Key:     "daily_summary",
		Subject: fmt.Sprintf("[LLM Proxy] Daily Summary — %s", date),
		Message: msg,
	}
}
```

- [ ] **Step 2: Verify build and commit**

```bash
go build ./internal/notify/...
git add internal/notify/alerts.go
git commit -m "feat(notify): add alert types and message formatters"
```

---

## Task 4: Notifier Core

**Files:**
- Create: `internal/notify/notifier.go`
- Modify: `internal/store/log.go` — add `GetErrorRate` method

- [ ] **Step 1: Add `GetErrorRate` to store**

In `internal/store/log.go`, add after the existing query methods:

```go
type ErrorRateResult struct {
	TotalRequests int
	ErrorCount    int
	ErrorRate     float64 // 0.0 to 100.0
}

func (d *DB) GetErrorRate(from, to time.Time) (ErrorRateResult, error) {
	var r ErrorRateResult
	err := d.QueryRow(`
		SELECT
			COUNT(*) AS total,
			SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
		FROM request_logs
		WHERE datetime(timestamp) BETWEEN datetime(?) AND datetime(?)`,
		sqliteTime(from), sqliteTime(to),
	).Scan(&r.TotalRequests, &r.ErrorCount)
	if err != nil {
		return r, err
	}
	if r.TotalRequests > 0 {
		r.ErrorRate = float64(r.ErrorCount) / float64(r.TotalRequests) * 100
	}
	return r, nil
}
```

- [ ] **Step 2: Create the Notifier**

```go
// internal/notify/notifier.go
package notify

import (
	"log/slog"
	"sync"
	"time"

	"github.com/darkraise/llm-proxy/internal/store"
)

type Notifier struct {
	db        *store.DB
	mu        sync.Mutex
	cooldowns map[string]time.Time // alertKey → last sent time
}

func NewNotifier(db *store.DB) *Notifier {
	return &Notifier{
		db:        db,
		cooldowns: make(map[string]time.Time),
	}
}

// Alert sends a notification if the alert is enabled and not in cooldown.
// Safe to call from any goroutine.
func (n *Notifier) Alert(alert Alert) {
	n.mu.Lock()
	defer n.mu.Unlock()

	channels := n.loadChannels()
	alerts := n.loadAlerts()

	rule := n.getRuleForType(alerts, alert.Type)
	if rule == nil || !rule.Enabled {
		return
	}

	// Check cooldown
	if last, ok := n.cooldowns[alert.Key]; ok {
		if time.Since(last) < time.Duration(rule.CooldownMin)*time.Minute {
			return
		}
	}

	// Send via all enabled channels
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
		n.cooldowns[alert.Key] = time.Now()
		slog.Info("notification sent", "type", alert.Type, "key", alert.Key)
	}
}

// Run starts the background alert evaluation loop.
func (n *Notifier) Run(stop <-chan struct{}) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			n.evaluate()
		}
	}
}

func (n *Notifier) evaluate() {
	alerts := n.loadAlerts()

	// Error rate check
	if alerts.ErrorRateExceeded.Enabled {
		window := alerts.ErrorRateExceeded.WindowMinutes
		if window <= 0 {
			window = 5
		}
		from := time.Now().Add(-time.Duration(window) * time.Minute)
		result, err := n.db.GetErrorRate(from, time.Now())
		if err == nil && result.TotalRequests > 0 && result.ErrorRate > alerts.ErrorRateExceeded.ThresholdPct {
			n.Alert(NewErrorRateAlert(result.ErrorRate, alerts.ErrorRateExceeded.ThresholdPct, window, result.TotalRequests, result.ErrorCount))
		}
	}

	// Provider recovery check
	if alerts.ProviderRecovered.Enabled {
		unstable, err := n.db.ListUnstableProviders()
		if err == nil {
			for _, ps := range unstable {
				// If marked unstable more than 5 minutes ago, check if it recovered
				if time.Since(ps.MarkedAt) > 5*time.Minute {
					// Mark as stable (the next request will re-mark if still broken)
					n.db.MarkProviderStable(ps.Provider)
					n.Alert(NewProviderRecoveredAlert(ps.Provider))
				}
			}
		}
	}

	// Daily summary check
	if alerts.DailySummary.Enabled {
		hour := alerts.DailySummary.Hour
		now := time.Now()
		if now.Hour() == hour {
			// Check cooldown manually (24h)
			key := "daily_summary"
			n.mu.Lock()
			last, ok := n.cooldowns[key]
			n.mu.Unlock()
			if !ok || time.Since(last) > 23*time.Hour {
				yesterday := now.AddDate(0, 0, -1)
				startOfDay := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 0, 0, 0, 0, now.Location())
				endOfDay := startOfDay.Add(24 * time.Hour)
				stats, err := n.db.GetProviderStats(startOfDay, endOfDay)
				if err == nil {
					var summaries []ProviderSummary
					for _, s := range stats {
						summaries = append(summaries, ProviderSummary{
							Provider: s.Provider, Requests: s.TotalRequests,
							Tokens: s.TotalTokens, Errors: s.ErrorCount,
						})
					}
					n.Alert(NewDailySummaryAlert(yesterday.Format("2006-01-02"), summaries))
				}
			}
		}
	}
}

func (n *Notifier) loadChannels() ChannelConfig {
	raw, _ := n.db.GetSetting("notification_channels")
	return ParseChannelConfig(raw)
}

func (n *Notifier) loadAlerts() AlertConfig {
	raw, _ := n.db.GetSetting("notification_alerts")
	return ParseAlertConfig(raw)
}

func (n *Notifier) getRuleForType(cfg AlertConfig, t AlertType) *AlertRule {
	switch t {
	case AlertProviderUnstable:
		return &cfg.ProviderUnstable
	case AlertErrorRateExceeded:
		return &cfg.ErrorRateExceeded.AlertRule
	case AlertProvidersExhausted:
		return &cfg.ProvidersExhausted
	case AlertAccountAuthFailure:
		return &cfg.AccountAuthFailure
	case AlertDailySummary:
		return &cfg.DailySummary.AlertRule
	case AlertProviderRecovered:
		return &cfg.ProviderRecovered
	default:
		return nil
	}
}

// SendTest sends a test notification to all enabled channels.
func (n *Notifier) SendTest() error {
	channels := n.loadChannels()
	msg := "[LLM Proxy] Test notification — your notification channels are working."
	subject := "[LLM Proxy] Test Notification"
	var lastErr error

	if channels.Email.Enabled {
		if err := SendEmail(channels.Email, subject, msg); err != nil {
			lastErr = err
		}
	}
	if channels.Telegram.Enabled {
		if err := SendTelegram(channels.Telegram, msg); err != nil {
			lastErr = err
		}
	}
	if channels.Discord.Enabled {
		if err := SendDiscord(channels.Discord, msg); err != nil {
			lastErr = err
		}
	}
	return lastErr
}
```

- [ ] **Step 3: Verify build**

```bash
go build ./internal/notify/...
```

- [ ] **Step 4: Commit**

```bash
git add internal/notify/notifier.go internal/store/log.go
git commit -m "feat(notify): add Notifier core with background loop and cooldowns"
```

---

## Task 5: Integrate Notifier into Server and Proxy Handler

**Files:**
- Modify: `internal/server/server.go`
- Modify: `internal/proxy/handler.go`

- [ ] **Step 1: Add Notifier to Server and start background goroutine**

In `internal/server/server.go`:

Add `notifier *notify.Notifier` field to the Server struct.

After `proxyHandler := proxy.NewHandler(pool, db, logFunc)`, add:
```go
notifier := notify.NewNotifier(db)
proxyHandler.SetNotifier(notifier)
```

In the `Start()` method, before `http.ListenAndServe`, add:
```go
notifyStop := make(chan struct{})
go s.notifier.Run(notifyStop)
defer close(notifyStop)
```

Save `notifier` to the Server struct.

- [ ] **Step 2: Add notifier to proxy Handler**

In `internal/proxy/handler.go`:

Add `notifier *notify.Notifier` field to Handler struct.

Add method:
```go
func (h *Handler) SetNotifier(n *notify.Notifier) {
	h.notifier = n
}
```

- [ ] **Step 3: Add Alert calls to forwardNonStreaming**

After each `markProviderUnstable` call, add:
```go
if h.notifier != nil {
    h.notifier.Alert(notify.NewProviderUnstableAlert(prov.Type, reason))
}
```

After the "all providers exhausted" logEntry (before return), add:
```go
if h.notifier != nil {
    h.notifier.Alert(notify.NewProvidersExhaustedAlert(req.Model))
}
```

For 401/403 detection (in the statusCode >= 400 block), add auth failure alert:
```go
if (statusCode == 401 || statusCode == 403) && h.notifier != nil {
    h.notifier.Alert(notify.NewAccountAuthFailureAlert(prov.Name, statusCode))
}
```

Apply the same patterns to `forwardEmbedding` and `handleStreaming`.

- [ ] **Step 4: Verify build and tests**

```bash
go build ./...
go test ./...
```

- [ ] **Step 5: Commit**

```bash
git add internal/server/server.go internal/proxy/handler.go
git commit -m "feat(notify): integrate notifier into server and proxy handler"
```

---

## Task 6: Test Notification Endpoint

**Files:**
- Modify: `internal/admin/handler.go`
- Modify: `internal/server/server.go`

- [ ] **Step 1: Add HandleTestNotification to admin handler**

The admin handler needs a reference to the Notifier. Add a `SetNotifier` method:
```go
func (h *AdminHandler) SetNotifier(n *notify.Notifier) {
	h.notifier = n
}

func (h *AdminHandler) HandleTestNotification(w http.ResponseWriter, r *http.Request) {
	if h.notifier == nil {
		writeJSON(w, 500, map[string]string{"error": "notifier not configured"})
		return
	}
	if err := h.notifier.SendTest(); err != nil {
		writeJSON(w, 200, map[string]any{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true})
}
```

Add `notifier *notify.Notifier` field to `AdminHandler`.

- [ ] **Step 2: Register route and wire up**

In `server.go`, after `notifier` creation:
```go
adminHandler.SetNotifier(notifier)
```

Register route:
```go
s.mux.Handle("POST /admin/api/notifications/test", protected(s.admin.HandleTestNotification))
```

- [ ] **Step 3: Verify build and commit**

```bash
go build ./...
git add internal/admin/handler.go internal/server/server.go
git commit -m "feat(notify): add test notification endpoint"
```

---

## Task 7: Frontend API and Settings UI

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/pages/Settings.tsx`

- [ ] **Step 1: Add notification API to frontend**

In `web/src/lib/api.ts`, add to the `api` object:
```typescript
notifications: {
    test: () => request<{ success: boolean; error?: string }>('POST', '/notifications/test'),
},
```

- [ ] **Step 2: Create NotificationSettings component in Settings.tsx**

Add a new section component `NotificationSettings` that:
- Reads `notification_channels` and `notification_alerts` from settings
- Shows 3 channel cards (Email, Telegram, Discord) each with enable toggle + config fields + test button
- Shows alert configuration table with enable toggle, cooldown input, and threshold inputs
- Save button saves both `notification_channels` and `notification_alerts` as JSON to settings

Use the existing `Section`, `Field`, `SaveButton`, `ToggleSwitch`, and input patterns from the existing settings sections. Use `Select` for the daily summary hour picker.

Channel cards:
- **Email**: SMTP Host, Port, User, Password (type=password), From, To (comma-separated)
- **Telegram**: Bot Token (type=password), Chat ID
- **Discord**: Webhook URL (type=password)

Alert table columns: Alert Name | Enabled (toggle) | Cooldown (min) | Threshold (where applicable)

Test button: calls `api.notifications.test()` and shows success/error toast.

- [ ] **Step 3: Add to Settings page render**

In the main `Settings` component, add `<NotificationSettings settings={settings} />` after `<OllamaSettings>` and before `<ConfigSettings>`.

- [ ] **Step 4: Verify build**

```bash
cd web && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/api.ts web/src/pages/Settings.tsx
git commit -m "feat(web): add notification settings UI with channel config and alert toggles"
```

---

## Task 8: Final Integration and Build Verification

- [ ] **Step 1: Verify full build**

```bash
go build ./...
go test ./...
cd web && npm run build
```

- [ ] **Step 2: Integration test**

1. Start the server
2. Go to Settings → Notifications
3. Configure Telegram (or Discord) channel with test credentials
4. Click "Test" → verify notification received
5. Enable "Provider Unstable" alert
6. Trigger a failure (disable all accounts of one provider, send a request)
7. Check notification is sent
8. Verify cooldown prevents duplicate within cooldown period

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "feat(notify): final integration and polish"
```

Only commit if there are actual fixes. Skip if everything is clean.
