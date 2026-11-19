.PHONY: help web build run test vet fmt smoke docker-up docker-down clean

BINARY := ortex-backend

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-12s %s\n", $$1, $$2}'

web: ## Build the Next.js static export into internal/web/dist
	cd web && npm ci || npm install
	cd web && npm run build
	rm -rf internal/web/dist && mkdir -p internal/web/dist
	cp -r web/out/. internal/web/dist/

build: ## Build the Go binary (expects internal/web/dist to exist)
	go build -trimpath -o $(BINARY) ./cmd/backend

run: ## Run the backend locally (reads .env-style vars from the environment)
	go run ./cmd/backend

test: ## Run Go unit tests (uses in-memory store + mock provider)
	go test ./...

vet: ## go vet
	go vet ./...

fmt: ## gofmt all Go sources
	gofmt -w cmd internal

smoke: ## Bring up docker-compose and probe health + frontend
	./scripts/smoke.sh

docker-up: ## Start PostgreSQL + backend via docker compose
	docker compose up --build -d

docker-down: ## Stop the stack and remove volumes
	docker compose down -v

clean: ## Remove build artifacts
	rm -f $(BINARY)
	rm -rf web/out web/.next
