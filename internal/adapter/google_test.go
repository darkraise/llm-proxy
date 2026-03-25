package adapter

import (
	"encoding/json"
	"testing"
)

func TestOpenAIToGoogle(t *testing.T) {
	req := ChatCompletionRequest{
		Model: "gemini-2.5-flash",
		Messages: []Message{
			{Role: "system", Content: "You are helpful"},
			{Role: "user", Content: "Hello"},
			{Role: "assistant", Content: "Hi there!"},
			{Role: "user", Content: "How are you?"},
		},
		Temperature: floatPtr(0.7),
		MaxTokens:   intPtr(1000),
	}

	url, body, err := OpenAIToGoogle(req, "test-api-key")
	if err != nil {
		t.Fatalf("OpenAIToGoogle: %v", err)
	}

	if url != "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test-api-key" {
		t.Errorf("url: %s", url)
	}

	var parsed map[string]any
	json.Unmarshal(body, &parsed)

	sysInstr, ok := parsed["systemInstruction"]
	if !ok {
		t.Fatal("missing systemInstruction")
	}
	parts := sysInstr.(map[string]any)["parts"].([]any)
	if parts[0].(map[string]any)["text"] != "You are helpful" {
		t.Error("system text mismatch")
	}

	contents := parsed["contents"].([]any)
	if len(contents) != 3 {
		t.Fatalf("contents: got %d, want 3", len(contents))
	}
	if contents[0].(map[string]any)["role"] != "user" {
		t.Error("first content should be user")
	}
	if contents[1].(map[string]any)["role"] != "model" {
		t.Error("second content should be model")
	}

	genCfg := parsed["generationConfig"].(map[string]any)
	if genCfg["temperature"] != 0.7 {
		t.Errorf("temperature: %v", genCfg["temperature"])
	}
	if genCfg["maxOutputTokens"] != float64(1000) {
		t.Errorf("maxOutputTokens: %v", genCfg["maxOutputTokens"])
	}
}

func TestGoogleToOpenAI(t *testing.T) {
	googleResp := []byte(`{
		"candidates": [{
			"content": {"parts": [{"text": "Hello!"}]},
			"finishReason": "STOP"
		}],
		"usageMetadata": {
			"promptTokenCount": 10,
			"candidatesTokenCount": 5,
			"totalTokenCount": 15
		}
	}`)

	resp, err := GoogleToOpenAI(googleResp, "gemini-2.5-flash")
	if err != nil {
		t.Fatalf("GoogleToOpenAI: %v", err)
	}

	if resp.Choices[0].Message.Content != "Hello!" {
		t.Errorf("content: got %v", resp.Choices[0].Message.Content)
	}
	if resp.Choices[0].FinishReason != "stop" {
		t.Errorf("finish_reason: got %q", resp.Choices[0].FinishReason)
	}
	if resp.Usage.TotalTokens != 15 {
		t.Errorf("total_tokens: got %d", resp.Usage.TotalTokens)
	}
}

func TestGoogleToOpenAI_SafetyBlock(t *testing.T) {
	googleResp := []byte(`{
		"candidates": [{
			"content": {"parts": [{"text": ""}]},
			"finishReason": "SAFETY"
		}]
	}`)

	resp, _ := GoogleToOpenAI(googleResp, "gemini-2.5-flash")
	if resp.Choices[0].FinishReason != "content_filter" {
		t.Errorf("finish_reason: got %q, want content_filter", resp.Choices[0].FinishReason)
	}
}

func floatPtr(f float64) *float64 { return &f }
func intPtr(i int) *int           { return &i }
