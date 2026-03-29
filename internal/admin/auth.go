package admin

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/darkraise/llm-proxy/internal/crypto"
	"github.com/darkraise/llm-proxy/internal/store"
)

type session struct {
	expiresAt time.Time
}

type Auth struct {
	db       *store.DB
	mu       sync.RWMutex
	sessions map[string]session
}

func NewAuth(db *store.DB, initialPassword string) *Auth {
	a := &Auth{
		db:       db,
		sessions: make(map[string]session),
	}

	// Set initial password if not already set
	existing, _ := db.GetSetting("admin_password_hash")
	if existing == "" && initialPassword != "" {
		hash, err := crypto.HashPassword(initialPassword)
		if err != nil {
			slog.Error("failed to hash initial password", "error", err)
		} else {
			db.SetSetting("admin_password_hash", hash)
		}
	}

	return a
}

func (a *Auth) IsSetupRequired() bool {
	hash, _ := a.db.GetSetting("admin_password_hash")
	return hash == ""
}

func (a *Auth) HandleSetupStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"setup_required": a.IsSetupRequired()})
}

func (a *Auth) HandleSetup(w http.ResponseWriter, r *http.Request) {
	if !a.IsSetupRequired() {
		http.Error(w, `{"error":"setup already completed"}`, 400)
		return
	}

	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, 400)
		return
	}

	if len(req.Password) < 8 {
		http.Error(w, `{"error":"password must be at least 8 characters"}`, 400)
		return
	}

	hash, err := crypto.HashPassword(req.Password)
	if err != nil {
		http.Error(w, `{"error":"failed to hash password"}`, 500)
		return
	}

	if err := a.db.SetSetting("admin_password_hash", hash); err != nil {
		http.Error(w, `{"error":"failed to save password"}`, 500)
		return
	}

	slog.Info("initial admin password set via setup page")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (a *Auth) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, 400)
		return
	}

	hash, _ := a.db.GetSetting("admin_password_hash")
	if hash == "" || !crypto.VerifyPassword(hash, req.Password) {
		http.Error(w, `{"error":"invalid password"}`, 401)
		return
	}

	// Create session
	token := generateToken()
	a.mu.Lock()
	a.sessions[token] = session{expiresAt: time.Now().Add(24 * time.Hour)}
	a.mu.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    token,
		Path:     "/admin",
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   86400,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (a *Auth) HandleLogout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("session")
	if err == nil {
		a.mu.Lock()
		delete(a.sessions, cookie.Value)
		a.mu.Unlock()
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    "",
		Path:     "/admin",
		HttpOnly: true,
		Secure:   r.TLS != nil,
		MaxAge:   -1,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (a *Auth) ValidateSession(r *http.Request) bool {
	cookie, err := r.Cookie("session")
	if err != nil {
		return false
	}

	a.mu.RLock()
	sess, ok := a.sessions[cookie.Value]
	a.mu.RUnlock()

	return ok && time.Now().Before(sess.expiresAt)
}

func generateToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}
