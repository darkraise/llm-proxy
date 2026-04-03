# Centralized Key Validation Pipeline

**Date:** 2026-04-03
**Status:** Approved

## Problem

Key validation logic is scattered across four packages with identical auth code duplicated four times. Provider-specific handling (Google URLs, Anthropic headers) is hardcoded in multiple places, leading to bugs when one is updated but others aren't. There is no way to customize the validation process per provider or add additional validation steps.

## Decisions

- **Multi-step pipeline with per-provider configuration** — validation runs as an ordered sequence of steps, short-circuiting on failure.
- **Hybrid config** — step types are defined in code (models_fetch, chat_completion), but which steps run and their parameters are stored per provider in the database.
- **New `internal/keyval` package** — a dedicated package that admin handlers, scanner, and proxy all import from.
- **Step interface with registry** — each step type implements a `Step` interface, looked up from a registry by name.
- **Default pipeline: models_fetch only** — chat_completion is available but opt-in per provider, avoiding unexpected token consumption.
- **`validation_steps` column on providers table** — JSON array of step configs, empty means use default.

## Package Structure

New package: `internal/keyval`

| File | Responsibility |
|---|---|
| `auth.go` | `SetAuth(req, authType, authHeader, key)` — single auth implementation replacing four duplicates |
| `step.go` | `Step` interface, `StepConfig` type, `StepResult` type, `ProviderInfo` struct |
| `pipeline.go` | `Validate()` entry point — loads steps from config, executes in order, returns results |
| `models_fetch.go` | `ModelsFetchStep` — GET models endpoint, parse response, extract rate limits |
| `chat_completion.go` | `ChatCompletionStep` — POST chat completion with configurable model/message |
| `parse.go` | Model list parsing (OpenAI, Google, Replicate, AI21, etc.) — moved from discover.go and keytest.go |

## Core Types

```go
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

type ProviderInfo struct {
    Name        string
    BaseURL     string
    ModelsURL   string
    AuthType    string
    AuthHeader  string
    APIStandard string
}
```

`ProviderInfo` is a lightweight view that avoids a dependency on `store.Provider`.

## Pipeline Runner

```go
func Validate(ctx context.Context, provider ProviderInfo, key string, steps []StepConfig) []StepResult
```

- If `steps` is empty/nil, use default: `[{"step":"models_fetch"}]`
- Executes steps in order, short-circuiting on first failure
- Shared `http.Client` with 15-second timeout
- Returns full list of `StepResult` (failed step + skipped remainder)
- `prior []StepResult` parameter on `Step.Run()` lets later steps reference earlier results (e.g., chat_completion picks first model from models_fetch)

Step registry:

```go
var registry = map[string]func(StepConfig) Step{
    "models_fetch":    newModelsFetchStep,
    "chat_completion": newChatCompletionStep,
}
```

Factory functions read step-specific parameters from `StepConfig.Params`:
- `models_fetch`: no parameters needed
- `chat_completion`: `model` (default: first model from prior step), `message` (default: "say ok"), `max_tokens` (default: 5)

## Auth Consolidation

`keyval.SetAuth()` replaces these four identical implementations:

| Function | Location | Action |
|---|---|---|
| `buildKeyTestRequest()` | admin/keytest.go | Delete |
| `setChatTestAuth()` | admin/keytest.go | Delete |
| `buildValidationRequest()` | scanner/validate.go | Delete |
| `setProviderAuth()` | proxy/handler.go | Replace with `keyval.SetAuth()` |

The function handles all auth types: bearer (default), api-key-header (with Anthropic version header), query-param, and none.

## Caller Migration

**Admin handlers** become thin wrappers:
- `HandleTestKey` → `keyval.Validate()` with `[models_fetch]`
- `HandleChatTestKey` → `keyval.Validate()` with `[chat_completion]`
- `HandleTestAccount` → decrypt key, build `ProviderInfo`, `keyval.Validate()` with `[models_fetch]`
- `HandleChatTestAccount` → decrypt key, build `ProviderInfo`, `keyval.Validate()` with `[chat_completion]`
- `HandleDiscoverByAccount` → `keyval.Validate()` with `[models_fetch]`, return models from result
- `HandleDiscoverModels` → same pattern with raw key
- `HandleDiscoverByDiscoveredKey` → same pattern, decrypt discovered key first

**Scanner** — `scanner.ValidateKey()` becomes a thin wrapper around `keyval.Validate()`. The `buildValidationRequest()` in scanner/validate.go is deleted.

**Proxy handler** — `setProviderAuth()` replaced by `keyval.SetAuth()`. All call sites (`callOpenAI`, `callGoogle`, `openOpenAIStream`, `callOpenAIEmbedding`, `callCohereEmbedding`) updated.

**Model parsing** — `parseModelList()` and all provider-specific parsers (`parseOpenAIModelList`, `parseGoogleModelList`, `parseEngineList`, `parseHuggingFaceUser`, `parseCloudflareVerify`, `parseReplicateModels`, `parseAI21Models`) move to `keyval/parse.go`.

**Excluded:** `HandleDiscoverOllama` stays separate (different protocol: `/api/tags`, no auth, Ollama-specific format).

## Database Schema Change

Add `validation_steps` TEXT column to `providers` table:

```sql
ALTER TABLE providers ADD COLUMN validation_steps TEXT NOT NULL DEFAULT ''
```

`store.Provider` gains:

```go
ValidationSteps string `json:"validation_steps"`
```

Helper method `ParseValidationSteps() []keyval.StepConfig` parses the JSON, returning nil for empty/invalid (triggering the default pipeline).

Built-in providers are seeded with empty `validation_steps`. Example custom configs:

```json
// Both steps (test models + chat):
[{"step":"models_fetch"},{"step":"chat_completion","params":{"max_tokens":5}}]

// Test specific model:
[{"step":"models_fetch"},{"step":"chat_completion","params":{"model":"llama-3.3-70b"}}]

// Default (models_fetch only) — no need to set:
[]
```

## Testing

**Unit tests for `keyval` package:**
- `auth_test.go` — `SetAuth` sets correct headers for each auth type
- `parse_test.go` — model list parsing for all provider formats
- `pipeline_test.go` — step ordering, short-circuit, defaults, prior result passing
- `models_fetch_test.go` — against `httptest.NewServer` with different provider formats
- `chat_completion_test.go` — against `httptest.NewServer`, auto model selection

**Regression:** Existing tests in admin, proxy, and integration packages continue to pass since behavior is unchanged, only the implementation location moves.
