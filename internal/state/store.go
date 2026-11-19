package state

import (
	"context"
	"errors"
)

// ErrNotFound is returned when a requested entity does not exist.
var ErrNotFound = errors.New("state: not found")

// ErrNoIntent is returned by ClaimNextIntent when the frontier is empty.
var ErrNoIntent = errors.New("state: no claimable intent")

// Store is the persistence boundary for the dual-graph state. Both a
// PostgreSQL implementation (production) and an in-memory implementation
// (tests/demos) satisfy it, so the engine and agents depend only on this
// interface.
type Store interface {
	// Lifecycle.
	Migrate(ctx context.Context) error
	Close() error

	// Tasks.
	CreateTask(ctx context.Context, t *Task) error
	GetTask(ctx context.Context, id string) (*Task, error)
	ListTasks(ctx context.Context) ([]*Task, error)
	UpdateTaskStatus(ctx context.Context, id string, status TaskStatus) error
	SetTaskPaused(ctx context.Context, id string, paused bool) error

	// Intents / frontier queue.
	AddIntent(ctx context.Context, in *Intent) error
	// ClaimNextIntent atomically moves one frontier intent to "claimed" for the
	// given worker and returns it. Returns ErrNoIntent if none are available.
	ClaimNextIntent(ctx context.Context, taskID, workerID string) (*Intent, error)
	UpdateIntentStatus(ctx context.Context, id string, status IntentStatus) error
	GetIntent(ctx context.Context, id string) (*Intent, error)
	ListIntents(ctx context.Context, taskID string) ([]*Intent, error)
	// IntentDedupKeys returns the set of dedup keys already present for a task,
	// so the Planner can avoid dispatching duplicate directions.
	IntentDedupKeys(ctx context.Context, taskID string) (map[string]bool, error)

	// Asset graph.
	AddAsset(ctx context.Context, a *Asset) error
	AddAssetEdge(ctx context.Context, e *AssetEdge) error
	ListAssets(ctx context.Context, taskID string) ([]*Asset, error)
	ListAssetEdges(ctx context.Context, taskID string) ([]*AssetEdge, error)

	// Exploration graph.
	AddExplorationNode(ctx context.Context, n *ExplorationNode) error
	AddExplorationEdge(ctx context.Context, e *ExplorationEdge) error
	ListExplorationNodes(ctx context.Context, taskID string) ([]*ExplorationNode, error)
	ListExplorationEdges(ctx context.Context, taskID string) ([]*ExplorationEdge, error)
	// ExplorationDedupKeys returns the set of exploration dedup keys for a task.
	ExplorationDedupKeys(ctx context.Context, taskID string) (map[string]bool, error)

	// Observations.
	AddObservation(ctx context.Context, o *Observation) error
	ListObservations(ctx context.Context, taskID string) ([]*Observation, error)

	// Approvals (human-in-the-loop gate).
	CreateApproval(ctx context.Context, a *Approval) error
	GetApproval(ctx context.Context, id string) (*Approval, error)
	ListPendingApprovals(ctx context.Context, taskID string) ([]*Approval, error)
	DecideApproval(ctx context.Context, id string, status ApprovalStatus, decidedBy, reason string) error

	// Planner todolist.
	SaveTodolist(ctx context.Context, t *Todolist) error
	LatestTodolist(ctx context.Context, taskID string) (*Todolist, error)

	// Audit log.
	AppendAudit(ctx context.Context, e *AuditEntry) error
	ListAudit(ctx context.Context, taskID string) ([]*AuditEntry, error)
}
