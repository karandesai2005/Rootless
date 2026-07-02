let tools = {};
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

let cursorEl = document.createElement("span");
cursorEl.id = "out-cursor";
cursorEl.textContent = "▋";

function showCursor() {
  if (!outEl.contains(cursorEl)) {
    outEl.appendChild(cursorEl);
  }
}

function hideCursor() {
  if (outEl.contains(cursorEl)) {
    cursorEl.remove();
  }
}

function log(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  
  const lower = String(msg).toLowerCase();
  if (lower.startsWith("[dracarys]") || lower.startsWith("[rootless]")) {
    el.className = "line-system";
  } else if (lower.includes("open") && /\d+\/tcp/.test(lower)) {
    el.className = "line-data";
  } else if (lower.startsWith("err:") || lower.includes("error")) {
    el.className = "line-error";
  } else if (lower.includes("[exit 0]") || lower.includes("done:") || lower.includes("finished")) {
    el.className = "line-success";
  } else if (lower.includes("starting") || lower.includes("nmap scan report") || lower.includes("host is up")) {
    el.className = "line-highlight";
  } else {
    el.className = "line-default";
  }

  el.style.animation = 'line-in 0.15s ease-out both';
  
  if (outEl.contains(cursorEl)) {
    outEl.insertBefore(el, cursorEl);
  } else {
    outEl.appendChild(el);
  }
  outEl.scrollTop = outEl.scrollHeight;
}

function clearLog() {
  outEl.innerHTML = "";
  if (cursorEl && outEl.contains(cursorEl)) {
    outEl.appendChild(cursorEl);
  }
}

function logJson(obj) {
  const lines = JSON.stringify(obj, null, 2).split("\n");
  for (const line of lines) {
    log(line);
  }
}

function setActiveTool(item) {
  document.querySelectorAll(".tool-item").forEach(element => {
    element.classList.remove("active");
  });
  item.classList.add("active");
}

function closeCurrentStream() {
  if (currentStream) {
    currentStream.close();
    currentStream = null;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function appendInput({ key, label, type = "text", required = false, placeholder = "", value = "" }) {
  const row = document.createElement("div");
  row.className = "input-row";

  const labelEl = document.createElement("label");
  labelEl.textContent = label;

  const input = document.createElement("input");
  input.type = type;
  input.dataset.key = key;
  input.required = required;
  input.placeholder = placeholder;
  input.value = value;

  row.appendChild(labelEl);
  row.appendChild(input);
  inputsEl.appendChild(row);
}

function appendSelect({ key, label, options, value = "" }) {
  const row = document.createElement("div");
  row.className = "input-row";

  const labelEl = document.createElement("label");
  labelEl.textContent = label;

  const select = document.createElement("select");
  select.dataset.key = key;

  options.forEach(option => {
    const optionEl = document.createElement("option");
    optionEl.value = option.id;
    optionEl.textContent = option.label;
    if (option.id === value) {
      optionEl.selected = true;
    }
    select.appendChild(optionEl);
  });

  row.appendChild(labelEl);
  row.appendChild(select);
  inputsEl.appendChild(row);
}

function readInputValues() {
  const values = {};

  inputsEl.querySelectorAll("[data-key]").forEach(element => {
    values[element.dataset.key] = element.value.trim();
  });

  return values;
}

function validateParams(tool, values) {
  for (const param of tool.params || []) {
    const value = values[param.key];
    if (param.required && !value) {
      throw new Error(`Missing required parameter: ${param.label || param.key}`);
    }
  }
}

function parseSseText(text) {
  const values = [];

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.startsWith("data:")) {
      continue;
    }

    values.push(rawLine.slice(5).trim());
  }

  return values;
}

function renderSseValue(value) {
  if (!value || value === "start") {
    return false;
  }

  if (value === "DONE") {
    return true;
  }

  if (value.startsWith("EXIT_CODE:")) {
    log(`[Exit ${value.split(":", 2)[1].trim()}]`);
    return false;
  }

  if (value.startsWith("[rootless]")) {
    log(`[dracarys] ${value.replace("[rootless] ", "")}`);
    return false;
  }

  log(value);
  return false;
}

async function runStandardTool(streamed) {
  if (!currentTool) {
    return;
  }

  closeCurrentStream();
  clearLog();

  let params;
  try {
    params = readInputValues();
    validateParams(currentTool, params);
  } catch (err) {
    log("[Error]");
    log(String(err.message || err));
    return;
  }

  if (streamed) {
    log("[Opening live stream]");
    showCursor();
    const streamUrl = window.api.getStreamUrl(currentTool.id, params);
    currentStream = new EventSource(streamUrl);

    currentStream.onmessage = event => {
      const shouldClose = renderSseValue(event.data);
      if (shouldClose) {
        closeCurrentStream();
        hideCursor();
      }
    };

    currentStream.onerror = () => {
      log("[Stream closed]");
      closeCurrentStream();
      hideCursor();
    };

    return;
  }

  log("[Running one-shot]");
  showCursor();
  try {
    const response = await window.api.runOnce(currentTool.id, params);
    parseSseText(response).forEach(renderSseValue);
  } catch (err) {
    log("[Error]");
    log(String(err));
  } finally {
    hideCursor();
  }
}

function renderNetworkInfo(interfaces) {
  const cards = interfaces.map(iface => {
    const ipv4 = iface.ipv4.length
      ? iface.ipv4.map(entry => `<div>${escapeHtml(entry.address)} ${escapeHtml(entry.cidr || "")}</div>`).join("")
      : "<div>None</div>";
    const ipv6 = iface.ipv6.length
      ? iface.ipv6.map(entry => `<div>${escapeHtml(entry.address)} ${escapeHtml(entry.cidr || "")}</div>`).join("")
      : "<div>None</div>";

    return `
      <div style="padding:14px;border:1px solid #1e293b;border-radius:12px;background:#0f172a;margin-bottom:12px;">
        <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(iface.name)}</div>
        <div style="color:#94a3b8;margin-bottom:6px;">${iface.internal ? "Internal" : "External"}${iface.mac ? ` | ${escapeHtml(iface.mac)}` : ""}</div>
        <div style="margin-bottom:6px;"><strong>IPv4</strong>${ipv4}</div>
        <div><strong>IPv6</strong>${ipv6}</div>
      </div>
    `;
  }).join("");

  netPanel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <h3 style="margin:0;">Network Interfaces</h3>
      <button id="closeNetPanel" style="background:#0f172a;color:#38bdf8;border:1px solid #1e293b;">Close</button>
    </div>
    ${cards || "<div>No interfaces found.</div>"}
  `;

  netPanel.style.display = "block";

  document.getElementById("closeNetPanel").onclick = () => {
    netPanel.style.display = "none";
  };
}

/* ---------------------- Load Tools ----------------------- */

async function loadTools() {
  try {
    tools = await window.api.listTools();
  } catch (err) {
    toolsListEl.textContent = "Failed to load tools";
    clearLog();
    log("[Error]");
    log(String(err));
    return;
  }

  customToolsEl.innerHTML = "";

  const customLabel = document.createElement("div");
  customLabel.className = "category-label";
  customLabel.textContent = "Custom";
  customToolsEl.appendChild(customLabel);

  const cryptoItem = document.createElement("div");
  cryptoItem.className = "tool-item";
  cryptoItem.textContent = "Crypto Identifier";
  cryptoItem.onclick = () => {
    setActiveTool(cryptoItem);
    selectTool({
      id: "crypto-identifier",
      name: "Crypto Identifier",
      description: "Identify hashes, tokens, and crypto-like encodings.",
      type: "custom",
    });
  };
  customToolsEl.appendChild(cryptoItem);

  toolsListEl.innerHTML = "";

  Object.entries(tools).forEach(([category, items]) => {
    const categoryLabel = document.createElement("div");
    categoryLabel.textContent = category;
    categoryLabel.className = "category-label";
    toolsListEl.appendChild(categoryLabel);

    items.forEach(tool => {
      const item = document.createElement("div");
      item.className = "tool-item";
      item.textContent = tool.name;
      item.onclick = () => {
        setActiveTool(item);
        selectTool(tool);
      };
      toolsListEl.appendChild(item);
    });
  });
}

/* ------------------- Render Selected Tool ------------------- */

function renderCryptoTool() {
  appendInput({
    key: "crypto_input",
    label: "Input",
    placeholder: "Paste hash/token/encoded text here...",
  });

  const textarea = inputsEl.querySelector("input[data-key='crypto_input']");
  const textAreaReplacement = document.createElement("textarea");
  textAreaReplacement.dataset.key = "crypto_input";
  textAreaReplacement.placeholder = textarea.placeholder;
  textarea.replaceWith(textAreaReplacement);

  const fileDiv = document.createElement("div");
  fileDiv.className = "input-row";

  const fileLabel = document.createElement("label");
  fileLabel.textContent = "Upload File";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.dataset.key = "crypto_file";

  fileDiv.appendChild(fileLabel);
  fileDiv.appendChild(fileInput);
  inputsEl.appendChild(fileDiv);

  const crackDiv = document.createElement("div");
  crackDiv.className = "input-row";

  const crackBtn = document.createElement("button");
  crackBtn.textContent = "Crack";
  crackBtn.id = "cryptoCrackBtn";
  crackBtn.onclick = async () => {
    await runCryptoCrack();
  };

  crackDiv.appendChild(crackBtn);
  inputsEl.appendChild(crackDiv);
}

function renderStandardTool(tool) {
  if (tool.scans && tool.scans.length) {
    appendSelect({
      key: "scan",
      label: "Scan Type",
      options: tool.scans,
      value: tool.default_scan || tool.scans[0].id,
    });
  }

  (tool.params || []).forEach(param => {
    appendInput({
      key: param.key,
      label: param.label || param.key,
      type: param.type || "text",
      required: Boolean(param.required),
      value: param.default || "",
    });
  });
}

function selectTool(tool) {
  closeCurrentStream();
  currentTool = tool;
  inputsEl.innerHTML = "";
  toolNameEl.textContent = `${tool.name} (${tool.id})`;

  if (tool.description) {
    const desc = document.createElement("p");
    desc.className = "tool-desc";
    desc.textContent = tool.description;
    inputsEl.appendChild(desc);
  }

  if (tool.id === "crypto-identifier") {
    renderCryptoTool();
    return;
  }

  renderStandardTool(tool);
}

/* ------------------- Crypto Detect ------------------- */

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

  try {
    const result = await window.api.detectCrypto(inputValue);
    logJson(result);
    log("[Finished]");
  } catch (err) {
    log("[Error]");
    log(String(err));
  }
}

/* ------------------- Crypto Crack ------------------- */

async function runCryptoCrack() {
  clearLog();
  log("[Starting crack process]");

  const textInput = inputsEl.querySelector("textarea[data-key='crypto_input']");
  const fileInput = inputsEl.querySelector("input[data-key='crypto_file']");
  const crackBtn = document.getElementById("cryptoCrackBtn");

  let inputValue = (textInput?.value || "").trim();

  if (!inputValue && fileInput?.files?.length) {
    inputValue = await fileInput.files[0].text();
  }

  if (!inputValue) {
    log("[Error]");
    log("Provide text input or upload a file.");
    return;
  }

  try {
    crackBtn.disabled = true;

    log("Detecting type...");
    const detect = await window.api.detectCrypto(inputValue);
    logJson(detect);

    if (!detect.john_format) {
      log("Unsupported hash type.");
      return;
    }

    log(`Detected ${detect.type}. Launching engine...`);

    const result = await window.api.crackCrypto(inputValue);
    logJson(result);

    if (result.cracked) {
      log(`Password: ${result.password}`);
    } else {
      log("No match found in wordlist.");
    }

    log("[Finished]");
  } catch (err) {
    log("[Error]");
    log(String(err));
  } finally {
    crackBtn.disabled = false;
  }
}

/* ----------------------- Actions ------------------------ */

runBtn.onclick = async () => {
  runBtn.style.animation = 'none';
  requestAnimationFrame(() => {
    runBtn.style.animation = 'btn-flare 0.4s ease-out';
  });

  if (!currentTool) {
    return;
  }

  if (currentTool.id === "crypto-identifier") {
    await runCryptoDetect("[Running one-shot]");
    return;
  }

  await runStandardTool(false);
};

runStreamBtn.onclick = async () => {
  if (!currentTool) {
    return;
  }

  if (currentTool.id === "crypto-identifier") {
    await runCryptoDetect("[Running streamed]");
    return;
  }

  await runStandardTool(true);
};

netBtn.onclick = async () => {
  if (netPanel.style.display === "block") {
    netPanel.style.display = "none";
    return;
  }

  try {
    const interfaces = await window.api.getNetworkInfo();
    renderNetworkInfo(interfaces);
  } catch (err) {
    clearLog();
    log("[Error]");
    log(String(err));
  }
};

window.addEventListener("beforeunload", closeCurrentStream);

/* -------------------- Init -------------------- */

window.addEventListener("DOMContentLoaded", loadTools);
