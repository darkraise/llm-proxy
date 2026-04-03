package keyval

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

type ChatCompletionStep struct {
	Model     string
	Message   string
	MaxTokens int
}

func newChatCompletionStep(cfg StepConfig) Step {
	s := &ChatCompletionStep{
		Message:   "say ok",
		MaxTokens: 5,
	}
	if m, ok := cfg.Params["model"].(string); ok && m != "" {
		s.Model = m
	}
	if m, ok := cfg.Params["message"].(string); ok && m != "" {
		s.Message = m
	}
	if mt, ok := cfg.Params["max_tokens"].(float64); ok && mt > 0 {
		s.MaxTokens = int(mt)
	}
	return s
}

func (s *ChatCompletionStep) Run(ctx context.Context, client *http.Client, provider ProviderInfo, key string, prior []StepResult) StepResult {
	result := StepResult{Step: "chat_completion"}

	model := s.Model
	if model == "" || model == "auto" {
		model = firstModelFromPrior(prior)
	}
	if model == "" {
		result.Error = "no model specified and none found from prior steps"
		return result
	}

	baseURL := provider.BaseURL
	if baseURL == "" && provider.APIStandard == "google" {
		baseURL = "https://generativelanguage.googleapis.com/v1beta/openai"
	}
	if baseURL == "" {
		result.Error = "no base URL configured"
		return result
	}

	payload, _ := json.Marshal(map[string]any{
		"model":      model,
		"messages":   []map[string]string{{"role": "user", "content": s.Message}},
		"max_tokens": s.MaxTokens,
	})

	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/chat/completions", strings.NewReader(string(payload)))
	if err != nil {
		result.Error = "failed to build request: " + err.Error()
		return result
	}
	req.Header.Set("Content-Type", "application/json")

	authType := provider.AuthType
	if baseURL == "https://generativelanguage.googleapis.com/v1beta/openai" {
		authType = "bearer"
	}
	SetAuth(req, authType, provider.AuthHeader, key)

	resp, err := client.Do(req)
	if err != nil {
		result.Error = "request failed: " + err.Error()
		return result
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	result.StatusCode = resp.StatusCode
	result.RateLimits = ExtractRateLimitHeaders(resp.Header)

	var parsed any
	if json.Unmarshal(body, &parsed) != nil {
		parsed = string(body)
	}
	result.Response = parsed

	if resp.StatusCode != 200 {
		result.Error = parseErrorMessage(body, resp.StatusCode)
		return result
	}

	result.Success = true
	return result
}

func firstModelFromPrior(prior []StepResult) string {
	for _, r := range prior {
		if r.Success && len(r.Models) > 0 {
			return r.Models[0]
		}
	}
	return ""
}
