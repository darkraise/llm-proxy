#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="./data"
BACKEND_PORT=4000
FRONTEND_PORT=5173
ADMIN_PASSWORD_HASH="$2a$12$5R5OvxGOxQ6A9o4uX08gluA6otEW74IVMlSuBr77scKqBohbfkgS6"

mkdir -p "$DATA_DIR"

echo "Starting LLM Proxy dev environment..."
echo "  Backend:  http://localhost:$BACKEND_PORT"
echo "  Frontend: http://localhost:$FRONTEND_PORT/admin/"
echo ""

# Start Vite dev server in background
(cd web && npm run dev -- --port "$FRONTEND_PORT") &
VITE_PID=$!

# Start Go backend with UI proxy to Vite
go run ./cmd/llm-proxy \
  -port "$BACKEND_PORT" \
  -data "$DATA_DIR" \
  -admin-password-hash "$ADMIN_PASSWORD_HASH" \
  -dev \
  -ui-proxy "http://localhost:$FRONTEND_PORT" &
GO_PID=$!

# Cleanup on exit
trap 'kill $VITE_PID $GO_PID 2>/dev/null; wait' EXIT INT TERM

echo "Press Ctrl+C to stop both servers."
wait
