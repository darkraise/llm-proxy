package config

import (
	"testing"

	"github.com/darkraise/llm-proxy/internal/store"
)

func TestExportAccountsYAML(t *testing.T) {
	accounts := []store.Account{
		{
			Name: "groq", Type: "groq", BaseURL: "https://api.groq.com/openai/v1",
			APIKey: []byte("gsk_test"),
			Models: `{"chat":["llama-3.3-70b"],"embedding":["embed-v1"]}`,
			DefaultModels: `{"chat":"llama-3.3-70b"}`,
			Priority: 3,
			Enabled:  true,
			Limits: []store.AccountLimit{
				{Metric: "rpm", MaxValue: 30, WindowSecs: 60},
				{Model: "llama-3.3-70b", Metric: "tpm", MaxValue: 5000, WindowSecs: 60},
			},
		},
	}

	data, err := ExportAccountsYAML(accounts)
	if err != nil {
		t.Fatalf("ExportAccountsYAML: %v", err)
	}

	// Re-parse and verify round-trip preserves all fields.
	cfg, err := ParseAccountsYAML(data)
	if err != nil {
		t.Fatalf("re-parse: %v", err)
	}
	if len(cfg.Accounts) != 1 {
		t.Fatalf("accounts: %d", len(cfg.Accounts))
	}
	a := cfg.Accounts[0]
	if a.Priority != 3 {
		t.Errorf("priority: %d", a.Priority)
	}
	if len(a.Models["chat"]) != 1 || a.Models["chat"][0] != "llama-3.3-70b" {
		t.Errorf("chat models: %v", a.Models["chat"])
	}
	if len(a.Models["embedding"]) != 1 || a.Models["embedding"][0] != "embed-v1" {
		t.Errorf("embedding models: %v", a.Models["embedding"])
	}
	if a.DefaultModels["chat"] != "llama-3.3-70b" {
		t.Errorf("default_models: %v", a.DefaultModels)
	}
	if len(a.Limits) != 2 {
		t.Fatalf("limits count: %d", len(a.Limits))
	}
	if a.Limits[1].Model != "llama-3.3-70b" {
		t.Errorf("limit model: %s", a.Limits[1].Model)
	}
	if a.Limits[0].WindowSecs != 60 {
		t.Errorf("limit window_secs: %d", a.Limits[0].WindowSecs)
	}

	// Verify ToAccounts round-trip.
	storeAccounts := cfg.ToAccounts()
	if storeAccounts[0].Priority != 3 {
		t.Errorf("ToAccounts priority: %d", storeAccounts[0].Priority)
	}
}

func TestExportSettingsYAML(t *testing.T) {
	settings := map[string]string{
		"request_timeout":         "15",
		"max_retries":             "3",
		"fallback_enabled":        "true",
		"fallback_url":            "http://localhost:11434/v1",
		"fallback_chat_model":     "llama3.1:8b",
		"fallback_embedding_model": "nomic-embed-text",
		"fallback_timeout":        "30",
	}

	data, err := ExportSettingsYAML(settings)
	if err != nil {
		t.Fatalf("ExportSettingsYAML: %v", err)
	}

	cfg, err := ParseSettingsYAML(data)
	if err != nil {
		t.Fatalf("re-parse: %v", err)
	}
	if cfg.Proxy.RequestTimeout != 15 {
		t.Errorf("request_timeout: %d", cfg.Proxy.RequestTimeout)
	}
	if cfg.Fallback.ChatModel != "llama3.1:8b" {
		t.Errorf("chat_model: %s", cfg.Fallback.ChatModel)
	}
}
