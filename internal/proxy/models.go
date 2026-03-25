package proxy

import (
	"encoding/json"
	"net/http"
)

func (h *Handler) HandleListModels(w http.ResponseWriter, r *http.Request) {
	models := h.pool.ListModels()

	data := make([]map[string]any, len(models))
	for i, m := range models {
		data[i] = map[string]any{
			"id": m, "object": "model", "created": 0, "owned_by": "llm-proxy",
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"object": "list",
		"data":   data,
	})
}
