package llm

import (
	"context"
	"net/http"
	"time"
)

// OpenAIProvider is a stub for the OpenAI Chat Completions API. Like the
// Anthropic provider, the live transport is intentionally not implemented in
// this scaffold; the mock provider backs all tests. Enabling it requires
// network egress to the API host and an API key from the environment's secret
// store (never hardcoded).
type OpenAIProvider struct {
	APIKey  string
	Model   string
	BaseURL string
	HTTP    *http.Client
}

// NewOpenAIProvider constructs an (unwired) OpenAI provider.
func NewOpenAIProvider(apiKey, model string) *OpenAIProvider {
	return &OpenAIProvider{
		APIKey:  apiKey,
		Model:   model,
		BaseURL: "https://api.openai.com",
		HTTP:    &http.Client{Timeout: 60 * time.Second},
	}
}

func (p *OpenAIProvider) Name() string { return "openai" }

// Complete is not implemented in the scaffold.
func (p *OpenAIProvider) Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error) {
	return nil, ErrNotImplemented
}

var _ Provider = (*OpenAIProvider)(nil)
