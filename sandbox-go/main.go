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

	"github.com/karandesai2005/Rootless/sandbox-go/toolmanager"
)

/* ---------------- REQUEST MODELS ---------------- */

type SystemRequest struct {
	Cmd string `json:"cmd"`
}

type ToolRequest struct {
	Tool       string   `json:"tool"`
	Binary     string   `json:"binary"`
	BinaryName string   `json:"binary_name"`
	Args       []string `json:"args"`
	Target     string   `json:"target"`
	Profile    string   `json:"profile"`
}

type JohnRequest struct {
	Cmd     []string   `json:"cmd"`
	Files   []TempFile `json:"files"`
	Cleanup []string   `json:"cleanup"`
}

type TempFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
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

func envEnabled(name string) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(name)))
	return value == "1" || value == "true" || value == "yes"
}

func expandedPath() string {
	seen := make(map[string]struct{})
	parts := make([]string, 0, 16)

	add := func(entries ...string) {
		for _, entry := range entries {
			if entry == "" {
				continue
			}
			if _, ok := seen[entry]; ok {
				continue
			}
			seen[entry] = struct{}{}
			parts = append(parts, entry)
		}
	}

	if extra := strings.TrimSpace(os.Getenv("SANDBOX_EXTRA_PATH")); extra != "" {
		add(strings.Split(extra, ":")...)
	}
	if home, err := os.UserHomeDir(); err == nil {
		add(
			filepath.Join(home, "go", "bin"),
			filepath.Join(home, ".local", "bin"),
		)
	}
	add("/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin")
	if current := os.Getenv("PATH"); current != "" {
		add(strings.Split(current, ":")...)
	}

	return strings.Join(parts, ":")
}

func init() {
	_ = os.Setenv("PATH", expandedPath())
}

func binaryExists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func resolveBinary(name string) (string, error) {
	return exec.LookPath(name)
}

func commandEnv() []string {
	path := expandedPath()
	env := os.Environ()
	filtered := make([]string, 0, len(env)+1)

	for _, entry := range env {
		if strings.HasPrefix(entry, "PATH=") {
			continue
		}
		filtered = append(filtered, entry)
	}

	filtered = append(filtered, "PATH="+path)
	return filtered
}

func extraFirejailWhitelist(args []string) []string {
	seen := make(map[string]struct{})
	extras := make([]string, 0)

	for _, arg := range args {
		if !strings.HasSuffix(arg, ".txt") || !filepath.IsAbs(arg) {
			continue
		}

		dir := filepath.Clean(filepath.Dir(arg))
		if _, ok := seen[dir]; ok {
			continue
		}
		seen[dir] = struct{}{}
		// read-only grants access without breaking private-bin (CLI --whitelist does).
		extras = append(extras, "--read-only="+dir)
	}

	return extras
}

func shouldUseFirejail() bool {
	if envEnabled("SANDBOX_DISABLE_FIREJAIL") {
		return false
	}

	if !binaryExists("firejail") {
		log.Printf("firejail not found; falling back to direct execution")
		return false
	}

	return true
}

func sandboxedCommand(binary string, args []string, profile string, firejailExtras ...string) *exec.Cmd {
	if shouldUseFirejail() {
		finalArgs := []string{"--quiet"}
		finalArgs = append(finalArgs, firejailExtras...)
		if profile != "" {
			finalArgs = append(finalArgs, "--profile="+profile)
		}
		finalArgs = append(finalArgs, binary)
		finalArgs = append(finalArgs, args...)
		cmd := exec.Command("firejail", finalArgs...)
		cmd.Env = commandEnv()
		return cmd
	}

	cmd := exec.Command(binary, args...)
	cmd.Env = commandEnv()
	return cmd
}

// TODO: remove legacy shell path once all tools migrated to ToolRequest
func bufferedShellCommand(command string, profile string) *exec.Cmd {
	if binaryExists("stdbuf") {
		return sandboxedCommand("stdbuf", []string{"-oL", "-eL", "bash", "-c", command}, profile)
	}

	return sandboxedCommand("bash", []string{"-c", command}, profile)
}

func allowedJohnWordlists() []string {
	allowed := []string{"/usr/share/wordlists/rockyou.txt"}

	if custom := strings.TrimSpace(os.Getenv("ROCKYOU_WORDLIST")); custom != "" {
		allowed = append(allowed, filepath.Clean(custom))
	}

	if custom := strings.TrimSpace(os.Getenv("JOHN_WORDLIST_PATH")); custom != "" {
		allowed = append(allowed, filepath.Clean(custom))
	}

	if wd, err := os.Getwd(); err == nil {
		allowed = append(allowed,
			filepath.Join(wd, "orchestrator", "wordlist", "rockyou.txt"),
			filepath.Join(filepath.Dir(wd), "orchestrator", "wordlist", "rockyou.txt"),
			// Allow bundled wordlists
			filepath.Join(wd, "tools", "wordlists", "passwords.txt"),
			filepath.Join(filepath.Dir(wd), "tools", "wordlists", "passwords.txt"),
		)
	}

	return allowed
}

func validateTmpPath(path string) (string, error) {
	clean := filepath.Clean(path)
	if !strings.HasPrefix(clean, "/tmp/") {
		return "", fmt.Errorf("path must be under /tmp")
	}
	return clean, nil
}

func writeTempFiles(files []TempFile) ([]string, error) {
	written := make([]string, 0, len(files))

	for _, file := range files {
		path, err := validateTmpPath(file.Path)
		if err != nil {
			return nil, err
		}

		if err := os.WriteFile(path, []byte(file.Content), 0o600); err != nil {
			return nil, err
		}

		written = append(written, path)
	}

	return written, nil
}

func cleanupPaths(paths []string) {
	for _, path := range paths {
		clean, err := validateTmpPath(path)
		if err != nil {
			continue
		}
		_ = os.Remove(clean)
	}
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

	written, err := writeTempFiles(req.Files)
	if err != nil {
		http.Error(w, "Invalid john temp files: "+err.Error(), http.StatusBadRequest)
		return
	}
	defer cleanupPaths(written)
	defer cleanupPaths(req.Cleanup)

	args, err := validateJohnArgs(req.Cmd)
	if err != nil {
		http.Error(w, "Invalid john command: "+err.Error(), http.StatusBadRequest)
		return
	}

	flusher := sendHeaders(w)
	if flusher == nil {
		return
	}

	cmd, err := execJohn(args)
	if err != nil {
		fmt.Fprintf(w, "data: ERROR: %s\n\n", err)
		fmt.Fprintf(w, "data: EXIT_CODE: 1\n\n")
		fmt.Fprintf(w, "data: DONE\n\n")
		flusher.Flush()
		return
	}
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

		if arg == "--no-log" || arg == "--log-stderr" {
			clean = append(clean, arg)
			continue
		}

		if strings.HasPrefix(arg, "--format=") {
			clean = append(clean, arg)
			continue
		}

		if strings.HasPrefix(arg, "--pot=") {
			p := strings.TrimPrefix(arg, "--pot=")
			validatedPot, err := validateTmpPath(p)
			if err != nil {
				return nil, fmt.Errorf("pot file must be under /tmp")
			}
			clean = append(clean, "--pot="+validatedPot)
			continue
		}

		if strings.HasPrefix(arg, "--wordlist=") {
			wl := strings.TrimPrefix(arg, "--wordlist=")
			allowed := false
			for _, candidate := range allowedJohnWordlists() {
				if filepath.Clean(wl) == candidate {
					allowed = true
					break
				}
			}
			if !allowed {
				return nil, fmt.Errorf("unsupported wordlist path")
			}
			clean = append(clean, arg)
			continue
		}

		if strings.HasPrefix(arg, "-") {
			return nil, fmt.Errorf("unsupported option: %s", arg)
		}

		path, err := validateTmpPath(arg)
		if err != nil {
			return nil, fmt.Errorf("hash file must be under /tmp")
		}
		clean = append(clean, path)
	}

	if len(clean) == 0 {
		return nil, fmt.Errorf("no john args supplied")
	}

	return clean, nil
}

func execJohn(cmd []string) (*exec.Cmd, error) {
	johnPath, err := toolmanager.EnsureInstalled("john", func(msg string) {
		log.Println(msg)
	})
	if err != nil {
		return nil, fmt.Errorf("john not available: %w", err)
	}

	profile := profilePath("john.profile")
	return sandboxedCommand(johnPath, cmd, profile), nil
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

	lookupName := req.BinaryName
	if lookupName == "" {
		lookupName = req.Binary
	}

	// Auto-download binary if not installed
	resolvedBinary, err := toolmanager.EnsureInstalled(lookupName, func(msg string) {
		fmt.Fprintf(w, "data: [rootless] %s\n\n", msg)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	})
	if err != nil {
		fmt.Fprintf(w, "data: ERROR: could not install %s: %s\n\n", lookupName, err)
		fmt.Fprintf(w, "data: EXIT_CODE: 1\n\n")
		fmt.Fprintf(w, "data: DONE\n\n")
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		return
	}
	req.Binary = resolvedBinary

	finalArgs := append([]string{}, req.Args...)
	if req.Target != "" {
		finalArgs = append(finalArgs, req.Target)
	}

	log.Printf("RESOLVED BINARY: %s", resolvedBinary)
	cmd := sandboxedCommand(resolvedBinary, finalArgs, profile, extraFirejailWhitelist(finalArgs)...)
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

	cmd := bufferedShellCommand(command, profile)

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

/* ---------------- TOOL STATUS HANDLER ---------------- */

// GET /tool-status?tool=nmap
// Returns JSON: {"tool":"nmap","installed":true,"path":"/home/user/.rootless/bin/nmap"}
func toolStatusHandler(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("tool")
	if name == "" {
		http.Error(w, "missing tool param", http.StatusBadRequest)
		return
	}
	installed := toolmanager.IsInstalled(name)
	path := ""
	if installed {
		path, _ = toolmanager.BinaryPath(name)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	fmt.Fprintf(w, `{"tool":%q,"installed":%v,"path":%q}`, name, installed, path)
}

/* ---------------- MAIN ---------------- */

func main() {
	http.HandleFunc("/run-system", systemHandler)
	http.HandleFunc("/run-john", johnHandler)
	http.HandleFunc("/tool-status", toolStatusHandler)

	log.Println("Go sandbox listening on 127.0.0.1:9000")
	log.Fatal(http.ListenAndServe("127.0.0.1:9000", nil))
}
