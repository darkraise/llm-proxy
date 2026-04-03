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
