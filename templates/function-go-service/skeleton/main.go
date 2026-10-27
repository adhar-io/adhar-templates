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
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	srv := &http.Server{
		Addr:              ":" + env("PORT", "8080"),
		Handler:           newHandler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	// Knative sends SIGTERM before it scales an instance away: finish what is
	// in flight, then exit.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	slog.Info("listening", "function", env("FUNCTION_NAME", ${{ values.name | dump }}), "addr", srv.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("serving", "error", err)
		os.Exit(1)
	}
}
