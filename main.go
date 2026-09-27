package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

// Override at build time: go build -ldflags "-X main.version=1.0.0"
var (
	version   = "dev"
	buildDate = "unknown"
)

const maxLaps = 5000

type pageData struct {
	AppName      string
	Version      string
	BuildDate    string
	DefaultTheme string
	MaxLaps      int
}

type server struct {
	tmpl   *template.Template
	static http.Handler
	data   pageData
}

func newServer(templatesDir, staticDir string, data pageData) (*server, error) {
	tmpl, err := template.New("index.html").Funcs(template.FuncMap{
		"humanBytes": humanBytes,
	}).ParseFiles(filepath.Join(templatesDir, "index.html"))
	if err != nil {
		return nil, fmt.Errorf("parse template: %w", err)
	}
	return &server{
		tmpl:   tmpl,
		static: http.FileServer(http.Dir(staticDir)),
		data:   data,
	}, nil
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /{$}", s.handleIndex)
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /favicon.ico", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/static/favicon.svg", http.StatusMovedPermanently)
	})
	mux.Handle("GET /static/", http.StripPrefix("/static/", cacheControl(s.static)))

	return withSecurityHeaders(withLogging(mux))
}

// handleIndex renders the template into memory so that an execution error
// becomes a complete 500 instead of a half-written response.
func (s *server) handleIndex(w http.ResponseWriter, r *http.Request) {
	var buf bytes.Buffer
	if err := s.tmpl.ExecuteTemplate(&buf, "index.html", s.data); err != nil {
		slog.Error("failed to render index.html", "err", err)
		http.Error(w, "internal error while rendering the page", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = buf.WriteTo(w)
}

func (s *server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(`{"status":"ok","version":` + strconv.Quote(s.data.Version) + `}`))
}

func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (w *statusRecorder) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		slog.Debug("request served",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration", time.Since(start).Round(time.Millisecond).String(),
		)
	})
}

func cacheControl(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		next.ServeHTTP(w, r)
	})
}

func humanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for v := n / unit; v >= unit; v /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}

func main() {
	addr := flag.String("addr", ":8080", "server listen address")
	templatesDir := flag.String("templates", "templates", "directory with the html templates")
	staticDir := flag.String("static", "static", "directory with css, js and icons")
	verbose := flag.Bool("v", false, "verbose log with one line per request")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if *verbose {
		logger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))
	}
	slog.SetDefault(logger)

	data := pageData{
		AppName:      "Stopwatch",
		Version:      version,
		BuildDate:    buildDate,
		DefaultTheme: "light",
		MaxLaps:      maxLaps,
	}

	srv, err := newServer(*templatesDir, *staticDir, data)
	if err != nil {
		slog.Error("could not start the server", "err", err)
		os.Exit(1)
	}

	css := filepath.Join(*staticDir, "dist", "app.css")
	if info, err := os.Stat(css); err != nil {
		slog.Warn("compiled css missing: run 'npm run build:css' before using the interface",
			"path", css)
	} else {
		slog.Info("compiled css found", "path", css, "size", humanBytes(info.Size()))
	}

	httpSrv := &http.Server{
		Addr:              *addr,
		Handler:           srv.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       90 * time.Second,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("serving stopwatch", "addr", *addr, "version", version)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server stopped with error", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	stop()
	slog.Info("shutting down, waiting for active requests")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		slog.Error("forced shutdown", "err", err)
		os.Exit(1)
	}
	slog.Info("server stopped")
}
