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

func novoServidorDeTeste(t *testing.T) *server {
	t.Helper()
	data := pageData{
		AppName:      "Cronometro",
		Version:      "teste",
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

func requisitar(t *testing.T, srv *server, metodo, caminho string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, httptest.NewRequest(metodo, caminho, nil))
	return rec
}

func TestIndexRetorna200ComModeloDoTemplate(t *testing.T) {
	rec := requisitar(t, novoServidorDeTeste(t), http.MethodGet, "/")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, esperado %d", rec.Code, http.StatusOK)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("Content-Type = %q, esperado text/html", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("Cache-Control = %q, esperado no-cache", cc)
	}

	body := rec.Body.String()
	for _, marcador := range []string{
		`<html lang="pt-BR"`,
		`id="cronometro"`,
		`id="tempo-min"`,
		`id="tempo-sec"`,
		`id="tempo-ms"`,
		`Cronometro`,
		`5000`, // MaxLaps injetado no template
		`/static/dist/app.css`,
		`/static/js/app.js`,
	} {
		if !strings.Contains(body, marcador) {
			t.Errorf("corpo nao contem o marcador %q", marcador)
		}
	}
}

func TestIndexIgnoraParametrosDesconhecidos(t *testing.T) {
	rec := requisitar(t, novoServidorDeTeste(t), http.MethodGet, "/?debug=1&x=<script>")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, esperado %d", rec.Code, http.StatusOK)
	}
}

func TestHealthz(t *testing.T) {
	rec := requisitar(t, novoServidorDeTeste(t), http.MethodGet, "/healthz")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, esperado %d", rec.Code, http.StatusOK)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != `{"status":"ok","version":"teste"}` {
		t.Errorf("body = %q", got)
	}
}

func TestRotaFaviconRedirecionaParaSVG(t *testing.T) {
	rec := requisitar(t, novoServidorDeTeste(t), http.MethodGet, "/favicon.ico")

	if rec.Code != http.StatusMovedPermanently {
		t.Fatalf("status = %d, esperado %d", rec.Code, http.StatusMovedPermanently)
	}
	if loc := rec.Header().Get("Location"); loc != "/static/favicon.svg" {
		t.Errorf("Location = %q", loc)
	}
}

func TestHeadersDeSeguranca(t *testing.T) {
	rec := requisitar(t, novoServidorDeTeste(t), http.MethodGet, "/")

	esperados := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy":        "same-origin",
		"X-Frame-Options":        "DENY",
	}
	for header, esperado := range esperados {
		if got := rec.Header().Get(header); got != esperado {
			t.Errorf("%s = %q, esperado %q", header, got, esperado)
		}
	}
}

func TestMetodoNaoPermitido(t *testing.T) {
	rec := requisitar(t, novoServidorDeTeste(t), http.MethodPost, "/")

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, esperado %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestAssetEstaticoEContentTypeDeModuloES(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "js"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "js", "app.js"), []byte("export const x = 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := novoServidorDeTeste(t)
	srv.static = http.FileServer(http.Dir(dir))

	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/static/js/app.js", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, esperado %d", rec.Code, http.StatusOK)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Errorf("Content-Type = %q, esperado content-type de javascript para o modulo ES", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("Cache-Control = %q, esperado no-cache para permitir revalidacao", cc)
	}
	body, _ := io.ReadAll(rec.Body)
	if string(body) != "export const x = 1;\n" {
		t.Errorf("body = %q", body)
	}
}

func TestTemplateAusenteFalhaNaInicializacao(t *testing.T) {
	_, err := newServer(t.TempDir(), t.TempDir(), pageData{})
	if err == nil {
		t.Fatal("esperava erro quando index.html nao existe")
	}
	if !strings.Contains(err.Error(), "parse template") {
		t.Errorf("erro inesperado: %v", err)
	}
}

func TestHumanBytes(t *testing.T) {
	casos := []struct {
		in   int64
		want string
	}{
		{0, "0 B"},
		{512, "512 B"},
		{1024, "1.0 KB"},
		{1536, "1.5 KB"},
		{1024 * 1024, "1.0 MB"},
	}
	for _, c := range casos {
		if got := humanBytes(c.in); got != c.want {
			t.Errorf("humanBytes(%d) = %q, esperado %q", c.in, got, c.want)
		}
	}
}
