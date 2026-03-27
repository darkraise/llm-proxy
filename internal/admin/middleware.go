package admin

import (
	"log/slog"
	"net/http"
)

func (a *Auth) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.ValidateSession(r) {
			cookie, _ := r.Cookie("session")
			cookieVal := ""
			if cookie != nil {
				cookieVal = cookie.Value[:min(8, len(cookie.Value))] + "..."
			}
			slog.Warn("auth rejected", "path", r.URL.Path, "method", r.Method, "cookie", cookieVal)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(401)
			w.Write([]byte(`{"error":"unauthorized"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}
