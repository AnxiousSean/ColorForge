package engine

import (
	"context"
	"testing"
	"time"

	"github.com/AnxiousSean/ortex/internal/agent"
	"github.com/AnxiousSean/ortex/internal/llm"
	"github.com/AnxiousSean/ortex/internal/state"
)

// RunUntilIdle plans and drains a frontier of non-sensitive intents to
// completion, producing observations and reaching the done state.
func TestRunUntilIdleDrainsReconFrontier(t *testing.T) {
	ctx := context.Background()
	store := state.NewMemoryStore()
	seedTask(t, store, "t1")

	// Seed a goal so BasicDirections proposes one recon direction.
	must(t, store.AddExplorationNode(ctx, &state.ExplorationNode{
		ID: state.NewID(), TaskID: "t1", Kind: state.ExploreGoal,
		Label: "recon lab", Status: "pending", DedupKey: "goal:recon lab",
		CreatedAt: time.Now(),
	}))

	eng := New(store, llm.NewMockProvider(), Options{Workers: 1, Directions: agent.BasicDirections})

	runCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	must(t, eng.RunUntilIdle(runCtx, "t1"))

	task, err := store.GetTask(ctx, "t1")
	must(t, err)
	if task.Status != state.TaskDone {
		t.Fatalf("task status = %q, want %q", task.Status, state.TaskDone)
	}

	obs, err := store.ListObservations(ctx, "t1")
	must(t, err)
	if len(obs) == 0 {
		t.Fatal("expected at least one observation written back")
	}

	// The recon intent should be done, not stuck.
	intents, err := store.ListIntents(ctx, "t1")
	must(t, err)
	if len(intents) == 0 {
		t.Fatal("expected at least one intent")
	}
	for _, in := range intents {
		if in.Status != state.IntentDone {
			t.Fatalf("intent %s status = %q, want done", in.ID, in.Status)
		}
	}

	// An audit trail exists (every action is traceable).
	audit, err := store.ListAudit(ctx, "t1")
	must(t, err)
	if len(audit) == 0 {
		t.Fatal("expected audit entries")
	}
}
