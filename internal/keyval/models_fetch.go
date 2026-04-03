package keyval

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
)

type ModelsFetchStep struct{}

func newModelsFetchStep(_ StepConfig) Step {
	return &ModelsFetchStep{}
}

func (s *ModelsFetchStep) Run(ctx context.Context, client *http.Client, provider ProviderInfo, key string, prior []StepResult) StepResult {
	result := StepResult{Step: "models_fetch"}

	modelsURL := provider.ModelsURL
	if modelsURL == "" {
		if provider.BaseURL == "" {
			result.Error = "no models URL or base URL configured"
			return result
		}
		modelsURL = provider.BaseURL + "/models"
	}

	req, err := http.NewRequestWithContext(ctx, "GET", modelsURL, nil)
	if err != nil {
		result.Error = "failed to build request: " + err.Error()
		return result
	}
	SetAuth(req, provider.AuthType, provider.AuthHeader, key)

	resp, err := client.Do(req)
	if err != nil {
		result.Error = "request failed: " + err.Error()
		return result
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	result.StatusCode = resp.StatusCode
	result.RateLimits = ExtractRateLimitHeaders(resp.Header)

	if resp.StatusCode != 200 {
		result.Error = parseErrorMessage(body, resp.StatusCode)
		return result
	}

	result.Success = true
	result.Models = ParseProviderModelList(provider.Name, body)
	return result
}

func parseErrorMessage(body []byte, statusCode int) string {
	var errObj struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &errObj) == nil && errObj.Error.Message != "" {
		return errObj.Error.Message
	}
	var msg struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(body, &msg) == nil && msg.Message != "" {
		return msg.Message
	}
	return http.StatusText(statusCode)
}
