package web

import (
	"io/fs"
	"net/http/httptest"
	"strings"
	"testing"
)

// Verification criterion #2: the Next.js static export is embedded into the
// binary via go:embed and is retrievable at runtime.
func TestEmbeddedIndexExists(t *testing.T) {
	root := FS()
	data, err := fs.ReadFile(root, "index.html")
	if err != nil {
		t.Fatalf("embedded index.html not found: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("embedded index.html is empty")
	}
	if !strings.Contains(strings.ToLower(string(data)), "<html") {
		t.Fatal("embedded index.html does not look like HTML")
	}
}

// The handler serves the embedded index at "/".
func TestHandlerServesIndex(t *testing.T) {
	h := Handler()
	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("GET / = %d, want 200", rec.Code)
	}
	if !strings.Contains(strings.ToLower(rec.Body.String()), "<html") {
		t.Fatal("GET / did not return HTML")
	}
}
