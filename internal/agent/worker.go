package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/AnxiousSean/ortex/internal/state"
	"github.com/AnxiousSean/ortex/internal/tools"
)

// Worker claims a single intent from the frontier, executes it via the
// ToolSet, and writes results back to the dual graph. For an intent whose
// classification requires approval, execution BLOCKS on the human-in-the-loop
// gate until an operator approves or denies.
type Worker struct {
	ID       string
	store    state.Store
	registry *tools.Registry
	log      *slog.Logger
}

// NewWorker builds a Worker with the given id.
func NewWorker(id string, store state.Store, registry *tools.Registry, log *slog.Logger) *Worker {
	if log == nil {
		log = slog.Default()
	}
	return &Worker{ID: id, store: store, registry: registry, log: log}
}

// ClaimAndRun claims one frontier intent and executes it. It returns ran=false
// when the frontier is empty. Writing results back is the signal for the
// planner to run its next cycle (the engine wires that notification).
func (w *Worker) ClaimAndRun(ctx context.Context, taskID string) (ran bool, err error) {
	intent, err := w.store.ClaimNextIntent(ctx, taskID, w.ID)
	if err == state.ErrNoIntent {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	actor := "worker:" + w.ID
	w.log.Debug("claimed intent", "worker", w.ID, "intent", intent.ID, "class", intent.Classification)

	if err := w.store.UpdateIntentStatus(ctx, intent.ID, state.IntentRunning); err != nil {
		return true, err
	}

	// Mandatory approval gate for sensitive actions. This BLOCKS.
	if intent.Classification.RequiresApproval() {
		if err := w.store.UpdateIntentStatus(ctx, intent.ID, state.IntentBlockedOnApproval); err != nil {
			return true, err
		}
		args, _ := json.Marshal(map[string]any{
			"intent_id":      intent.ID,
			"classification": string(intent.Classification),
			"reason":         intent.Description,
		})
		res, err := w.registry.Invoke(ctx, "request_exploitation_approval", taskID, actor, args)
		if err != nil {
			_ = w.store.UpdateIntentStatus(ctx, intent.ID, state.IntentFailed)
			return true, fmt.Errorf("approval gate: %w", err)
		}
		approved, _ := res.Content["approved"].(bool)
		if !approved {
			_ = w.store.AddObservation(ctx, &state.Observation{
				ID: state.NewID(), TaskID: taskID, IntentID: intent.ID, WorkerID: w.ID,
				Content:   map[string]any{"result": "denied", "detail": "operator denied the action"},
				CreatedAt: time.Now(),
			})
			_ = w.store.UpdateIntentStatus(ctx, intent.ID, state.IntentFailed)
			w.recordOutcome(ctx, taskID, intent, "denied")
			return true, nil
		}
		_ = w.store.UpdateIntentStatus(ctx, intent.ID, state.IntentRunning)
	}

	// Execute the intent. In this scaffold, execution uses the MOCK recon tool
	// for recon/enumeration and records a simulated outcome for sensitive
	// intents that were approved. No real attack traffic is generated.
	content, execErr := w.execute(ctx, taskID, actor, intent)
	if execErr != nil {
		_ = w.store.UpdateIntentStatus(ctx, intent.ID, state.IntentFailed)
		return true, execErr
	}

	// Write results back.
	if err := w.store.AddObservation(ctx, &state.Observation{
		ID: state.NewID(), TaskID: taskID, IntentID: intent.ID, WorkerID: w.ID,
		Content: content, CreatedAt: time.Now(),
	}); err != nil {
		return true, err
	}
	if err := w.store.UpdateIntentStatus(ctx, intent.ID, state.IntentDone); err != nil {
		return true, err
	}
	w.recordOutcome(ctx, taskID, intent, "done")
	return true, nil
}

// execute runs the tool(s) appropriate to an intent and returns the result
// content to store as an observation.
func (w *Worker) execute(ctx context.Context, taskID, actor string, intent *state.Intent) (map[string]any, error) {
	switch intent.Classification {
	case state.ClassRecon, state.ClassEnumeration:
		args, _ := json.Marshal(map[string]any{"target": intent.Description, "technique": "port_scan"})
		res, err := w.registry.Invoke(ctx, "execute_recon", taskID, actor, args)
		if err != nil {
			return nil, err
		}
		return res.Content, nil
	default:
		// Approved exploitation/exfiltration: simulated only.
		return map[string]any{
			"simulated": true,
			"result":    "approved action executed in lab simulation",
			"intent":    intent.Description,
		}, nil
	}
}

// recordOutcome appends an ExplorationGraph outcome node so the planner can see
// this direction resolved. Errors are logged, not fatal to the work result.
func (w *Worker) recordOutcome(ctx context.Context, taskID string, intent *state.Intent, outcome string) {
	err := w.store.AddExplorationNode(ctx, &state.ExplorationNode{
		ID: state.NewID(), TaskID: taskID, Kind: state.ExploreOutcome,
		Label: outcome + ": " + intent.Description, Status: outcome,
		DedupKey: "outcome:" + intent.DedupKey, CreatedAt: time.Now(),
	})
	if err != nil {
		w.log.Warn("record outcome failed", "worker", w.ID, "intent", intent.ID, "err", err)
	}
}
