package adapter

import (
	"encoding/json"
	"testing"
)

func TestParseOpenAIRequest(t *testing.T) {
	raw := `{
		"model": "auto",
		"messages": [
			{"role": "system", "content": "You are helpful"},
			{"role": "user", "content": "Hello"}
		],
		"temperature": 0.7,
		"stream": false
	}`

	req, err := ParseOpenAIRequest([]byte(raw))
	if err != nil {
		t.Fatalf("ParseOpenAIRequest: %v", err)
	}
	if req.Model != "auto" {
		t.Errorf("model: got %q", req.Model)
	}
	if len(req.Messages) != 2 {
		t.Errorf("messages: got %d", len(req.Messages))
	}
	if req.Stream {
		t.Error("stream should be false")
	}
}

func TestFormatOpenAIRequest(t *testing.T) {
	req := ChatCompletionRequest{
		Model:    "llama-3.3-70b",
		Messages: []Message{{Role: "user", Content: "Hi"}},
	}
	data, err := FormatOpenAIRequest(req)
	if err != nil {
		t.Fatalf("FormatOpenAIRequest: %v", err)
	}

	var parsed map[string]any
	json.Unmarshal(data, &parsed)
	if parsed["model"] != "llama-3.3-70b" {
		t.Errorf("model: got %v", parsed["model"])
	}
}

func TestParseOpenAIResponse(t *testing.T) {
	raw := `{
		"id": "chatcmpl-123",
		"object": "chat.completion",
		"created": 1700000000,
		"model": "llama-3.3-70b",
		"choices": [{"index": 0, "message": {"role": "assistant", "content": "Hello!"}, "finish_reason": "stop"}],
		"usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
	}`

	resp, err := ParseOpenAIResponse([]byte(raw))
	if err != nil {
		t.Fatalf("ParseOpenAIResponse: %v", err)
	}
	if resp.Choices[0].Message.Content != "Hello!" {
		t.Errorf("content: got %v", resp.Choices[0].Message.Content)
	}
	if resp.Usage.TotalTokens != 15 {
		t.Errorf("total_tokens: got %d", resp.Usage.TotalTokens)
	}
}
