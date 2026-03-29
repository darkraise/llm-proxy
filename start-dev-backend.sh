#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="./data"
PROXY_PORT=4000
ADMIN_PORT=4001
FRONTEND_PORT=5173
export ADMIN_PASSWORD_HASH='$2a$12$5R5OvxGOxQ6A9o4uX08gluA6otEW74IVMlSuBr77scKqBohbfkgS6'

mkdir -p "$DATA_DIR"

echo "Starting LLM Proxy dev backend server..."
echo "  Proxy API:  http://localhost:$PROXY_PORT"
echo "  Admin API:  http://localhost:$ADMIN_PORT"
echo ""

# Start Go backend with UI proxy to Vite dev server
go run ./cmd/llm-proxy \
  -port "$PROXY_PORT" \
  -admin-port "$ADMIN_PORT" \
  -data "$DATA_DIR" \
  -dev \
  -ui-proxy "http://localhost:$FRONTEND_PORT" &
GO_PID=$!

# Cleanup on exit
trap 'kill $GO_PID 2>/dev/null; wait' EXIT INT TERM

echo "Press Ctrl+C to stop server."
wait
