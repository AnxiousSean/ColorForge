package llm

import (
	"fmt"
	"os"
)

// New constructs a Provider by name. API keys are read from the environment
// (never passed on the command line or hardcoded). Unknown names are an error.
func New(name string) (Provider, error) {
	switch name {
	case "", "mock":
		return NewMockProvider(), nil
	case "anthropic":
		key := os.Getenv("ANTHROPIC_API_KEY")
		if key == "" {
			return nil, fmt.Errorf("llm: ANTHROPIC_API_KEY is required for the anthropic provider")
		}
		model := envOr("ANTHROPIC_MODEL", "claude-sonnet-5-5")
		return NewAnthropicProvider(key, model), nil
	case "openai":
		key := os.Getenv("OPENAI_API_KEY")
		if key == "" {
			return nil, fmt.Errorf("llm: OPENAI_API_KEY is required for the openai provider")
		}
		model := envOr("OPENAI_MODEL", "gpt-4o")
		return NewOpenAIProvider(key, model), nil
	default:
		return nil, fmt.Errorf("llm: unknown provider %q", name)
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
