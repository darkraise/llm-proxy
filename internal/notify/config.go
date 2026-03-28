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
	ProviderUnstable   AlertRule          `json:"provider_unstable"`
	ErrorRateExceeded  ErrorRateAlertRule `json:"error_rate_exceeded"`
	ProvidersExhausted AlertRule          `json:"providers_exhausted"`
	AccountAuthFailure AlertRule          `json:"account_auth_failure"`
	DailySummary       DailySummaryRule   `json:"daily_summary"`
	ProviderRecovered  AlertRule          `json:"provider_recovered"`
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
