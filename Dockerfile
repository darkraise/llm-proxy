# Stage 1: Build React SPA
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ .
RUN npm run build

# Stage 2: Build Go binary
FROM golang:1.23-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /app/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /llm-proxy ./cmd/llm-proxy

# Stage 3: Final image
FROM gcr.io/distroless/static-debian12
COPY --from=build /llm-proxy /llm-proxy
EXPOSE 4000
VOLUME /data
ENTRYPOINT ["/llm-proxy"]
