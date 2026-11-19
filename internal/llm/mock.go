package llm

import (
	"context"
	"sync"
)

// MockProvider is a deterministic Provider for tests and offline demos. It
// either replays a fixed script of responses in order, or delegates to a
// Responder func for dynamic behavior. It performs no network I/O.
type MockProvider struct {
	mu        sync.Mutex
	script    []*CompletionResponse
	idx       int
	Responder func(ctx context.Context, req CompletionRequest) (*CompletionResponse, error)
	// Calls records every request received, for assertions in tests.
	Calls []CompletionRequest
}

// NewMockProvider returns a mock that replays the given responses in order.
// After the script is exhausted it returns an empty "end_turn" response.
func NewMockProvider(responses ...*CompletionResponse) *MockProvider {
	return &MockProvider{script: responses}
}

// NewMockResponder returns a mock driven by a function.
func NewMockResponder(fn func(ctx context.Context, req CompletionRequest) (*CompletionResponse, error)) *MockProvider {
	return &MockProvider{Responder: fn}
}

func (m *MockProvider) Name() string { return "mock" }

// Complete returns the next scripted response (or the Responder's output).
func (m *MockProvider) Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Calls = append(m.Calls, req)

	if m.Responder != nil {
		return m.Responder(ctx, req)
	}
	if m.idx < len(m.script) {
		resp := m.script[m.idx]
		m.idx++
		return resp, nil
	}
	return &CompletionResponse{StopReason: "end_turn"}, nil
}

// CallCount returns how many completions have been requested.
func (m *MockProvider) CallCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.Calls)
}

var _ Provider = (*MockProvider)(nil)
