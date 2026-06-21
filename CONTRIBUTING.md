# Contributing to Rootless

Thank you for contributing. Rootless is a layered security tool: changes that look small in one directory can expand the attack surface in another. Read [THREAT_MODEL.md](THREAT_MODEL.md) before touching sandbox or orchestration code.

## Project layout

| Path | Purpose | Language / style |
|------|---------|------------------|
| `/electron` | Desktop UI (renderer, preload bridge, main process) | JavaScript (CommonJS). Renderer has **no** Node.js access; all backend calls go through `preload.js`. Match existing patterns: `contextIsolation: true`, explicit `window.api` methods only. |
| `/orchestrator` | FastAPI service: tool catalog, request validation, preset → command mapping, SSE proxy to sandbox | Python 3. Tool definitions live in `/tools/*.json` (preferred) and legacy `orchestrator/tools.json`. Use type hints where the file already does; keep validation server-side. |
| `/sandbox-go` | Go HTTP runtime: spawns tools, streams stdout/stderr, applies Firejail profiles | Go 1.x. `gofmt` style. New execution paths require security review. |
| `/sandbox_profiles` | Firejail profiles consumed by `sandbox-go` at runtime | Firejail profile syntax. **Highest-risk surface** in the repo — every line can grant host access. |
| `/tools` | Preset/flag schemas per tool (`{tool}.json`) | JSON. Presets only — no free-text flags. Follow `tools/nmap.json` as the reference integration. |

Supporting paths (not primary contribution targets for tool integrations):

- `/sandbox-go/sandbox_profiles/` — fallback profiles used in some Docker layouts; prefer `/sandbox_profiles` at repo root for new tools.
- Root `package.json` — dev orchestration scripts (`npm run dev`).

## Local development setup

### Prerequisites

- **Linux** (recommended): Firejail for real sandbox behavior. Install `firejail`, `nmap`, Go, Python 3.10+, Node.js 18+.
- **macOS / Windows**: UI and orchestrator run; sandbox enforcement is **not** active without Firejail (see [THREAT_MODEL.md](THREAT_MODEL.md)).

### Electron UI

```bash
cd electron
npm install
npm start
```

The UI expects the orchestrator at `http://127.0.0.1:8000`. Start it first (below) or use `npm run dev` from the repo root.

### FastAPI orchestrator

```bash
cd orchestrator
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Listens on `http://127.0.0.1:8000`. Environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `GO_SANDBOX_URL` | `http://127.0.0.1:9000` | Go sandbox base URL |
| `TOOL_DEFINITION_DIR` | `../tools` | Directory of `*.json` tool schemas |

### Go sandbox runtime

```bash
cd sandbox-go   # or repo root
go run ./sandbox-go/main.go
```

Listens on `:9000`. Environment variables:

| Variable | Purpose |
|----------|---------|
| `SANDBOX_PROFILE_DIR` | Override profile search path (e.g. absolute path to `/sandbox_profiles`) |
| `SANDBOX_DISABLE_FIREJAIL=1` | Skip Firejail (Docker dev only — not for production Linux) |

### Full stack (recommended)

From repo root:

```bash
npm install
npm run dev
```

Starts orchestrator, sandbox, and Electron concurrently.

### Docker (optional)

```bash
docker compose up --build
```

Note: compose sets `SANDBOX_DISABLE_FIREJAIL=1` inside the sandbox container. Use native Linux + Firejail to test profile behavior accurately.

---

## Adding a new tool integration

This is the primary contribution path. Follow every step; do not skip the sandbox profile or preset schema.

**Reference implementation:** Nmap — `tools/nmap.json`, `sandbox_profiles/nmap.profile`, catalog entry in `orchestrator/tools.json`.

### Checklist

1. **Open an issue** (optional but recommended) using the [New Tool Integration](.github/ISSUE_TEMPLATE/new_tool_integration.md) template. Describe the tool, proposed presets, and why it is safe to sandbox.

2. **Create a Firejail profile** at `sandbox_profiles/{tool}.profile`:
   - Start from an existing profile (e.g. `nmap.profile` or `john.profile`).
   - Use `private-bin {binary}` to allow only the tool executable.
   - Drop capabilities by default (`caps.drop all`); add only what the tool needs (e.g. `net_raw` for SYN scans — justify in the PR).
   - Whitelist filesystem paths explicitly; default-deny everything else.
   - Do **not** grant a full shell, `noroot` bypass, or broad `whitelist /` patterns.
   - Document in the PR why each whitelist/network rule is required.

3. **Create a tool definition** at `tools/{tool}.json`:
   ```json
   {
     "id": "mytool",
     "name": "My Tool",
     "type": "system",
     "binary": "mytool",
     "profile": "mytool.profile",
     "scans": {
       "preset-id": {
         "label": "Human-readable preset name",
         "args": ["--fixed-flag", "-O"]
       }
     }
   }
   ```
   - `id` must be unique and match the filename stem.
   - `args` are **fixed per preset** — users never pass raw flags.
   - User-supplied values (targets, URLs) are passed separately as `target` by the orchestrator, not embedded in `args`.
   - No shell metacharacters, no `sudo`, no variable substitution inside `args`.

4. **Register the tool in the catalog** in `orchestrator/tools.json`:
   - Add an entry under the appropriate category (`network`, `web`, `wireless`, etc.) with matching `id`.
   - Legacy fields (`cmd`, `params`) may exist for older tools; new integrations should rely on `/tools/{tool}.json` for execution. The orchestrator merges file-based definitions into the catalog served at `GET /tools`.

5. **Verify orchestrator routing** in `orchestrator/app.py`:
   - Standard system tools with a file definition use `POST /run-system` with structured payload (`tool`, `binary`, `args`, `target`, `profile`) — no code change needed if you followed the JSON schema.
   - If the tool needs special handling (temp files, non-`/tmp` paths, custom validation), extend the orchestrator and sandbox **only** with allowlisted arguments — see `validateJohnArgs` in `sandbox-go/main.go` as the pattern. Expect mandatory security review.

6. **UI wiring** — usually automatic:
   - `renderer.js` loads `GET /tools` and renders `scans` as a preset dropdown and `params` as inputs.
   - If your tool needs a new parameter type (file upload, interface picker), extend `renderer.js` minimally and expose only typed fields — never a free-text command box.
   - Custom tool types (e.g. crypto flows) are separate; do not piggyback on them for standard CLI tools.

7. **Install the binary on the host** (out of scope for bundling in this pass): document the expected package name and minimum version in the PR. Rootless does not verify binary checksums yet.

8. **Test end-to-end on Linux with Firejail**:
   - `curl http://127.0.0.1:8000/tools` — tool appears with presets.
   - Run each preset from the UI or `GET /stream?tool={id}&scan={preset}&target={target}`.
   - Confirm output streams over SSE and the process exits cleanly.
   - Confirm the tool cannot read/write paths outside the profile (manual spot-check).

9. **Open a PR** using the PR template. If the PR touches `/sandbox_profiles` or `/sandbox-go`, **request explicit security review** before merge (see below).

---

## Pull request review expectations

| Change type | Review bar |
|-------------|------------|
| `/sandbox_profiles/**` | **Mandatory security review.** Profile changes define filesystem, network, and capability exposure. Treat every PR as a potential sandbox escape or privilege escalation. |
| `/sandbox-go/**` | **Mandatory security review.** Execution, validation, and process lifecycle logic lives here. |
| `/orchestrator/**` (tool routing, validation) | Security-aware review; orchestrator is the trust gateway. |
| `/tools/*.json`, `orchestrator/tools.json` | Review preset schemas for flag injection, unexpected binaries, or preset combinations that escalate privileges. |
| `/electron/**` | Verify no new Node exposure in renderer; preload API surface stays minimal. |

Maintainers may block merge until a security reviewer signs off on sandbox-related changes.

## Branch naming

```
<type>/<short-description>
```

Types: `feat`, `fix`, `docs`, `security`, `chore`, `refactor`

Examples: `feat/gobuster-presets`, `security/tighten-nmap-profile`, `docs/threat-model`

## Commit messages

Use imperative mood, concise subject (≤72 chars), optional body for *why*:

```
Add gobuster preset schema and sandbox profile

Restrict profile to gobuster binary and wordlist path.
No raw URL flags from UI.
```

Reference issues: `Fixes #12` or `Refs #12` in the body.

## Issues and pull requests

- One logical change per PR. Tool integration = profile + JSON schema + catalog entry in a single PR when possible.
- Link the issue in the PR description.
- For security fixes, **do not** open a public issue with exploit details — see [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Contributor Covenant Code of Conduct v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Report conduct concerns to the maintainers via GitHub or the private security contact in [SECURITY.md](SECURITY.md).