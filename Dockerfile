# syntax=docker/dockerfile:1

# ---- Stage 1: build the Next.js static export ----
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

# ---- Stage 2: build the Go binary with the export embedded ----
FROM golang:1.24-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Place the freshly-built export where go:embed expects it.
RUN rm -rf internal/web/dist && mkdir -p internal/web/dist
COPY --from=web /web/out/ internal/web/dist/
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/ortex-backend ./cmd/backend

# ---- Stage 3: minimal runtime ----
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/ortex-backend /app/ortex-backend
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/ortex-backend"]
