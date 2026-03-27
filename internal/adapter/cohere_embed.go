package adapter

import (
	"encoding/json"
	"fmt"
)

// cohereEmbedRequest is the native Cohere POST /embed format.
type cohereEmbedRequest struct {
	Model           string   `json:"model"`
	Texts           []string `json:"texts"`
	InputType       string   `json:"input_type"`
	EmbeddingTypes  []string `json:"embedding_types"`
	OutputDimension *int     `json:"output_dimension,omitempty"`
}

// cohereEmbedResponse is the native Cohere embed response.
type cohereEmbedResponse struct {
	Embeddings struct {
		Float [][]float64 `json:"float"`
	} `json:"embeddings"`
	Meta struct {
		BilledUnits struct {
			InputTokens int `json:"input_tokens"`
		} `json:"billed_units"`
	} `json:"meta"`
}

// OpenAIToCohereEmbed converts an OpenAI embedding request to Cohere native format.
func OpenAIToCohereEmbed(req EmbeddingRequest) ([]byte, error) {
	// Normalize input to []string
	var texts []string
	switch v := req.Input.(type) {
	case string:
		texts = []string{v}
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok {
				texts = append(texts, s)
			}
		}
	case []string:
		texts = v
	default:
		return nil, fmt.Errorf("unsupported input type")
	}

	cr := cohereEmbedRequest{
		Model:          req.Model,
		Texts:          texts,
		InputType:      "search_document",
		EmbeddingTypes: []string{"float"},
	}
	if req.Dimensions != nil {
		cr.OutputDimension = req.Dimensions
	}

	return json.Marshal(cr)
}

// CohereEmbedToOpenAI converts a Cohere embed response to OpenAI format.
func CohereEmbedToOpenAI(data []byte, model string) (EmbeddingResponse, error) {
	var cr cohereEmbedResponse
	if err := json.Unmarshal(data, &cr); err != nil {
		return EmbeddingResponse{}, err
	}

	embeddings := make([]Embedding, len(cr.Embeddings.Float))
	for i, vec := range cr.Embeddings.Float {
		embeddings[i] = Embedding{
			Object:    "embedding",
			Index:     i,
			Embedding: vec,
		}
	}

	totalTokens := cr.Meta.BilledUnits.InputTokens

	return EmbeddingResponse{
		Object: "list",
		Data:   embeddings,
		Model:  model,
		Usage: Usage{
			PromptTokens: totalTokens,
			TotalTokens:  totalTokens,
		},
	}, nil
}
