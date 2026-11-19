package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/AnxiousSean/ortex/internal/state"
)

// ApprovalGate blocks a worker until a human decision is recorded for an
// approval request. The engine supplies the concrete implementation.
type ApprovalGate interface {
	// Await blocks until the approval identified by approvalID is decided, or
	// ctx is cancelled. It returns the final status.
	Await(ctx context.Context, approvalID string) (state.ApprovalStatus, error)
}

// audit writes a traceable entry for an action. Audit failures are reported to
// the caller so that an un-auditable action can be treated as a hard error.
func audit(ctx context.Context, store state.Store, taskID, actor, action string, payload map[string]any) error {
	return store.AppendAudit(ctx, &state.AuditEntry{
		ID:        state.NewID(),
		TaskID:    taskID,
		Actor:     actor,
		Action:    action,
		Payload:   payload,
		CreatedAt: time.Now(),
	})
}

// DefaultRegistry registers the full Ortex toolset against a store and gate.
func DefaultRegistry(store state.Store, gate ApprovalGate) *Registry {
	r := NewRegistry()
	r.Register(&AddAssetTool{store: store})
	r.Register(&AddAssetEdgeTool{store: store})
	r.Register(&QueryAssetGraphTool{store: store})
	r.Register(&QueryExplorationStateTool{store: store})
	r.Register(&RecordObservationTool{store: store})
	r.Register(&UpdateTodolistTool{store: store})
	r.Register(&ExecuteReconTool{store: store})
	r.Register(&RequestExploitationApprovalTool{store: store, gate: gate})
	return r
}

// ---- add_asset --------------------------------------------------------------

type AddAssetTool struct{ store state.Store }

type addAssetArgs struct {
	Type       string         `json:"type"`
	Key        string         `json:"key"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

func (t *AddAssetTool) Name() string { return "add_asset" }
func (t *AddAssetTool) Description() string {
	return "Add a node to the AssetGraph (host, service, credential, or vuln)."
}
func (t *AddAssetTool) Schema() json.RawMessage {
	return json.RawMessage(`{
  "type":"object",
  "properties":{
    "type":{"type":"string","enum":["host","service","credential","vuln"]},
    "key":{"type":"string","minLength":1},
    "attributes":{"type":"object"}
  },
  "required":["type","key"],
  "additionalProperties":false
}`)
}

func (t *AddAssetTool) Invoke(ctx context.Context, taskID, actor string, raw json.RawMessage) (*Result, error) {
	var a addAssetArgs
	if err := decodeStrict(raw, &a); err != nil {
		return nil, err
	}
	at := state.AssetType(a.Type)
	switch at {
	case state.AssetHost, state.AssetService, state.AssetCredential, state.AssetVuln:
	default:
		return nil, fmt.Errorf("invalid asset type %q", a.Type)
	}
	if strings.TrimSpace(a.Key) == "" {
		return nil, fmt.Errorf("key must not be empty")
	}
	asset := &state.Asset{
		ID: state.NewID(), TaskID: taskID, Type: at, Key: a.Key,
		Attributes: a.Attributes, CreatedAt: time.Now(),
	}
	if err := t.store.AddAsset(ctx, asset); err != nil {
		return nil, err
	}
	if err := audit(ctx, t.store, taskID, actor, "add_asset", map[string]any{"type": a.Type, "key": a.Key}); err != nil {
		return nil, err
	}
	return &Result{Content: map[string]any{"asset_id": asset.ID, "type": a.Type, "key": a.Key}}, nil
}

// ---- add_asset_edge ---------------------------------------------------------

type AddAssetEdgeTool struct{ store state.Store }

type addAssetEdgeArgs struct {
	SrcAssetID string         `json:"src_asset_id"`
	DstAssetID string         `json:"dst_asset_id"`
	Relation   string         `json:"relation"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

func (t *AddAssetEdgeTool) Name() string { return "add_asset_edge" }
func (t *AddAssetEdgeTool) Description() string {
	return "Relate two AssetGraph nodes (e.g. host runs service)."
}
func (t *AddAssetEdgeTool) Schema() json.RawMessage {
	return json.RawMessage(`{
  "type":"object",
  "properties":{
    "src_asset_id":{"type":"string","minLength":1},
    "dst_asset_id":{"type":"string","minLength":1},
    "relation":{"type":"string","minLength":1},
    "attributes":{"type":"object"}
  },
  "required":["src_asset_id","dst_asset_id","relation"],
  "additionalProperties":false
}`)
}

func (t *AddAssetEdgeTool) Invoke(ctx context.Context, taskID, actor string, raw json.RawMessage) (*Result, error) {
	var a addAssetEdgeArgs
	if err := decodeStrict(raw, &a); err != nil {
		return nil, err
	}
	if a.SrcAssetID == "" || a.DstAssetID == "" || strings.TrimSpace(a.Relation) == "" {
		return nil, fmt.Errorf("src_asset_id, dst_asset_id and relation are required")
	}
	edge := &state.AssetEdge{
		ID: state.NewID(), TaskID: taskID, SrcAssetID: a.SrcAssetID,
		DstAssetID: a.DstAssetID, Relation: a.Relation, Attributes: a.Attributes,
	}
	if err := t.store.AddAssetEdge(ctx, edge); err != nil {
		return nil, err
	}
	if err := audit(ctx, t.store, taskID, actor, "add_asset_edge", map[string]any{"relation": a.Relation}); err != nil {
		return nil, err
	}
	return &Result{Content: map[string]any{"edge_id": edge.ID}}, nil
}

// ---- query_asset_graph ------------------------------------------------------

type QueryAssetGraphTool struct{ store state.Store }

func (t *QueryAssetGraphTool) Name() string { return "query_asset_graph" }
func (t *QueryAssetGraphTool) Description() string {
	return "Return all AssetGraph nodes and edges for the task."
}
func (t *QueryAssetGraphTool) Schema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)
}

func (t *QueryAssetGraphTool) Invoke(ctx context.Context, taskID, _ string, raw json.RawMessage) (*Result, error) {
	var empty struct{}
	if err := decodeStrict(nonNull(raw), &empty); err != nil {
		return nil, err
	}
	assets, err := t.store.ListAssets(ctx, taskID)
	if err != nil {
		return nil, err
	}
	edges, err := t.store.ListAssetEdges(ctx, taskID)
	if err != nil {
		return nil, err
	}
	return &Result{Content: map[string]any{"assets": assets, "edges": edges}}, nil
}

// ---- query_exploration_state ------------------------------------------------

type QueryExplorationStateTool struct{ store state.Store }

func (t *QueryExplorationStateTool) Name() string { return "query_exploration_state" }
func (t *QueryExplorationStateTool) Description() string {
	return "Return ExplorationGraph nodes/edges and the latest todolist, to see what has been tried."
}
func (t *QueryExplorationStateTool) Schema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)
}

func (t *QueryExplorationStateTool) Invoke(ctx context.Context, taskID, _ string, raw json.RawMessage) (*Result, error) {
	var empty struct{}
	if err := decodeStrict(nonNull(raw), &empty); err != nil {
		return nil, err
	}
	nodes, err := t.store.ListExplorationNodes(ctx, taskID)
	if err != nil {
		return nil, err
	}
	edges, err := t.store.ListExplorationEdges(ctx, taskID)
	if err != nil {
		return nil, err
	}
	content := map[string]any{"nodes": nodes, "edges": edges}
	if todo, err := t.store.LatestTodolist(ctx, taskID); err == nil {
		content["todolist"] = todo
	}
	return &Result{Content: content}, nil
}

// ---- record_observation -----------------------------------------------------

type RecordObservationTool struct{ store state.Store }

type recordObservationArgs struct {
	IntentID string         `json:"intent_id"`
	Content  map[string]any `json:"content"`
}

func (t *RecordObservationTool) Name() string { return "record_observation" }
func (t *RecordObservationTool) Description() string {
	return "Write a worker observation (result) back to state."
}
func (t *RecordObservationTool) Schema() json.RawMessage {
	return json.RawMessage(`{
  "type":"object",
  "properties":{
    "intent_id":{"type":"string","minLength":1},
    "content":{"type":"object"}
  },
  "required":["intent_id","content"],
  "additionalProperties":false
}`)
}

func (t *RecordObservationTool) Invoke(ctx context.Context, taskID, actor string, raw json.RawMessage) (*Result, error) {
	var a recordObservationArgs
	if err := decodeStrict(raw, &a); err != nil {
		return nil, err
	}
	if a.IntentID == "" {
		return nil, fmt.Errorf("intent_id is required")
	}
	obs := &state.Observation{
		ID: state.NewID(), TaskID: taskID, IntentID: a.IntentID,
		WorkerID: actor, Content: a.Content, CreatedAt: time.Now(),
	}
	if err := t.store.AddObservation(ctx, obs); err != nil {
		return nil, err
	}
	if err := audit(ctx, t.store, taskID, actor, "record_observation", map[string]any{"intent_id": a.IntentID}); err != nil {
		return nil, err
	}
	return &Result{Content: map[string]any{"observation_id": obs.ID}}, nil
}

// ---- update_todolist --------------------------------------------------------

type UpdateTodolistTool struct{ store state.Store }

type updateTodolistArgs struct {
	Round int              `json:"round"`
	Items []state.TodoItem `json:"items"`
}

func (t *UpdateTodolistTool) Name() string { return "update_todolist" }
func (t *UpdateTodolistTool) Description() string {
	return "Save the planner's shared todolist for a round."
}
func (t *UpdateTodolistTool) Schema() json.RawMessage {
	return json.RawMessage(`{
  "type":"object",
  "properties":{
    "round":{"type":"integer","minimum":0},
    "items":{"type":"array","items":{"type":"object","properties":{"text":{"type":"string"},"done":{"type":"boolean"}},"required":["text"],"additionalProperties":false}}
  },
  "required":["round","items"],
  "additionalProperties":false
}`)
}

func (t *UpdateTodolistTool) Invoke(ctx context.Context, taskID, actor string, raw json.RawMessage) (*Result, error) {
	var a updateTodolistArgs
	if err := decodeStrict(raw, &a); err != nil {
		return nil, err
	}
	if a.Round < 0 {
		return nil, fmt.Errorf("round must be >= 0")
	}
	todo := &state.Todolist{
		ID: state.NewID(), TaskID: taskID, Round: a.Round,
		Items: a.Items, CreatedAt: time.Now(),
	}
	if err := t.store.SaveTodolist(ctx, todo); err != nil {
		return nil, err
	}
	if err := audit(ctx, t.store, taskID, actor, "update_todolist", map[string]any{"round": a.Round, "items": len(a.Items)}); err != nil {
		return nil, err
	}
	return &Result{Content: map[string]any{"todolist_id": todo.ID, "round": a.Round}}, nil
}

// ---- execute_recon (MOCK) ---------------------------------------------------

type ExecuteReconTool struct{ store state.Store }

type executeReconArgs struct {
	Target    string `json:"target"`
	Technique string `json:"technique"`
}

func (t *ExecuteReconTool) Name() string { return "execute_recon" }
func (t *ExecuteReconTool) Description() string {
	return "MOCK reconnaissance. Returns SIMULATED findings only; performs no real network activity. For isolated-lab scaffolding."
}
func (t *ExecuteReconTool) Schema() json.RawMessage {
	return json.RawMessage(`{
  "type":"object",
  "properties":{
    "target":{"type":"string","minLength":1},
    "technique":{"type":"string","enum":["port_scan","service_probe","dns_enum","http_fingerprint"]}
  },
  "required":["target","technique"],
  "additionalProperties":false
}`)
}

func (t *ExecuteReconTool) Invoke(ctx context.Context, taskID, actor string, raw json.RawMessage) (*Result, error) {
	var a executeReconArgs
	if err := decodeStrict(raw, &a); err != nil {
		return nil, err
	}
	if strings.TrimSpace(a.Target) == "" {
		return nil, fmt.Errorf("target is required")
	}
	if err := audit(ctx, t.store, taskID, actor, "execute_recon", map[string]any{
		"target": a.Target, "technique": a.Technique, "mock": true,
	}); err != nil {
		return nil, err
	}
	// Deterministic simulated output. NOTHING here touches the network.
	findings := map[string]any{
		"simulated":  true,
		"target":     a.Target,
		"technique":  a.Technique,
		"note":       "mock recon result; no real scan performed",
		"open_ports": []int{22, 80, 443},
	}
	return &Result{Content: findings}, nil
}

// ---- request_exploitation_approval (BLOCKING human-in-the-loop) --------------

type RequestExploitationApprovalTool struct {
	store state.Store
	gate  ApprovalGate
}

type approvalArgs struct {
	IntentID       string `json:"intent_id"`
	Classification string `json:"classification"`
	Reason         string `json:"reason"`
}

func (t *RequestExploitationApprovalTool) Name() string { return "request_exploitation_approval" }
func (t *RequestExploitationApprovalTool) Description() string {
	return "Request mandatory human approval for an exploitation/exfiltration intent. BLOCKS until an operator approves or denies."
}
func (t *RequestExploitationApprovalTool) Schema() json.RawMessage {
	return json.RawMessage(`{
  "type":"object",
  "properties":{
    "intent_id":{"type":"string","minLength":1},
    "classification":{"type":"string","enum":["exploitation","exfiltration"]},
    "reason":{"type":"string","minLength":1}
  },
  "required":["intent_id","classification","reason"],
  "additionalProperties":false
}`)
}

func (t *RequestExploitationApprovalTool) Invoke(ctx context.Context, taskID, actor string, raw json.RawMessage) (*Result, error) {
	var a approvalArgs
	if err := decodeStrict(raw, &a); err != nil {
		return nil, err
	}
	class := state.Classification(a.Classification)
	if !class.RequiresApproval() {
		return nil, fmt.Errorf("classification %q does not require approval", a.Classification)
	}
	if strings.TrimSpace(a.Reason) == "" {
		return nil, fmt.Errorf("reason is required for an approval request")
	}
	appr := &state.Approval{
		ID: state.NewID(), TaskID: taskID, IntentID: a.IntentID,
		Classification: class, Status: state.ApprovalPending,
		Reason: a.Reason, RequestedAt: time.Now(),
	}
	if err := t.store.CreateApproval(ctx, appr); err != nil {
		return nil, err
	}
	if err := audit(ctx, t.store, taskID, actor, "request_approval", map[string]any{
		"approval_id": appr.ID, "intent_id": a.IntentID, "classification": a.Classification,
	}); err != nil {
		return nil, err
	}
	// BLOCK until a human decides.
	status, err := t.gate.Await(ctx, appr.ID)
	if err != nil {
		return nil, err
	}
	if err := audit(ctx, t.store, taskID, actor, "approval_decided", map[string]any{
		"approval_id": appr.ID, "status": string(status),
	}); err != nil {
		return nil, err
	}
	return &Result{Content: map[string]any{
		"approval_id": appr.ID,
		"status":      string(status),
		"approved":    status == state.ApprovalApproved,
	}}, nil
}

// nonNull normalizes empty/omitted tool args to an empty JSON object so that
// strict decoding of no-arg tools succeeds.
func nonNull(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "null" {
		return json.RawMessage(`{}`)
	}
	return raw
}
