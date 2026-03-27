package adapter

import "encoding/json"

type EmbeddingRequest struct {
	Model          string `json:"model"`
	Input          any    `json:"input"`                    // string or []string
	EncodingFormat string `json:"encoding_format,omitempty"`
	Dimensions     *int   `json:"dimensions,omitempty"`
}

type EmbeddingResponse struct {
	Object string      `json:"object"`
	Data   []Embedding `json:"data"`
	Model  string      `json:"model"`
	Usage  Usage       `json:"usage"`
}

type Embedding struct {
	Object    string    `json:"object"`
	Index     int       `json:"index"`
	Embedding []float64 `json:"embedding"`
}

func ParseEmbeddingRequest(data []byte) (EmbeddingRequest, error) {
	var req EmbeddingRequest
	err := json.Unmarshal(data, &req)
	return req, err
}

func FormatEmbeddingRequest(req EmbeddingRequest) ([]byte, error) {
	return json.Marshal(req)
}

func ParseEmbeddingResponse(data []byte) (EmbeddingResponse, error) {
	var resp EmbeddingResponse
	err := json.Unmarshal(data, &resp)
	return resp, err
}
