// Package config loads and validates runtime configuration exclusively from
// environment variables. No secrets are ever hardcoded.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds all runtime configuration for the Ortex backend.
type Config struct {
	// ListenAddr is the host:port the HTTP server binds to.
	ListenAddr string
	// DatabaseURL is the PostgreSQL connection string. May be empty when
	// running with the in-memory store (e.g. tests, demos).
	DatabaseURL string
	// LLMProvider selects the model backend: "mock", "anthropic", "openai".
	LLMProvider string
	// SessionSecret signs web-console session cookies (HMAC). Required.
	SessionSecret string
	// OperatorUser is the single web-console operator username. Required.
	OperatorUser string
	// OperatorPasswordHash is a bcrypt hash of the operator password. Required.
	OperatorPasswordHash string
	// Workers is the number of worker goroutines per task.
	Workers int
	// UseMemoryStore forces the in-memory store even if DatabaseURL is set.
	UseMemoryStore bool
}

// Load reads configuration from the environment and validates it.
func Load() (*Config, error) {
	c := &Config{
		ListenAddr:           env("ORTEX_LISTEN_ADDR", ":8080"),
		DatabaseURL:          env("DATABASE_URL", ""),
		LLMProvider:          strings.ToLower(env("ORTEX_LLM_PROVIDER", "mock")),
		SessionSecret:        env("ORTEX_SESSION_SECRET", ""),
		OperatorUser:         env("ORTEX_OPERATOR_USER", ""),
		OperatorPasswordHash: env("ORTEX_OPERATOR_PASSWORD_HASH", ""),
		Workers:              envInt("ORTEX_WORKERS", 3),
		UseMemoryStore:       envBool("ORTEX_USE_MEMORY_STORE", false),
	}
	if err := c.Validate(); err != nil {
		return nil, err
	}
	return c, nil
}

// Validate checks that all required fields are present and well-formed.
func (c *Config) Validate() error {
	var errs []string
	if c.ListenAddr == "" {
		errs = append(errs, "ORTEX_LISTEN_ADDR must not be empty")
	}
	switch c.LLMProvider {
	case "mock", "anthropic", "openai":
	default:
		errs = append(errs, fmt.Sprintf("ORTEX_LLM_PROVIDER %q is not one of mock|anthropic|openai", c.LLMProvider))
	}
	if len(c.SessionSecret) < 16 {
		errs = append(errs, "ORTEX_SESSION_SECRET must be set and at least 16 characters")
	}
	if c.OperatorUser == "" {
		errs = append(errs, "ORTEX_OPERATOR_USER must be set")
	}
	if c.OperatorPasswordHash == "" {
		errs = append(errs, "ORTEX_OPERATOR_PASSWORD_HASH must be set (bcrypt hash)")
	}
	if c.Workers < 1 || c.Workers > 64 {
		errs = append(errs, "ORTEX_WORKERS must be between 1 and 64")
	}
	if !c.UseMemoryStore && c.DatabaseURL == "" {
		errs = append(errs, "DATABASE_URL must be set unless ORTEX_USE_MEMORY_STORE=true")
	}
	if len(errs) > 0 {
		return errors.New("invalid configuration:\n  - " + strings.Join(errs, "\n  - "))
	}
	return nil
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v, ok := os.LookupEnv(key); ok {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			return n
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	if v, ok := os.LookupEnv(key); ok {
		if b, err := strconv.ParseBool(strings.TrimSpace(v)); err == nil {
			return b
		}
	}
	return def
}
