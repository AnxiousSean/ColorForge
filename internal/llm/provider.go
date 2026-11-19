// Package llm abstracts large-language-model providers behind a single
// interface so the agent layer is provider-agnostic. A deterministic mock
// provider backs tests and offline demos; real providers (Anthropic, OpenAI,
// local models) implement the same interface.
package llm

import (
	"context"
	"encoding/json"
	"errors"
)

// Role identifies the author of a message in a conversation.
type Role string

const (
	RoleSystem    Role = "system"
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
	RoleTool      Role = "tool"
)

// Message is a single turn in an LLM conversation.
type Message struct {
	Role    Role   `json:"role"`
	Content string `json:"content"`
	// ToolCallID associates a RoleTool message with the ToolCall it answers.
	ToolCallID string `json:"tool_call_id,omitempty"`
}

// ToolSpec describes a tool the model may call, including its JSON-schema args.
type ToolSpec struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Schema      json.RawMessage `json:"schema"`
}

// ToolCall is a model's request to invoke a named tool with JSON arguments.
type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

// CompletionRequest is a single completion request to a provider.
type CompletionRequest struct {
	System      string     `json:"system,omitempty"`
	Messages    []Message  `json:"messages"`
	Tools       []ToolSpec `json:"tools,omitempty"`
	MaxTokens   int        `json:"max_tokens,omitempty"`
	Temperature float64    `json:"temperature,omitempty"`
}

// CompletionResponse is a provider's reply. It may contain free text and/or a
// set of tool calls the caller is expected to execute.
type CompletionResponse struct {
	Text      string     `json:"text,omitempty"`
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
	// StopReason is provider-specific ("end_turn", "tool_use", ...).
	StopReason string `json:"stop_reason,omitempty"`
}

// Provider is the abstraction every LLM backend implements.
type Provider interface {
	// Name returns a stable identifier, e.g. "mock", "anthropic", "openai".
	Name() string
	// Complete performs one completion. Implementations must honor ctx.
	Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error)
}

// ErrNotImplemented is returned by provider stubs that are not yet wired up.
var ErrNotImplemented = errors.New("llm: provider not implemented in this scaffold")
