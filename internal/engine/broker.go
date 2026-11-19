package engine

import (
	"context"
	"sync"

	"github.com/AnxiousSean/ortex/internal/state"
)

// approvalBroker bridges blocked workers and operator decisions. A worker
// awaiting an approval blocks in Await; the API (via Engine.Decide) calls
// Signal to release it. Decisions that arrive before a waiter registers are
// retained so no signal is lost.
type approvalBroker struct {
	mu      sync.Mutex
	waiters map[string]chan state.ApprovalStatus
	decided map[string]state.ApprovalStatus
}

func newApprovalBroker() *approvalBroker {
	return &approvalBroker{
		waiters: map[string]chan state.ApprovalStatus{},
		decided: map[string]state.ApprovalStatus{},
	}
}

// Await blocks until approvalID is decided or ctx is cancelled.
func (b *approvalBroker) Await(ctx context.Context, approvalID string) (state.ApprovalStatus, error) {
	b.mu.Lock()
	if st, ok := b.decided[approvalID]; ok {
		delete(b.decided, approvalID)
		b.mu.Unlock()
		return st, nil
	}
	ch, ok := b.waiters[approvalID]
	if !ok {
		ch = make(chan state.ApprovalStatus, 1)
		b.waiters[approvalID] = ch
	}
	b.mu.Unlock()

	select {
	case st := <-ch:
		return st, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

// Signal records a decision and releases any waiter.
func (b *approvalBroker) Signal(approvalID string, status state.ApprovalStatus) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if ch, ok := b.waiters[approvalID]; ok {
		ch <- status
		close(ch)
		delete(b.waiters, approvalID)
		return
	}
	b.decided[approvalID] = status
}
