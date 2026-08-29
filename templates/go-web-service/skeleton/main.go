package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
{%- if values.withDatabase %}
	"database/sql"

	_ "github.com/lib/pq"
{%- endif %}
)

{%- if values.withDatabase %}
var db *sql.DB
{%- endif %}

func main() {
	ctx := context.Background()
	shutdown := setupOTel(ctx)
	defer func() { _ = shutdown(ctx) }()

	port := os.Getenv("PORT")
	if port == "" {
		port = "${{ values.port }}"
	}

{%- if values.withDatabase %}
	var err error
	db, err = sql.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
{%- endif %}

	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"service": "${{ values.name }}", "status": "ok"})
	})

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "ok")
	})

{%- if values.withDatabase %}
	mux.HandleFunc("/db", func(w http.ResponseWriter, r *http.Request) {
		var now string
		if err := db.QueryRow("SELECT now()").Scan(&now); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]string{"db": "error", "error": err.Error()})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"db": "ok", "now": now})
	})
{%- endif %}

	log.Printf("${{ values.name }} listening on port %s", port)
	// otelHandler adds tracing + metrics to every request.
	log.Fatal(http.ListenAndServe(":"+port, otelHandler(mux)))
}
