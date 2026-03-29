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
	cooldowns map[string]time.Time // alertKey -> last sent time
}

func NewNotifier(db *store.DB) *Notifier {
	return &Notifier{
		db:        db,
		cooldowns: make(map[string]time.Time),
	}
}

// Alert sends a notification if the alert type is enabled and not in cooldown.
// Safe to call from any goroutine.
func (n *Notifier) Alert(alert Alert) {
	// Load config and check cooldown under lock, then release before network I/O.
	n.mu.Lock()

	channels := n.loadChannels()
	alerts := n.loadAlerts()

	rule := n.getRuleForType(alerts, alert.Type)
	if rule == nil || !rule.Enabled {
		n.mu.Unlock()
		return
	}

	if last, ok := n.cooldowns[alert.Key]; ok {
		if time.Since(last) < time.Duration(rule.CooldownMin)*time.Minute {
			n.mu.Unlock()
			return
		}
	}

	// Optimistically set cooldown so concurrent callers skip while we send.
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
		// All channels failed — clear optimistic cooldown so next attempt retries.
		n.mu.Lock()
		delete(n.cooldowns, alert.Key)
		n.mu.Unlock()
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
				if time.Since(ps.MarkedAt) > 5*time.Minute {
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
