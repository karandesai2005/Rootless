package toolmanager

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// ToolSpec defines a downloadable tool binary
type ToolSpec struct {
	Name        string // tool name e.g. "nmap"
	Version     string // pinned version e.g. "7.95"
	URL         string // download URL for linux/amd64
	SHA256      string // expected hex sha256 of the downloaded file
	IsArchive   bool   // true if the download is a .tar.gz or .zip
	ArchivePath string // path inside archive to the binary e.g. "nmap-7.95/nmap"
}

// TOOL_REGISTRY is the pinned tool manifest.
// SHA256 values must be filled in after you download and hash each binary.
// Mark them as "FILL_IN" for now — I will verify and fill them manually.
var TOOL_REGISTRY = map[string]ToolSpec{
	"nmap": {
		Name:        "nmap",
		Version:     "7.99",
		URL:         "https://nmap.org/dist/nmap-7.99-1.x86_64.rpm",
		SHA256:      "d3128bd9c62643d77372fac0b8bddf8331a60d19ed2da14f9339844f64f7e9dd",
		IsArchive:   false,
		ArchivePath: "",
	},
	"gobuster": {
		Name:        "gobuster",
		Version:     "3.6.0",
		URL:         "https://github.com/OJ/gobuster/releases/download/v3.6.0/gobuster_Linux_x86_64.tar.gz",
		SHA256:      "871be404ce5f80c96b864586b3caa90f894598d1a8222ae316c19e5f70e04cfc",
		IsArchive:   true,
		ArchivePath: "gobuster",
	},
	"john": {
		Name:        "john",
		Version:     "1.9.0-jumbo-1",
		URL:         "https://github.com/karandesai2005/Rootless/releases/download/tools-v1/john-linux-x86_64",
		SHA256:      "FILL_IN",
		IsArchive:   false,
		ArchivePath: "",
	},
}

// RootlessDir returns ~/.rootless
func RootlessDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".rootless"), nil
}

// BinDir returns ~/.rootless/bin
func BinDir() (string, error) {
	base, err := RootlessDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "bin"), nil
}

// BinaryPath returns the full path for a tool binary
func BinaryPath(name string) (string, error) {
	bin, err := BinDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(bin, name), nil
}

// IsInstalled checks if the binary exists and is executable
func IsInstalled(name string) bool {
	path, err := BinaryPath(name)
	if err != nil {
		return false
	}
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.Mode()&0111 != 0
}

// EnsureInstalled checks if binary exists, downloads+verifies if not.
// Returns the path to the binary on success.
// progress is a callback called with status strings during download.
func EnsureInstalled(name string, progress func(string)) (string, error) {
	// Check system PATH first — if already installed, use it directly
	if systemPath, err := exec.LookPath(name); err == nil {
		progress(fmt.Sprintf("[rootless] %s found on system, using %s", name, systemPath))
		return systemPath, nil
	}

	// Check our cache next
	binaryPath, err := BinaryPath(name)
	if err != nil {
		return "", err
	}
	if IsInstalled(name) {
		return binaryPath, nil
	}

	// Not found anywhere — download it
	if runtime.GOOS != "linux" {
		return "", fmt.Errorf("auto-download only supported on linux (current: %s)", runtime.GOOS)
	}

	spec, ok := TOOL_REGISTRY[name]
	if !ok {
		return "", fmt.Errorf("tool %q not in registry and not found on system", name)
	}

	binDir, err := BinDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		return "", fmt.Errorf("create bin dir: %w", err)
	}

	progress(fmt.Sprintf("Downloading %s v%s...", spec.Name, spec.Version))

	tmpFile, err := os.CreateTemp("", "rootless-download-*")
	if err != nil {
		return "", fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	resp, err := http.Get(spec.URL)
	if err != nil {
		return "", fmt.Errorf("download %s: %w", spec.URL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("download %s: HTTP %d", spec.URL, resp.StatusCode)
	}

	hasher := sha256.New()
	writer := io.MultiWriter(tmpFile, hasher)

	if _, err := io.Copy(writer, resp.Body); err != nil {
		tmpFile.Close()
		return "", fmt.Errorf("write download: %w", err)
	}
	tmpFile.Close()

	progress(fmt.Sprintf("Verifying %s...", spec.Name))

	// Skip SHA256 check if placeholder not yet filled
	if spec.SHA256 != "FILL_IN" && spec.SHA256 != "" {
		actual := hex.EncodeToString(hasher.Sum(nil))
		if actual != spec.SHA256 {
			return "", fmt.Errorf("sha256 mismatch for %s: expected %s got %s",
				spec.Name, spec.SHA256, actual)
		}
	}

	if spec.IsArchive {
		progress(fmt.Sprintf("Extracting %s...", spec.Name))
		if err := extractBinary(tmpPath, spec.ArchivePath, binaryPath); err != nil {
			return "", fmt.Errorf("extract %s: %w", spec.Name, err)
		}
	} else {
		if err := os.Rename(tmpPath, binaryPath); err != nil {
			if err := copyFile(tmpPath, binaryPath); err != nil {
				return "", fmt.Errorf("install binary: %w", err)
			}
		}
	}

	if err := os.Chmod(binaryPath, 0o755); err != nil {
		return "", fmt.Errorf("chmod %s: %w", spec.Name, err)
	}

	progress(fmt.Sprintf("%s ready.", spec.Name))
	return binaryPath, nil
}

// extractBinary extracts a single file from a .tar.gz archive
func extractBinary(archivePath, innerPath, destPath string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()

	tr := tar.NewReader(gz)

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if hdr.Name == innerPath || filepath.Base(hdr.Name) == filepath.Base(innerPath) {
			out, err := os.Create(destPath)
			if err != nil {
				return err
			}
			defer out.Close()
			if _, err := io.Copy(out, tr); err != nil {
				return err
			}
			return nil
		}
	}
	return fmt.Errorf("binary %q not found in archive", innerPath)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
