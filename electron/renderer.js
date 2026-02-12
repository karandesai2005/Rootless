// renderer.js

let tools = {};
let flatTools = {};
let currentTool = null;
let currentStream = null;

/* -------------------- DOM -------------------- */

const toolsListEl = document.getElementById("toolsList");
const customToolsEl = document.getElementById("customTools");
const toolNameEl = document.getElementById("toolName");
const inputsEl = document.getElementById("inputs");
const outEl = document.getElementById("out");
const runBtn = document.getElementById("runBtn");
const runStreamBtn = document.getElementById("runStreamBtn");

const netBtn = document.getElementById("netInfoBtn");
const netPanel = document.getElementById("netPanel");

/* -------------------- Helpers -------------------- */

function log(msg) {
  outEl.textContent += msg + "\n";
  outEl.scrollTop = outEl.scrollHeight;
}

function clearLog() {
  outEl.textContent = "";
}

function logJson(obj) {
  outEl.textContent += `${JSON.stringify(obj, null, 2)}\n`;
  outEl.scrollTop = outEl.scrollHeight;
}

/* ---------------------- Load Tools ----------------------- */

async function loadTools() {
  tools = await window.api.listTools();

  if (customToolsEl) {
    customToolsEl.innerHTML = "";

    const label = document.createElement("div");
    label.className = "category-label";
    label.textContent = "📂 Custom";
    customToolsEl.appendChild(label);

    const cryptoItem = document.createElement("div");
    cryptoItem.className = "tool-item";
    cryptoItem.textContent = "Crypto Identifier";
    cryptoItem.onclick = () => {
      document
        .querySelectorAll(".tool-item")
        .forEach(x => x.classList.remove("active"));
      cryptoItem.classList.add("active");
      selectTool({
        id: "crypto-identifier",
        name: "Crypto Identifier",
        description: "Identify hashes, tokens, and crypto-like encodings.",
        type: "custom",
      });
    };
    customToolsEl.appendChild(cryptoItem);
  }

  toolsListEl.innerHTML = "";
  flatTools = {};

  Object.keys(tools).forEach(category => {
    const catLabel = document.createElement("div");
    catLabel.textContent = `📂 ${category}`;
    catLabel.className = "category-label";
    toolsListEl.appendChild(catLabel);

    tools[category].forEach(t => {
      flatTools[t.id] = t;

      const item = document.createElement("div");
      item.className = "tool-item";
      item.textContent = t.name;

      item.onclick = () => {
        document
          .querySelectorAll(".tool-item")
          .forEach(x => x.classList.remove("active"));

        item.classList.add("active");
        selectTool(t);
      };

      toolsListEl.appendChild(item);
    });
  });
}

/* ------------------- Placeholder Parsing (legacy) ------------------- */

function parsePlaceholders(str) {
  const out = [];
  const re = /\{([A-Z0-9_]+)\}/g;
  let m;

  while ((m = re.exec(str)) !== null) out.push(m[1]);
  if (!out.includes("TARGET")) out.push("TARGET");

  return out;
}

/* ------------------- Render Selected Tool ------------------- */

function selectTool(tool) {
  currentTool = tool;
  inputsEl.innerHTML = "";
  toolNameEl.textContent = `${tool.name} (${tool.id})`;

  if (tool.description) {
    const desc = document.createElement("p");
    desc.className = "tool-desc";
    desc.textContent = tool.description;
    inputsEl.appendChild(desc);
  }

  /* ========= NMAP (PRESET UI) ========= */

  if (tool.id === "nmap") {
    // Target
    const targetDiv = document.createElement("div");
    targetDiv.className = "input-row";

    const targetLabel = document.createElement("label");
    targetLabel.textContent = "Target";

    const targetInput = document.createElement("input");
    targetInput.dataset.key = "target";
    targetInput.value = "127.0.0.1";

    targetDiv.appendChild(targetLabel);
    targetDiv.appendChild(targetInput);
    inputsEl.appendChild(targetDiv);

    // Scan type
    const scanDiv = document.createElement("div");
    scanDiv.className = "input-row";

    const scanLabel = document.createElement("label");
    scanLabel.textContent = "Scan Type";

    const scanSelect = document.createElement("select");
    scanSelect.dataset.key = "scan";

    const scans = [
      ["quick", "Quick Scan"],
      ["service", "Service Scan"],
      ["tcp", "TCP Connect Scan"],
      ["ping", "Ping Sweep"],
    ];

    scans.forEach(([value, label]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      scanSelect.appendChild(opt);
    });

    scanDiv.appendChild(scanLabel);
    scanDiv.appendChild(scanSelect);
    inputsEl.appendChild(scanDiv);

    const note = document.createElement("p");
    note.style.fontSize = "12px";
    note.style.color = "#94a3b8";
    note.textContent =
      "🔒 Stealth (-sS) and OS detection are disabled in sandbox for security reasons.";
    inputsEl.appendChild(note);

    return;
  }

  /* ========= CRYPTO IDENTIFIER (PRESET UI) ========= */

  if (tool.id === "crypto-identifier") {
    const inputDiv = document.createElement("div");
    inputDiv.className = "input-row";

    const inputLabel = document.createElement("label");
    inputLabel.textContent = "Input";

    const textarea = document.createElement("textarea");
    textarea.dataset.key = "crypto_input";
    textarea.placeholder = "Paste hash/token/encoded text here...";

    inputDiv.appendChild(inputLabel);
    inputDiv.appendChild(textarea);
    inputsEl.appendChild(inputDiv);

    const fileDiv = document.createElement("div");
    fileDiv.className = "input-row";

    const fileLabel = document.createElement("label");
    fileLabel.textContent = "Upload File";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".txt,.log,.json,.jwt,*/*";
    fileInput.dataset.key = "crypto_file";

    fileDiv.appendChild(fileLabel);
    fileDiv.appendChild(fileInput);
    inputsEl.appendChild(fileDiv);

    return;
  }

  /* ========= FALLBACK: LEGACY TOOLS ========= */

  let placeholders = [];

  if (tool.type === "system") placeholders = parsePlaceholders(tool.cmd);
  else if (tool.type === "wasm") placeholders = ["TARGET"];

  placeholders.forEach(ph => {
    const div = document.createElement("div");
    div.className = "input-row";

    const label = document.createElement("label");
    label.textContent = ph;

    const input = document.createElement("input");
    input.dataset.key = ph.toLowerCase();
    input.value = ph === "TARGET" ? "127.0.0.1" : "";

    div.appendChild(label);
    div.appendChild(input);
    inputsEl.appendChild(div);
  });
}

/* ------------------- Collect Params ------------------- */

function collectParams() {
  const p = {};
  inputsEl.querySelectorAll("input, select").forEach(el => {
    p[el.dataset.key] = el.value;
  });
  return p;
}

async function runCryptoDetect(modeLabel) {
  clearLog();
  log(modeLabel);

  const textInput = inputsEl.querySelector("textarea[data-key='crypto_input']");
  const fileInput = inputsEl.querySelector("input[data-key='crypto_file']");

  let inputValue = (textInput?.value || "").trim();

  if (!inputValue && fileInput?.files?.length) {
    inputValue = await fileInput.files[0].text();
  }

  if (!inputValue) {
    log("[Error]");
    log("Provide text input or upload a file.");
    return;
  }

  const result = await window.api.detectCrypto(inputValue);
  logJson(result);
  log("[Finished]");
}

/* ----------------------- Run (one-shot) ------------------------ */

runBtn.onclick = async () => {
  if (!currentTool) return;

  try {
    if (currentTool.id === "crypto-identifier") {
      await runCryptoDetect("[Running one-shot…]");
      return;
    }

    clearLog();
    log("[Running one-shot…]");

    const params = collectParams();
    const out = await window.api.runOnce(currentTool.id, params);
    log(out);
    log("[Finished]");
  } catch (e) {
    log("[Error]");
    log(String(e));
  }
};

/* ----------------------- Run Streamed ------------------------ */

runStreamBtn.onclick = async () => {
  if (!currentTool) return;

  if (currentTool.id === "crypto-identifier") {
    try {
      await runCryptoDetect("[Running streamed…]");
    } catch (e) {
      log("[Error]");
      log(String(e));
    }
    return;
  }

  clearLog();
  log("[Stream opened]");

  if (currentStream) {
    try {
      currentStream.close();
    } catch {}
  }

  const params = collectParams();
  const url = window.api.getStreamUrl(currentTool.id, params);

  const evt = new EventSource(url);
  currentStream = evt;

  evt.onmessage = e => {
    let d = e.data;
    if (d.startsWith("data:")) d = d.replace(/^data:\s*/i, "");

    log(d);

    if (d.includes("DONE")) {
      log("\n[Finished]");
      evt.close();
    }
  };

  evt.onerror = () => {
    log("[Connection error]");
    evt.close();
  };
};

/* ------------------- Network Info (CROSS-PLATFORM) ------------------- */

if (netBtn && netPanel) {
  netBtn.onclick = async () => {
    if (netPanel.style.display === "block") {
      netPanel.style.display = "none";
      return;
    }

    netPanel.style.display = "block";
    netPanel.innerHTML = "<h2>🌐 Network Interfaces</h2><p>Loading…</p>";

    try {
      const data = await window.api.getNetworkInfo(); // JSON
      netPanel.innerHTML = renderNetworkInfo(data);
    } catch (e) {
      netPanel.innerHTML = `<p style="color:red">Error: ${e}</p>`;
    }
  };
}

function renderNetworkInfo(data) {
  let html = `<h2 style="margin-bottom:12px">🌐 Network Interfaces</h2>`;

  data.forEach(iface => {
    html += `
      <div style="
        border:1px solid #1e293b;
        border-radius:14px;
        padding:14px;
        margin-bottom:14px;
        background:#020617;
      ">
        <div style="font-size:15px;font-weight:600;color:#38bdf8">
          ${iface.name} ${iface.internal ? "(loopback)" : ""}
        </div>
    `;

    if (iface.mac) {
      html += `<div style="color:#94a3b8">MAC: ${iface.mac}</div>`;
    }

    iface.ipv4.forEach(ip => {
      html += `
        <div style="margin-top:8px;color:#22d3ee;font-family:monospace">
          IPv4: ${ip.address} (${ip.cidr})
        </div>
      `;
    });

    iface.ipv6.forEach(ip => {
      html += `
        <div style="margin-top:4px;color:#a78bfa;font-family:monospace">
          IPv6: ${ip.address}
        </div>
      `;
    });

    if (iface.ipv4.length === 0 && iface.ipv6.length === 0) {
      html += `<div style="color:#64748b;margin-top:6px">No IP assigned</div>`;
    }

    html += `</div>`;
  });

  return html;
}

/* -------------------- Init -------------------- */

window.addEventListener("DOMContentLoaded", loadTools);
