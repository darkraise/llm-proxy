package server

import (
	"context"
	"fmt"
	"net/http"
)

type Config struct {
	Port       int
	DataDir    string
	Dev        bool
	UIProxy    string
	SeedConfig string
	Version    string
}

type Server struct {
	cfg  Config
	http *http.Server
	mux  *http.ServeMux
}

func New(cfg Config) (*Server, error) {
	mux := http.NewServeMux()

	s := &Server{
		cfg: cfg,
		mux: mux,
		http: &http.Server{
			Addr:    fmt.Sprintf(":%d", cfg.Port),
			Handler: mux,
		},
	}

	s.routes()
	return s, nil
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /", s.handleRoot)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"healthy"}`))
}

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"service":"llm-proxy","version":"%s"}`, s.cfg.Version)
}

func (s *Server) Start() error {
	return s.http.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.http.Shutdown(ctx)
}
