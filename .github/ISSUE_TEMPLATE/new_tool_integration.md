---
name: New tool integration
about: Propose adding a pentesting tool with preset-based, sandboxed execution
title: "[Tool] "
labels: tool-integration
assignees: ''
---

## Tool name

<!-- e.g. Gobuster, Masscan -->

## What it does

Brief description of the tool's purpose and typical use cases.

## Why it is safe to sandbox

Explain which capabilities the tool needs (network, raw sockets, filesystem paths, hardware access) and why a tight Firejail profile is feasible. Note anything that **cannot** be safely sandboxed.

## Proposed preset / flag schema

Presets only — no free-text flags. Example:

| Preset ID | Label | Fixed args | User-supplied params |
|-----------|-------|------------|----------------------|
| quick | Quick scan | `-foo`, `-bar` | `target` (hostname/CIDR) |

## Binary source

- Expected binary name on PATH or install method (package name, version):
- Upstream docs:
- Upstream source repo:

## Sandbox profile sketch

Filesystem paths to whitelist, capabilities required (`caps.keep`), network needs (`netfilter`, `net_raw`, etc.).

## Are you planning to open a PR?

- [ ] Yes — I will follow [CONTRIBUTING.md](../../CONTRIBUTING.md)
- [ ] No — requesting maintainer / community implementation

## Additional context

Related issues, prior art, or UX notes.