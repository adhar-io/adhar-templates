package main

// The function's tests. `go test ./...` runs them, locally and in app-ci, on
// the Go toolchain project.toml pins.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func get(t *testing.T, srv *httptest.Server, req *http.Request) map[string]any {
	t.Helper()
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("%s %s answered %d", req.Method, req.URL.Path, res.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body
}

func TestHealthz(t *testing.T) {
	srv := httptest.NewServer(newHandler())
	defer srv.Close()
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/healthz", nil)
	if body := get(t, srv, req); body["ok"] != true {
		t.Errorf("/healthz = %v", body)
	}
}

func TestInvoke(t *testing.T) {
	srv := httptest.NewServer(newHandler())
	defer srv.Close()
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/", nil)
	if body := get(t, srv, req); body["ok"] != true || body["event"] != nil {
		t.Errorf("GET / = %v", body)
	}
}

func TestCloudEvent(t *testing.T) {
	srv := httptest.NewServer(newHandler())
	defer srv.Close()
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/", strings.NewReader(`{"hello":"world"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Ce-Type", "com.example.ping")
	req.Header.Set("Ce-Source", "test")
	req.Header.Set("Ce-Id", "1")
	req.Header.Set("Ce-Specversion", "1.0")
	body := get(t, srv, req)
	if body["event"] != "com.example.ping" || body["received"] != float64(17) {
		t.Errorf("POST / with a CloudEvent = %v", body)
	}
}
