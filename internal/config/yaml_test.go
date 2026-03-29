package config

import (
	"testing"

	"github.com/darkraise/llm-proxy/internal/store"
)

func TestParseYAML(t *testing.T) {
	input := `
proxy:
  request_timeout: 20
  max_retries: 5

fallback:
  enabled: true
  base_url: http://localhost:11434/v1
  chat_model: llama3.1:8b
  embedding_model: nomic-embed-text
  timeout: 30

accounts:
  - name: groq
    type: groq
    base_url: https://api.groq.com/openai/v1
    api_key: gsk_test
    models: ["llama-3.3-70b-versatile"]
    limits:
      - metric: rpm
        max_value: 30
      - metric: rpd
        max_value: 1000
    enabled: true
  - name: google-1
    type: google
    api_key: AIza_test
    models: ["gemini-2.5-flash"]
    limits:
      - metric: rpm
        max_value: 10
    enabled: true
`

	cfg, err := ParseYAML([]byte(input))
	if err != nil {
		t.Fatalf("ParseYAML: %v", err)
	}

	if cfg.Proxy.RequestTimeout != 20 {
		t.Errorf("request_timeout: %d", cfg.Proxy.RequestTimeout)
	}
	if !cfg.Fallback.Enabled {
		t.Error("fallback should be enabled")
	}
	if len(cfg.Accounts) != 2 {
		t.Fatalf("accounts: %d", len(cfg.Accounts))
	}
	if cfg.Accounts[0].Name != "groq" {
		t.Errorf("first account: %s", cfg.Accounts[0].Name)
	}
	if len(cfg.Accounts[0].Limits) != 2 {
		t.Errorf("groq limits: %d", len(cfg.Accounts[0].Limits))
	}
}

func TestExportYAML(t *testing.T) {
	accounts := []store.Account{
		{Name: "groq", Type: "groq", BaseURL: "https://api.groq.com/openai/v1", APIKey: []byte("gsk_test"),
			Models: `{"chat":["llama-3.3-70b"]}`, Enabled: true,
			Limits: []store.AccountLimit{{Metric: "rpm", MaxValue: 30, WindowSecs: 60}}},
	}
	settings := map[string]string{
		"request_timeout":  "15",
		"max_retries":      "3",
		"fallback_enabled":         "true",
		"fallback_url":             "http://localhost:11434/v1",
		"fallback_chat_model":      "llama3.1:8b",
		"fallback_embedding_model": "nomic-embed-text",
		"fallback_timeout":         "30",
	}

	data, err := ExportYAML(accounts, settings)
	if err != nil {
		t.Fatalf("ExportYAML: %v", err)
	}

	// Should be valid YAML that can be re-parsed
	cfg, err := ParseYAML(data)
	if err != nil {
		t.Fatalf("re-parse: %v", err)
	}
	if len(cfg.Accounts) != 1 {
		t.Errorf("accounts: %d", len(cfg.Accounts))
	}
}
