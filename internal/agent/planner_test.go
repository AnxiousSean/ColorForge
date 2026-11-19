package agent

import (
	"context"
	"testing"
	"time"

	"github.com/AnxiousSean/ortex/internal/llm"
	"github.com/AnxiousSean/ortex/internal/state"
)

// Verification criterion #4: the planner must not dispatch duplicate intents
// when the exploration graph shows no new directions.
func TestPlannerNoDuplicateIntents(t *testing.T) {
	ctx := context.Background()
	store := state.NewMemoryStore()
	mustTask(t, store, "t1")

	// Seed one goal → one recon direction is available.
	must(t, store.AddExplorationNode(ctx, &state.ExplorationNode{
		ID: state.NewID(), TaskID: "t1", Kind: state.ExploreGoal,
		Label: "assess lab host", Status: "pending", DedupKey: "goal:assess lab host",
		CreatedAt: time.Now(),
	}))

	p := NewPlanner(store, llm.NewMockProvider(), nil, nil)

	// First cycle dispatches exactly one intent.
	n1, err := p.Plan(ctx, "t1")
	must(t, err)
	if n1 != 1 {
		t.Fatalf("first Plan: dispatched = %d, want 1", n1)
	}

	// Second cycle: the single direction is now covered → zero dispatched.
	n2, err := p.Plan(ctx, "t1")
	must(t, err)
	if n2 != 0 {
		t.Fatalf("second Plan: dispatched = %d, want 0 (duplicate suppression)", n2)
	}

	// The frontier holds exactly one intent.
	intents, err := store.ListIntents(ctx, "t1")
	must(t, err)
	if len(intents) != 1 {
		t.Fatalf("intents in store = %d, want 1", len(intents))
	}
}

// When the strategy proposes the same direction twice in one pass, only one
// intent is dispatched.
func TestPlannerDedupWithinSinglePass(t *testing.T) {
	ctx := context.Background()
	store := state.NewMemoryStore()
	mustTask(t, store, "t1")

	dup := func(context.Context, state.Store, llm.Provider, string) ([]Direction, error) {
		return []Direction{
			{DedupKey: "k1", Description: "do a", Classification: state.ClassRecon},
			{DedupKey: "k1", Description: "do a again", Classification: state.ClassRecon},
			{DedupKey: "k2", Description: "do b", Classification: state.ClassRecon},
		}, nil
	}
	p := NewPlanner(store, llm.NewMockProvider(), nil, dup)

	n, err := p.Plan(ctx, "t1")
	must(t, err)
	if n != 2 {
		t.Fatalf("dispatched = %d, want 2 (k1 once, k2 once)", n)
	}
}

func mustTask(t *testing.T, store *state.MemoryStore, id string) {
	t.Helper()
	must(t, store.CreateTask(context.Background(), &state.Task{
		ID: id, Objective: "obj", AuthorizedScope: "lab", Status: state.TaskPending,
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}))
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
