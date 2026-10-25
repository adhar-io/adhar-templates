package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

type payload map[string]any

func writeJSON(w http.ResponseWriter, status int, body payload) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, payload{
			"ok": true,
			"at": time.Now().UTC().Format(time.RFC3339),
		})
	})

	http.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, payload{
			"ok":       true,
			"function": os.Getenv("FUNCTION_NAME"),
			"runtime":  "go122",
			"trigger":  os.Getenv("FUNCTION_TRIGGER"),
			"at":       time.Now().UTC().Format(time.RFC3339),
		})
	})

	log.Printf("function listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
