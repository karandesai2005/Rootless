# 🔥 DRACARYS

**pentest tools. no installs.**

Dracarys (formerly Rootless) is an open-source, sandboxed pentesting desktop console. Run tools like **Nmap, Gobuster, Ffuf, Nikto, and John the Ripper** in isolated environments, without virtual machines, without local installations, and without unsafe sudo usage.

**One install → isolated tools → live output.**

---

## ✨ Features

* **🔥 Firejail Sandboxed:** Every tool runs in an isolated cage. `caps.drop all`, private-bin, network-scoped. Your system stays clean. (Linux MVP)
* **⚡ Live Streaming Output:** Results stream line by line via SSE. No waiting for scans to finish. Watch it happen in real time.
* **🛡️ No Shell Injection:** Preset-driven flags only. No free-text CLI input. The attack surface is a typed allowlist.
* **📦 Auto Binary Fetch:** Missing a tool? Dracarys downloads it, verifies SHA256, and caches it in your home directory. No `apt-get` needed.
* **🔍 Crypto Identifier:** Paste a hash, get the type back. MD5, SHA256, bcrypt, JWT, Base64 — all detected and crackable via John the Ripper.
* **🌐 Network Aware:** Live interface inspector shows your IPs, MACs, and CIDRs. Pick your target interface before you scan.

---

## 🧠 Architecture Overview

Dracarys uses a **layered, least-privilege architecture** with four distinct trust boundaries. The renderer has zero exec privilege, and the sandbox never touches the host filesystem.

```
Electron UI (Renderer)
   ↓ IPC (no Node.js access)
FastAPI Orchestrator (Python)
   ↓ HTTP + SSE (tool allowlist)
Go Sandbox Runtime
   ↓ exec.Command
Firejail (Linux isolation)
   ↓
Pentesting Tool (Nmap, Gobuster, John, etc.)
```

### Security & Threat Model
Dracarys is designed around least privilege and explicit trust boundaries. For assets, threat actors, per-layer mitigations, and known gaps (including platform parity), see **[THREAT_MODEL.md](THREAT_MODEL.md)**.

To report a vulnerability privately, see **[SECURITY.md](SECURITY.md)**.

---

## 🧩 Bundled Tools

* ✅ **Nmap** — Preset-based service and port scans, dedicated Firejail profile, live SSE streaming.
* ✅ **Gobuster** — Directory brute-forcing with built-in wordlists.
* ✅ **Crypto Identifier & Cracker** — Powered by John the Ripper.
* ✅ **Ffuf / Nikto** — Web fuzzing and scanning integrations.

> **Platform note:** Firejail is the only sandbox backend with enforcement in this release. Dracarys is currently a **Linux MVP**. On macOS and Windows, the stack requires future sandbox-exec or AppContainer implementations.

---

## 🚀 Getting Started (Development)

To run Dracarys locally from source, you need Node.js, Python 3, and Go installed.

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up the Python virtual environment:
   ```bash
   python3 -m venv orchestrator/.venv
   source orchestrator/.venv/bin/activate
   pip install -r orchestrator/requirements.txt
   ```
4. Fire it up:
   ```bash
   npm run dev
   ```

---

## 🤝 Contributing

We need you! Dracarys is built in public and relies on community contributions. 

Contributions are heavily welcome — especially tool integrations that follow the preset-only, sandboxed pattern, or implementations for Windows/macOS sandboxing. 

Read **[CONTRIBUTING.md](CONTRIBUTING.md)** for project layout, local dev setup, the step-by-step tool integration checklist, and PR review rules (sandbox profile changes require explicit security review).

---

## 📜 License

[Apache License 2.0](LICENSE) — Copyright 2026 Karan Desai
