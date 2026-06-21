# Threat Model

This document describes what Rootless protects, who might attack it, and how each layer responds. It is written for security-literate contributors and reviewers — not as marketing copy.

**Scope:** Electron UI → FastAPI orchestrator → Go sandbox runtime → Firejail (Linux) → host-installed tool binaries. Cross-platform sandbox backends and tool bundling are out of scope for this revision.

---

## System context

```
┌─────────────────────────────────────────────────────────────────┐
│                        Host operating system                     │
│  ┌──────────────┐    IPC/preload     ┌────────────────────────┐ │
│  │ Electron UI  │ ─────────────────► │ FastAPI orchestrator   │ │
│  │ (renderer)   │    HTTP/SSE        │ 127.0.0.1:8000           │ │
│  └──────────────┘                    └───────────┬────────────┘ │
│         │ no shell/exec                         │ HTTP POST     │
│         │                                       ▼               │
│                                    ┌────────────────────────┐   │
│                                    │ Go sandbox :9000       │   │
│                                    │ exec + stream          │   │
│                                    └───────────┬────────────┘   │
│                                                │ firejail       │
│                                                ▼               │
│                                    ┌────────────────────────┐   │
│                                    │ Tool process (nmap, …) │   │
│                                    │ + network ↔ scan target│   │
│                                    └────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

Trust flows **one way**: UI → Orchestrator → Sandbox → Tool. Lower layers do not trust higher layers; they validate and constrain.

---

## Trust boundaries

### B1: Renderer ↔ Orchestrator

| Property | Detail |
|----------|--------|
| Crossing | `preload.js` exposes fixed methods (`listTools`, `runOnce`, `getStreamUrl`, crypto helpers, `getNetworkInfo`). Renderer uses `fetch` / `EventSource` to `127.0.0.1:8000`. |
| Trust assumption | Renderer is **untrusted**. It may send malicious HTTP query strings, wrong presets, or oversized inputs. |
| Enforcement | Orchestrator validates `tool` against catalog, `scan` against allowlisted preset IDs in `/tools/{tool}.json`, and required parameters. No arbitrary command strings on the preset-driven path. |

**Gap:** Orchestrator CORS is `allow_origins=["*"]`. Acceptable while bound to localhost; risky if the API is ever exposed on a network interface without authentication.

### B2: Orchestrator ↔ Go sandbox

| Property | Detail |
|----------|--------|
| Crossing | HTTP JSON to `/run-system` or `/run-john`. SSE streamed back. |
| Trust assumption | Orchestrator is **semi-trusted** — compromised orchestrator can invoke any tool the sandbox accepts. |
| Enforcement | Preset path sends structured fields (`binary`, `args[]`, `target`, `profile`) — not a shell string. Legacy path accepts `{"cmd": "..."}` and runs `bash -c` under `system.profile` (higher risk; being phased out for new tools). |

### B3: Go sandbox ↔ Tool process

| Property | Detail |
|----------|--------|
| Crossing | `exec` via Firejail wrapper (`firejail --profile=… binary args… target`). |
| Trust assumption | Tool binary and scan **target network** are untrusted (malicious responses, parser bugs). |
| Enforcement | Firejail profile restricts filesystem, capabilities, and network stack exposure. Go runtime supervises lifecycle: start, stream, wait, exit — no persistent daemon, no re-parenting. |

**Gap:** If `firejail` is missing, `shouldUseFirejail()` falls back to **direct execution** of the binary on the host. This is logged but not fatal.

### B4: Sandbox / tool ↔ Host OS

| Property | Detail |
|----------|--------|
| Crossing | Syscalls, filesystem, network, capabilities. |
| Trust assumption | Tool process is **hostile** after spawn. |
| Enforcement (Linux + Firejail) | Profile-defined: `private-bin`, `caps.drop`, `private-tmp`, `private-dev`, `netfilter`, explicit `whitelist` paths. |

**Gap:** On **macOS and Windows**, the same Go binary runs but Firejail is unavailable — **no OS-level sandbox enforcement today**. The UI and orchestrator still run; tools execute with the privileges of the user running `sandbox-go`.

---

## Assets

| Asset | Why it matters |
|-------|----------------|
| Host filesystem | Read exfiltration, write persistence, SSH keys, cloud credentials. |
| Host network | Lateral movement, C2, scanning third parties from the user's identity. |
| Other host processes | Cross-process attack via `/proc`, Unix sockets, or shared resources. |
| Orchestrator integrity | Gateway to all tool execution; catalog tampering adds tools or flags. |
| User scan targets | Untrusted input to tool parsers (Nmap script output, malformed packets reflected to scanner). |
| Bundled / system tool binaries | Supply-chain compromise replaces `nmap` with malicious code. |

---

## Threat actors and scenarios

### TA1: Malicious contributor — sandbox profile PR

**Goal:** Merge a profile that whitelists `/`, allows `bash`, retains `setuid` capabilities, or enables `net` without `netfilter`.

**Impact:** Full host compromise on next tool run.

**Mitigation:** Mandatory security review for `/sandbox_profiles` and `/sandbox-go` (see [CONTRIBUTING.md](CONTRIBUTING.md)). Reviewers treat profiles as firewall rules: prove every whitelist and capability.

### TA2: Compromised Electron renderer

**Goal:** Escape to shell via Node, load remote code, or call orchestrator with arbitrary parameters.

**Impact:** Without orchestrator bugs, limited to **allowed tools and presets** — not arbitrary `rm -rf /`.

**Mitigation:** `contextIsolation`, `nodeIntegration: false`, `sandbox: true`, minimal preload API. Renderer cannot spawn processes.

**Residual risk:** If orchestrator accepts legacy `cmd` strings or preset schema allows injection via `target`, renderer could trigger dangerous **allowlisted** behavior (e.g. scanning unintended networks).

### TA3: Malicious scan target (network-facing)

**Goal:** Exploit tool parser bugs via crafted responses (e.g. malformed service banners, NSE script behavior).

**Impact:** Code execution **inside** the tool process — contained by Firejail on Linux if profile is tight; host escape requires kernel/Firejail/tool vulnerability chain.

**Mitigation:** Minimal capabilities in profile; no `sudo`; prefer connect scans over raw sockets where possible; keep tool versions documented.

### TA4: Supply chain — tool binary on host

**Goal:** Replace `/usr/bin/nmap` (or PATH binary) with trojaned build.

**Impact:** Malicious code runs **inside** sandbox constraints but still with whatever the profile allows (often network + some filesystem).

**Mitigation:** **None implemented yet** — no checksum pinning, no signed bundles, no immutable tool paths. Documented gap.

### TA5: Local attacker — orchestrator/sandbox ports

**Goal:** Another local user or process POSTs to `:8000` or `:9000`.

**Impact:** Run allowlisted tools as the Rootless user.

**Mitigation:** Services bind to localhost in default dev config; sandbox validates John args and `/tmp` paths. **No authentication** on HTTP APIs — assumes single-user workstation threat model.

---

## Per-layer mitigations

### Electron UI

- Renderer: no `require`, no `child_process`, no filesystem APIs.
- Main process: only `get-network-info` IPC (uses `os.networkInterfaces()` — no shell).
- Preload: fixed API surface; stream URLs built from query params, not user-defined URLs to arbitrary hosts.

### FastAPI orchestrator

- Tool allowlist: unknown `tool` → 400.
- Preset allowlist: `scan` must exist in `tools/{id}.json` `scans` map.
- Structured sandbox payload for integrated tools: `binary`, `args`, `target`, `profile` — orchestrator does not concatenate user input into shell commands on this path.
- John/crypto path: format mapped from detector; wordlist paths constrained in sandbox validator.

### Go sandbox runtime

- Resolves profile from `SANDBOX_PROFILE_DIR` or `sandbox_profiles/`.
- `runToolRequest`: appends `target` as final argv element; no shell interpolation.
- `validateJohnArgs`: allowlist for flags, `/tmp`-only hash/pot files, allowlisted wordlists.
- `streamProcess`: waits for exit; no detach, no setuid.
- `SANDBOX_DISABLE_FIREJAIL` and missing `firejail` → direct exec (dev/Docker only; must not be used for production Linux threat posture).

### Firejail profiles (Linux)

**Nmap (`sandbox_profiles/nmap.profile`):**

- `netfilter` — network allowed with filtering hook.
- `caps.drop all` — no raw sockets in current profile (TCP connect scans).
- `private-bin nmap` — only nmap visible in jail.
- `private-tmp`, `private-dev` — reduced filesystem exposure.

**John (`sandbox_profiles/john.profile`):**

- `private-bin john`; whitelists for `/usr/share/john`, `/etc/john`, rockyou wordlist.
- `protocol unix` — no outbound network for offline cracking.

**System / legacy (`sandbox-go/sandbox_profiles/system.profile`):**

- Used for `bash -c` legacy commands — broader than per-tool profiles; avoid for new integrations.

**Profile requirements for new tools (expected):**

| Control | Intent |
|---------|--------|
| `private-bin {tool}` | Single executable surface |
| `caps.drop all` + explicit `caps.keep` | Least privilege for raw ICMP/SYN/etc. |
| `whitelist` only required paths | No home directory, no `~/.ssh` |
| `private-tmp` | Ephemeral writes |
| `noroot` | No UID 0 inside jail |
| No `ignore` directives weakening defaults | Prevents accidental full access |

---

## Known gaps and explicit non-goals

| Gap | Status |
|-----|--------|
| macOS / Windows sandbox enforcement | **Not implemented.** Firejail is Linux-only. Cross-platform backends are roadmap items, not current behavior. |
| Tool binary verification | **Not implemented.** System PATH binaries are executed as-is. |
| Authenticated orchestrator API | **Not implemented.** Localhost trust model only. |
| Legacy `cmd` string execution | **Still present** for entries in `orchestrator/tools.json` without `/tools/{id}.json` file defs. New tools must use preset JSON path. |
| WASM tools | Catalog entries exist; orchestrator returns 400 — not enabled. |
| Gobuster / wireless tools in catalog | Listed in `tools.json` but **not** first-class integrations like Nmap (no `/tools/*.json`, no dedicated hardened profiles in tree). |
| Scan target validation | Target string passed to tool with minimal semantic validation (no strict CIDR/host allowlist). |
| Docker compose dev stack | Runs with `SANDBOX_DISABLE_FIREJAIL=1` — container isolation only, not Firejail. |

---

## Review process for new sandbox profiles

Every new or modified file under `/sandbox_profiles` (and execution changes in `/sandbox-go`) is a **new attack surface**:

1. Contributor follows the checklist in [CONTRIBUTING.md](CONTRIBUTING.md).
2. PR must check the security review box in the [pull request template](.github/PULL_REQUEST_TEMPLATE.md).
3. Reviewer verifies: binary allowlist, capability set, filesystem whitelists, network rules, absence of shell/profile escapes (`include` chains, `ignore` weakeners).
4. Reviewer confirms Linux + Firejail manual test notes in PR.
5. Merge blocked until explicit security sign-off.

Profiles are treated like production firewall policy — optimistic merges are unacceptable.

---

## Reporting vulnerabilities

See [SECURITY.md](SECURITY.md) for private disclosure. Do not file public issues for sandbox escapes or RCE chains.