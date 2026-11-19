// Package engine orchestrates a pentest task: it runs one plannerLoop and N
// worker goroutines per task, handles intent claiming, timeouts, pause/resume
// and draining, and owns the human-in-the-loop approval gate.
package engine

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/AnxiousSean/ortex/internal/agent"
	"github.com/AnxiousSean/ortex/internal/llm"
	"github.com/AnxiousSean/ortex/internal/state"
	"github.com/AnxiousSean/ortex/internal/tools"
)

// Engine coordinates planner and workers over a shared Store.
type Engine struct {
	store    state.Store
	provider llm.Provider
	registry *tools.Registry
	broker   *approvalBroker
	planner  *agent.Planner
	workers  int
	log      *slog.Logger

	// intentTimeout bounds how long a single intent execution may run.
	intentTimeout time.Duration
}

// Options configures an Engine.
type Options struct {
	Workers       int
	IntentTimeout time.Duration
	Directions    agent.DirectionFunc // nil → agent.BasicDirections
	Logger        *slog.Logger
}

// New builds an Engine. The approval gate (broker) is wired into the toolset so
// that sensitive tools block on it.
func New(store state.Store, provider llm.Provider, opts Options) *Engine {
	log := opts.Logger
	if log == nil {
		log = slog.Default()
	}
	workers := opts.Workers
	if workers < 1 {
		workers = 1
	}
	timeout := opts.IntentTimeout
	if timeout <= 0 {
		timeout = 2 * time.Minute
	}
	broker := newApprovalBroker()
	registry := tools.DefaultRegistry(store, broker)
	planner := agent.NewPlanner(store, provider, log, opts.Directions)
	return &Engine{
		store: store, provider: provider, registry: registry, broker: broker,
		planner: planner, workers: workers, log: log, intentTimeout: timeout,
	}
}

// Registry exposes the toolset (used by API handlers and tests).
func (e *Engine) Registry() *tools.Registry { return e.registry }

// Planner exposes the planner (used by tests).
func (e *Engine) Planner() *agent.Planner { return e.planner }

// NewWorker constructs a worker bound to this engine's store+toolset.
func (e *Engine) NewWorker(id string) *agent.Worker {
	return agent.NewWorker(id, e.store, e.registry, e.log)
}

// Decide records an operator's approval decision and releases the blocked
// worker. It is the unblock side of the human-in-the-loop gate.
func (e *Engine) Decide(ctx context.Context, approvalID string, status state.ApprovalStatus, decidedBy, reason string) error {
	if status != state.ApprovalApproved && status != state.ApprovalDenied {
		return fmt.Errorf("invalid approval status %q", status)
	}
	if err := e.store.DecideApproval(ctx, approvalID, status, decidedBy, reason); err != nil {
		return err
	}
	e.broker.Signal(approvalID, status)
	return nil
}

// Pause and Resume toggle a task's paused flag; the loops observe it.
func (e *Engine) Pause(ctx context.Context, taskID string) error {
	return e.store.SetTaskPaused(ctx, taskID, true)
}
func (e *Engine) Resume(ctx context.Context, taskID string) error {
	return e.store.SetTaskPaused(ctx, taskID, false)
}

// RunUntilIdle is a simple sequential driver for demos and tests: it plans and
// drains the frontier repeatedly until a planning pass dispatches nothing and
// no intent remains claimable. An intent that requires approval will block here
// until an operator decides (the correct behavior: an engagement cannot be
// considered idle while a sensitive action awaits a human).
func (e *Engine) RunUntilIdle(ctx context.Context, taskID string) error {
	if err := e.store.UpdateTaskStatus(ctx, taskID, state.TaskRunning); err != nil {
		return err
	}
	worker := e.NewWorker("w0")
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		t, err := e.store.GetTask(ctx, taskID)
		if err != nil {
			return err
		}
		if t.Paused {
			return ErrPaused
		}
		dispatched, err := e.planner.Plan(ctx, taskID)
		if err != nil {
			return err
		}
		ran := 0
		for {
			did, err := worker.ClaimAndRun(ctx, taskID)
			if err != nil {
				return err
			}
			if !did {
				break
			}
			ran++
		}
		if dispatched == 0 && ran == 0 {
			break
		}
	}
	return e.store.UpdateTaskStatus(ctx, taskID, state.TaskDone)
}

// ErrPaused is returned by RunUntilIdle when the task is paused.
var ErrPaused = errors.New("engine: task is paused")

// Run launches the concurrent orchestration for a task: one plannerLoop plus N
// worker goroutines. It returns when ctx is cancelled, after draining in-flight
// workers. Workers wake on write-back; the planner re-plans on each write-back
// and on a periodic tick.
func (e *Engine) Run(ctx context.Context, taskID string) error {
	if err := e.store.UpdateTaskStatus(ctx, taskID, state.TaskRunning); err != nil {
		return err
	}
	planWake := make(chan struct{}, 1)
	workWake := make(chan struct{}, 1)
	notify := func(ch chan struct{}) {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
	notify(planWake) // kick off an initial planning cycle

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		e.plannerLoop(ctx, taskID, planWake, workWake, notify)
	}()
	for i := 0; i < e.workers; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			e.workerLoop(ctx, taskID, fmt.Sprintf("w%d", id), workWake, planWake, notify)
		}(i)
	}
	wg.Wait()
	// Draining complete.
	return ctx.Err()
}

func (e *Engine) plannerLoop(ctx context.Context, taskID string, wake, workWake chan struct{}, notify func(chan struct{})) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-wake:
		case <-ticker.C:
		}
		if e.paused(ctx, taskID) {
			continue
		}
		n, err := e.planner.Plan(ctx, taskID)
		if err != nil {
			e.log.Error("planner cycle failed", "task", taskID, "err", err)
			continue
		}
		if n > 0 {
			notify(workWake)
		}
	}
}

func (e *Engine) workerLoop(ctx context.Context, taskID, workerID string, wake, planWake chan struct{}, notify func(chan struct{})) {
	w := e.NewWorker(workerID)
	backoff := 250 * time.Millisecond
	for {
		if err := ctx.Err(); err != nil {
			return
		}
		if e.paused(ctx, taskID) {
			if !sleepOrDone(ctx, backoff) {
				return
			}
			continue
		}
		// Bound a single intent's execution time (approval waits honor ctx too).
		runCtx, cancel := context.WithTimeout(ctx, e.intentTimeout)
		did, err := w.ClaimAndRun(runCtx, taskID)
		cancel()
		if err != nil && !errors.Is(err, context.Canceled) {
			e.log.Error("worker run failed", "worker", workerID, "task", taskID, "err", err)
		}
		if did {
			notify(planWake) // write-back triggers the next planner cycle
			continue
		}
		// Frontier empty: wait for a wake or ctx cancellation.
		select {
		case <-ctx.Done():
			return
		case <-wake:
		case <-time.After(backoff):
		}
	}
}

func (e *Engine) paused(ctx context.Context, taskID string) bool {
	t, err := e.store.GetTask(ctx, taskID)
	if err != nil {
		return false
	}
	return t.Paused
}

func sleepOrDone(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}
