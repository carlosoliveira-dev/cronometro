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

// Injetáveis em build: go build -ldflags "-X main.version=1.0.0"
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

// handleIndex renderiza o template em memória para que um erro de execução
// vire um 500 completo, em vez de uma resposta parcialmente escrita.
func (s *server) handleIndex(w http.ResponseWriter, r *http.Request) {
	var buf bytes.Buffer
	if err := s.tmpl.ExecuteTemplate(&buf, "index.html", s.data); err != nil {
		slog.Error("falha ao renderizar index.html", "erro", err)
		http.Error(w, "erro interno ao renderizar a pagina", http.StatusInternalServerError)
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
		slog.Debug("requicao atendida",
			"metodo", r.Method,
			"caminho", r.URL.Path,
			"status", rec.status,
			"duracao", time.Since(start).Round(time.Millisecond).String(),
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
	addr := flag.String("addr", ":8080", "endereco de escuta do servidor")
	templatesDir := flag.String("templates", "templates", "diretorio com os templates html")
	staticDir := flag.String("static", "static", "diretorio com css, js e icones")
	verbose := flag.Bool("v", false, "log verboso com uma linha por requisicao")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if *verbose {
		logger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))
	}
	slog.SetDefault(logger)

	data := pageData{
		AppName:      "Cronometro",
		Version:      version,
		BuildDate:    buildDate,
		DefaultTheme: "light",
		MaxLaps:      maxLaps,
	}

	srv, err := newServer(*templatesDir, *staticDir, data)
	if err != nil {
		slog.Error("nao foi possivel iniciar o servidor", "erro", err)
		os.Exit(1)
	}

	css := filepath.Join(*staticDir, "dist", "app.css")
	if info, err := os.Stat(css); err != nil {
		slog.Warn("css compilado ausente: rode 'npm run build:css' antes de usar a interface",
			"caminho", css)
	} else {
		slog.Info("css compilado encontrado", "caminho", css, "tamanho", humanBytes(info.Size()))
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
		slog.Info("servindo cronometro", "addr", *addr, "versao", version)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("servidor encerrado com erro", "erro", err)
			stop()
		}
	}()

	<-ctx.Done()
	stop()
	slog.Info("encerrando, aguardando requisicoes ativas")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown forcado", "erro", err)
		os.Exit(1)
	}
	slog.Info("servidor encerrado")
}
