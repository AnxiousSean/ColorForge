package agent

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/AnxiousSean/ortex/internal/state"
)

// MainAgent handles the operator-facing conversation: it turns an operator
// objective into a task with an explicit authorized scope, seeds the initial
// goal into the exploration graph, and surfaces pending approval requests.
type MainAgent struct {
	store state.Store
}

// NewMainAgent builds a MainAgent.
func NewMainAgent(store state.Store) *MainAgent { return &MainAgent{store: store} }

// StartTask creates a task from an operator objective. An authorized scope
// (rules of engagement) is REQUIRED: the framework refuses to start work
// without an explicit statement of what the operator is permitted to test.
func (m *MainAgent) StartTask(ctx context.Context, objective, authorizedScope string) (*state.Task, error) {
	if strings.TrimSpace(objective) == "" {
		return nil, fmt.Errorf("objective must not be empty")
	}
	if strings.TrimSpace(authorizedScope) == "" {
		return nil, fmt.Errorf("authorized_scope is required: declare the systems you are permitted to test")
	}
	now := time.Now()
	task := &state.Task{
		ID: state.NewID(), Objective: objective, AuthorizedScope: authorizedScope,
		Status: state.TaskPending, CreatedAt: now, UpdatedAt: now,
	}
	if err := m.store.CreateTask(ctx, task); err != nil {
		return nil, err
	}
	// Seed the exploration graph with the top-level goal.
	if err := m.store.AddExplorationNode(ctx, &state.ExplorationNode{
		ID: state.NewID(), TaskID: task.ID, Kind: state.ExploreGoal,
		Label: objective, Status: "pending", DedupKey: "goal:" + objective,
		CreatedAt: now,
	}); err != nil {
		return nil, err
	}
	if err := m.store.AppendAudit(ctx, &state.AuditEntry{
		ID: state.NewID(), TaskID: task.ID, Actor: "operator", Action: "start_task",
		Payload:   map[string]any{"objective": objective, "authorized_scope": authorizedScope},
		CreatedAt: now,
	}); err != nil {
		return nil, err
	}
	return task, nil
}

// PendingApprovals returns the approval requests awaiting an operator decision.
func (m *MainAgent) PendingApprovals(ctx context.Context, taskID string) ([]*state.Approval, error) {
	return m.store.ListPendingApprovals(ctx, taskID)
}
