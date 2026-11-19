// Command backend is the Ortex server: it loads configuration, connects to
// PostgreSQL (or an in-memory store), runs migrations, constructs the engine,
// and serves the JSON API plus the embedded Next.js console.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/AnxiousSean/ortex/internal/config"
	"github.com/AnxiousSean/ortex/internal/engine"
	"github.com/AnxiousSean/ortex/internal/httpapi"
	"github.com/AnxiousSean/ortex/internal/llm"
	"github.com/AnxiousSean/ortex/internal/state"
	"github.com/AnxiousSean/ortex/internal/web"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)

	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Store selection.
	var store state.Store
	if cfg.UseMemoryStore {
		store = state.NewMemoryStore()
		log.Warn("using in-memory store: data is not persisted")
	} else {
		pg, err := state.NewPostgresStore(ctx, cfg.DatabaseURL)
		if err != nil {
			return err
		}
		store = pg
	}
	defer store.Close()

	if err := store.Migrate(ctx); err != nil {
		return err
	}
	log.Info("migrations applied")

	provider, err := llm.New(cfg.LLMProvider)
	if err != nil {
		return err
	}
	log.Info("llm provider", "name", provider.Name())

	eng := engine.New(store, provider, engine.Options{Workers: cfg.Workers, Logger: log})
	auth := httpapi.NewAuthenticator(cfg.OperatorUser, cfg.OperatorPasswordHash, cfg.SessionSecret)
	srv := httpapi.NewServer(store, eng, auth, web.Handler(), log)

	httpServer := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	log.Info("ortex backend listening", "addr", cfg.ListenAddr)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
