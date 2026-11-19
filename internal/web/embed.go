// Package web embeds the statically-exported Next.js console and serves it.
//
// The Next.js build (output: "export") is placed into ./dist by `make web`,
// and compiled into the Go binary via go:embed. A minimal placeholder
// dist/index.html is committed so `go build ./...` always succeeds even before
// the frontend has been built.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

// FS returns the embedded export rooted at the dist directory.
func FS() fs.FS {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic("web: embedded dist missing: " + err.Error())
	}
	return sub
}

// Handler serves the embedded console with a single-page-app fallback: unknown
// paths resolve to index.html so client-side routing works.
func Handler() http.Handler {
	root := FS()
	fileServer := http.FileServer(http.FS(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(root, p); err != nil {
			// Not a real file: try "<p>.html" (Next export style), else index.html.
			if _, err2 := fs.Stat(root, p+".html"); err2 == nil {
				r2 := r.Clone(r.Context())
				r2.URL.Path = "/" + p + ".html"
				fileServer.ServeHTTP(w, r2)
				return
			}
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})
}
