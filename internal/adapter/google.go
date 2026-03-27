package adapter

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const googleBaseURL = "https://generativelanguage.googleapis.com/v1beta"

type googleRequest struct {
	Contents          []googleContent  `json:"contents"`
	SystemInstruction *googleSystem    `json:"systemInstruction,omitempty"`
	GenerationConfig  *googleGenConfig `json:"generationConfig,omitempty"`
}

type googleContent struct {
	Role  string       `json:"role"`
	Parts []googlePart `json:"parts"`
}

type googleSystem struct {
	Parts []googlePart `json:"parts"`
}

type googlePart struct {
	Text string `json:"text"`
}

type googleGenConfig struct {
	Temperature     *float64 `json:"temperature,omitempty"`
	MaxOutputTokens *int     `json:"maxOutputTokens,omitempty"`
	TopP            *float64 `json:"topP,omitempty"`
}

type googleResponse struct {
	Candidates    []googleCandidate `json:"candidates"`
	UsageMetadata googleUsage       `json:"usageMetadata"`
}

type googleCandidate struct {
	Content      googleContent `json:"content"`
	FinishReason string        `json:"finishReason"`
}

type googleUsage struct {
	PromptTokenCount     int `json:"promptTokenCount"`
	CandidatesTokenCount int `json:"candidatesTokenCount"`
	TotalTokenCount      int `json:"totalTokenCount"`
}

func OpenAIToGoogle(req ChatCompletionRequest, apiKey string) (string, []byte, error) {
	gr := googleRequest{}

	var systemParts []googlePart
	for _, msg := range req.Messages {
		role := msg.Role
		text := contentToString(msg.Content)

		switch role {
		case "system":
			systemParts = append(systemParts, googlePart{Text: text})
		case "user":
			gr.Contents = append(gr.Contents, googleContent{Role: "user", Parts: []googlePart{{Text: text}}})
		case "assistant":
			gr.Contents = append(gr.Contents, googleContent{Role: "model", Parts: []googlePart{{Text: text}}})
		}
	}

	if len(systemParts) > 0 {
		gr.SystemInstruction = &googleSystem{Parts: systemParts}
	}

	genCfg := &googleGenConfig{}
	hasGenCfg := false
	if req.Temperature != nil {
		genCfg.Temperature = req.Temperature
		hasGenCfg = true
	}
	if req.MaxTokens != nil {
		genCfg.MaxOutputTokens = req.MaxTokens
		hasGenCfg = true
	}
	if req.TopP != nil {
		genCfg.TopP = req.TopP
		hasGenCfg = true
	}
	if hasGenCfg {
		gr.GenerationConfig = genCfg
	}

	body, err := json.Marshal(gr)
	if err != nil {
		return "", nil, err
	}

	modelName := strings.TrimPrefix(req.Model, "models/")
	url := fmt.Sprintf("%s/models/%s:generateContent?key=%s", googleBaseURL, modelName, apiKey)
	return url, body, nil
}

func GoogleStreamURL(model, apiKey string) string {
	modelName := strings.TrimPrefix(model, "models/")
	return fmt.Sprintf("%s/models/%s:streamGenerateContent?alt=sse&key=%s", googleBaseURL, modelName, apiKey)
}

func GoogleToOpenAI(data []byte, model string) (ChatCompletionResponse, error) {
	var gr googleResponse
	if err := json.Unmarshal(data, &gr); err != nil {
		return ChatCompletionResponse{}, err
	}

	content := ""
	finishReason := "stop"

	if len(gr.Candidates) > 0 {
		c := gr.Candidates[0]
		for _, p := range c.Content.Parts {
			content += p.Text
		}
		finishReason = mapGoogleFinishReason(c.FinishReason)
	}

	return ChatCompletionResponse{
		ID:      fmt.Sprintf("chatcmpl-google-%d", time.Now().UnixMilli()),
		Object:  "chat.completion",
		Created: time.Now().Unix(),
		Model:   model,
		Choices: []Choice{{
			Index:        0,
			Message:      Message{Role: "assistant", Content: content},
			FinishReason: finishReason,
		}},
		Usage: Usage{
			PromptTokens:     gr.UsageMetadata.PromptTokenCount,
			CompletionTokens: gr.UsageMetadata.CandidatesTokenCount,
			TotalTokens:      gr.UsageMetadata.TotalTokenCount,
		},
	}, nil
}

func mapGoogleFinishReason(reason string) string {
	switch reason {
	case "STOP":
		return "stop"
	case "MAX_TOKENS":
		return "length"
	case "SAFETY", "RECITATION":
		return "content_filter"
	default:
		return "stop"
	}
}

func contentToString(content any) string {
	switch v := content.(type) {
	case string:
		return v
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}
