#!/bin/bash
set -e

IMAGE="darkraise/llm-proxy"
TAG="${1:-latest}"
NO_PUSH=false
if [ "$1" = "--no-push" ]; then
  NO_PUSH=true
  TAG="latest"
fi

echo "=== Building ${IMAGE}:${TAG} ==="
docker build -t "${IMAGE}:${TAG}" .
[ "$TAG" != "latest" ] && docker tag "${IMAGE}:${TAG}" "${IMAGE}:latest"

if [ "$NO_PUSH" = true ]; then
  echo "=== Skipping push ==="
else
  docker push "${IMAGE}:${TAG}"
  [ "$TAG" != "latest" ] && docker push "${IMAGE}:latest"
fi

echo "=== Done ==="
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | grep llm-proxy
