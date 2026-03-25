package config

import (
	"encoding/json"
	"strconv"

	"github.com/darkraise/llm-proxy/internal/store"
	"gopkg.in/yaml.v3"
)

type Config struct {
	Proxy     ProxyConfig    `yaml:"proxy"`
	Fallback  FallbackConfig `yaml:"fallback"`
	Providers []ProviderYAML `yaml:"providers"`
}

type ProxyConfig struct {
	RequestTimeout int `yaml:"request_timeout"`
	MaxRetries     int `yaml:"max_retries"`
}

type FallbackConfig struct {
	Enabled bool   `yaml:"enabled"`
	BaseURL string `yaml:"base_url"`
	Model   string `yaml:"model"`
	Timeout int    `yaml:"timeout"`
}

type ProviderYAML struct {
	Name    string      `yaml:"name"`
	Type    string      `yaml:"type"`
	BaseURL string      `yaml:"base_url,omitempty"`
	APIKey  string      `yaml:"api_key"`
	Models  []string    `yaml:"models"`
	Limits  []LimitYAML `yaml:"limits"`
	Enabled bool        `yaml:"enabled"`
}

type LimitYAML struct {
	Metric   string `yaml:"metric"`
	MaxValue int    `yaml:"max_value"`
}

func ParseYAML(data []byte) (*Config, error) {
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (c *Config) ToProviders() []store.Provider {
	providers := make([]store.Provider, len(c.Providers))
	for i, p := range c.Providers {
		modelsJSON, _ := json.Marshal(p.Models)
		var limits []store.ProviderLimit
		for _, l := range p.Limits {
			windowSecs := metricToWindow(l.Metric)
			limits = append(limits, store.ProviderLimit{
				Metric: l.Metric, MaxValue: l.MaxValue, WindowSecs: windowSecs,
			})
		}
		providers[i] = store.Provider{
			Name:    p.Name,
			Type:    p.Type,
			BaseURL: p.BaseURL,
			APIKey:  []byte(p.APIKey),
			Models:  string(modelsJSON),
			Enabled: p.Enabled,
			Limits:  limits,
		}
	}
	return providers
}

func ExportYAML(providers []store.Provider, settings map[string]string) ([]byte, error) {
	cfg := Config{
		Proxy: ProxyConfig{
			RequestTimeout: atoi(settings["request_timeout"], 15),
			MaxRetries:     atoi(settings["max_retries"], 3),
		},
		Fallback: FallbackConfig{
			Enabled: settings["fallback_enabled"] == "true",
			BaseURL: settings["fallback_url"],
			Model:   settings["fallback_model"],
			Timeout: atoi(settings["fallback_timeout"], 30),
		},
	}

	for _, p := range providers {
		var models []string
		json.Unmarshal([]byte(p.Models), &models)

		var limits []LimitYAML
		for _, l := range p.Limits {
			limits = append(limits, LimitYAML{Metric: l.Metric, MaxValue: l.MaxValue})
		}

		cfg.Providers = append(cfg.Providers, ProviderYAML{
			Name:    p.Name,
			Type:    p.Type,
			BaseURL: p.BaseURL,
			APIKey:  string(p.APIKey), // plaintext for export
			Models:  models,
			Limits:  limits,
			Enabled: p.Enabled,
		})
	}

	return yaml.Marshal(&cfg)
}

func metricToWindow(metric string) int {
	switch metric {
	case "rpm", "tpm":
		return 60
	case "rpd", "tpd":
		return 86400
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
