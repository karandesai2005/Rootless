// renderer.js

let tools = {};
let flatTools = {};
let currentTool = null;
let currentStream = null;

const toolsListEl = document.getElementById("toolsList");
const toolNameEl = document.getElementById("toolName");
const inputsEl = document.getElementById("inputs");
const outEl = document.getElementById("out");
const runBtn = document.getElementById("runBtn");
const runStreamBtn = document.getElementById("runStreamBtn");

function log(msg) {
  outEl.textContent += msg + "\n";
  outEl.scrollTop = outEl.scrollHeight;
}

function clearLog() {
  outEl.textContent = "";
}

/* ---------------------- Load Tools ----------------------- */

async function loadTools() {
  tools = await window.api.listTools();

  toolsListEl.innerHTML = "";
  flatTools = {};

  Object.keys(tools).forEach(category => {
    const catLabel = document.createElement("div");
    catLabel.textContent = `🔹 ${category}`;
    catLabel.style.margin = "10px 0 6px";
    toolsListEl.appendChild(catLabel);

    tools[category].forEach(t => {
      flatTools[t.id] = t;

      const item = document.createElement("div");
      item.className = "tool-item";
      item.textContent = t.name + " (" + t.id + ")";

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

/* ------------------- Render Selected Tool ------------------- */

function parsePlaceholders(str) {
  const out = [];
  const re = /\{([A-Z0-9_]+)\}/g;

  let m;
  while ((m = re.exec(str)) !== null) out.push(m[1]);

  if (!out.includes("TARGET")) out.push("TARGET");

  return out;
}

function selectTool(tool) {
  currentTool = tool;
  toolNameEl.textContent = `${tool.name} (${tool.id})`;
  inputsEl.innerHTML = "";

  const source = tool.type === "system" ? tool.cmd : (tool.module || "");
  const placeholders = parsePlaceholders(source);

  placeholders.forEach(ph => {
    const div = document.createElement("div");

    const label = document.createElement("label");
    label.textContent = ph;

    const input = document.createElement("input");
    input.dataset.key = ph;
    input.value = ph === "TARGET" ? "127.0.0.1" : "";

    div.appendChild(label);
    div.appendChild(input);
    inputsEl.appendChild(div);
  });
}

function collectParams() {
  const p = {};
  inputsEl.querySelectorAll("input").forEach(i => {
    p[i.dataset.key.toLowerCase()] = i.value;
  });
  return p;
}

/* ----------------------- Run (one-shot) ------------------------ */

runBtn.onclick = async () => {
  if (!currentTool) return;
  clearLog();
  log("[Running one-shot…]");

  try {
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

runStreamBtn.onclick = () => {
  if (!currentTool) return;

  clearLog();
  log("[Stream opened]");

  if (currentStream) {
    try { currentStream.close(); } catch {}
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

  evt.onerror = err => {
    log("[Connection error]");
    evt.close();
  };
};

/* -------------------- Initial Load -------------------- */
window.addEventListener("DOMContentLoaded", loadTools);
