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

  /* ========= CRYPTO IDENTIFIER ========= */

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
    fileInput.dataset.key = "crypto_file";

    fileDiv.appendChild(fileLabel);
    fileDiv.appendChild(fileInput);
    inputsEl.appendChild(fileDiv);

    const crackDiv = document.createElement("div");
    crackDiv.className = "input-row";

    const crackBtn = document.createElement("button");
    crackBtn.textContent = "Crack";
    crackBtn.id = "cryptoCrackBtn";

    crackDiv.appendChild(crackBtn);
    inputsEl.appendChild(crackDiv);

    crackBtn.onclick = async () => {
      await runCryptoCrack();
    };

    return;
  }

  /* fallback tools unchanged */
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

  const result = await window.api.detectCrypto(inputValue);
  logJson(result);
  log("[Finished]");
}

/* ------------------- Crypto Crack ------------------- */

async function runCryptoCrack() {
  clearLog();
  log("[Starting crack process…]");

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
      crackBtn.disabled = false;
      return;
    }

    log(`Detected ${detect.type}. Launching engine...`);

    const result = await window.api.crackCrypto(inputValue);
    logJson(result);

    if (result.cracked) {
      log(`✔ Password: ${result.password}`);
    } else {
      log("✖ No match found in wordlist.");
    }

    log("[Finished]");
  } catch (err) {
    log("[Error]");
    log(String(err));
  } finally {
    crackBtn.disabled = false;
  }
}

/* ----------------------- Run Buttons ------------------------ */

runBtn.onclick = async () => {
  if (!currentTool) return;

  if (currentTool.id === "crypto-identifier") {
    await runCryptoDetect("[Running one-shot…]");
    return;
  }
};

runStreamBtn.onclick = async () => {
  if (!currentTool) return;

  if (currentTool.id === "crypto-identifier") {
    await runCryptoDetect("[Running streamed…]");
    return;
  }
};

/* -------------------- Init -------------------- */

window.addEventListener("DOMContentLoaded", loadTools);