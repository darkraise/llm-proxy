package adapter

import "encoding/json"

func ParseOpenAIRequest(data []byte) (ChatCompletionRequest, error) {
	var req ChatCompletionRequest
	err := json.Unmarshal(data, &req)
	return req, err
}

func FormatOpenAIRequest(req ChatCompletionRequest) ([]byte, error) {
	return json.Marshal(req)
}

func ParseOpenAIResponse(data []byte) (ChatCompletionResponse, error) {
	var resp ChatCompletionResponse
	err := json.Unmarshal(data, &resp)
	return resp, err
}

func FormatOpenAIResponse(resp ChatCompletionResponse) ([]byte, error) {
	return json.Marshal(resp)
}

func ParseStreamChunk(data []byte) (StreamChunk, error) {
	var chunk StreamChunk
	err := json.Unmarshal(data, &chunk)
	return chunk, err
}
