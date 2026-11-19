package engine

import (
	"context"
	"testing"
	"time"

	"github.com/AnxiousSean/ortex/internal/llm"
	"github.com/AnxiousSean/ortex/internal/state"
)

// Verification criterion #5: an intent requiring approval must block the engine
// until an approval signal is received.
func TestApprovalGateBlocksUntilDecided(t *testing.T) {
	ctx := context.Background()
	store := state.NewMemoryStore()
	seedTask(t, store, "t1")

	// Put an exploitation intent (requires approval) on the frontier.
	now := time.Now()
	must(t, store.AddIntent(ctx, &state.Intent{
		ID: "i1", TaskID: "t1", Description: "exploit lab service",
		Classification: state.ClassExploitation, Status: state.IntentFrontier,
		DedupKey: "exploit:1", CreatedAt: now, UpdatedAt: now,
	}))

	eng := New(store, llm.NewMockProvider(), Options{Workers: 1})
	worker := eng.NewWorker("w1")

	done := make(chan error, 1)
	go func() {
		_, err := worker.ClaimAndRun(ctx, "t1")
		done <- err
	}()

	// The worker must NOT complete while the approval is pending.
	select {
	case err := <-done:
		t.Fatalf("worker returned before approval (err=%v) — gate did not block", err)
	case <-time.After(200 * time.Millisecond):
		// expected: still blocked
	}

	// Intent is parked on the gate, and a pending approval exists.
	in, err := store.GetIntent(ctx, "i1")
	must(t, err)
	if in.Status != state.IntentBlockedOnApproval {
		t.Fatalf("intent status = %q, want %q", in.Status, state.IntentBlockedOnApproval)
	}
	pending, err := store.ListPendingApprovals(ctx, "t1")
	must(t, err)
	if len(pending) != 1 {
		t.Fatalf("pending approvals = %d, want 1", len(pending))
	}

	// Operator approves → the worker unblocks and completes.
	must(t, eng.Decide(ctx, pending[0].ID, state.ApprovalApproved, "operator", "authorized in lab"))

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("worker returned error after approval: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("worker did not complete after approval — gate failed to release")
	}

	in, err = store.GetIntent(ctx, "i1")
	must(t, err)
	if in.Status != state.IntentDone {
		t.Fatalf("intent status after approval = %q, want %q", in.Status, state.IntentDone)
	}
}

// A denial causes the intent to fail (and never execute the action).
func TestApprovalGateDenial(t *testing.T) {
	ctx := context.Background()
	store := state.NewMemoryStore()
	seedTask(t, store, "t1")
	now := time.Now()
	must(t, store.AddIntent(ctx, &state.Intent{
		ID: "i1", TaskID: "t1", Description: "exfiltrate lab data",
		Classification: state.ClassExfiltration, Status: state.IntentFrontier,
		DedupKey: "exfil:1", CreatedAt: now, UpdatedAt: now,
	}))

	eng := New(store, llm.NewMockProvider(), Options{Workers: 1})
	worker := eng.NewWorker("w1")

	done := make(chan error, 1)
	go func() {
		_, err := worker.ClaimAndRun(ctx, "t1")
		done <- err
	}()

	// Wait for the approval to be created, then deny it.
	var approvalID string
	for i := 0; i < 50; i++ {
		p, _ := store.ListPendingApprovals(ctx, "t1")
		if len(p) == 1 {
			approvalID = p[0].ID
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if approvalID == "" {
		t.Fatal("approval was never created")
	}
	must(t, eng.Decide(ctx, approvalID, state.ApprovalDenied, "operator", "out of scope"))

	select {
	case err := <-done:
		must(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("worker did not complete after denial")
	}

	in, err := store.GetIntent(ctx, "i1")
	must(t, err)
	if in.Status != state.IntentFailed {
		t.Fatalf("denied intent status = %q, want %q", in.Status, state.IntentFailed)
	}
}

func seedTask(t *testing.T, store *state.MemoryStore, id string) {
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
