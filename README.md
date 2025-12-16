# 🛡️ Pentest Desktop

**A sandboxed, cross-platform pentesting desktop application**

Pentest Desktop is a security-focused desktop application that lets users run popular pentesting tools (like **Nmap**, **Gobuster**, etc.) in **isolated environments**, without installing tools directly on their system or dealing with VMs, dependency conflicts, or OS limitations.

The goal is simple:
**one install → all tools → secure by default → live streaming output**.

## ✨ Why Pentest Desktop?

Traditional pentesting setups are painful:

* Virtual machines are heavy and slow
* Tools are OS-specific and conflict with system packages
* Installing & maintaining toolchains is messy
* Running tools with sudo is risky

Pentest Desktop solves this by:

* Shipping tools **inside the app**
* Running them in **OS-level sandboxes**
* Granting **minimal privileges only when required**
* Streaming output live back to the UI

## 🧠 Architecture Overview

Pentest Desktop uses a **multi-layer, security-first architecture**.
<img width="1024" height="559" alt="image" src="https://github.com/user-attachments/assets/e3e6ad85-2d36-4add-bceb-b577ead01247" />


### High-level flow

```
Electron UI
   ↓ IPC
FastAPI Orchestrator
   ↓ HTTP + SSE
Go Sandbox
   ↓ exec
Firejail (Isolation)
   ↓
Pentesting Tool (Nmap, Gobuster, etc.)
   ↑
Live output streamed back to UI
```

### Layer responsibilities

* **Electron UI**

  * User selects tool and scan type
  * Displays real-time output
  * No direct system access

* **FastAPI Orchestrator (Python)**

  * Validates requests
  * Maps UI actions to tool commands
  * Acts as an SSE proxy

* **Go Sandbox**

  * Executes tools
  * Streams stdout/stderr in real time
  * Handles process lifecycle safely

* **Firejail (Linux isolation)**

  * Enforces filesystem, network, and capability restrictions
  * Grants capabilities like `net_raw` only when required

* **Pentesting Tools**

  * Run fully isolated
  * Can access the user’s network when explicitly allowed


## 🔍 Nmap Integration (Current Focus)

Nmap is treated as a **first-class tool**, not a raw command runner.

### Key design decisions

* ❌ No `sudo` in the UI
* ✅ Capability-based privileges via Firejail
* ✅ Different sandbox profiles for different scan types
* ✅ Live streaming output via SSE

### Example

Instead of users typing:

```bash
sudo nmap -sS -sV 192.168.1.0/24
```

They simply:

* Select **Stealth Scan**
* Enter the target
* Click **Run**

The app automatically:

* Chooses the correct flags
* Selects the privileged sandbox profile
* Streams output live

## 📺 Live Streaming Output

All tools stream output **in real time** back to the UI.
<img width="808" height="542" alt="image" src="https://github.com/user-attachments/assets/6ec3136d-165a-49f0-992f-e7ca93ca8e6e" />


This is achieved using:

* `stdbuf` for line-buffered output
* Parallel stdout/stderr streaming
* Server-Sent Events (SSE) end-to-end

No polling. No blocking. No fake progress bars.


## 🔐 Security Model

Pentest Desktop follows **least-privilege by design**.

* Tools run isolated from the host filesystem
* Network access is explicit and controlled
* Raw sockets are enabled **only when required**
* Renderer process never executes commands
* One-way trust: UI → Orchestrator → Sandbox

A compromised UI does **not** mean system compromise.

## 🧩 Tool Support (Planned & Ongoing)

* ✅ Nmap (in progress, first-class)
* 🔜 Gobuster
* 🔜 Wireless tools
* 🔜 WASM-based tools
* 🔜 Tool profiles & presets

---

## 🚧 Project Status

This project is **actively under development**.

Current focus:

* Perfecting Nmap execution
* Improving scan presets & UX
* Strengthening sandbox profiles
* Preparing for cross-platform support


## 📌 Roadmap (Short-term)

* Nmap scan presets (Quick / Service / Stealth / OS)
* UI-based flag selection (no manual flags)
* Tool-specific Firejail profiles
* Better error handling & reporting
* Documentation & threat model

## 🤝 Contributing

This project is in early stages.
Feedback, ideas, and discussions are welcome.


## 📜 License

TBD (will be added as the project stabilizes)

