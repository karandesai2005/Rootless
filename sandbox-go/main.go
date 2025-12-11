package main

import (
	"fmt"
	"log"
	"net/http"
	"time"
)

func execHandler(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	// Read query params (no request body)
	tool := r.URL.Query().Get("tool")
	target := r.URL.Query().Get("target")
	if tool == "" || target == "" {
		http.Error(w, "missing tool or target", http.StatusBadRequest)
		return
	}

	log.Printf("🔥 Go: /exec called (tool=%s target=%s)\n", tool, target)

	// SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	// Immediate heartbeat so client treats stream as open
	fmt.Fprintf(w, "data: start\n\n")
	flusher.Flush()

	// Simulated tool streaming output
	for i := 1; i <= 5; i++ {
		msg := fmt.Sprintf("data: step %d: executing %s on %s\n\n", i, tool, target)
		fmt.Fprint(w, msg)
		flusher.Flush()
		time.Sleep(700 * time.Millisecond)
	}

	fmt.Fprint(w, "data: DONE\n\n")
	flusher.Flush()
}

func main() {
	http.HandleFunc("/exec", execHandler)
	log.Println("Go sandbox listening on :9000")
	log.Fatal(http.ListenAndServe(":9000", nil))
}
