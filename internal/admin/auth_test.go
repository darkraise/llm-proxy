package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/darkraise/llm-proxy/internal/crypto"

	"github.com/darkraise/llm-proxy/internal/store"
)

func newTestStore(t *testing.T) *store.DB {
	t.Helper()
	db, err := store.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func seedPassword(t *testing.T, db *store.DB, password string) {
	t.Helper()
	hash, err := crypto.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	db.SetSetting("admin_password_hash", hash)
}

func TestAuth_LoginLogout(t *testing.T) {
	db := newTestStore(t)
	seedPassword(t, db, "admin123")
	auth := NewAuth(db)

	// Login with correct password
	body := `{"password":"admin123"}`
	req := httptest.NewRequest("POST", "/admin/api/auth/login", strings.NewReader(body))
	w := httptest.NewRecorder()
	auth.HandleLogin(w, req)

	if w.Code != 200 {
		t.Fatalf("login status: %d", w.Code)
	}

	// Should have session cookie
	cookies := w.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "session" {
			sessionCookie = c
		}
	}
	if sessionCookie == nil {
		t.Fatal("no session cookie")
	}

	// Logout
	req = httptest.NewRequest("POST", "/admin/api/auth/logout", nil)
	req.AddCookie(sessionCookie)
	w = httptest.NewRecorder()
	auth.HandleLogout(w, req)

	if w.Code != 200 {
		t.Fatalf("logout status: %d", w.Code)
	}
}

func TestAuth_LoginWrongPassword(t *testing.T) {
	db := newTestStore(t)
	seedPassword(t, db, "admin123")
	auth := NewAuth(db)

	body := `{"password":"wrong"}`
	req := httptest.NewRequest("POST", "/admin/api/auth/login", strings.NewReader(body))
	w := httptest.NewRecorder()
	auth.HandleLogin(w, req)

	if w.Code != 401 {
		t.Errorf("status: %d, want 401", w.Code)
	}
}

func TestAuth_MiddlewareBlocksUnauthenticated(t *testing.T) {
	db := newTestStore(t)
	auth := NewAuth(db)

	protected := auth.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))

	req := httptest.NewRequest("GET", "/admin/api/accounts", nil)
	w := httptest.NewRecorder()
	protected.ServeHTTP(w, req)

	if w.Code != 401 {
		t.Errorf("status: %d, want 401", w.Code)
	}
}

func TestAuth_MiddlewareAllowsAuthenticated(t *testing.T) {
	db := newTestStore(t)
	seedPassword(t, db, "admin123")
	auth := NewAuth(db)

	// Login first
	loginBody := `{"password":"admin123"}`
	loginReq := httptest.NewRequest("POST", "/admin/api/auth/login", strings.NewReader(loginBody))
	loginW := httptest.NewRecorder()
	auth.HandleLogin(loginW, loginReq)

	cookies := loginW.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "session" {
			sessionCookie = c
		}
	}

	// Access protected endpoint
	protected := auth.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}))

	req := httptest.NewRequest("GET", "/admin/api/accounts", nil)
	req.AddCookie(sessionCookie)
	w := httptest.NewRecorder()
	protected.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("status: %d, want 200", w.Code)
	}
}
