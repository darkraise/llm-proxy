package keyval

import (
	"context"
	"encoding/json"
	"net/http"
)

type ProviderInfo struct {
	Name        string
	BaseURL     string
	ModelsURL   string
	AuthType    string
	AuthHeader  string
	APIStandard string
}

type StepConfig struct {
	Step   string         `json:"step"`
	Params map[string]any `json:"params,omitempty"`
}

type StepResult struct {
	Step       string            `json:"step"`
	Success    bool              `json:"success"`
	StatusCode int               `json:"status_code,omitempty"`
	Error      string            `json:"error,omitempty"`
	Models     []string          `json:"models,omitempty"`
	RateLimits map[string]string `json:"rate_limits,omitempty"`
	Response   any               `json:"response,omitempty"`
}

type Step interface {
	Run(ctx context.Context, client *http.Client, provider ProviderInfo, key string, prior []StepResult) StepResult
}

func ParseStepConfigs(raw string) []StepConfig {
	if raw == "" {
		return nil
	}
	var steps []StepConfig
	if json.Unmarshal([]byte(raw), &steps) != nil {
		return nil
	}
	return steps
}
