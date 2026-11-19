// Package tools exposes the dual-graph state and core (mock) actions as
// strictly-typed, validated, LLM-callable tools. In this scaffold every
// action-performing tool is a MOCK: it records intent and returns simulated
// results. No real network scanning or exploitation is performed.
package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
)

// Result is a tool invocation's structured output.
type Result struct {
	Content map[string]any `json:"content"`
}

// Tool is a single LLM-callable capability.
type Tool interface {
	// Name is the stable tool identifier used by the model.
	Name() string
	// Description explains the tool to the model.
	Description() string
	// Schema returns the JSON schema for the tool's arguments.
	Schema() json.RawMessage
	// Invoke validates and executes the tool with raw JSON arguments.
	Invoke(ctx context.Context, taskID, actor string, args json.RawMessage) (*Result, error)
}

// Registry holds the available tools by name.
type Registry struct {
	tools map[string]Tool
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry { return &Registry{tools: map[string]Tool{}} }

// Register adds a tool, panicking on a duplicate name (programmer error).
func (r *Registry) Register(t Tool) {
	if _, exists := r.tools[t.Name()]; exists {
		panic("tools: duplicate tool name " + t.Name())
	}
	r.tools[t.Name()] = t
}

// Get returns a tool by name.
func (r *Registry) Get(name string) (Tool, bool) {
	t, ok := r.tools[name]
	return t, ok
}

// Names returns registered tool names in sorted order.
func (r *Registry) Names() []string {
	out := make([]string, 0, len(r.tools))
	for n := range r.tools {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

// Invoke looks up and runs a tool by name.
func (r *Registry) Invoke(ctx context.Context, name, taskID, actor string, args json.RawMessage) (*Result, error) {
	t, ok := r.tools[name]
	if !ok {
		return nil, fmt.Errorf("tools: unknown tool %q", name)
	}
	return t.Invoke(ctx, taskID, actor, args)
}

// decodeStrict unmarshals JSON into v and rejects unknown fields, so malformed
// or unexpected tool arguments are caught rather than silently ignored.
func decodeStrict(args json.RawMessage, v any) error {
	dec := json.NewDecoder(bytes.NewReader(args))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("invalid arguments: %w", err)
	}
	return nil
}
