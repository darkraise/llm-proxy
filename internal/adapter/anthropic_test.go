package adapter

import (
	"encoding/json"
	"testing"
)

func TestAnthropicToOpenAI(t *testing.T) {
	raw := []byte(`{
		"model": "claude-3-sonnet",
		"max_tokens": 1024,
		"system": "You are helpful",
		"messages": [
			{"role": "user", "content": "Hello"},
			{"role": "assistant", "content": "Hi!"},
			{"role": "user", "content": "How are you?"}
		],
		"temperature": 0.7,
		"stream": false
	}`)

	req, err := AnthropicToOpenAI(raw)
	if err != nil {
		t.Fatalf("AnthropicToOpenAI: %v", err)
	}

	if req.Model != "claude-3-sonnet" {
		t.Errorf("model: %q", req.Model)
	}
	if len(req.Messages) != 4 {
		t.Fatalf("messages: got %d, want 4", len(req.Messages))
	}
	if req.Messages[0].Role != "system" {
		t.Errorf("first message role: %q", req.Messages[0].Role)
	}
	if req.Messages[0].Content != "You are helpful" {
		t.Errorf("system content: %v", req.Messages[0].Content)
	}
	if *req.MaxTokens != 1024 {
		t.Errorf("max_tokens: %d", *req.MaxTokens)
	}
}

func TestOpenAIToAnthropic(t *testing.T) {
	resp := ChatCompletionResponse{
		ID:    "chatcmpl-123",
		Model: "llama-3.3-70b",
		Choices: []Choice{{
			Index:        0,
			Message:      Message{Role: "assistant", Content: "Hello!"},
			FinishReason: "stop",
		}},
		Usage: Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15},
	}

	data, err := OpenAIToAnthropic(resp)
	if err != nil {
		t.Fatalf("OpenAIToAnthropic: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if result["type"] != "message" {
		t.Errorf("type: %v", result["type"])
	}
	if result["role"] != "assistant" {
		t.Errorf("role: %v", result["role"])
	}
	if result["stop_reason"] != "end_turn" {
		t.Errorf("stop_reason: %v", result["stop_reason"])
	}

	content := result["content"].([]any)
	if len(content) != 1 {
		t.Fatalf("content blocks: %d", len(content))
	}
	block := content[0].(map[string]any)
	if block["type"] != "text" {
		t.Errorf("block type: %v", block["type"])
	}
	if block["text"] != "Hello!" {
		t.Errorf("text: %v", block["text"])
	}

	usage := result["usage"].(map[string]any)
	if usage["input_tokens"] != float64(10) {
		t.Errorf("input_tokens: %v", usage["input_tokens"])
	}
}

func TestAnthropicFinishReasonMapping(t *testing.T) {
	tests := []struct {
		openai    string
		anthropic string
	}{
		{"stop", "end_turn"},
		{"length", "max_tokens"},
		{"content_filter", "end_turn"},
		{"tool_calls", "tool_use"},
	}

	for _, tt := range tests {
		got := openaiToAnthropicStopReason(tt.openai)
		if got != tt.anthropic {
			t.Errorf("map %q: got %q, want %q", tt.openai, got, tt.anthropic)
		}
	}
}
