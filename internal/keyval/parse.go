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
