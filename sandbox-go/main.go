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
	"strings"
	"sync"
)

/* ---------------- REQUEST MODELS ---------------- */

type SystemRequest struct {
	Cmd string `json:"cmd"`
}

type ToolRequest struct {
	Tool    string   `json:"tool"`
	Binary  string   `json:"binary"`
	Args    []string `json:"args"`
	Target  string   `json:"target"`
	Profile string   `json:"profile"`
}

type JohnRequest struct {
	Cmd []string `json:"cmd"`
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

/* -------- PROFILE PATH -------- */

func profilePath(name string) string {
	if base := os.Getenv("SANDBOX_PROFILE_DIR"); base != "" {
		return filepath.Join(base, name)
	}

	wd, err := os.Getwd()
	if err == nil {
		p := filepath.Join(wd, "sandbox_profiles", name)
		if _, err := os.Stat(p); err == nil {
			return p
		}

		parent := filepath.Dir(wd)
		p = filepath.Join(parent, "sandbox_profiles", name)
		if _, err := os.Stat(p); err == nil {
			return p
		}

		p = filepath.Join(wd, "sandbox-go", "sandbox_profiles", name)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	log.Printf("Could not find profile '%s'", name)
	return name
}

/* ---------------- SYSTEM HANDLER ---------------- */

func systemHandler(w http.ResponseWriter, r *http.Request) {
	bodyBytes, _ := io.ReadAll(r.Body)
	log.Printf("RECEIVED BODY: %s", string(bodyBytes))

	var toolReq ToolRequest
	if err := json.NewDecoder(bytes.NewReader(bodyBytes)).Decode(&toolReq); err == nil &&
		toolReq.Binary != "" {
		runToolRequest(w, toolReq)
		return
	}

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

/* ---------------- JOHN HANDLER ---------------- */

func johnHandler(w http.ResponseWriter, r *http.Request) {
	var req JohnRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	args, err := validateJohnArgs(req.Cmd)
	if err != nil {
		http.Error(w, "Invalid john command: "+err.Error(), http.StatusBadRequest)
		return
	}

	flusher := sendHeaders(w)
	if flusher == nil {
		return
	}

	cmd := execJohn(args)
	streamProcess(w, flusher, cmd)
}

func validateJohnArgs(args []string) ([]string, error) {
	if len(args) == 0 {
		return nil, fmt.Errorf("cmd cannot be empty")
	}

	clean := make([]string, 0, len(args))
	for i, arg := range args {
		if i == 0 && arg == "john" {
			continue
		}

		if arg == "" {
			return nil, fmt.Errorf("empty arg")
		}
		if strings.ContainsRune(arg, '\x00') {
			return nil, fmt.Errorf("invalid arg content")
		}
		if len(arg) > 512 {
			return nil, fmt.Errorf("arg too long")
		}

		if arg == "--show" {
			clean = append(clean, arg)
			continue
		}

		if strings.HasPrefix(arg, "--format=") {
			clean = append(clean, arg)
			continue
		}

		if strings.HasPrefix(arg, "--wordlist=") {
			wl := strings.TrimPrefix(arg, "--wordlist=")
			if wl != "/usr/share/wordlists/rockyou.txt" {
				return nil, fmt.Errorf("unsupported wordlist path")
			}
			clean = append(clean, arg)
			continue
		}

		if strings.HasPrefix(arg, "-") {
			return nil, fmt.Errorf("unsupported option: %s", arg)
		}

		path := filepath.Clean(arg)
		if !strings.HasPrefix(path, "/tmp/") {
			return nil, fmt.Errorf("hash file must be under /tmp")
		}
		clean = append(clean, path)
	}

	if len(clean) == 0 {
		return nil, fmt.Errorf("no john args supplied")
	}

	return clean, nil
}

func execJohn(cmd []string) *exec.Cmd {
	profile := profilePath("john.profile")
	finalArgs := []string{
		"--quiet",
		"--profile=" + profile,
		"john",
	}
	finalArgs = append(finalArgs, cmd...)

	return exec.Command("firejail", finalArgs...)
}

/* ---------------- SAFE EXECUTION ---------------- */

func runToolRequest(w http.ResponseWriter, req ToolRequest) {
	flusher := sendHeaders(w)
	if flusher == nil {
		return
	}

	profile := profilePath(req.Profile)
	log.Printf("TOOL EXEC: %s %v %s (profile=%s)",
		req.Binary, req.Args, req.Target, profile)

	finalArgs := []string{
		"--quiet",
		"--profile=" + profile,
		req.Binary,
	}
	finalArgs = append(finalArgs, req.Args...)
	if req.Target != "" {
		finalArgs = append(finalArgs, req.Target)
	}

	cmd := exec.Command("firejail", finalArgs...)
	streamProcess(w, flusher, cmd)
}

/* ---------------- LEGACY EXECUTION ---------------- */

func runLegacyCommand(w http.ResponseWriter, command string) {
	flusher := sendHeaders(w)
	if flusher == nil {
		return
	}

	profile := profilePath("system.profile")
	log.Printf("LEGACY EXEC: %s (profile=%s)", command, profile)

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
		fmt.Fprintf(w, "data: EXIT_CODE: 1\n\n")
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

	err := cmd.Wait()
	wg.Wait()

	exitCode := 0
	if err != nil {
		exitCode = 1
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}
	}

	fmt.Fprintf(w, "data: EXIT_CODE: %d\n\n", exitCode)
	fmt.Fprintf(w, "data: DONE\n\n")
	flusher.Flush()
}

/* ---------------- MAIN ---------------- */

func main() {
	http.HandleFunc("/run-system", systemHandler)
	http.HandleFunc("/run-john", johnHandler)

	log.Println("Go sandbox listening on :9000 (Firejail enabled)")
	log.Fatal(http.ListenAndServe(":9000", nil))
}
