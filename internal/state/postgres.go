package state

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresStore is the production Store backed by PostgreSQL via pgxpool.
type PostgresStore struct {
	pool *pgxpool.Pool
}

// NewPostgresStore connects to the database at databaseURL and returns a store.
func NewPostgresStore(ctx context.Context, databaseURL string) (*PostgresStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return &PostgresStore{pool: pool}, nil
}

func (s *PostgresStore) Migrate(ctx context.Context) error { return applyMigrations(ctx, s.pool) }

func (s *PostgresStore) Close() error {
	s.pool.Close()
	return nil
}

func marshalJSON(v map[string]any) (string, error) {
	if v == nil {
		return "{}", nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func unmarshalJSON(b []byte) map[string]any {
	if len(b) == 0 {
		return map[string]any{}
	}
	m := map[string]any{}
	_ = json.Unmarshal(b, &m)
	return m
}

// ---- Tasks ----

func (s *PostgresStore) CreateTask(ctx context.Context, t *Task) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO tasks(id, objective, authorized_scope, status, paused, created_at, updated_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7)`,
		t.ID, t.Objective, t.AuthorizedScope, string(t.Status), t.Paused, t.CreatedAt, t.UpdatedAt)
	return err
}

func (s *PostgresStore) GetTask(ctx context.Context, id string) (*Task, error) {
	t := &Task{}
	var status string
	err := s.pool.QueryRow(ctx,
		`SELECT id, objective, authorized_scope, status, paused, created_at, updated_at
		 FROM tasks WHERE id=$1`, id).
		Scan(&t.ID, &t.Objective, &t.AuthorizedScope, &status, &t.Paused, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	t.Status = TaskStatus(status)
	return t, nil
}

func (s *PostgresStore) ListTasks(ctx context.Context) ([]*Task, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, objective, authorized_scope, status, paused, created_at, updated_at
		 FROM tasks ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Task
	for rows.Next() {
		t := &Task{}
		var status string
		if err := rows.Scan(&t.ID, &t.Objective, &t.AuthorizedScope, &status, &t.Paused, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		t.Status = TaskStatus(status)
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *PostgresStore) UpdateTaskStatus(ctx context.Context, id string, status TaskStatus) error {
	ct, err := s.pool.Exec(ctx,
		`UPDATE tasks SET status=$1, updated_at=now() WHERE id=$2`, string(status), id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) SetTaskPaused(ctx context.Context, id string, paused bool) error {
	ct, err := s.pool.Exec(ctx,
		`UPDATE tasks SET paused=$1, updated_at=now() WHERE id=$2`, paused, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- Intents ----

func (s *PostgresStore) AddIntent(ctx context.Context, in *Intent) error {
	// ON CONFLICT makes dispatch idempotent per (task_id, dedup_key).
	_, err := s.pool.Exec(ctx,
		`INSERT INTO intents(id, task_id, description, classification, status, dedup_key, claimed_by, created_at, updated_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 ON CONFLICT (task_id, dedup_key) DO NOTHING`,
		in.ID, in.TaskID, in.Description, string(in.Classification), string(in.Status),
		in.DedupKey, in.ClaimedBy, in.CreatedAt, in.UpdatedAt)
	return err
}

func (s *PostgresStore) ClaimNextIntent(ctx context.Context, taskID, workerID string) (*Intent, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rolled back unless committed

	in := &Intent{}
	var class, status string
	err = tx.QueryRow(ctx,
		`SELECT id, task_id, description, classification, status, dedup_key, claimed_by, created_at, updated_at
		 FROM intents
		 WHERE task_id=$1 AND status=$2
		 ORDER BY created_at
		 FOR UPDATE SKIP LOCKED
		 LIMIT 1`, taskID, string(IntentFrontier)).
		Scan(&in.ID, &in.TaskID, &in.Description, &class, &status, &in.DedupKey, &in.ClaimedBy, &in.CreatedAt, &in.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoIntent
	}
	if err != nil {
		return nil, err
	}

	in.Classification = Classification(class)
	in.Status = IntentClaimed
	in.ClaimedBy = workerID
	in.UpdatedAt = time.Now()

	if _, err := tx.Exec(ctx,
		`UPDATE intents SET status=$1, claimed_by=$2, updated_at=now() WHERE id=$3`,
		string(IntentClaimed), workerID, in.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return in, nil
}

func (s *PostgresStore) UpdateIntentStatus(ctx context.Context, id string, status IntentStatus) error {
	ct, err := s.pool.Exec(ctx,
		`UPDATE intents SET status=$1, updated_at=now() WHERE id=$2`, string(status), id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) GetIntent(ctx context.Context, id string) (*Intent, error) {
	in := &Intent{}
	var class, status string
	err := s.pool.QueryRow(ctx,
		`SELECT id, task_id, description, classification, status, dedup_key, claimed_by, created_at, updated_at
		 FROM intents WHERE id=$1`, id).
		Scan(&in.ID, &in.TaskID, &in.Description, &class, &status, &in.DedupKey, &in.ClaimedBy, &in.CreatedAt, &in.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	in.Classification = Classification(class)
	in.Status = IntentStatus(status)
	return in, nil
}

func (s *PostgresStore) ListIntents(ctx context.Context, taskID string) ([]*Intent, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, task_id, description, classification, status, dedup_key, claimed_by, created_at, updated_at
		 FROM intents WHERE task_id=$1 ORDER BY created_at`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Intent
	for rows.Next() {
		in := &Intent{}
		var class, status string
		if err := rows.Scan(&in.ID, &in.TaskID, &in.Description, &class, &status, &in.DedupKey, &in.ClaimedBy, &in.CreatedAt, &in.UpdatedAt); err != nil {
			return nil, err
		}
		in.Classification = Classification(class)
		in.Status = IntentStatus(status)
		out = append(out, in)
	}
	return out, rows.Err()
}

func (s *PostgresStore) IntentDedupKeys(ctx context.Context, taskID string) (map[string]bool, error) {
	rows, err := s.pool.Query(ctx, `SELECT dedup_key FROM intents WHERE task_id=$1`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := map[string]bool{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		keys[k] = true
	}
	return keys, rows.Err()
}

// ---- Asset graph ----

func (s *PostgresStore) AddAsset(ctx context.Context, a *Asset) error {
	attrs, err := marshalJSON(a.Attributes)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO assets(id, task_id, type, key, attributes, created_at)
		 VALUES($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (task_id, type, key) DO NOTHING`,
		a.ID, a.TaskID, string(a.Type), a.Key, attrs, a.CreatedAt)
	return err
}

func (s *PostgresStore) AddAssetEdge(ctx context.Context, e *AssetEdge) error {
	attrs, err := marshalJSON(e.Attributes)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO asset_edges(id, task_id, src_asset_id, dst_asset_id, relation, attributes)
		 VALUES($1,$2,$3,$4,$5,$6)`,
		e.ID, e.TaskID, e.SrcAssetID, e.DstAssetID, e.Relation, attrs)
	return err
}

func (s *PostgresStore) ListAssets(ctx context.Context, taskID string) ([]*Asset, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, task_id, type, key, attributes, created_at
		 FROM assets WHERE task_id=$1 ORDER BY created_at`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Asset
	for rows.Next() {
		a := &Asset{}
		var typ string
		var attrs []byte
		if err := rows.Scan(&a.ID, &a.TaskID, &typ, &a.Key, &attrs, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.Type = AssetType(typ)
		a.Attributes = unmarshalJSON(attrs)
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *PostgresStore) ListAssetEdges(ctx context.Context, taskID string) ([]*AssetEdge, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, task_id, src_asset_id, dst_asset_id, relation, attributes
		 FROM asset_edges WHERE task_id=$1`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*AssetEdge
	for rows.Next() {
		e := &AssetEdge{}
		var attrs []byte
		if err := rows.Scan(&e.ID, &e.TaskID, &e.SrcAssetID, &e.DstAssetID, &e.Relation, &attrs); err != nil {
			return nil, err
		}
		e.Attributes = unmarshalJSON(attrs)
		out = append(out, e)
	}
	return out, rows.Err()
}

// ---- Exploration graph ----

func (s *PostgresStore) AddExplorationNode(ctx context.Context, n *ExplorationNode) error {
	attrs, err := marshalJSON(n.Attributes)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO exploration_nodes(id, task_id, kind, label, status, dedup_key, attributes, created_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
		n.ID, n.TaskID, string(n.Kind), n.Label, n.Status, n.DedupKey, attrs, n.CreatedAt)
	return err
}

func (s *PostgresStore) AddExplorationEdge(ctx context.Context, e *ExplorationEdge) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO exploration_edges(id, task_id, src_id, dst_id, relation)
		 VALUES($1,$2,$3,$4,$5)`,
		e.ID, e.TaskID, e.SrcID, e.DstID, e.Relation)
	return err
}

func (s *PostgresStore) ListExplorationNodes(ctx context.Context, taskID string) ([]*ExplorationNode, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, task_id, kind, label, status, dedup_key, attributes, created_at
		 FROM exploration_nodes WHERE task_id=$1 ORDER BY created_at`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ExplorationNode
	for rows.Next() {
		n := &ExplorationNode{}
		var kind string
		var attrs []byte
		if err := rows.Scan(&n.ID, &n.TaskID, &kind, &n.Label, &n.Status, &n.DedupKey, &attrs, &n.CreatedAt); err != nil {
			return nil, err
		}
		n.Kind = ExplorationKind(kind)
		n.Attributes = unmarshalJSON(attrs)
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *PostgresStore) ListExplorationEdges(ctx context.Context, taskID string) ([]*ExplorationEdge, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, task_id, src_id, dst_id, relation
		 FROM exploration_edges WHERE task_id=$1`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ExplorationEdge
	for rows.Next() {
		e := &ExplorationEdge{}
		if err := rows.Scan(&e.ID, &e.TaskID, &e.SrcID, &e.DstID, &e.Relation); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *PostgresStore) ExplorationDedupKeys(ctx context.Context, taskID string) (map[string]bool, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT dedup_key FROM exploration_nodes WHERE task_id=$1 AND dedup_key <> ''`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := map[string]bool{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		keys[k] = true
	}
	return keys, rows.Err()
}

// ---- Observations ----

func (s *PostgresStore) AddObservation(ctx context.Context, o *Observation) error {
	content, err := marshalJSON(o.Content)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO observations(id, task_id, intent_id, worker_id, content, created_at)
		 VALUES($1,$2,$3,$4,$5,$6)`,
		o.ID, o.TaskID, o.IntentID, o.WorkerID, content, o.CreatedAt)
	return err
}

func (s *PostgresStore) ListObservations(ctx context.Context, taskID string) ([]*Observation, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, task_id, intent_id, worker_id, content, created_at
		 FROM observations WHERE task_id=$1 ORDER BY created_at`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Observation
	for rows.Next() {
		o := &Observation{}
		var content []byte
		if err := rows.Scan(&o.ID, &o.TaskID, &o.IntentID, &o.WorkerID, &content, &o.CreatedAt); err != nil {
			return nil, err
		}
		o.Content = unmarshalJSON(content)
		out = append(out, o)
	}
	return out, rows.Err()
}

// ---- Approvals ----

func (s *PostgresStore) CreateApproval(ctx context.Context, a *Approval) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO approvals(id, task_id, intent_id, classification, status, reason, decided_by, requested_at, decided_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		a.ID, a.TaskID, a.IntentID, string(a.Classification), string(a.Status),
		a.Reason, a.DecidedBy, a.RequestedAt, a.DecidedAt)
	return err
}

func (s *PostgresStore) GetApproval(ctx context.Context, id string) (*Approval, error) {
	a := &Approval{}
	var class, status string
	err := s.pool.QueryRow(ctx,
		`SELECT id, task_id, intent_id, classification, status, reason, decided_by, requested_at, decided_at
		 FROM approvals WHERE id=$1`, id).
		Scan(&a.ID, &a.TaskID, &a.IntentID, &class, &status, &a.Reason, &a.DecidedBy, &a.RequestedAt, &a.DecidedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	a.Classification = Classification(class)
	a.Status = ApprovalStatus(status)
	return a, nil
}

func (s *PostgresStore) ListPendingApprovals(ctx context.Context, taskID string) ([]*Approval, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, task_id, intent_id, classification, status, reason, decided_by, requested_at, decided_at
		 FROM approvals WHERE task_id=$1 AND status=$2 ORDER BY requested_at`,
		taskID, string(ApprovalPending))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Approval
	for rows.Next() {
		a := &Approval{}
		var class, status string
		if err := rows.Scan(&a.ID, &a.TaskID, &a.IntentID, &class, &status, &a.Reason, &a.DecidedBy, &a.RequestedAt, &a.DecidedAt); err != nil {
			return nil, err
		}
		a.Classification = Classification(class)
		a.Status = ApprovalStatus(status)
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *PostgresStore) DecideApproval(ctx context.Context, id string, status ApprovalStatus, decidedBy, reason string) error {
	ct, err := s.pool.Exec(ctx,
		`UPDATE approvals SET status=$1, decided_by=$2, reason=$3, decided_at=now()
		 WHERE id=$4 AND status=$5`,
		string(status), decidedBy, reason, id, string(ApprovalPending))
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- Todolist ----

func (s *PostgresStore) SaveTodolist(ctx context.Context, t *Todolist) error {
	items, err := json.Marshal(t.Items)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO todolists(id, task_id, round, items, created_at)
		 VALUES($1,$2,$3,$4,$5)`,
		t.ID, t.TaskID, t.Round, string(items), t.CreatedAt)
	return err
}

func (s *PostgresStore) LatestTodolist(ctx context.Context, taskID string) (*Todolist, error) {
	t := &Todolist{}
	var items []byte
	err := s.pool.QueryRow(ctx,
		`SELECT id, task_id, round, items, created_at
		 FROM todolists WHERE task_id=$1 ORDER BY round DESC LIMIT 1`, taskID).
		Scan(&t.ID, &t.TaskID, &t.Round, &items, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(items, &t.Items)
	return t, nil
}

// ---- Audit ----

func (s *PostgresStore) AppendAudit(ctx context.Context, e *AuditEntry) error {
	payload, err := marshalJSON(e.Payload)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO audit_log(id, task_id, actor, action, payload, created_at)
		 VALUES($1,$2,$3,$4,$5,$6)`,
		e.ID, e.TaskID, e.Actor, e.Action, payload, e.CreatedAt)
	return err
}

func (s *PostgresStore) ListAudit(ctx context.Context, taskID string) ([]*AuditEntry, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, task_id, actor, action, payload, created_at
		 FROM audit_log WHERE task_id=$1 ORDER BY created_at`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*AuditEntry
	for rows.Next() {
		e := &AuditEntry{}
		var payload []byte
		if err := rows.Scan(&e.ID, &e.TaskID, &e.Actor, &e.Action, &payload, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.Payload = unmarshalJSON(payload)
		out = append(out, e)
	}
	return out, rows.Err()
}

// Ensure PostgresStore satisfies Store.
var _ Store = (*PostgresStore)(nil)
