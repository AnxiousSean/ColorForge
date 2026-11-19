-- 0001_init.sql — dual-graph state schema for Ortex.
-- IDs are stored as TEXT (application-generated UUIDv4) to avoid requiring any
-- PostgreSQL extension. All JSON payloads use jsonb.

CREATE TABLE IF NOT EXISTS tasks (
    id               TEXT PRIMARY KEY,
    objective        TEXT        NOT NULL,
    authorized_scope TEXT        NOT NULL,
    status           TEXT        NOT NULL,
    paused           BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Frontier queue of planner-dispatched intents.
CREATE TABLE IF NOT EXISTS intents (
    id             TEXT PRIMARY KEY,
    task_id        TEXT        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    description    TEXT        NOT NULL,
    classification TEXT        NOT NULL,
    status         TEXT        NOT NULL,
    dedup_key      TEXT        NOT NULL,
    claimed_by     TEXT        NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intents_task_status ON intents(task_id, status);
-- Dedup directions per task: a given direction is dispatched at most once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_intents_task_dedup ON intents(task_id, dedup_key);

-- AssetGraph: discovered entities and their relationships.
CREATE TABLE IF NOT EXISTS assets (
    id         TEXT PRIMARY KEY,
    task_id    TEXT        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    type       TEXT        NOT NULL,
    key        TEXT        NOT NULL,
    attributes JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assets_task ON assets(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assets_task_type_key ON assets(task_id, type, key);

CREATE TABLE IF NOT EXISTS asset_edges (
    id           TEXT PRIMARY KEY,
    task_id      TEXT        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    src_asset_id TEXT        NOT NULL,
    dst_asset_id TEXT        NOT NULL,
    relation     TEXT        NOT NULL,
    attributes   JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_asset_edges_task ON asset_edges(task_id);

-- ExplorationGraph: progress of the investigation.
CREATE TABLE IF NOT EXISTS exploration_nodes (
    id         TEXT PRIMARY KEY,
    task_id    TEXT        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    kind       TEXT        NOT NULL,
    label      TEXT        NOT NULL,
    status     TEXT        NOT NULL DEFAULT 'pending',
    dedup_key  TEXT        NOT NULL DEFAULT '',
    attributes JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exploration_nodes_task ON exploration_nodes(task_id);

CREATE TABLE IF NOT EXISTS exploration_edges (
    id       TEXT PRIMARY KEY,
    task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    src_id   TEXT NOT NULL,
    dst_id   TEXT NOT NULL,
    relation TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exploration_edges_task ON exploration_edges(task_id);

CREATE TABLE IF NOT EXISTS observations (
    id         TEXT PRIMARY KEY,
    task_id    TEXT        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    intent_id  TEXT        NOT NULL,
    worker_id  TEXT        NOT NULL,
    content    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_observations_task ON observations(task_id);

-- Human-in-the-loop approval gate.
CREATE TABLE IF NOT EXISTS approvals (
    id             TEXT PRIMARY KEY,
    task_id        TEXT        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    intent_id      TEXT        NOT NULL,
    classification TEXT        NOT NULL,
    status         TEXT        NOT NULL DEFAULT 'pending',
    reason         TEXT        NOT NULL DEFAULT '',
    decided_by     TEXT        NOT NULL DEFAULT '',
    requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_approvals_task_status ON approvals(task_id, status);

-- Planner multi-round shared todolist.
CREATE TABLE IF NOT EXISTS todolists (
    id         TEXT PRIMARY KEY,
    task_id    TEXT        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    round      INTEGER     NOT NULL,
    items      JSONB       NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_todolists_task_round ON todolists(task_id, round DESC);

-- Append-only audit log: every agent/operator action is traceable.
CREATE TABLE IF NOT EXISTS audit_log (
    id         TEXT PRIMARY KEY,
    task_id    TEXT        NOT NULL,
    actor      TEXT        NOT NULL,
    action     TEXT        NOT NULL,
    payload    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_log(task_id, created_at);
