# Ortex

**Multi-agent autonomous penetration-testing framework — foundational scaffold.**

Ortex is a Go backend that embeds a Next.js web console, persists a dual-graph
state in PostgreSQL, and orchestrates a Planner/Worker multi-agent engine. It is
architecturally inspired by the Artex project.

> ⚠️ **Authorized, isolated-lab use only.** Ortex is for legitimate security
> research and red-team exercises against systems you own or are **explicitly
> authorized** to test. Do not use it to access systems without permission.

## Safety model

Safety is structural, not optional:

- **Authorized scope is mandatory.** Every task must declare its rules of
  engagement (`authorized_scope`); the framework refuses to start a task without
  one.
- **Human-in-the-loop approval gate.** Any intent classified as `exploitation`
  or `exfiltration` **blocks** in the engine until an operator approves or denies
  it from the console. There is no path around the gate.
- **Full audit trail.** Every agent and operator action is written to an
  append-only `audit_log` table and is traceable per task.
- **Mock action tools.** In this scaffold the action-performing tools
  (`execute_recon`, etc.) are **mocks**: they return simulated findings and
  perform no real network activity or attacks.
- **No hardcoded secrets.** All configuration comes from environment variables;
  the web console is authenticated.

## Architecture

```
cmd/backend        entrypoint: config → store → migrate → engine → HTTP server
cmd/hashpw         helper to generate an operator bcrypt password hash
internal/config    env-var configuration + validation
internal/state     dual-graph models, Store interface, Postgres + in-memory impls, migrations
internal/llm       provider interface, deterministic mock, Anthropic/OpenAI stubs
internal/tools     strictly-typed, validated, LLM-callable toolset
internal/agent     Planner (sole intent generator), Worker, MainAgent
internal/engine    plannerLoop + N workers, claim/timeout/pause/resume/drain, approval gate
internal/httpapi   JSON API, session auth, task + approval endpoints
internal/web       embeds the Next.js export (go:embed) and serves it
web                Next.js console (static export → internal/web/dist)
```

### Dual-graph state

- **AssetGraph** — discovered entities (hosts, services, credentials, vulns) and
  their relationships.
- **ExplorationGraph** — investigation progress (goals, dispatched intents,
  outcomes). The planner reads this to avoid re-exploring covered directions.

Both graphs are persisted in PostgreSQL for session resumption and auditability.

### Orchestration

The **Planner** is the sole generator of intents: it reads the exploration graph
and dispatches a new intent into the frontier only for a direction not already
covered (deduplicated by key). **Workers** each claim one frontier intent
(`FOR UPDATE SKIP LOCKED`), execute it via the toolset, and write results back —
which triggers the next planner cycle. The **MainAgent** turns an operator
objective into a task and surfaces pending approvals.

## Quick start (Docker)

```bash
docker compose up --build
# console + API on http://localhost:8080
# demo login — operator / ortex-demo   (change these for real use)
```

Run the end-to-end smoke test (health + embedded frontend + auth gate):

```bash
make smoke
```

## Local development

```bash
# 1. Build the web console into the embed directory
make web

# 2. Build / run the backend (in-memory store, mock LLM — no DB needed)
ORTEX_USE_MEMORY_STORE=true \
ORTEX_SESSION_SECRET="$(openssl rand -base64 32)" \
ORTEX_OPERATOR_USER=operator \
ORTEX_OPERATOR_PASSWORD_HASH="$(go run ./cmd/hashpw 'ortex-demo')" \
make run

# 3. Tests + vet
make test
make vet
```

## Configuration

See [`.env.example`](./.env.example) for all settings. Required: a session
secret, an operator username, and a bcrypt operator password hash
(`go run ./cmd/hashpw '<password>'`). PostgreSQL is required unless
`ORTEX_USE_MEMORY_STORE=true`.

## LLM providers

The `llm.Provider` interface abstracts the model backend. The scaffold ships a
deterministic **mock** provider used by all tests. Real **Anthropic** and
**OpenAI** adapters are stubbed behind the interface; enabling one requires
network egress to the provider and an API key supplied via your secret store
(never hardcoded).

## License / responsible use

Use Ortex only where you have explicit written authorization. The authors
provide it for defensive research and sanctioned red-team work; misuse is your
responsibility.
