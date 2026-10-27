// ${{ values.name }}: an HTTP function on Adhar's Function API (Knative).
//
// Knative starts this process on demand, sends it requests on $PORT (8080) and
// scales it to zero when no request has arrived for a while. Events from the
// function's trigger arrive as HTTP POSTs too: a CloudEvent in binary mode
// (ce-* headers) from a schedule or a Broker, or a Dapr topic delivery.
package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"
)

// maxBody bounds a request body; larger ones are refused rather than buffered.
const maxBody = 1 << 20

type reply map[string]any

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, body reply) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// newHandler is the function: /healthz, and every other path and method
// invokes it. Replace the body of invoke with what yours does.
func newHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, reply{"ok": true, "at": time.Now().UTC().Format(time.RFC3339)})
	})
	mux.HandleFunc("/", invoke)
	return mux
}

func invoke(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		slog.Error("reading the request", "error", err)
		writeJSON(w, http.StatusRequestEntityTooLarge, reply{"ok": false, "error": err.Error()})
		return
	}
	var event any
	if t := r.Header.Get("Ce-Type"); t != "" {
		event = t
	}
	writeJSON(w, http.StatusOK, reply{
		"ok":       true,
		"function": env("FUNCTION_NAME", ${{ values.name | dump }}),
		"runtime":  env("FUNCTION_RUNTIME", "go125"),
		"trigger":  env("FUNCTION_TRIGGER", "http"),
		"method":   r.Method,
		"path":     r.URL.Path,
		"event":    event,
		"received": len(body),
		"at":       time.Now().UTC().Format(time.RFC3339),
	})
}
