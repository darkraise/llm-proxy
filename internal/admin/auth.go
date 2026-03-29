package admin

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/darkraise/llm-proxy/internal/crypto"
)

type session struct {
	expiresAt time.Time
}

type Auth struct {
	passwordHash string
	mu           sync.RWMutex
	sessions     map[string]session
}

func NewAuth(passwordHash string) *Auth {
	return &Auth{
		passwordHash: passwordHash,
		sessions:     make(map[string]session),
	}
}

func (a *Auth) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, 400)
		return
	}

	if !crypto.VerifyPassword(a.passwordHash, req.Password) {
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
		Path:     "/",
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
		Path:     "/",
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
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		panic("crypto/rand: " + err.Error())
	}
	return hex.EncodeToString(b)
}
