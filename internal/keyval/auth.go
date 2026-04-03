package keyval

import "net/http"

func SetAuth(req *http.Request, authType, authHeader, key string) {
	switch authType {
	case "api-key-header":
		header := authHeader
		if header == "" {
			header = "x-api-key"
		}
		req.Header.Set(header, key)
		if header == "x-api-key" {
			req.Header.Set("anthropic-version", "2023-06-01")
		}
	case "query-param":
		q := req.URL.Query()
		q.Set("key", key)
		req.URL.RawQuery = q.Encode()
	case "none":
	default:
		req.Header.Set("Authorization", "Bearer "+key)
	}
}
