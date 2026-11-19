package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/AnxiousSean/ortex/internal/agent"
	"github.com/AnxiousSean/ortex/internal/engine"
	"github.com/AnxiousSean/ortex/internal/state"
)

// Server wires the HTTP API, authentication, and the embedded web console.
type Server struct {
	store  state.Store
	engine *engine.Engine
	main   *agent.MainAgent
	auth   *Authenticator
	static http.Handler
	log    *slog.Logger

	mu      sync.Mutex
	running map[string]context.CancelFunc // taskID → cancel of its Run loop
}

// NewServer builds a Server. static serves the embedded frontend.
func NewServer(store state.Store, eng *engine.Engine, auth *Authenticator, static http.Handler, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	return &Server{
		store: store, engine: eng, main: agent.NewMainAgent(store),
		auth: auth, static: static, log: log, running: map[string]context.CancelFunc{},
	}
}

// Handler returns the root http.Handler with routes and auth applied.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// Unauthenticated endpoints.
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.HandleFunc("POST /api/logout", s.handleLogout)

	// Authenticated API.
	api := http.NewServeMux()
	api.HandleFunc("POST /api/tasks", s.handleCreateTask)
	api.HandleFunc("GET /api/tasks", s.handleListTasks)
	api.HandleFunc("GET /api/tasks/{id}", s.handleGetTask)
	api.HandleFunc("GET /api/tasks/{id}/graph", s.handleGetGraph)
	api.HandleFunc("GET /api/tasks/{id}/approvals", s.handleListApprovals)
	api.HandleFunc("GET /api/tasks/{id}/audit", s.handleListAudit)
	api.HandleFunc("POST /api/tasks/{id}/start", s.handleStartTask)
	api.HandleFunc("POST /api/tasks/{id}/pause", s.handlePauseTask)
	api.HandleFunc("POST /api/tasks/{id}/resume", s.handleResumeTask)
	api.HandleFunc("POST /api/approvals/{id}", s.handleDecideApproval)
	mux.Handle("/api/", s.auth.Middleware(api))

	// Everything else → embedded web console.
	mux.Handle("/", s.static)

	return logging(s.log, mux)
}

// ---- Handlers ----

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "time": time.Now().UTC()})
}

type loginReq struct {
	User     string `json:"user"`
	Password string `json:"password"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.User == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "user and password are required")
		return
	}
	if !s.auth.Verify(req.User, req.Password) {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	s.auth.SetSessionCookie(w, req.User)
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "user": req.User})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.auth.ClearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

type createTaskReq struct {
	Objective       string `json:"objective"`
	AuthorizedScope string `json:"authorized_scope"`
}

func (s *Server) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	var req createTaskReq
	if !decodeJSON(w, r, &req) {
		return
	}
	task, err := s.main.StartTask(r.Context(), req.Objective, req.AuthorizedScope)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, task)
}

func (s *Server) handleListTasks(w http.ResponseWriter, r *http.Request) {
	tasks, err := s.store.ListTasks(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasks})
}

func (s *Server) handleGetTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	task, err := s.store.GetTask(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "task not found")
		return
	}
	intents, _ := s.store.ListIntents(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]any{"task": task, "intents": intents})
}

func (s *Server) handleGetGraph(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.store.GetTask(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, "task not found")
		return
	}
	assets, _ := s.store.ListAssets(r.Context(), id)
	assetEdges, _ := s.store.ListAssetEdges(r.Context(), id)
	exNodes, _ := s.store.ListExplorationNodes(r.Context(), id)
	exEdges, _ := s.store.ListExplorationEdges(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]any{
		"asset_graph":       map[string]any{"nodes": assets, "edges": assetEdges},
		"exploration_graph": map[string]any{"nodes": exNodes, "edges": exEdges},
	})
}

func (s *Server) handleListApprovals(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	approvals, err := s.store.ListPendingApprovals(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"approvals": approvals})
}

func (s *Server) handleListAudit(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	entries, err := s.store.ListAudit(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"audit": entries})
}

type decideReq struct {
	Decision string `json:"decision"` // "approve" | "deny"
	Reason   string `json:"reason"`
}

func (s *Server) handleDecideApproval(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req decideReq
	if !decodeJSON(w, r, &req) {
		return
	}
	var status state.ApprovalStatus
	switch strings.ToLower(req.Decision) {
	case "approve", "approved":
		status = state.ApprovalApproved
	case "deny", "denied":
		status = state.ApprovalDenied
	default:
		writeError(w, http.StatusBadRequest, `decision must be "approve" or "deny"`)
		return
	}
	if err := s.engine.Decide(r.Context(), id, status, "operator", req.Reason); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": string(status), "approval_id": id})
}

func (s *Server) handleStartTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.store.GetTask(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, "task not found")
		return
	}
	s.mu.Lock()
	if _, ok := s.running[id]; ok {
		s.mu.Unlock()
		writeError(w, http.StatusConflict, "task already running")
		return
	}
	// Detached background context; cancelled by pause/stop.
	ctx, cancel := context.WithCancel(context.Background())
	s.running[id] = cancel
	s.mu.Unlock()

	go func() {
		defer func() {
			s.mu.Lock()
			delete(s.running, id)
			s.mu.Unlock()
		}()
		if err := s.engine.Run(ctx, id); err != nil && ctx.Err() == nil {
			s.log.Error("task run ended with error", "task", id, "err", err)
		}
	}()
	writeJSON(w, http.StatusAccepted, map[string]any{"status": "running", "task_id": id})
}

func (s *Server) handlePauseTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.engine.Pause(r.Context(), id); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "paused", "task_id": id})
}

func (s *Server) handleResumeTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.engine.Resume(r.Context(), id); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "resumed", "task_id": id})
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]any{"error": msg})
}

// decodeJSON strictly decodes a JSON request body, writing a 400 on failure.
// It returns false if the caller should stop.
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MiB cap
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return false
	}
	return true
}

func logging(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Debug("http", "method", r.Method, "path", r.URL.Path, "dur", time.Since(start))
	})
}
