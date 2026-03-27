package proxy

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/darkraise/llm-proxy/internal/adapter"
	"github.com/darkraise/llm-proxy/internal/provider"
	"github.com/darkraise/llm-proxy/internal/ratelimit"
	"github.com/darkraise/llm-proxy/internal/store"
)

func (h *Handler) handleStreaming(w http.ResponseWriter, r *http.Request, req adapter.ChatCompletionRequest, endpoint string, category string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, 500, "streaming not supported")
		return
	}

	req.Stream = true
	logEntry := store.RequestLog{Model: req.Model, Endpoint: endpoint, Status: "error"}

	for attempt := 0; attempt < h.maxRetries; attempt++ {
		prov, err := h.pool.Select(req.Model, category, h.maxRetries)
		if err != nil {
			break
		}

		logEntry.AccountName = prov.Name
		logEntry.AccountID = &prov.ID
		logEntry.ProviderType = prov.Type
		logEntry.Model = firstModel(prov, req.Model, category)
		t0 := time.Now()

		var streamResp *http.Response
		switch prov.Type {
		case "google":
			streamResp, err = h.openGoogleStream(prov, req)
		default:
			streamResp, err = h.openOpenAIStream(prov, req)
		}

		if err != nil {
			slog.Warn("stream connect error", "provider", prov.Name, "error", err)
			h.pool.RecordError(prov.Name, 15*time.Second)
			continue
		}

		if streamResp.StatusCode == 429 {
			streamResp.Body.Close()
			h.pool.RecordRateLimit(prov.Name, 60*time.Second)
			continue
		}

		if streamResp.StatusCode >= 400 {
			streamResp.Body.Close()
			h.pool.RecordError(prov.Name, 10*time.Second)
			continue
		}

		// Connected — parse rate limit headers before consuming the body.
		if h.rateLimitChan != nil {
			model := firstModel(prov, req.Model, category)
			if defs := ratelimit.ParseRateLimitHeaders(prov.Type, streamResp.Header, model); len(defs) > 0 {
				select {
				case h.rateLimitChan <- RateLimitUpdate{Provider: prov.Type, Model: model, Defs: defs}:
				default:
					slog.Warn("rate limit chan full, dropping header update")
				}
			}
		}

		// Stream to client
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		var totalTokens int
		if prov.Type == "google" {
			totalTokens = h.pipeGoogleStream(w, flusher, streamResp.Body, prov, endpoint)
		} else {
			totalTokens = h.pipeOpenAIStream(w, flusher, streamResp.Body, endpoint)
		}
		streamResp.Body.Close()

		latency := time.Since(t0)
		logEntry.LatencyMs = int(latency.Milliseconds())
		logEntry.Status = "success"
		logEntry.StatusCode = 200
		logEntry.CompletionTokens = totalTokens
		h.pool.RecordSuccess(prov.Name, totalTokens)

		if h.logFunc != nil {
			h.logFunc(logEntry)
		}
		return
	}

	// All providers exhausted
	logEntry.Status = "error"
	logEntry.ErrorMessage = "all providers exhausted"
	if h.logFunc != nil {
		h.logFunc(logEntry)
	}
	writeError(w, 503, "all providers exhausted")
}

func (h *Handler) openOpenAIStream(prov *provider.AccountInfo, req adapter.ChatCompletionRequest) (*http.Response, error) {
	req.Model = firstModel(prov, req.Model, store.CategoryChat)
	data, err := adapter.FormatOpenAIRequest(req)
	if err != nil {
		return nil, err
	}

	baseURL := resolveBaseURL(prov)
	httpReq, err := http.NewRequest("POST", baseURL+"/chat/completions", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+prov.DecryptedKey)

	return h.client.Do(httpReq)
}

func (h *Handler) openGoogleStream(prov *provider.AccountInfo, req adapter.ChatCompletionRequest) (*http.Response, error) {
	req.Model = firstModel(prov, req.Model, store.CategoryChat)
	url := adapter.GoogleStreamURL(req.Model, prov.DecryptedKey)

	_, body, err := adapter.OpenAIToGoogle(req, prov.DecryptedKey)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	return h.client.Do(httpReq)
}

func (h *Handler) pipeOpenAIStream(w http.ResponseWriter, flusher http.Flusher, body io.Reader, endpoint string) int {
	scanner := bufio.NewScanner(body)
	var totalTokens int

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			if endpoint == "anthropic" {
				writeAnthropicStreamEnd(w, flusher)
			} else {
				fmt.Fprintf(w, "data: [DONE]\n\n")
				flusher.Flush()
			}
			break
		}

		if endpoint == "anthropic" {
			writeAnthropicChunk(w, flusher, []byte(data))
		} else {
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}

		// Extract token count from final chunk if available
		var chunk adapter.StreamChunk
		if json.Unmarshal([]byte(data), &chunk) == nil && chunk.Usage != nil {
			totalTokens = chunk.Usage.TotalTokens
		}
	}
	return totalTokens
}

func (h *Handler) pipeGoogleStream(w http.ResponseWriter, flusher http.Flusher, body io.Reader, prov *provider.AccountInfo, endpoint string) int {
	scanner := bufio.NewScanner(body)
	var totalTokens int
	chunkIdx := 0

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")

		// Parse Google chunk and convert to OpenAI format
		var googleChunk map[string]any
		if err := json.Unmarshal([]byte(data), &googleChunk); err != nil {
			continue
		}

		// Extract text from Google format
		candidates, _ := googleChunk["candidates"].([]any)
		if len(candidates) == 0 {
			continue
		}
		candidate := candidates[0].(map[string]any)
		content, _ := candidate["content"].(map[string]any)
		parts, _ := content["parts"].([]any)

		text := ""
		for _, p := range parts {
			part := p.(map[string]any)
			if t, ok := part["text"].(string); ok {
				text += t
			}
		}

		// Build OpenAI SSE chunk
		openaiChunk := adapter.StreamChunk{
			ID:      fmt.Sprintf("chatcmpl-google-%d", time.Now().UnixMilli()),
			Object:  "chat.completion.chunk",
			Created: time.Now().Unix(),
			Model:   firstModel(prov, "", store.CategoryChat),
			Choices: []adapter.StreamDelta{{
				Index: 0,
				Delta: adapter.Delta{Content: text},
			}},
		}

		if chunkIdx == 0 {
			openaiChunk.Choices[0].Delta.Role = "assistant"
		}

		// Check for finish reason
		if fr, ok := candidate["finishReason"].(string); ok && fr != "" {
			reason := "stop"
			switch fr {
			case "MAX_TOKENS":
				reason = "length"
			}
			openaiChunk.Choices[0].FinishReason = &reason
		}

		// Extract usage
		if usage, ok := googleChunk["usageMetadata"].(map[string]any); ok {
			pt, _ := usage["promptTokenCount"].(float64)
			ct, _ := usage["candidatesTokenCount"].(float64)
			tt, _ := usage["totalTokenCount"].(float64)
			openaiChunk.Usage = &adapter.Usage{
				PromptTokens: int(pt), CompletionTokens: int(ct), TotalTokens: int(tt),
			}
			totalTokens = int(tt)
		}

		chunkData, _ := json.Marshal(openaiChunk)

		if endpoint == "anthropic" {
			writeAnthropicChunk(w, flusher, chunkData)
		} else {
			fmt.Fprintf(w, "data: %s\n\n", chunkData)
			flusher.Flush()
		}

		chunkIdx++
	}

	if endpoint == "anthropic" {
		writeAnthropicStreamEnd(w, flusher)
	} else {
		fmt.Fprintf(w, "data: [DONE]\n\n")
		flusher.Flush()
	}

	return totalTokens
}

// Anthropic streaming helpers
func writeAnthropicChunk(w http.ResponseWriter, flusher http.Flusher, openaiChunkData []byte) {
	var chunk adapter.StreamChunk
	if err := json.Unmarshal(openaiChunkData, &chunk); err != nil {
		return
	}

	if len(chunk.Choices) == 0 {
		return
	}

	delta := chunk.Choices[0].Delta

	// Role delta → message_start
	if delta.Role == "assistant" {
		event := map[string]any{
			"type": "message_start",
			"message": map[string]any{
				"id": chunk.ID, "type": "message", "role": "assistant",
				"content": []any{}, "model": chunk.Model,
				"usage": map[string]any{"input_tokens": 0, "output_tokens": 0},
			},
		}
		data, _ := json.Marshal(event)
		fmt.Fprintf(w, "event: message_start\ndata: %s\n\n", data)
		flusher.Flush()

		// content_block_start
		blockStart := map[string]any{
			"type":          "content_block_start",
			"index":         0,
			"content_block": map[string]any{"type": "text", "text": ""},
		}
		data, _ = json.Marshal(blockStart)
		fmt.Fprintf(w, "event: content_block_start\ndata: %s\n\n", data)
		flusher.Flush()
	}

	// Content delta
	if delta.Content != "" {
		blockDelta := map[string]any{
			"type":  "content_block_delta",
			"index": 0,
			"delta": map[string]any{"type": "text_delta", "text": delta.Content},
		}
		data, _ := json.Marshal(blockDelta)
		fmt.Fprintf(w, "event: content_block_delta\ndata: %s\n\n", data)
		flusher.Flush()
	}
}

func writeAnthropicStreamEnd(w http.ResponseWriter, flusher http.Flusher) {
	blockStop := map[string]any{"type": "content_block_stop", "index": 0}
	data, _ := json.Marshal(blockStop)
	fmt.Fprintf(w, "event: content_block_stop\ndata: %s\n\n", data)
	flusher.Flush()

	msgDelta := map[string]any{
		"type":  "message_delta",
		"delta": map[string]any{"stop_reason": "end_turn"},
		"usage": map[string]any{"output_tokens": 0},
	}
	data, _ = json.Marshal(msgDelta)
	fmt.Fprintf(w, "event: message_delta\ndata: %s\n\n", data)
	flusher.Flush()

	msgStop := map[string]any{"type": "message_stop"}
	data, _ = json.Marshal(msgStop)
	fmt.Fprintf(w, "event: message_stop\ndata: %s\n\n", data)
	flusher.Flush()
}
