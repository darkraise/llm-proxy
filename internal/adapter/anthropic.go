package adapter

import (
	"encoding/json"
	"fmt"
	"time"
)

type anthropicRequest struct {
	Model       string    `json:"model"`
	MaxTokens   int       `json:"max_tokens"`
	System      string    `json:"system,omitempty"`
	Messages    []Message `json:"messages"`
	Temperature *float64  `json:"temperature,omitempty"`
	TopP        *float64  `json:"top_p,omitempty"`
	Stream      bool      `json:"stream,omitempty"`
	Tools       any       `json:"tools,omitempty"`
	ToolChoice  any       `json:"tool_choice,omitempty"`
}

type anthropicResponse struct {
	ID           string             `json:"id"`
	Type         string             `json:"type"`
	Role         string             `json:"role"`
	Content      []anthropicContent `json:"content"`
	Model        string             `json:"model"`
	StopReason   string             `json:"stop_reason"`
	StopSequence *string            `json:"stop_sequence"`
	Usage        anthropicUsage     `json:"usage"`
}

type anthropicContent struct {
	Type  string `json:"type"`
	Text  string `json:"text,omitempty"`
	ID    string `json:"id,omitempty"`
	Name  string `json:"name,omitempty"`
	Input any    `json:"input,omitempty"`
}

type anthropicUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

func AnthropicToOpenAI(data []byte) (ChatCompletionRequest, error) {
	var ar anthropicRequest
	if err := json.Unmarshal(data, &ar); err != nil {
		return ChatCompletionRequest{}, fmt.Errorf("parse anthropic request: %w", err)
	}

	var messages []Message
	if ar.System != "" {
		messages = append(messages, Message{Role: "system", Content: ar.System})
	}
	messages = append(messages, ar.Messages...)

	maxTokens := ar.MaxTokens
	req := ChatCompletionRequest{
		Model:       ar.Model,
		Messages:    messages,
		Stream:      ar.Stream,
		Temperature: ar.Temperature,
		MaxTokens:   &maxTokens,
		TopP:        ar.TopP,
		Tools:       ar.Tools,
		ToolChoice:  ar.ToolChoice,
	}

	return req, nil
}

func OpenAIToAnthropic(resp ChatCompletionResponse) ([]byte, error) {
	var content []anthropicContent
	stopReason := "end_turn"

	if len(resp.Choices) > 0 {
		choice := resp.Choices[0]
		text := contentToString(choice.Message.Content)
		if text != "" {
			content = append(content, anthropicContent{Type: "text", Text: text})
		}
		stopReason = openaiToAnthropicStopReason(choice.FinishReason)
	}

	ar := anthropicResponse{
		ID:         fmt.Sprintf("msg_%d", time.Now().UnixMilli()),
		Type:       "message",
		Role:       "assistant",
		Content:    content,
		Model:      resp.Model,
		StopReason: stopReason,
		Usage: anthropicUsage{
			InputTokens:  resp.Usage.PromptTokens,
			OutputTokens: resp.Usage.CompletionTokens,
		},
	}

	return json.Marshal(ar)
}

func openaiToAnthropicStopReason(reason string) string {
	switch reason {
	case "stop":
		return "end_turn"
	case "length":
		return "max_tokens"
	case "tool_calls":
		return "tool_use"
	default:
		return "end_turn"
	}
}
