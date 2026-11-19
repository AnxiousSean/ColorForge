package tools

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/AnxiousSean/ortex/internal/state"
)

func TestAddAssetValidation(t *testing.T) {
	store := state.NewMemoryStore()
	r := DefaultRegistry(store, nil)

	// Unknown field is rejected (strict decoding).
	_, err := r.Invoke(context.Background(), "add_asset", "t1", "worker:w1",
		json.RawMessage(`{"type":"host","key":"10.0.0.1","bogus":true}`))
	if err == nil {
		t.Fatal("expected error for unknown field")
	}

	// Invalid asset type is rejected.
	_, err = r.Invoke(context.Background(), "add_asset", "t1", "worker:w1",
		json.RawMessage(`{"type":"wormhole","key":"x"}`))
	if err == nil {
		t.Fatal("expected error for invalid asset type")
	}

	// Valid call succeeds and is audited.
	res, err := r.Invoke(context.Background(), "add_asset", "t1", "worker:w1",
		json.RawMessage(`{"type":"host","key":"10.0.0.1"}`))
	if err != nil {
		t.Fatalf("valid add_asset failed: %v", err)
	}
	if res.Content["asset_id"] == nil {
		t.Fatal("expected asset_id in result")
	}
	audit, _ := store.ListAudit(context.Background(), "t1")
	if len(audit) != 1 {
		t.Fatalf("audit entries = %d, want 1", len(audit))
	}
}

func TestExecuteReconIsSimulated(t *testing.T) {
	store := state.NewMemoryStore()
	r := DefaultRegistry(store, nil)
	res, err := r.Invoke(context.Background(), "execute_recon", "t1", "worker:w1",
		json.RawMessage(`{"target":"10.0.0.1","technique":"port_scan"}`))
	if err != nil {
		t.Fatalf("execute_recon failed: %v", err)
	}
	if sim, _ := res.Content["simulated"].(bool); !sim {
		t.Fatal("execute_recon result must be marked simulated (no real scanning)")
	}
}

func TestRequiresApproval(t *testing.T) {
	if !state.ClassExploitation.RequiresApproval() {
		t.Fatal("exploitation must require approval")
	}
	if !state.ClassExfiltration.RequiresApproval() {
		t.Fatal("exfiltration must require approval")
	}
	if state.ClassRecon.RequiresApproval() {
		t.Fatal("recon must not require approval")
	}
}
