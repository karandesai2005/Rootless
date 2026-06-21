# Security Policy

## Supported versions

Rootless is pre-1.0 and under active development. Security fixes land on `main`. There are no long-term release branches yet.

## Reporting a vulnerability

**Do not** open a public GitHub issue for sandbox escapes, remote code execution, privilege escalation, or other security vulnerabilities.

Report privately using one of:

1. **[GitHub Security Advisories](https://github.com/karandesai2005/Rootless/security/advisories/new)** (preferred) — use "Report a vulnerability" on the repository Security tab.
2. **Maintainer contact** — if Advisories are unavailable, open a minimal public issue asking for a private security contact without including exploit details.

Include:

- Description and impact
- Affected component (Electron, orchestrator, sandbox-go, Firejail profile, specific tool preset)
- Steps to reproduce (proof-of-concept)
- Environment (OS, Firejail version, Rootless commit)
- Suggested fix or mitigation, if any

## What we consider in scope

- Sandbox escape from a tool process to the host
- Arbitrary command execution outside allowlisted presets
- Privilege escalation via profile misconfiguration or orchestrator bypass
- Renderer → host compromise via unintended Node/shell access
- Local API abuse on `:8000` / `:9000` that exceeds the intended trust model

## Out of scope (for now)

- Vulnerabilities in upstream tool binaries (Nmap, John, etc.) — report to upstream; we may document version pins separately
- Attacks requiring physical access or a fully compromised host OS outside Rootless
- Social engineering or missing authentication on intentionally localhost-bound dev services (documented in [THREAT_MODEL.md](THREAT_MODEL.md))

## Response expectations

- **Acknowledgment:** within 7 days
- **Triage:** within 14 days
- **Fix or mitigation plan:** depends on severity; critical sandbox escapes are prioritized

We will coordinate disclosure timing with reporters and credit them in the advisory unless they prefer anonymity.

## Secure development

Contributors adding tools or sandbox profiles must follow [CONTRIBUTING.md](CONTRIBUTING.md) and [THREAT_MODEL.md](THREAT_MODEL.md). Profile changes require explicit security review before merge.