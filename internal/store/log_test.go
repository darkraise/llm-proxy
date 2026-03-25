package store

import (
	"testing"
	"time"
)

func TestRequestLog_InsertAndQuery(t *testing.T) {
	db := newTestDB(t)

	entry := RequestLog{
		ProviderName:     "groq",
		Model:            "llama-3.3-70b",
		Endpoint:         "openai",
		Status:           "success",
		LatencyMs:        342,
		PromptTokens:     100,
		CompletionTokens: 200,
		StatusCode:       200,
	}

	if err := db.InsertRequestLog(entry); err != nil {
		t.Fatalf("InsertRequestLog: %v", err)
	}

	logs, total, err := db.QueryRequestLogs(RequestLogFilter{Limit: 10})
	if err != nil {
		t.Fatalf("QueryRequestLogs: %v", err)
	}
	if total != 1 {
		t.Fatalf("total: got %d, want 1", total)
	}
	if logs[0].ProviderName != "groq" {
		t.Errorf("provider: got %q", logs[0].ProviderName)
	}
}

func TestRequestLog_FilterByProvider(t *testing.T) {
	db := newTestDB(t)

	db.InsertRequestLog(RequestLog{ProviderName: "groq", Model: "m", Endpoint: "openai", Status: "success"})
	db.InsertRequestLog(RequestLog{ProviderName: "google", Model: "m", Endpoint: "openai", Status: "success"})

	logs, total, _ := db.QueryRequestLogs(RequestLogFilter{ProviderName: "groq", Limit: 10})
	if total != 1 {
		t.Errorf("total: got %d, want 1", total)
	}
	if logs[0].ProviderName != "groq" {
		t.Errorf("provider: got %q", logs[0].ProviderName)
	}
}

func TestRequestLog_FilterByStatus(t *testing.T) {
	db := newTestDB(t)

	db.InsertRequestLog(RequestLog{ProviderName: "a", Model: "m", Endpoint: "openai", Status: "success"})
	db.InsertRequestLog(RequestLog{ProviderName: "b", Model: "m", Endpoint: "openai", Status: "error"})

	_, total, _ := db.QueryRequestLogs(RequestLogFilter{Status: "error", Limit: 10})
	if total != 1 {
		t.Errorf("total: got %d, want 1", total)
	}
}

func TestOverviewStats(t *testing.T) {
	db := newTestDB(t)

	db.InsertRequestLog(RequestLog{ProviderName: "a", Model: "m", Endpoint: "openai", Status: "success", LatencyMs: 100, PromptTokens: 50, CompletionTokens: 100})
	db.InsertRequestLog(RequestLog{ProviderName: "b", Model: "m", Endpoint: "openai", Status: "error", LatencyMs: 200})

	stats, err := db.GetOverviewStats(time.Now().Add(-1*time.Hour), time.Now().Add(1*time.Hour))
	if err != nil {
		t.Fatalf("GetOverviewStats: %v", err)
	}
	if stats.TotalRequests != 2 {
		t.Errorf("total: got %d", stats.TotalRequests)
	}
	if stats.ErrorCount != 1 {
		t.Errorf("errors: got %d", stats.ErrorCount)
	}
	if stats.TotalTokens != 150 {
		t.Errorf("tokens: got %d", stats.TotalTokens)
	}
}
