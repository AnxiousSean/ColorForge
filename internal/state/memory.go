package state

import (
	"context"
	"sort"
	"sync"
	"time"
)

// MemoryStore is an in-process Store implementation backed by maps and a
// mutex. It is used by unit tests and local demos so that no PostgreSQL
// instance is required. It is safe for concurrent use.
type MemoryStore struct {
	mu sync.Mutex

	tasks        map[string]*Task
	intents      map[string]*Intent
	assets       map[string]*Asset
	assetEdges   map[string]*AssetEdge
	exploreNodes map[string]*ExplorationNode
	exploreEdges map[string]*ExplorationEdge
	observations map[string]*Observation
	approvals    map[string]*Approval
	todolists    map[string]*Todolist
	audit        []*AuditEntry
}

// NewMemoryStore returns an empty in-memory Store.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		tasks:        map[string]*Task{},
		intents:      map[string]*Intent{},
		assets:       map[string]*Asset{},
		assetEdges:   map[string]*AssetEdge{},
		exploreNodes: map[string]*ExplorationNode{},
		exploreEdges: map[string]*ExplorationEdge{},
		observations: map[string]*Observation{},
		approvals:    map[string]*Approval{},
		todolists:    map[string]*Todolist{},
	}
}

func (s *MemoryStore) Migrate(context.Context) error { return nil }
func (s *MemoryStore) Close() error                  { return nil }

// ---- Tasks ----

func (s *MemoryStore) CreateTask(_ context.Context, t *Task) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := *t
	s.tasks[t.ID] = &cp
	return nil
}

func (s *MemoryStore) GetTask(_ context.Context, id string) (*Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tasks[id]
	if !ok {
		return nil, ErrNotFound
	}
	cp := *t
	return &cp, nil
}

func (s *MemoryStore) ListTasks(_ context.Context) ([]*Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Task, 0, len(s.tasks))
	for _, t := range s.tasks {
		cp := *t
		out = append(out, &cp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

func (s *MemoryStore) UpdateTaskStatus(_ context.Context, id string, status TaskStatus) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tasks[id]
	if !ok {
		return ErrNotFound
	}
	t.Status = status
	t.UpdatedAt = time.Now()
	return nil
}

func (s *MemoryStore) SetTaskPaused(_ context.Context, id string, paused bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tasks[id]
	if !ok {
		return ErrNotFound
	}
	t.Paused = paused
	t.UpdatedAt = time.Now()
	return nil
}

// ---- Intents ----

func (s *MemoryStore) AddIntent(_ context.Context, in *Intent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Enforce per-task dedup_key uniqueness, mirroring the Postgres index.
	for _, existing := range s.intents {
		if existing.TaskID == in.TaskID && existing.DedupKey == in.DedupKey {
			return nil // idempotent: duplicate direction ignored
		}
	}
	cp := *in
	s.intents[in.ID] = &cp
	return nil
}

func (s *MemoryStore) ClaimNextIntent(_ context.Context, taskID, workerID string) (*Intent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Deterministic claim: oldest frontier intent first.
	var cands []*Intent
	for _, in := range s.intents {
		if in.TaskID == taskID && in.Status == IntentFrontier {
			cands = append(cands, in)
		}
	}
	if len(cands) == 0 {
		return nil, ErrNoIntent
	}
	sort.Slice(cands, func(i, j int) bool { return cands[i].CreatedAt.Before(cands[j].CreatedAt) })
	in := cands[0]
	in.Status = IntentClaimed
	in.ClaimedBy = workerID
	in.UpdatedAt = time.Now()
	cp := *in
	return &cp, nil
}

func (s *MemoryStore) UpdateIntentStatus(_ context.Context, id string, status IntentStatus) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	in, ok := s.intents[id]
	if !ok {
		return ErrNotFound
	}
	in.Status = status
	in.UpdatedAt = time.Now()
	return nil
}

func (s *MemoryStore) GetIntent(_ context.Context, id string) (*Intent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	in, ok := s.intents[id]
	if !ok {
		return nil, ErrNotFound
	}
	cp := *in
	return &cp, nil
}

func (s *MemoryStore) ListIntents(_ context.Context, taskID string) ([]*Intent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*Intent
	for _, in := range s.intents {
		if in.TaskID == taskID {
			cp := *in
			out = append(out, &cp)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

func (s *MemoryStore) IntentDedupKeys(_ context.Context, taskID string) (map[string]bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := map[string]bool{}
	for _, in := range s.intents {
		if in.TaskID == taskID {
			keys[in.DedupKey] = true
		}
	}
	return keys, nil
}

// ---- Asset graph ----

func (s *MemoryStore) AddAsset(_ context.Context, a *Asset) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.assets {
		if existing.TaskID == a.TaskID && existing.Type == a.Type && existing.Key == a.Key {
			return nil // idempotent on (task,type,key)
		}
	}
	cp := *a
	s.assets[a.ID] = &cp
	return nil
}

func (s *MemoryStore) AddAssetEdge(_ context.Context, e *AssetEdge) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := *e
	s.assetEdges[e.ID] = &cp
	return nil
}

func (s *MemoryStore) ListAssets(_ context.Context, taskID string) ([]*Asset, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*Asset
	for _, a := range s.assets {
		if a.TaskID == taskID {
			cp := *a
			out = append(out, &cp)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

func (s *MemoryStore) ListAssetEdges(_ context.Context, taskID string) ([]*AssetEdge, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*AssetEdge
	for _, e := range s.assetEdges {
		if e.TaskID == taskID {
			cp := *e
			out = append(out, &cp)
		}
	}
	return out, nil
}

// ---- Exploration graph ----

func (s *MemoryStore) AddExplorationNode(_ context.Context, n *ExplorationNode) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := *n
	s.exploreNodes[n.ID] = &cp
	return nil
}

func (s *MemoryStore) AddExplorationEdge(_ context.Context, e *ExplorationEdge) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := *e
	s.exploreEdges[e.ID] = &cp
	return nil
}

func (s *MemoryStore) ListExplorationNodes(_ context.Context, taskID string) ([]*ExplorationNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*ExplorationNode
	for _, n := range s.exploreNodes {
		if n.TaskID == taskID {
			cp := *n
			out = append(out, &cp)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

func (s *MemoryStore) ListExplorationEdges(_ context.Context, taskID string) ([]*ExplorationEdge, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*ExplorationEdge
	for _, e := range s.exploreEdges {
		if e.TaskID == taskID {
			cp := *e
			out = append(out, &cp)
		}
	}
	return out, nil
}

func (s *MemoryStore) ExplorationDedupKeys(_ context.Context, taskID string) (map[string]bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := map[string]bool{}
	for _, n := range s.exploreNodes {
		if n.TaskID == taskID && n.DedupKey != "" {
			keys[n.DedupKey] = true
		}
	}
	return keys, nil
}

// ---- Observations ----

func (s *MemoryStore) AddObservation(_ context.Context, o *Observation) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := *o
	s.observations[o.ID] = &cp
	return nil
}

func (s *MemoryStore) ListObservations(_ context.Context, taskID string) ([]*Observation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*Observation
	for _, o := range s.observations {
		if o.TaskID == taskID {
			cp := *o
			out = append(out, &cp)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

// ---- Approvals ----

func (s *MemoryStore) CreateApproval(_ context.Context, a *Approval) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := *a
	s.approvals[a.ID] = &cp
	return nil
}

func (s *MemoryStore) GetApproval(_ context.Context, id string) (*Approval, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.approvals[id]
	if !ok {
		return nil, ErrNotFound
	}
	cp := *a
	return &cp, nil
}

func (s *MemoryStore) ListPendingApprovals(_ context.Context, taskID string) ([]*Approval, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*Approval
	for _, a := range s.approvals {
		if a.TaskID == taskID && a.Status == ApprovalPending {
			cp := *a
			out = append(out, &cp)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RequestedAt.Before(out[j].RequestedAt) })
	return out, nil
}

func (s *MemoryStore) DecideApproval(_ context.Context, id string, status ApprovalStatus, decidedBy, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.approvals[id]
	if !ok {
		return ErrNotFound
	}
	a.Status = status
	a.DecidedBy = decidedBy
	a.Reason = reason
	now := time.Now()
	a.DecidedAt = &now
	return nil
}

// ---- Todolist ----

func (s *MemoryStore) SaveTodolist(_ context.Context, t *Todolist) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := *t
	s.todolists[t.ID] = &cp
	return nil
}

func (s *MemoryStore) LatestTodolist(_ context.Context, taskID string) (*Todolist, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var latest *Todolist
	for _, t := range s.todolists {
		if t.TaskID != taskID {
			continue
		}
		if latest == nil || t.Round > latest.Round {
			latest = t
		}
	}
	if latest == nil {
		return nil, ErrNotFound
	}
	cp := *latest
	return &cp, nil
}

// ---- Audit ----

func (s *MemoryStore) AppendAudit(_ context.Context, e *AuditEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := *e
	s.audit = append(s.audit, &cp)
	return nil
}

func (s *MemoryStore) ListAudit(_ context.Context, taskID string) ([]*AuditEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*AuditEntry
	for _, e := range s.audit {
		if e.TaskID == taskID {
			cp := *e
			out = append(out, &cp)
		}
	}
	return out, nil
}

// Ensure MemoryStore satisfies Store.
var _ Store = (*MemoryStore)(nil)
