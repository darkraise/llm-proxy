package ratelimit

import (
	"net/http"
	"strconv"

	"github.com/darkraise/llm-proxy/internal/store"
)

// HeaderMapping describes how a single HTTP response header maps to a rate
// limit definition.
type HeaderMapping struct {
	Header     string
	Metric     string
	WindowSecs int
}

// ProviderHeaderMappings lists the response headers that carry rate limit
// capacity values, keyed by provider type.
var ProviderHeaderMappings = map[string][]HeaderMapping{
	"openai": {
		{"x-ratelimit-limit-requests", "rpm", 60},
		{"x-ratelimit-limit-tokens", "tpm", 60},
	},
	"openai_legacy": {
		{"x-ratelimit-limit-requests", "rpm", 60},
		{"x-ratelimit-limit-tokens", "tpm", 60},
	},
	"anthropic": {
		{"anthropic-ratelimit-requests-limit", "rpm", 60},
		{"anthropic-ratelimit-tokens-limit", "tpm", 60},
	},
	"groq": {
		{"x-ratelimit-limit-requests", "rpd", 86400},
		{"x-ratelimit-limit-tokens", "tpm", 60},
	},
	"cerebras": {
		{"x-ratelimit-limit-requests-day", "rpd", 86400},
		{"x-ratelimit-limit-tokens-minute", "tpm", 60},
	},
	"xai": {
		{"x-ratelimit-limit-requests", "rpd", 86400},
		{"x-ratelimit-limit-tokens", "tpm", 60},
	},
	"together": {
		{"x-ratelimit-limit", "rps", 1},
		{"x-tokenlimit-limit", "tps", 1},
	},
	"fireworks": {
		{"x-ratelimit-limit-requests", "rpm", 60},
	},
	"deepseek": {
		{"x-ratelimit-limit-requests", "rpm", 60},
	},
	"openrouter": {
		{"x-ratelimit-limit-requests", "rpm", 60},
	},
}

var genericFallbackMappings = []HeaderMapping{
	{"x-ratelimit-limit-requests", "rpm", 60},
	{"x-ratelimit-limit-tokens", "tpm", 60},
}

// ParseRateLimitHeaders inspects the provider response headers and returns
// any rate limit definitions that can be extracted. Providers without an
// explicit mapping fall back to the standard OpenAI-compatible headers.
func ParseRateLimitHeaders(providerType string, headers http.Header, model string) []store.RateLimitDef {
	mappings, ok := ProviderHeaderMappings[providerType]
	if !ok {
		mappings = genericFallbackMappings
	}

	var defs []store.RateLimitDef
	for _, m := range mappings {
		raw := headers.Get(m.Header)
		if raw == "" {
			continue
		}
		val, err := strconv.Atoi(raw)
		if err != nil || val <= 0 {
			continue
		}
		defs = append(defs, store.RateLimitDef{
			Provider:   providerType,
			Model:      model,
			Metric:     m.Metric,
			MaxValue:   val,
			WindowSecs: m.WindowSecs,
		})
	}
	return defs
}
