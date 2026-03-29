package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/darkraise/llm-proxy/internal/crypto"
	"github.com/darkraise/llm-proxy/internal/server"
)

var (
	version = "dev"
)

func main() {
	port := flag.Int("port", 4000, "server port")
	dataDir := flag.String("data", "/data", "data directory for SQLite DB")
	dev := flag.Bool("dev", false, "development mode")
	uiProxy := flag.String("ui-proxy", "", "proxy UI requests to this URL (dev mode)")
	seedConfig := flag.String("seed", "/app/seed.yml", "path to seed YAML config")
	healthcheck := flag.Bool("healthcheck", false, "run healthcheck and exit")
	hashPassword := flag.String("hash-password", "", "hash a password and print to stdout, then exit")
	flag.Parse()

	if *hashPassword != "" {
		hash, err := crypto.HashPassword(*hashPassword)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
		fmt.Println(hash)
		os.Exit(0)
	}

	if *healthcheck {
		resp, err := http.Get(fmt.Sprintf("http://localhost:%d/health", *port))
		if err != nil || resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		os.Exit(0)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg := server.Config{
		Port:       *port,
		DataDir:    *dataDir,
		Dev:        *dev,
		UIProxy:    *uiProxy,
		SeedConfig: *seedConfig,
		Version:    version,
	}

	srv, err := server.New(cfg)
	if err != nil {
		slog.Error("failed to create server", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("server starting", "port", cfg.Port, "version", version)
		if err := srv.Start(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown error", "error", err)
	}
}
