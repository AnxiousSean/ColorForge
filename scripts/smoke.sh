#!/usr/bin/env bash
# Smoke test: start the docker-compose stack, confirm the backend connects to
# PostgreSQL, serves the embedded frontend, and that the API auth gate works.
set -euo pipefail

cd "$(dirname "$0")/.."

cleanup() { docker compose down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> building and starting stack"
docker compose up --build -d

BASE="http://localhost:8080"
echo "==> waiting for backend health"
for i in $(seq 1 40); do
  if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [ "$i" = 40 ]; then echo "backend did not become healthy"; docker compose logs backend; exit 1; fi
done

echo "==> /api/health"
curl -fsS "$BASE/api/health"; echo

echo "==> embedded frontend served at /"
curl -fsS "$BASE/" | head -c 80; echo

echo "==> API requires auth (expect 401)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/tasks")
echo "GET /api/tasks -> $code"
[ "$code" = "401" ] || { echo "expected 401"; exit 1; }

echo "==> login with demo operator"
curl -fsS -c /tmp/ortex.cookies -X POST "$BASE/api/login" \
  -H 'Content-Type: application/json' \
  -d '{"user":"operator","password":"ortex-demo"}'; echo

echo "==> authenticated task list (expect 200)"
code=$(curl -s -b /tmp/ortex.cookies -o /dev/null -w '%{http_code}' "$BASE/api/tasks")
echo "GET /api/tasks -> $code"
[ "$code" = "200" ] || { echo "expected 200"; exit 1; }

echo "==> SMOKE TEST PASSED"
