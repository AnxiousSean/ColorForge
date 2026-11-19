// Package agent implements the Planner, Worker, and MainAgent roles of the
// orchestration layer. The Planner is the SOLE generator of intents; Workers
// execute a single claimed intent each and write results back to the dual
// graph; the MainAgent handles the operator conversation and surfaces approval
// requests.
package agent

import (
	"context"
	"log/slog"
	"time"

	"github.com/AnxiousSean/ortex/internal/llm"
	"github.com/AnxiousSean/ortex/internal/state"
)

// Direction is a candidate next step the Planner may turn into an intent. The
// DedupKey makes a direction idempotent: a given direction is dispatched at
// most once per task.
type Direction struct {
	DedupKey       string
	Description    string
	Classification state.Classification
}

// DirectionFunc proposes candidate directions from the current state. The
// default implementation (BasicDirections) is deterministic; a live deployment
// can supply one backed by the LLM provider.
type DirectionFunc func(ctx context.Context, store state.Store, provider llm.Provider, taskID string) ([]Direction, error)

// Planner reads the exploration graph and dispatches new intents into the
// frontier only for directions not already covered.
type Planner struct {
	store      state.Store
	provider   llm.Provider
	directions DirectionFunc
	log        *slog.Logger
}

// NewPlanner builds a Planner. If directions is nil, BasicDirections is used.
func NewPlanner(store state.Store, provider llm.Provider, log *slog.Logger, directions DirectionFunc) *Planner {
	if directions == nil {
		directions = BasicDirections
	}
	if log == nil {
		log = slog.Default()
	}
	return &Planner{store: store, provider: provider, directions: directions, log: log}
}

// Plan runs one planning cycle. It returns the number of new intents dispatched.
// It never dispatches a direction whose dedup key is already present, so when
// the exploration graph shows no new directions it dispatches zero intents.
func (p *Planner) Plan(ctx context.Context, taskID string) (int, error) {
	existing, err := p.store.IntentDedupKeys(ctx, taskID)
	if err != nil {
		return 0, err
	}
	candidates, err := p.directions(ctx, p.store, p.provider, taskID)
	if err != nil {
		return 0, err
	}

	dispatched := 0
	for _, c := range candidates {
		if c.DedupKey == "" {
			continue
		}
		if existing[c.DedupKey] {
			continue // already covered — do not dispatch a duplicate
		}
		class := c.Classification
		if !class.Valid() {
			class = state.ClassRecon
		}
		now := time.Now()
		intent := &state.Intent{
			ID: state.NewID(), TaskID: taskID, Description: c.Description,
			Classification: class, Status: state.IntentFrontier,
			DedupKey: c.DedupKey, CreatedAt: now, UpdatedAt: now,
		}
		if err := p.store.AddIntent(ctx, intent); err != nil {
			return dispatched, err
		}
		// Mirror the dispatched intent as an ExplorationGraph node so future
		// planning cycles can see that this direction has been taken.
		if err := p.store.AddExplorationNode(ctx, &state.ExplorationNode{
			ID: state.NewID(), TaskID: taskID, Kind: state.ExploreIntent,
			Label: c.Description, Status: "pending", DedupKey: c.DedupKey,
			CreatedAt: now,
		}); err != nil {
			return dispatched, err
		}
		// Mark the local set so duplicate candidates in the same pass are skipped.
		existing[c.DedupKey] = true
		dispatched++

		if err := p.store.AppendAudit(ctx, &state.AuditEntry{
			ID: state.NewID(), TaskID: taskID, Actor: "planner", Action: "dispatch_intent",
			Payload:   map[string]any{"dedup_key": c.DedupKey, "classification": string(class)},
			CreatedAt: now,
		}); err != nil {
			return dispatched, err
		}
	}
	p.log.Debug("planner cycle", "task", taskID, "dispatched", dispatched, "candidates", len(candidates))
	return dispatched, nil
}

// BasicDirections is the deterministic default strategy. It proposes a recon
// direction for each pending goal node and an enumeration direction for each
// discovered host asset. All directions are non-sensitive (recon/enumeration);
// exploitation/exfiltration directions are introduced explicitly elsewhere and
// always pass through the approval gate.
func BasicDirections(ctx context.Context, store state.Store, _ llm.Provider, taskID string) ([]Direction, error) {
	var dirs []Direction

	nodes, err := store.ListExplorationNodes(ctx, taskID)
	if err != nil {
		return nil, err
	}
	for _, n := range nodes {
		if n.Kind == state.ExploreGoal && n.Status == "pending" {
			dirs = append(dirs, Direction{
				DedupKey:       "recon:" + n.Label,
				Description:    "Perform reconnaissance toward goal: " + n.Label,
				Classification: state.ClassRecon,
			})
		}
	}

	assets, err := store.ListAssets(ctx, taskID)
	if err != nil {
		return nil, err
	}
	for _, a := range assets {
		if a.Type == state.AssetHost {
			dirs = append(dirs, Direction{
				DedupKey:       "enum:" + a.Key,
				Description:    "Enumerate services on host " + a.Key,
				Classification: state.ClassEnumeration,
			})
		}
	}
	return dirs, nil
}
