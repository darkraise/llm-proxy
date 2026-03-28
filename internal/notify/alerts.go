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
	Key     string // unique key for cooldown, e.g. "provider_unstable:groq"
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

func NewErrorRateAlert(rate, threshold float64, window, totalRequests, errorCount int) Alert {
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
