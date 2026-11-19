package llm

import (
	"context"
	"net/http"
	"time"
)

// AnthropicProvider is a stub for the Anthropic Claude Messages API. The
// transport is intentionally left unimplemented in this scaffold: the mock
// provider backs all tests, and enabling a live provider is a deliberate,
// separately-reviewed step (it also requires network egress to the API host
// and an API key supplied via the environment's secret store — never hardcoded).
type AnthropicProvider struct {
	APIKey  string
	Model   string
	BaseURL string
	HTTP    *http.Client
}

// NewAnthropicProvider constructs an (unwired) Anthropic provider.
func NewAnthropicProvider(apiKey, model string) *AnthropicProvider {
	return &AnthropicProvider{
		APIKey:  apiKey,
		Model:   model,
		BaseURL: "https://api.anthropic.com",
		HTTP:    &http.Client{Timeout: 60 * time.Second},
	}
}

func (p *AnthropicProvider) Name() string { return "anthropic" }

// Complete is not implemented in the scaffold. Wire up the Messages API +
// tool-use translation here when enabling a live provider.
func (p *AnthropicProvider) Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error) {
	return nil, ErrNotImplemented
}

var _ Provider = (*AnthropicProvider)(nil)
