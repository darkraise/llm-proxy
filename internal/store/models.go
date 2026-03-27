package store

import "encoding/json"

const (
	CategoryChat      = "chat"
	CategoryEmbedding = "embedding"
)

// ParseCategorizedModels parses JSON like {"chat":["m1"],"embedding":["m2"]} into a map.
// Returns empty map on error.
func ParseCategorizedModels(raw string) map[string][]string {
	if raw == "" {
		return map[string][]string{}
	}
	var m map[string][]string
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return map[string][]string{}
	}
	if m == nil {
		return map[string][]string{}
	}
	return m
}

// FormatCategorizedModels serializes a categorized model map to JSON.
func FormatCategorizedModels(m map[string][]string) string {
	if m == nil {
		m = map[string][]string{}
	}
	data, _ := json.Marshal(m)
	return string(data)
}

// ParseDefaultModels parses JSON like {"chat":"m1","embedding":"m2"} into a map.
func ParseDefaultModels(raw string) map[string]string {
	if raw == "" {
		return map[string]string{}
	}
	var m map[string]string
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return map[string]string{}
	}
	if m == nil {
		return map[string]string{}
	}
	return m
}

// FormatDefaultModels serializes a default models map to JSON.
func FormatDefaultModels(m map[string]string) string {
	if m == nil {
		m = map[string]string{}
	}
	data, _ := json.Marshal(m)
	return string(data)
}

// AllModels flattens a categorized model map into a deduplicated slice.
func AllModels(m map[string][]string) []string {
	seen := map[string]bool{}
	var result []string
	for _, models := range m {
		for _, model := range models {
			if !seen[model] {
				seen[model] = true
				result = append(result, model)
			}
		}
	}
	return result
}

// ModelsForCategory returns models for a specific category.
func ModelsForCategory(m map[string][]string, cat string) []string {
	if models, ok := m[cat]; ok {
		return models
	}
	return nil
}
