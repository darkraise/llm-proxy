# Centralized Key Validation Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize all key validation, auth setup, and model parsing into a new `internal/keyval` package with a configurable multi-step pipeline, eliminating four duplicated auth implementations and scattered provider-specific logic.

**Architecture:** Create `internal/keyval` with a `Step` interface and registry-based pipeline runner. All admin handlers, scanner, and proxy call into keyval for auth and validation. The providers table gains a `validation_steps` JSON column for per-provider pipeline configuration.

**Tech Stack:** Go, SQLite (modernc.org/sqlite), net/http, httptest

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `internal/keyval/auth.go` | Create | `SetAuth()` — single auth implementation |
| `internal/keyval/auth_test.go` | Create | Auth tests for all auth types |
| `internal/keyval/parse.go` | Create | Model list parsing (OpenAI, Google, array, provider-specific) |
| `internal/keyval/parse_test.go` | Create | Parse tests |
| `internal/keyval/step.go` | Create | `Step` interface, `StepConfig`, `StepResult`, `ProviderInfo` types |
| `internal/keyval/models_fetch.go` | Create | `ModelsFetchStep` implementation |
| `internal/keyval/models_fetch_test.go` | Create | Models fetch tests with httptest |
| `internal/keyval/chat_completion.go` | Create | `ChatCompletionStep` implementation |
| `internal/keyval/chat_completion_test.go` | Create | Chat completion tests with httptest |
| `internal/keyval/pipeline.go` | Create | `Validate()` entry point, step registry, default pipeline |
| `internal/keyval/pipeline_test.go` | Create | Pipeline orchestration tests |
| `internal/store/provider.go` | Modify | Add `ValidationSteps` field, `ParseValidationSteps()` method |
| `internal/store/sqlite.go` | Modify | Add `validation_steps` column to providers table |
| `internal/proxy/handler.go` | Modify | Replace `setProviderAuth()` with `keyval.SetAuth()` |
| `internal/proxy/stream.go` | Modify | Replace `setProviderAuth()` call with `keyval.SetAuth()` |
| `internal/scanner/validate.go` | Modify | Replace with thin wrapper around `keyval.Validate()` |
| `internal/admin/keytest.go` | Modify | Remove duplicated functions, use keyval |
| `internal/admin/handler.go` | Modify | Simplify test/chat handlers to use keyval |
| `internal/admin/discover.go` | Modify | Remove `parseModelList`, use keyval |
| `internal/admin/scanner_handler.go` | Modify | Simplify discover handler to use keyval |

---

### Task 1: Core Types and Auth

**Files:**
- Create: `internal/keyval/step.go`
- Create: `internal/keyval/auth.go`
- Create: `internal/keyval/auth_test.go`

- [ ] **Step 1: Create `internal/keyval/step.go` with core types**

```go
package keyval

import (
	"context"
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
```

- [ ] **Step 2: Create `internal/keyval/auth.go`**

```go
package keyval

import "net/http"

func SetAuth(req *http.Request, authType, authHeader, key string) {
	switch authType {
	case "api-key-header":
		header := authHeader
		if header == "" {
			header = "x-api-key"
		}
		req.Header.Set(header, key)
		if header == "x-api-key" {
			req.Header.Set("anthropic-version", "2023-06-01")
		}
	case "query-param":
		q := req.URL.Query()
		q.Set("key", key)
		req.URL.RawQuery = q.Encode()
	case "none":
		// no auth
	default:
		req.Header.Set("Authorization", "Bearer "+key)
	}
}
```

- [ ] **Step 3: Create `internal/keyval/auth_test.go`**

```go
package keyval_test

import (
	"net/http"
	"testing"

	"github.com/darkraise/llm-proxy/internal/keyval"
)

func TestSetAuth_Bearer(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/models", nil)
	keyval.SetAuth(req, "bearer", "", "sk-test-key")

	if got := req.Header.Get("Authorization"); got != "Bearer sk-test-key" {
		t.Errorf("expected Bearer auth, got %q", got)
	}
}

func TestSetAuth_DefaultIsBearerToken(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/models", nil)
	keyval.SetAuth(req, "", "", "sk-test-key")

	if got := req.Header.Get("Authorization"); got != "Bearer sk-test-key" {
		t.Errorf("expected Bearer auth for empty authType, got %q", got)
	}
}

func TestSetAuth_APIKeyHeader(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/models", nil)
	keyval.SetAuth(req, "api-key-header", "x-api-key", "sk-ant-key")

	if got := req.Header.Get("x-api-key"); got != "sk-ant-key" {
		t.Errorf("expected x-api-key header, got %q", got)
	}
	if got := req.Header.Get("anthropic-version"); got != "2023-06-01" {
		t.Errorf("expected anthropic-version header, got %q", got)
	}
}

func TestSetAuth_APIKeyHeaderCustom(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/models", nil)
	keyval.SetAuth(req, "api-key-header", "X-Custom-Key", "my-key")

	if got := req.Header.Get("X-Custom-Key"); got != "my-key" {
		t.Errorf("expected X-Custom-Key header, got %q", got)
	}
	if got := req.Header.Get("anthropic-version"); got != "" {
		t.Errorf("anthropic-version should not be set for custom header, got %q", got)
	}
}

func TestSetAuth_QueryParam(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/models", nil)
	keyval.SetAuth(req, "query-param", "", "AIzaSyTestKey")

	if got := req.URL.Query().Get("key"); got != "AIzaSyTestKey" {
		t.Errorf("expected key query param, got %q", got)
	}
}

func TestSetAuth_None(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com/models", nil)
	keyval.SetAuth(req, "none", "", "ignored-key")

	if got := req.Header.Get("Authorization"); got != "" {
		t.Errorf("expected no auth header, got %q", got)
	}
	if got := req.URL.Query().Get("key"); got != "" {
		t.Errorf("expected no query param, got %q", got)
	}
}
```

- [ ] **Step 4: Run tests**

Run: `go test ./internal/keyval/ -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/keyval/
git commit -m "feat(keyval): add core types and centralized SetAuth"
```

---

### Task 2: Model Parsing

**Files:**
- Create: `internal/keyval/parse.go`
- Create: `internal/keyval/parse_test.go`

- [ ] **Step 1: Create `internal/keyval/parse.go`**

Move and consolidate model parsing from `admin/discover.go` (parseModelList) and `admin/keytest.go` (parseOpenAIModelList, parseGoogleModelList, etc.). Also move `extractRateLimitHeaders` and `parseRateLimitsFromHeaders`.

```go
package keyval

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
)

type ParsedModel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func ParseModelList(data []byte) []ParsedModel {
	// OpenAI format: {"data": [{"id": "..."}]}
	var openai struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.Unmarshal(data, &openai) == nil && len(openai.Data) > 0 {
		models := make([]ParsedModel, 0, len(openai.Data))
		for _, item := range openai.Data {
			if item.ID != "" {
				models = append(models, ParsedModel{ID: item.ID, Name: item.ID})
			}
		}
		return models
	}

	// Google format: {"models": [{"name": "models/gemini-2.0-flash", ...}]}
	var google struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if json.Unmarshal(data, &google) == nil && len(google.Models) > 0 {
		models := make([]ParsedModel, 0, len(google.Models))
		for _, item := range google.Models {
			if item.Name != "" {
				models = append(models, ParsedModel{ID: item.Name, Name: item.Name})
			}
		}
		return models
	}

	// Plain array: [{"id":"...", "name":"..."}]
	var arr []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if json.Unmarshal(data, &arr) == nil && len(arr) > 0 {
		models := make([]ParsedModel, 0, len(arr))
		for _, item := range arr {
			name := item.Name
			if name == "" {
				name = item.ID
			}
			if name != "" {
				models = append(models, ParsedModel{ID: name, Name: name})
			}
		}
		return models
	}

	return nil
}

func ParseModelIDs(data []byte) []string {
	models := ParseModelList(data)
	if models == nil {
		return nil
	}
	ids := make([]string, len(models))
	for i, m := range models {
		ids[i] = m.ID
	}
	sort.Strings(ids)
	return ids
}

func ExtractRateLimitHeaders(header http.Header) map[string]string {
	limits := make(map[string]string)
	for k, vals := range header {
		lower := strings.ToLower(k)
		if strings.Contains(lower, "ratelimit") || strings.Contains(lower, "rate-limit") {
			limits[k] = vals[0]
		}
	}
	if len(limits) == 0 {
		return nil
	}
	return limits
}

type ParsedLimit struct {
	Metric     string `json:"metric"`
	MaxValue   int    `json:"max_value"`
	WindowSecs int    `json:"window_secs"`
}

func ParseRateLimitsFromHeaders(header http.Header) []ParsedLimit {
	type mapping struct {
		suffixes   []string
		metric     string
		windowSecs int
	}
	mappings := []mapping{
		{[]string{"limit-requests", "requests-limit"}, "rpm", 60},
		{[]string{"limit-tokens", "tokens-limit"}, "tpm", 60},
		{[]string{"limit-requests-day"}, "rpd", 86400},
		{[]string{"limit-tokens-day"}, "tpd", 86400},
		{[]string{"limit-tokens-minute"}, "tpm", 60},
		{[]string{"limit-requests-minute"}, "rpm", 60},
	}

	seen := map[string]bool{}
	var limits []ParsedLimit
	for key, vals := range header {
		lower := strings.ToLower(key)
		if !strings.Contains(lower, "ratelimit") && !strings.Contains(lower, "rate-limit") {
			continue
		}
		if strings.Contains(lower, "remaining") || strings.Contains(lower, "reset") {
			continue
		}
		for _, m := range mappings {
			for _, suffix := range m.suffixes {
				if strings.HasSuffix(lower, suffix) && !seen[m.metric] {
					v := 0
					fmt.Sscanf(vals[0], "%d", &v)
					if v > 0 {
						limits = append(limits, ParsedLimit{Metric: m.metric, MaxValue: v, WindowSecs: m.windowSecs})
						seen[m.metric] = true
					}
				}
			}
		}
	}
	return limits
}

func ParseProviderModelList(providerName string, body []byte) []string {
	switch providerName {
	case "google":
		return parseGoogleModelList(body)
	case "huggingface":
		return nil
	case "stability":
		return parseEngineList(body)
	case "replicate":
		return parseReplicateModels(body)
	case "ai21":
		return parseAI21Models(body)
	default:
		return parseOpenAIModelList(body)
	}
}

func parseOpenAIModelList(body []byte) []string {
	var resp struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &resp) != nil || len(resp.Data) == 0 {
		return nil
	}
	models := make([]string, 0, len(resp.Data))
	for _, m := range resp.Data {
		models = append(models, m.ID)
	}
	sort.Strings(models)
	return models
}

func parseGoogleModelList(body []byte) []string {
	var resp struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if json.Unmarshal(body, &resp) != nil || len(resp.Models) == 0 {
		return nil
	}
	models := make([]string, 0, len(resp.Models))
	for _, m := range resp.Models {
		models = append(models, m.Name)
	}
	sort.Strings(models)
	return models
}

func parseEngineList(body []byte) []string {
	var engines []struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(body, &engines) != nil || len(engines) == 0 {
		return nil
	}
	models := make([]string, 0, len(engines))
	for _, e := range engines {
		models = append(models, e.ID)
	}
	sort.Strings(models)
	return models
}

func parseReplicateModels(body []byte) []string {
	var resp struct {
		Results []struct {
			Owner string `json:"owner"`
			Name  string `json:"name"`
		} `json:"results"`
	}
	if json.Unmarshal(body, &resp) != nil || len(resp.Results) == 0 {
		return nil
	}
	models := make([]string, 0, len(resp.Results))
	for _, m := range resp.Results {
		models = append(models, m.Owner+"/"+m.Name)
	}
	sort.Strings(models)
	return models
}

func parseAI21Models(body []byte) []string {
	var models []struct {
		Name string `json:"name"`
	}
	if json.Unmarshal(body, &models) != nil || len(models) == 0 {
		return nil
	}
	out := make([]string, 0, len(models))
	for _, m := range models {
		out = append(out, m.Name)
	}
	sort.Strings(out)
	return out
}
```

- [ ] **Step 2: Create `internal/keyval/parse_test.go`**

```go
package keyval_test

import (
	"net/http"
	"testing"

	"github.com/darkraise/llm-proxy/internal/keyval"
)

func TestParseModelList_OpenAI(t *testing.T) {
	data := []byte(`{"data":[{"id":"gpt-4o"},{"id":"gpt-3.5-turbo"}]}`)
	models := keyval.ParseModelList(data)
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}
	if models[0].ID != "gpt-4o" {
		t.Errorf("expected gpt-4o, got %s", models[0].ID)
	}
}

func TestParseModelList_Google(t *testing.T) {
	data := []byte(`{"models":[{"name":"models/gemini-2.0-flash"},{"name":"models/gemma-3-27b-it"}]}`)
	models := keyval.ParseModelList(data)
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}
	if models[0].ID != "models/gemini-2.0-flash" {
		t.Errorf("expected models/gemini-2.0-flash, got %s", models[0].ID)
	}
}

func TestParseModelList_PlainArray(t *testing.T) {
	data := []byte(`[{"id":"model-a","name":"Model A"},{"id":"model-b"}]`)
	models := keyval.ParseModelList(data)
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}
}

func TestParseModelList_Empty(t *testing.T) {
	models := keyval.ParseModelList([]byte(`{}`))
	if models != nil {
		t.Errorf("expected nil for empty response, got %v", models)
	}
}

func TestParseModelIDs_Sorted(t *testing.T) {
	data := []byte(`{"data":[{"id":"z-model"},{"id":"a-model"}]}`)
	ids := keyval.ParseModelIDs(data)
	if len(ids) != 2 || ids[0] != "a-model" || ids[1] != "z-model" {
		t.Errorf("expected sorted [a-model z-model], got %v", ids)
	}
}

func TestExtractRateLimitHeaders(t *testing.T) {
	h := http.Header{}
	h.Set("X-RateLimit-Limit-Requests", "100")
	h.Set("X-RateLimit-Remaining-Requests", "99")
	h.Set("Content-Type", "application/json")

	limits := keyval.ExtractRateLimitHeaders(h)
	if len(limits) != 2 {
		t.Fatalf("expected 2 rate limit headers, got %d", len(limits))
	}
	if _, ok := limits["Content-Type"]; ok {
		t.Error("should not include Content-Type")
	}
}

func TestExtractRateLimitHeaders_None(t *testing.T) {
	h := http.Header{}
	h.Set("Content-Type", "application/json")

	limits := keyval.ExtractRateLimitHeaders(h)
	if limits != nil {
		t.Errorf("expected nil for no rate limit headers, got %v", limits)
	}
}

func TestParseProviderModelList_OpenAI(t *testing.T) {
	data := []byte(`{"data":[{"id":"gpt-4o"},{"id":"gpt-3.5-turbo"}]}`)
	models := keyval.ParseProviderModelList("openai", data)
	if len(models) != 2 {
		t.Fatalf("expected 2, got %d", len(models))
	}
}

func TestParseProviderModelList_Google(t *testing.T) {
	data := []byte(`{"models":[{"name":"models/gemini-2.0-flash"}]}`)
	models := keyval.ParseProviderModelList("google", data)
	if len(models) != 1 || models[0] != "models/gemini-2.0-flash" {
		t.Errorf("expected [models/gemini-2.0-flash], got %v", models)
	}
}
```

- [ ] **Step 3: Run tests**

Run: `go test ./internal/keyval/ -v`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add internal/keyval/
git commit -m "feat(keyval): add model parsing and rate limit header extraction"
```

---

### Task 3: Models Fetch Step

**Files:**
- Create: `internal/keyval/models_fetch.go`
- Create: `internal/keyval/models_fetch_test.go`

- [ ] **Step 1: Create `internal/keyval/models_fetch.go`**

```go
package keyval

import (
	"context"
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
	// Try {"error":{"message":"..."}}
	var errObj struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if jsonUnmarshal(body, &errObj) == nil && errObj.Error.Message != "" {
		return errObj.Error.Message
	}
	// Try {"message":"..."}
	var msg struct {
		Message string `json:"message"`
	}
	if jsonUnmarshal(body, &msg) == nil && msg.Message != "" {
		return msg.Message
	}
	return http.StatusText(statusCode)
}
```

Note: `jsonUnmarshal` is just `json.Unmarshal` — add the import for `encoding/json` at the top:

```go
import (
	"context"
	"encoding/json"
	"io"
	"net/http"
)
```

And replace `jsonUnmarshal` with `json.Unmarshal` in the actual code.

- [ ] **Step 2: Create `internal/keyval/models_fetch_test.go`**

```go
package keyval_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/darkraise/llm-proxy/internal/keyval"
)

func TestModelsFetchStep_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("X-RateLimit-Limit-Requests", "100")
		w.Write([]byte(`{"data":[{"id":"gpt-4o"},{"id":"gpt-3.5-turbo"}]}`))
	}))
	defer srv.Close()

	step := keyval.ModelsFetchStep{}
	result := step.Run(context.Background(), srv.Client(), keyval.ProviderInfo{
		Name:      "openai",
		ModelsURL: srv.URL + "/models",
		AuthType:  "bearer",
	}, "test-key", nil)

	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}
	if len(result.Models) != 2 {
		t.Errorf("expected 2 models, got %d", len(result.Models))
	}
	if result.RateLimits == nil {
		t.Error("expected rate limits to be captured")
	}
}

func TestModelsFetchStep_AuthFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		w.Write([]byte(`{"error":{"message":"invalid api key"}}`))
	}))
	defer srv.Close()

	step := keyval.ModelsFetchStep{}
	result := step.Run(context.Background(), srv.Client(), keyval.ProviderInfo{
		Name:      "openai",
		ModelsURL: srv.URL + "/models",
		AuthType:  "bearer",
	}, "bad-key", nil)

	if result.Success {
		t.Fatal("expected failure")
	}
	if result.StatusCode != 401 {
		t.Errorf("expected 401, got %d", result.StatusCode)
	}
	if result.Error != "invalid api key" {
		t.Errorf("expected error message, got %q", result.Error)
	}
}

func TestModelsFetchStep_GoogleFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("key") == "" {
			w.WriteHeader(401)
			return
		}
		w.Write([]byte(`{"models":[{"name":"models/gemini-2.0-flash"}]}`))
	}))
	defer srv.Close()

	step := keyval.ModelsFetchStep{}
	result := step.Run(context.Background(), srv.Client(), keyval.ProviderInfo{
		Name:      "google",
		ModelsURL: srv.URL + "/models",
		AuthType:  "query-param",
	}, "AIzaSyTest", nil)

	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}
	if len(result.Models) != 1 || result.Models[0] != "models/gemini-2.0-flash" {
		t.Errorf("expected [models/gemini-2.0-flash], got %v", result.Models)
	}
}

func TestModelsFetchStep_NoURL(t *testing.T) {
	step := keyval.ModelsFetchStep{}
	result := step.Run(context.Background(), http.DefaultClient, keyval.ProviderInfo{
		Name: "test",
	}, "key", nil)

	if result.Success {
		t.Fatal("expected failure with no URL")
	}
}
```

- [ ] **Step 3: Run tests**

Run: `go test ./internal/keyval/ -v`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add internal/keyval/
git commit -m "feat(keyval): add ModelsFetchStep implementation"
```

---

### Task 4: Chat Completion Step

**Files:**
- Create: `internal/keyval/chat_completion.go`
- Create: `internal/keyval/chat_completion_test.go`

- [ ] **Step 1: Create `internal/keyval/chat_completion.go`**

```go
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
```

- [ ] **Step 2: Create `internal/keyval/chat_completion_test.go`**

```go
package keyval_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/darkraise/llm-proxy/internal/keyval"
)

func TestChatCompletionStep_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		json.NewDecoder(r.Body).Decode(&req)
		if req["model"] != "gpt-4o" {
			t.Errorf("expected model gpt-4o, got %v", req["model"])
		}
		w.Header().Set("X-RateLimit-Limit-Requests", "500")
		w.Write([]byte(`{"id":"chatcmpl-1","choices":[{"message":{"content":"ok"}}],"usage":{"total_tokens":10}}`))
	}))
	defer srv.Close()

	step := keyval.ChatCompletionStep{Model: "gpt-4o", Message: "say ok", MaxTokens: 5}
	result := step.Run(context.Background(), srv.Client(), keyval.ProviderInfo{
		Name:     "openai",
		BaseURL:  srv.URL,
		AuthType: "bearer",
	}, "test-key", nil)

	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}
	if result.StatusCode != 200 {
		t.Errorf("expected 200, got %d", result.StatusCode)
	}
	if result.Response == nil {
		t.Error("expected response body")
	}
}

func TestChatCompletionStep_AutoModelFromPrior(t *testing.T) {
	var receivedModel string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		json.NewDecoder(r.Body).Decode(&req)
		receivedModel = req["model"].(string)
		w.Write([]byte(`{"id":"chatcmpl-1","choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer srv.Close()

	prior := []keyval.StepResult{
		{Step: "models_fetch", Success: true, Models: []string{"llama-3.3-70b", "mixtral-8x7b"}},
	}

	step := keyval.ChatCompletionStep{Message: "hi", MaxTokens: 5}
	result := step.Run(context.Background(), srv.Client(), keyval.ProviderInfo{
		Name:     "groq",
		BaseURL:  srv.URL,
		AuthType: "bearer",
	}, "key", prior)

	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}
	if receivedModel != "llama-3.3-70b" {
		t.Errorf("expected auto-selected llama-3.3-70b, got %s", receivedModel)
	}
}

func TestChatCompletionStep_NoModel(t *testing.T) {
	step := keyval.ChatCompletionStep{Message: "hi", MaxTokens: 5}
	result := step.Run(context.Background(), http.DefaultClient, keyval.ProviderInfo{
		Name:     "openai",
		BaseURL:  "http://localhost",
		AuthType: "bearer",
	}, "key", nil)

	if result.Success {
		t.Fatal("expected failure with no model")
	}
	if result.Error != "no model specified and none found from prior steps" {
		t.Errorf("unexpected error: %s", result.Error)
	}
}

func TestChatCompletionStep_ProviderError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(429)
		w.Write([]byte(`{"error":{"message":"rate limit exceeded"}}`))
	}))
	defer srv.Close()

	step := keyval.ChatCompletionStep{Model: "gpt-4o", Message: "hi", MaxTokens: 5}
	result := step.Run(context.Background(), srv.Client(), keyval.ProviderInfo{
		Name:     "openai",
		BaseURL:  srv.URL,
		AuthType: "bearer",
	}, "key", nil)

	if result.Success {
		t.Fatal("expected failure on 429")
	}
	if result.StatusCode != 429 {
		t.Errorf("expected 429, got %d", result.StatusCode)
	}
	if result.Error != "rate limit exceeded" {
		t.Errorf("expected error message, got %q", result.Error)
	}
}
```

- [ ] **Step 3: Run tests**

Run: `go test ./internal/keyval/ -v`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add internal/keyval/
git commit -m "feat(keyval): add ChatCompletionStep implementation"
```

---

### Task 5: Pipeline Runner

**Files:**
- Create: `internal/keyval/pipeline.go`
- Create: `internal/keyval/pipeline_test.go`

- [ ] **Step 1: Create `internal/keyval/pipeline.go`**

```go
package keyval

import (
	"context"
	"net/http"
	"time"
)

var defaultSteps = []StepConfig{{Step: "models_fetch"}}

var registry = map[string]func(StepConfig) Step{
	"models_fetch":    newModelsFetchStep,
	"chat_completion": newChatCompletionStep,
}

func Validate(ctx context.Context, provider ProviderInfo, key string, steps []StepConfig) []StepResult {
	if len(steps) == 0 {
		steps = defaultSteps
	}

	client := &http.Client{Timeout: 15 * time.Second}
	var results []StepResult

	for _, cfg := range steps {
		factory, ok := registry[cfg.Step]
		if !ok {
			results = append(results, StepResult{
				Step:  cfg.Step,
				Error: "unknown step type: " + cfg.Step,
			})
			break
		}

		step := factory(cfg)
		result := step.Run(ctx, client, provider, key, results)
		results = append(results, result)

		if !result.Success {
			break
		}
	}

	return results
}
```

- [ ] **Step 2: Create `internal/keyval/pipeline_test.go`**

```go
package keyval_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/darkraise/llm-proxy/internal/keyval"
)

func TestValidate_DefaultPipeline(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"data":[{"id":"model-a"}]}`))
	}))
	defer srv.Close()

	results := keyval.Validate(context.Background(), keyval.ProviderInfo{
		Name:      "test",
		ModelsURL: srv.URL + "/models",
		AuthType:  "bearer",
	}, "key", nil)

	if len(results) != 1 {
		t.Fatalf("expected 1 result (default pipeline), got %d", len(results))
	}
	if !results[0].Success {
		t.Errorf("expected success, got error: %s", results[0].Error)
	}
	if results[0].Step != "models_fetch" {
		t.Errorf("expected models_fetch step, got %s", results[0].Step)
	}
}

func TestValidate_MultiStep(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			w.Write([]byte(`{"data":[{"id":"test-model"}]}`))
			return
		}
		w.Write([]byte(`{"id":"chatcmpl-1","choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer srv.Close()

	steps := []keyval.StepConfig{
		{Step: "models_fetch"},
		{Step: "chat_completion", Params: map[string]any{"max_tokens": float64(5)}},
	}

	results := keyval.Validate(context.Background(), keyval.ProviderInfo{
		Name:      "test",
		BaseURL:   srv.URL,
		ModelsURL: srv.URL + "/models",
		AuthType:  "bearer",
	}, "key", steps)

	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if !results[0].Success {
		t.Errorf("step 1 failed: %s", results[0].Error)
	}
	if !results[1].Success {
		t.Errorf("step 2 failed: %s", results[1].Error)
	}
}

func TestValidate_ShortCircuitOnFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		w.Write([]byte(`{"error":{"message":"unauthorized"}}`))
	}))
	defer srv.Close()

	steps := []keyval.StepConfig{
		{Step: "models_fetch"},
		{Step: "chat_completion", Params: map[string]any{"model": "test"}},
	}

	results := keyval.Validate(context.Background(), keyval.ProviderInfo{
		Name:      "test",
		ModelsURL: srv.URL + "/models",
		BaseURL:   srv.URL,
		AuthType:  "bearer",
	}, "key", steps)

	if len(results) != 1 {
		t.Fatalf("expected 1 result (short-circuit), got %d", len(results))
	}
	if results[0].Success {
		t.Error("expected failure")
	}
}

func TestValidate_UnknownStep(t *testing.T) {
	results := keyval.Validate(context.Background(), keyval.ProviderInfo{
		Name: "test",
	}, "key", []keyval.StepConfig{{Step: "nonexistent"}})

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Success {
		t.Error("expected failure for unknown step")
	}
	if results[0].Error != "unknown step type: nonexistent" {
		t.Errorf("unexpected error: %s", results[0].Error)
	}
}
```

- [ ] **Step 3: Run tests**

Run: `go test ./internal/keyval/ -v`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add internal/keyval/
git commit -m "feat(keyval): add pipeline runner with step registry"
```

---

### Task 6: Database Schema Change

**Files:**
- Modify: `internal/store/sqlite.go`
- Modify: `internal/store/provider.go`

- [ ] **Step 1: Add `validation_steps` column to providers table**

In `internal/store/sqlite.go`, find the `migrate()` function's migration list. Add a new migration that adds the column. Find the pattern of existing `ALTER TABLE` migrations and add after the last one:

```go
`ALTER TABLE providers ADD COLUMN validation_steps TEXT NOT NULL DEFAULT ''`,
```

Also update the `CREATE TABLE IF NOT EXISTS providers` definition (around line 124-138) to include the new column:

```sql
validation_steps TEXT NOT NULL DEFAULT '',
```

- [ ] **Step 2: Update Provider struct and CRUD**

In `internal/store/provider.go`, add the field to the `Provider` struct:

```go
ValidationSteps string `json:"validation_steps"`
```

Add a `ParseValidationSteps` method:

```go
func (p Provider) ParseValidationSteps() []keyval.StepConfig {
	if p.ValidationSteps == "" {
		return nil
	}
	var steps []keyval.StepConfig
	if err := json.Unmarshal([]byte(p.ValidationSteps), &steps); err != nil {
		return nil
	}
	return steps
}
```

Note: to avoid a circular import (store → keyval), define the step config struct inline or use `[]map[string]any` and let the caller convert. The simplest approach is to use a raw JSON approach:

```go
func (p Provider) ParseValidationSteps() []struct {
	Step   string         `json:"step"`
	Params map[string]any `json:"params,omitempty"`
} {
	if p.ValidationSteps == "" {
		return nil
	}
	var steps []struct {
		Step   string         `json:"step"`
		Params map[string]any `json:"params,omitempty"`
	}
	if err := json.Unmarshal([]byte(p.ValidationSteps), &steps); err != nil {
		return nil
	}
	return steps
}
```

Then in the keyval callers, convert to `[]keyval.StepConfig`. Or better: add a `ToStepConfigs` helper in `keyval` that accepts `[]byte` JSON directly:

```go
// In keyval/step.go:
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
```

Update the provider `SELECT` queries, `INSERT`, and `UPDATE` statements in `provider.go` to include `validation_steps`. Also update `seedProviders` in `sqlite.go` to include the empty column value in the INSERT for each builtin provider.

- [ ] **Step 3: Verify build and run all tests**

Run: `go build ./... && go test ./...`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add internal/store/ internal/keyval/step.go
git commit -m "feat(store): add validation_steps column to providers table"
```

---

### Task 7: Migrate Proxy Handler

**Files:**
- Modify: `internal/proxy/handler.go`
- Modify: `internal/proxy/stream.go`

- [ ] **Step 1: Replace `setProviderAuth` with `keyval.SetAuth`**

In `internal/proxy/handler.go`, add the import:

```go
"github.com/darkraise/llm-proxy/internal/keyval"
```

Replace the `setProviderAuth` function (lines 706-723) with a thin wrapper that calls `keyval.SetAuth`:

```go
func setProviderAuth(httpReq *http.Request, prov *provider.AccountInfo) {
	keyval.SetAuth(httpReq, prov.AuthType, prov.AuthHeader, prov.DecryptedKey)
}
```

This preserves the existing call sites unchanged while delegating to the centralized implementation.

- [ ] **Step 2: Update `stream.go` import if needed**

If `stream.go` calls `setProviderAuth` directly (it's in the same package, so no import change needed — it calls the local function which now delegates to keyval). No changes needed in stream.go itself since `setProviderAuth` is still defined in handler.go.

- [ ] **Step 3: Run proxy tests and integration tests**

Run: `go test ./internal/proxy/ ./test/ -v`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add internal/proxy/handler.go
git commit -m "refactor(proxy): delegate setProviderAuth to keyval.SetAuth"
```

---

### Task 8: Migrate Scanner

**Files:**
- Modify: `internal/scanner/validate.go`

- [ ] **Step 1: Replace `ValidateKey` and `buildValidationRequest`**

Replace the entire file content of `internal/scanner/validate.go`:

```go
package scanner

import (
	"context"

	"github.com/darkraise/llm-proxy/internal/keyval"
	"github.com/darkraise/llm-proxy/internal/store"
)

func ValidateKey(db *store.DB, provider, key string) (bool, error) {
	prov, err := db.GetProvider(provider)
	if err != nil {
		return false, err
	}

	info := keyval.ProviderInfo{
		Name:        prov.Name,
		BaseURL:     prov.BaseURL,
		ModelsURL:   prov.ModelsURL,
		AuthType:    prov.AuthType,
		AuthHeader:  prov.AuthHeader,
		APIStandard: prov.APIStandard,
	}

	steps := keyval.ParseStepConfigs(prov.ValidationSteps)
	results := keyval.Validate(context.Background(), info, key, steps)

	if len(results) == 0 {
		return false, nil
	}
	return results[len(results)-1].Success, nil
}
```

This deletes `buildValidationRequest` entirely.

- [ ] **Step 2: Run tests**

Run: `go build ./... && go test ./...`
Expected: ALL PASS (scanner has no test files, but build must succeed and other tests must not regress)

- [ ] **Step 3: Commit**

```bash
git add internal/scanner/validate.go
git commit -m "refactor(scanner): use keyval.Validate for key validation"
```

---

### Task 9: Migrate Admin Handlers

**Files:**
- Modify: `internal/admin/handler.go`
- Modify: `internal/admin/keytest.go`
- Modify: `internal/admin/discover.go`
- Modify: `internal/admin/scanner_handler.go`

This is the largest migration task. Each handler becomes a thin wrapper that builds `ProviderInfo`, calls `keyval.Validate()`, and formats the response.

- [ ] **Step 1: Add a helper to build ProviderInfo from a stored provider**

Add to `internal/admin/handler.go` (or a new `internal/admin/helpers.go`):

```go
func (h *AdminHandler) providerInfo(providerType, accountBaseURL string) keyval.ProviderInfo {
	prov, err := h.db.GetProvider(providerType)
	if err != nil {
		return keyval.ProviderInfo{Name: providerType, AuthType: "bearer"}
	}
	baseURL := accountBaseURL
	if baseURL == "" {
		baseURL = prov.BaseURL
	}
	return keyval.ProviderInfo{
		Name:        prov.Name,
		BaseURL:     baseURL,
		ModelsURL:   prov.ModelsURL,
		AuthType:    prov.AuthType,
		AuthHeader:  prov.AuthHeader,
		APIStandard: prov.APIStandard,
	}
}

func (h *AdminHandler) decryptAccountKey(p store.Account) (string, error) {
	if h.encryptionKey != nil {
		plain, err := crypto.Decrypt(h.encryptionKey, p.APIKey)
		if err != nil {
			return "", err
		}
		return strings.TrimSpace(string(plain)), nil
	}
	return strings.TrimSpace(string(p.APIKey)), nil
}

func (h *AdminHandler) validationSteps(providerType string) []keyval.StepConfig {
	prov, err := h.db.GetProvider(providerType)
	if err != nil {
		return nil
	}
	return keyval.ParseStepConfigs(prov.ValidationSteps)
}
```

- [ ] **Step 2: Rewrite `HandleTestKey` in keytest.go**

```go
func (h *AdminHandler) HandleTestKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Provider string `json:"provider"`
		Key      string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request body"})
		return
	}
	if req.Provider == "" || req.Key == "" {
		writeJSON(w, 400, map[string]string{"error": "provider and key are required"})
		return
	}

	info := h.providerInfo(req.Provider, "")
	steps := h.validationSteps(req.Provider)
	results := keyval.Validate(r.Context(), info, req.Key, steps)

	// Build response matching the existing KeyTestResult format.
	last := results[len(results)-1]
	resp := map[string]any{
		"valid":       last.Success,
		"status_code": last.StatusCode,
	}
	if last.Error != "" {
		resp["error"] = last.Error
	}
	if last.Models != nil {
		resp["models"] = last.Models
	}
	if last.RateLimits != nil {
		resp["rate_limits"] = last.RateLimits
	}

	writeJSON(w, 200, resp)
}
```

- [ ] **Step 3: Rewrite `HandleChatTestKey` in keytest.go**

```go
func (h *AdminHandler) HandleChatTestKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Provider string `json:"provider"`
		Key      string `json:"key"`
		Model    string `json:"model"`
		Message  string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request body"})
		return
	}
	if req.Provider == "" || req.Key == "" || req.Model == "" {
		writeJSON(w, 400, map[string]string{"error": "provider, key, and model are required"})
		return
	}
	if req.Message == "" {
		req.Message = "say ok"
	}

	info := h.providerInfo(req.Provider, "")
	steps := []keyval.StepConfig{
		{Step: "chat_completion", Params: map[string]any{
			"model": req.Model, "message": req.Message, "max_tokens": float64(20),
		}},
	}

	results := keyval.Validate(r.Context(), info, req.Key, steps)
	last := results[len(results)-1]

	writeJSON(w, 200, map[string]any{
		"status_code": last.StatusCode,
		"response":    last.Response,
		"rate_limits": last.RateLimits,
		"error":       last.Error,
	})
}
```

- [ ] **Step 4: Rewrite `HandleTestAccount` in handler.go**

```go
func (h *AdminHandler) HandleTestAccount(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid id"})
		return
	}
	p, err := h.db.GetAccount(id)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "account not found"})
		return
	}
	apiKey, err := h.decryptAccountKey(p)
	if err != nil {
		writeJSON(w, 200, map[string]any{"success": false, "error": "failed to decrypt API key"})
		return
	}

	info := h.providerInfo(p.Type, p.BaseURL)
	results := keyval.Validate(r.Context(), info, apiKey, []keyval.StepConfig{{Step: "models_fetch"}})
	last := results[len(results)-1]

	if !last.Success {
		errMsg := last.Error
		if len(errMsg) > 500 {
			errMsg = errMsg[:500]
		}
		writeJSON(w, 200, map[string]any{"success": false, "status_code": last.StatusCode, "error": errMsg})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "status_code": last.StatusCode})
}
```

- [ ] **Step 5: Rewrite `HandleChatTestAccount` in handler.go**

```go
func (h *AdminHandler) HandleChatTestAccount(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid id"})
		return
	}
	var req struct {
		Model   string `json:"model"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request body"})
		return
	}
	if req.Model == "" {
		writeJSON(w, 400, map[string]string{"error": "model is required"})
		return
	}
	if req.Message == "" {
		req.Message = "say ok"
	}

	p, err := h.db.GetAccount(id)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "account not found"})
		return
	}
	apiKey, err := h.decryptAccountKey(p)
	if err != nil {
		writeJSON(w, 200, map[string]any{"error": "failed to decrypt API key"})
		return
	}

	info := h.providerInfo(p.Type, p.BaseURL)
	steps := []keyval.StepConfig{
		{Step: "chat_completion", Params: map[string]any{
			"model": req.Model, "message": req.Message, "max_tokens": float64(20),
		}},
	}

	results := keyval.Validate(r.Context(), info, apiKey, steps)
	last := results[len(results)-1]

	writeJSON(w, 200, map[string]any{
		"status_code": last.StatusCode,
		"response":    last.Response,
		"rate_limits": last.RateLimits,
	})
}
```

- [ ] **Step 6: Rewrite `HandleDiscoverByAccount` in discover.go**

```go
func (h *AdminHandler) HandleDiscoverByAccount(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid id"})
		return
	}
	account, err := h.db.GetAccount(id)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "account not found"})
		return
	}
	apiKey, err := h.decryptAccountKey(account)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "failed to decrypt API key"})
		return
	}

	info := h.providerInfo(account.Type, account.BaseURL)
	results := keyval.Validate(r.Context(), info, apiKey, []keyval.StepConfig{{Step: "models_fetch"}})
	last := results[len(results)-1]

	if !last.Success {
		writeJSON(w, 502, map[string]string{"error": last.Error})
		return
	}

	models := make([]map[string]string, len(last.Models))
	for i, m := range last.Models {
		models[i] = map[string]string{"id": m, "name": m}
	}
	writeJSON(w, 200, map[string]any{"models": models})
}
```

- [ ] **Step 7: Rewrite `HandleDiscoverModels` in discover.go**

Same pattern: build `ProviderInfo` from request body, call `keyval.Validate` with `[models_fetch]`, return models.

- [ ] **Step 8: Rewrite `HandleDiscoverByDiscoveredKey` in scanner_handler.go**

Same pattern: decrypt discovered key, build `ProviderInfo`, call `keyval.Validate` with `[models_fetch]`, return models.

- [ ] **Step 9: Remove orphaned functions from keytest.go**

Delete these functions that are now in keyval:
- `testProviderKey`
- `buildKeyTestRequest`
- `setChatTestAuth`
- `extractRateLimitHeaders`
- `parseRateLimitsFromHeaders`
- `parseErrorMessage`
- `parseOpenAIModelList`
- `parseGoogleModelList`
- `parseEngineList`
- `parseHuggingFaceUser`
- `parseCloudflareVerify`
- `parseReplicateModels`
- `parseAI21Models`

Keep only: `HandleTestKey`, `HandleChatTestKey`, `HandleGetAccountKey`, and any remaining helpers still needed.

- [ ] **Step 10: Remove `parseModelList` from discover.go**

Delete the `parseModelList` function (lines 17-70 of discover.go) since it's now in `keyval/parse.go`.

- [ ] **Step 11: Run full test suite**

Run: `go build ./... && go test ./...`
Expected: ALL PASS

- [ ] **Step 12: Commit**

```bash
git add internal/admin/ internal/keyval/
git commit -m "refactor(admin): migrate all handlers to use keyval pipeline"
```

---

### Task 10: Final Cleanup and Verification

**Files:**
- All modified files

- [ ] **Step 1: Verify no orphaned imports**

Run: `go build ./...`
Expected: Clean build with no unused import errors.

- [ ] **Step 2: Run full test suite**

Run: `go test ./...`
Expected: ALL PASS

- [ ] **Step 3: Verify frontend still compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No new errors (existing errors from other files are acceptable).

- [ ] **Step 4: Commit any final cleanup**

```bash
git add -A
git commit -m "chore: clean up unused imports and dead code after keyval migration"
```
