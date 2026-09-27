package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestServer(t *testing.T) *server {
	t.Helper()
	data := pageData{
		AppName:      "Stopwatch",
		Version:      "test",
		BuildDate:    "2026-09-26",
		DefaultTheme: "light",
		MaxLaps:      maxLaps,
	}
	srv, err := newServer("templates", "static", data)
	if err != nil {
		t.Fatalf("newServer: %v", err)
	}
	return srv
}

func request(t *testing.T, srv *server, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func TestIndexReturns200WithTheTemplateData(t *testing.T) {
	rec := request(t, newTestServer(t), http.MethodGet, "/")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("Content-Type = %q, want text/html", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache", cc)
	}

	body := rec.Body.String()
	for _, marker := range []string{
		`<html lang="en"`,
		`id="stopwatch"`,
		`id="time-min"`,
		`id="time-sec"`,
		`id="time-ms"`,
		`Stopwatch`,
		`5000`, // MaxLaps injected into the template
		`/static/dist/app.css`,
		`/static/js/app.js`,
	} {
		if !strings.Contains(body, marker) {
			t.Errorf("body does not contain the marker %q", marker)
		}
	}
}

func TestIndexIgnoresUnknownQueryParams(t *testing.T) {
	rec := request(t, newTestServer(t), http.MethodGet, "/?debug=1&x=<script>")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestHealthz(t *testing.T) {
	rec := request(t, newTestServer(t), http.MethodGet, "/healthz")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != `{"status":"ok","version":"test"}` {
		t.Errorf("body = %q", got)
	}
}

func TestFaviconRouteRedirectsToSVG(t *testing.T) {
	rec := request(t, newTestServer(t), http.MethodGet, "/favicon.ico")

	if rec.Code != http.StatusMovedPermanently {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMovedPermanently)
	}
	if loc := rec.Header().Get("Location"); loc != "/static/favicon.svg" {
		t.Errorf("Location = %q", loc)
	}
}

func TestSecurityHeaders(t *testing.T) {
	rec := request(t, newTestServer(t), http.MethodGet, "/")

	expected := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy":        "same-origin",
		"X-Frame-Options":        "DENY",
	}
	for header, want := range expected {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
}

func TestMethodNotAllowed(t *testing.T) {
	rec := request(t, newTestServer(t), http.MethodPost, "/")

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestStaticAssetAndEsmContentType(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "js"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "js", "app.js"), []byte("export const x = 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := newTestServer(t)
	srv.static = http.FileServer(http.Dir(dir))

	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/static/js/app.js", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Errorf("Content-Type = %q, want a javascript content type for the ES module", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache to allow revalidation", cc)
	}
	body, _ := io.ReadAll(rec.Body)
	if string(body) != "export const x = 1;\n" {
		t.Errorf("body = %q", body)
	}
}

func TestMissingTemplateFailsAtStartup(t *testing.T) {
	_, err := newServer(t.TempDir(), t.TempDir(), pageData{})
	if err == nil {
		t.Fatal("expected an error when index.html is missing")
	}
	if !strings.Contains(err.Error(), "parse template") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestHumanBytes(t *testing.T) {
	cases := []struct {
		in   int64
		want string
	}{
		{0, "0 B"},
		{512, "512 B"},
		{1024, "1.0 KB"},
		{1536, "1.5 KB"},
		{1024 * 1024, "1.0 MB"},
	}
	for _, c := range cases {
		if got := humanBytes(c.in); got != c.want {
			t.Errorf("humanBytes(%d) = %q, want %q", c.in, got, c.want)
		}
	}
}
