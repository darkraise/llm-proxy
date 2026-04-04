package config

import (
	"encoding/json"
	"strconv"

	"github.com/darkraise/llm-proxy/internal/store"
	"gopkg.in/yaml.v3"
)

// ─── Settings YAML (proxy + fallback settings only) ─────────────────────────

type SettingsYAML struct {
	Proxy    ProxyConfig    `yaml:"proxy"`
	Fallback FallbackConfig `yaml:"fallback"`
}

type ProxyConfig struct {
	RequestTimeout int `yaml:"request_timeout"`
	MaxRetries     int `yaml:"max_retries"`
}

type FallbackConfig struct {
	Enabled        bool   `yaml:"enabled"`
	BaseURL        string `yaml:"base_url"`
	ChatModel      string `yaml:"chat_model"`
	EmbeddingModel string `yaml:"embedding_model,omitempty"`
	Timeout        int    `yaml:"timeout"`
}

func ExportSettingsYAML(settings map[string]string) ([]byte, error) {
	cfg := SettingsYAML{
		Proxy: ProxyConfig{
			RequestTimeout: atoi(settings["request_timeout"], 15),
			MaxRetries:     atoi(settings["max_retries"], 3),
		},
		Fallback: FallbackConfig{
			Enabled:        settings["fallback_enabled"] == "true",
			BaseURL:        settings["fallback_url"],
			ChatModel:      settings["fallback_chat_model"],
			EmbeddingModel: settings["fallback_embedding_model"],
			Timeout:        atoi(settings["fallback_timeout"], 30),
		},
	}
	return yaml.Marshal(&cfg)
}

func ParseSettingsYAML(data []byte) (*SettingsYAML, error) {
	var cfg SettingsYAML
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// ─── Accounts YAML ──────────────────────────────────────────────────────────

type AccountsYAML struct {
	Accounts []AccountYAML `yaml:"accounts"`
}

type AccountYAML struct {
	Name          string              `yaml:"name"`
	Type          string              `yaml:"type"`
	BaseURL       string              `yaml:"base_url,omitempty"`
	APIKey        string              `yaml:"api_key"`
	Models        map[string][]string `yaml:"models"`
	DefaultModels map[string]string   `yaml:"default_models,omitempty"`
	Priority      int                 `yaml:"priority"`
	Limits        []LimitYAML         `yaml:"limits"`
	Enabled       bool                `yaml:"enabled"`
}

type LimitYAML struct {
	Model      string `yaml:"model,omitempty"`
	Metric     string `yaml:"metric"`
	MaxValue   int    `yaml:"max_value"`
	WindowSecs int    `yaml:"window_secs"`
}

func ExportAccountsYAML(accounts []store.Account) ([]byte, error) {
	cfg := AccountsYAML{}
	for _, p := range accounts {
		models := store.ParseCategorizedModels(p.Models)
		defaults := store.ParseDefaultModels(p.DefaultModels)

		var limits []LimitYAML
		for _, l := range p.Limits {
			limits = append(limits, LimitYAML{
				Model:      l.Model,
				Metric:     l.Metric,
				MaxValue:   l.MaxValue,
				WindowSecs: l.WindowSecs,
			})
		}

		cfg.Accounts = append(cfg.Accounts, AccountYAML{
			Name:          p.Name,
			Type:          p.Type,
			BaseURL:       p.BaseURL,
			APIKey:        string(p.APIKey),
			Models:        models,
			DefaultModels: defaults,
			Priority:      p.Priority,
			Limits:        limits,
			Enabled:       p.Enabled,
		})
	}
	return yaml.Marshal(&cfg)
}

func ParseAccountsYAML(data []byte) (*AccountsYAML, error) {
	var cfg AccountsYAML
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (c *AccountsYAML) ToAccounts() []store.Account {
	accounts := make([]store.Account, len(c.Accounts))
	for i, p := range c.Accounts {
		models := p.Models
		if models == nil {
			models = map[string][]string{}
		}
		defaults := p.DefaultModels
		if defaults == nil {
			defaults = map[string]string{}
		}

		var limits []store.AccountLimit
		for _, l := range p.Limits {
			ws := l.WindowSecs
			if ws == 0 {
				ws = metricToWindow(l.Metric)
			}
			limits = append(limits, store.AccountLimit{
				Model:      l.Model,
				Metric:     l.Metric,
				MaxValue:   l.MaxValue,
				WindowSecs: ws,
			})
		}

		modelsJSON, _ := json.Marshal(models)
		defaultsJSON, _ := json.Marshal(defaults)

		accounts[i] = store.Account{
			Name:          p.Name,
			Type:          p.Type,
			BaseURL:       p.BaseURL,
			APIKey:        []byte(p.APIKey),
			Models:        string(modelsJSON),
			DefaultModels: string(defaultsJSON),
			Priority:      p.Priority,
			Enabled:       p.Enabled,
			Limits:        limits,
		}
	}
	return accounts
}

// ─── Helpers ────────────────────────────────────────────────────────────────

func metricToWindow(metric string) int {
	switch metric {
	case "rpm", "tpm":
		return 60
	case "rpd", "tpd":
		return 86400
	case "rpmo", "tpmo":
		return 2592000
	case "rph", "tph":
		return 3600
	case "rps":
		return 1
	default:
		return 60
	}
}

func atoi(s string, def int) int {
	if v, err := strconv.Atoi(s); err == nil {
		return v
	}
	return def
}
