package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/darkraise/llm-proxy/internal/provider"
	"github.com/darkraise/llm-proxy/internal/store"
)

func setupTestAdmin(t *testing.T) (*AdminHandler, *http.Cookie) {
	t.Helper()
	db := newTestStore(t)
	auth := NewAuth(db, "admin123")
	pool := provider.NewPool(nil)
	h := NewAdminHandler(db, auth, pool, nil)

	// Login to get session cookie
	loginReq := httptest.NewRequest("POST", "/admin/api/auth/login", strings.NewReader(`{"password":"admin123"}`))
	loginW := httptest.NewRecorder()
	auth.HandleLogin(loginW, loginReq)

	var cookie *http.Cookie
	for _, c := range loginW.Result().Cookies() {
		if c.Name == "session" {
			cookie = c
		}
	}
	return h, cookie
}

func TestAdminHandler_ProviderCRUD(t *testing.T) {
	h, cookie := setupTestAdmin(t)

	// Create
	createBody := `{"name":"groq","type":"groq","base_url":"https://api.groq.com","api_key":"gsk_test","models":["llama-3.3-70b"],"limits":[{"metric":"rpm","max_value":30,"window_secs":60}]}`
	req := httptest.NewRequest("POST", "/admin/api/providers", strings.NewReader(createBody))
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	h.HandleCreateProvider(w, req)

	if w.Code != 201 {
		t.Fatalf("create status: %d, body: %s", w.Code, w.Body.String())
	}

	var created map[string]any
	json.Unmarshal(w.Body.Bytes(), &created)
	id := created["id"].(float64)

	// List
	req = httptest.NewRequest("GET", "/admin/api/providers", nil)
	req.AddCookie(cookie)
	w = httptest.NewRecorder()
	h.HandleListProviders(w, req)

	if w.Code != 200 {
		t.Fatalf("list status: %d", w.Code)
	}

	var providers []map[string]any
	json.Unmarshal(w.Body.Bytes(), &providers)
	if len(providers) != 1 {
		t.Fatalf("providers: got %d", len(providers))
	}
	if providers[0]["name"] != "groq" {
		t.Errorf("name: %v", providers[0]["name"])
	}

	// Update
	updateBody := `{"name":"groq-updated","type":"groq","base_url":"https://api.groq.com","api_key":"gsk_new","models":["llama-3.3-70b"],"limits":[]}`
	req = httptest.NewRequest("PUT", "/admin/api/providers/1", strings.NewReader(updateBody))
	req.AddCookie(cookie)
	req.SetPathValue("id", "1")
	w = httptest.NewRecorder()
	h.HandleUpdateProvider(w, req)

	if w.Code != 200 {
		t.Fatalf("update status: %d, body: %s", w.Code, w.Body.String())
	}

	// Delete
	req = httptest.NewRequest("DELETE", "/admin/api/providers/1", nil)
	req.AddCookie(cookie)
	req.SetPathValue("id", "1")
	w = httptest.NewRecorder()
	h.HandleDeleteProvider(w, req)

	if w.Code != 200 {
		t.Fatalf("delete status: %d", w.Code)
	}

	_ = id // used for verification
}

func TestAdminHandler_StatsOverview(t *testing.T) {
	h, cookie := setupTestAdmin(t)

	// Insert a log entry
	h.db.InsertRequestLog(store.RequestLog{
		ProviderName: "groq", Model: "m", Endpoint: "openai", Status: "success",
		LatencyMs: 100, PromptTokens: 50, CompletionTokens: 100,
	})

	req := httptest.NewRequest("GET", "/admin/api/stats/overview", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	h.HandleStatsOverview(w, req)

	if w.Code != 200 {
		t.Fatalf("status: %d", w.Code)
	}

	var stats map[string]any
	json.Unmarshal(w.Body.Bytes(), &stats)
	if stats["total_requests"] != float64(1) {
		t.Errorf("total_requests: %v", stats["total_requests"])
	}
}
