package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"time"
)

type WasmRequest struct {
	Module string `json:"module"`
	Target string `json:"target"`
}

type SystemRequest struct {
	Cmd string `json:"cmd"`
}

func sendHeaders(w http.ResponseWriter) http.Flusher {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return nil
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	fmt.Fprintf(w, "data: start\n\n")
	flusher.Flush()
	return flusher
}

func wasmHandler(w http.ResponseWriter, r *http.Request) {
	flusher := sendHeaders(w)
	if flusher == nil { return }

	var req WasmRequest
	json.NewDecoder(r.Body).Decode(&req)

	for i := 1; i <= 5; i++ {
		fmt.Fprintf(w, "data: wasm-step-%d: %s on %s\n\n", i, req.Module, req.Target)
		flusher.Flush()
		time.Sleep(600 * time.Millisecond)
	}

	fmt.Fprintf(w, "data: DONE\n\n")
	flusher.Flush()
}

func systemHandler(w http.ResponseWriter, r *http.Request) {
	flusher := sendHeaders(w)
	if flusher == nil { return }

	var req SystemRequest
	json.NewDecoder(r.Body).Decode(&req)

	cmd := exec.Command("bash", "-c", req.Cmd)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	cmd.Start()

	buf := make([]byte, 256)
	for {
		n, _ := stdout.Read(buf)
		if n > 0 {
			fmt.Fprintf(w, "data: %s\n\n", string(buf[:n]))
			flusher.Flush()
		}

		e, _ := stderr.Read(buf)
		if e > 0 {
			fmt.Fprintf(w, "data: %s\n\n", string(buf[:e]))
			flusher.Flush()
		}

		if n == 0 && e == 0 {
			break
		}
	}

	fmt.Fprintf(w, "data: DONE\n\n")
	flusher.Flush()
}

func main() {
	http.HandleFunc("/run-wasm", wasmHandler)
	http.HandleFunc("/run-system", systemHandler)

	log.Println("🔥 Go sandbox listening on :9000")
	log.Fatal(http.ListenAndServe(":9000", nil))
}
