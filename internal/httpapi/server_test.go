package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/AnxiousSean/ortex/internal/engine"
	"github.com/AnxiousSean/ortex/internal/llm"
	"github.com/AnxiousSean/ortex/internal/state"
	"golang.org/x/crypto/bcrypt"
)

func newTestServer(t *testing.T) http.Handler {
	t.Helper()
	store := state.NewMemoryStore()
	eng := engine.New(store, llm.NewMockProvider(), engine.Options{Workers: 1})
	hash, _ := bcrypt.GenerateFromPassword([]byte("pw"), bcrypt.MinCost)
	auth := NewAuthenticator("operator", string(hash), "test-secret-0123456789")
	static := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })
	return NewServer(store, eng, auth, static, nil).Handler()
}

func TestHealthNoAuth(t *testing.T) {
	h := newTestServer(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/health", nil))
	if rec.Code != 200 {
		t.Fatalf("health = %d, want 200", rec.Code)
	}
}

func TestTasksRequireAuth(t *testing.T) {
	h := newTestServer(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/tasks", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauth tasks = %d, want 401", rec.Code)
	}
}

func TestLoginThenCreateTask(t *testing.T) {
	h := newTestServer(t)

	// Login.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/login", strings.NewReader(`{"user":"operator","password":"pw"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("login = %d, want 200", rec.Code)
	}
	cookie := rec.Header().Get("Set-Cookie")
	if cookie == "" {
		t.Fatal("no session cookie issued")
	}

	// Create a task with the session cookie.
	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest("POST", "/api/tasks", strings.NewReader(`{"objective":"assess lab","authorized_scope":"10.0.0.0/24 lab only"}`))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Cookie", cookie)
	h.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusCreated {
		t.Fatalf("create task = %d, want 201; body=%s", rec2.Code, rec2.Body.String())
	}
}

func TestCreateTaskRejectsMissingScope(t *testing.T) {
	h := newTestServer(t)
	// Login first.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/login", strings.NewReader(`{"user":"operator","password":"pw"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	cookie := rec.Header().Get("Set-Cookie")

	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest("POST", "/api/tasks", strings.NewReader(`{"objective":"assess lab","authorized_scope":""}`))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Cookie", cookie)
	h.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("missing scope = %d, want 400 (authorized scope is mandatory)", rec2.Code)
	}
}
