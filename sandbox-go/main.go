package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
)

/* ---------------- REQUEST MODELS ---------------- */

// OLD (legacy)
type SystemRequest struct {
	Cmd string `json:"cmd"`
}

// NEW (tool abstraction)
type ToolRequest struct {
	Tool    string   `json:"tool"`
	Binary  string   `json:"binary"`
	Args    []string `json:"args"`
	Target  string   `json:"target"`
	Profile string   `json:"profile"`
}

/* ---------------- SSE HEADERS ---------------- */

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
	w.Header().Set("Access-Control-Allow-Origin", "*")

	fmt.Fprintf(w, "data: start\n\n")
	flusher.Flush()
	return flusher
}

/* -------- ROBUST PROFILE PATH -------- */

func profilePath(name string) string {
	// 1️⃣ Explicit env override (best practice)
	if base := os.Getenv("SANDBOX_PROFILE_DIR"); base != "" {
		return filepath.Join(base, name)
	}

	// 2️⃣ Current working directory
	wd, err := os.Getwd()
	if err == nil {
		// ./sandbox_profiles
		p := filepath.Join(wd, "sandbox_profiles", name)
		if _, err := os.Stat(p); err == nil {
			return p
		}

		// ../sandbox_profiles  ✅ THIS FIXES YOUR ISSUE
		parent := filepath.Dir(wd)
		p = filepath.Join(parent, "sandbox_profiles", name)
		if _, err := os.Stat(p); err == nil {
			return p
		}

		// ./sandbox-go/sandbox_profiles (legacy)
		p = filepath.Join(wd, "sandbox-go", "sandbox_profiles", name)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	log.Printf("❌ CRITICAL: Could not find profile '%s'", name)
	return name
}

/* ---------------- SYSTEM HANDLER ---------------- */

func systemHandler(w http.ResponseWriter, r *http.Request) {
	// STEP 1: Read body first
	bodyBytes, _ := io.ReadAll(r.Body)
	log.Printf("📦 RECEIVED BODY: %s", string(bodyBytes))

	// Try NEW structured request first
	var toolReq ToolRequest
	if err := json.NewDecoder(bytes.NewReader(bodyBytes)).Decode(&toolReq); err == nil &&
		toolReq.Binary != "" {

		runToolRequest(w, toolReq)
		return
	}

	// Fallback to OLD cmd-based request
	var sysReq SystemRequest
	if err := json.NewDecoder(bytes.NewReader(bodyBytes)).Decode(&sysReq); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if sysReq.Cmd == "" {
		http.Error(w, "Command cannot be empty", http.StatusBadRequest)
		return
	}

	runLegacyCommand(w, sysReq.Cmd)
}

/* ---------------- NEW SAFE EXECUTION ---------------- */

func runToolRequest(w http.ResponseWriter, req ToolRequest) {
	flusher := sendHeaders(w)
	if flusher == nil {
		return
	}

	profile := profilePath(req.Profile)
	log.Printf("🚀 TOOL EXEC: %s %v %s (profile=%s)",
		req.Binary, req.Args, req.Target, profile)

	finalArgs := []string{
		"--quiet",
		"--profile=" + profile,
		req.Binary,
	}
	finalArgs = append(finalArgs, req.Args...)
	finalArgs = append(finalArgs, req.Target)

	cmd := exec.Command("firejail", finalArgs...)

	streamProcess(w, flusher, cmd)
}

/* ---------------- OLD LEGACY EXECUTION ---------------- */

func runLegacyCommand(w http.ResponseWriter, command string) {
	flusher := sendHeaders(w)
	if flusher == nil {
		return
	}

	profile := profilePath("system.profile")
	log.Printf("⚠️ LEGACY EXEC: %s (profile=%s)", command, profile)

	cmd := exec.Command(
		"firejail",
		"--quiet",
		"--profile="+profile,
		"stdbuf", "-oL", "-eL",
		"bash", "-c", command,
	)

	streamProcess(w, flusher, cmd)
}

/* ---------------- STREAMING ---------------- */

func streamProcess(w http.ResponseWriter, flusher http.Flusher, cmd *exec.Cmd) {
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		fmt.Fprintf(w, "data: Error starting command: %s\n\n", err)
		flusher.Flush()
		return
	}

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			fmt.Fprintf(w, "data: %s\n\n", scanner.Text())
			flusher.Flush()
		}
	}()

	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			fmt.Fprintf(w, "data: ERR: %s\n\n", scanner.Text())
			flusher.Flush()
		}
	}()

	cmd.Wait()
	wg.Wait()

	fmt.Fprintf(w, "data: DONE\n\n")
	flusher.Flush()
}

/* ---------------- MAIN ---------------- */

func main() {
	http.HandleFunc("/run-system", systemHandler)

	log.Println("🔥 Go sandbox listening on :9000 (Firejail enabled)")
	log.Fatal(http.ListenAndServe(":9000", nil))
}
