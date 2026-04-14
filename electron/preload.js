// preload.js
const { contextBridge, ipcRenderer } = require("electron");

/*
  Secure bridge between Renderer and Backend
  - No Node.js access in renderer
  - Explicit APIs only
*/

const API_BASES = [
  "http://127.0.0.1:8000",
  "http://localhost:8000",
];

async function tryGet(path) {
  let lastError = "Unknown error";

  for (const base of API_BASES) {
    try {
      const res = await fetch(`${base}${path}`);
      if (!res.ok) {
        lastError = `Status ${res.status}`;
        continue;
      }

      return await res.text();
    } catch (err) {
      lastError = String(err);
    }
  }

  throw new Error(`Backend unreachable. Last error: ${lastError}`);
}

async function tryPost(path, body) {
  let lastError = "Unknown error";

  for (const base of API_BASES) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        lastError = data?.details || `Status ${res.status}`;
        continue;
      }

      return data;
    } catch (err) {
      lastError = String(err);
    }
  }

  throw new Error(`Backend unreachable. Last error: ${lastError}`);
}

contextBridge.exposeInMainWorld("api", {
  /* -------- Tool APIs -------- */

  listTools: async () => {
    const text = await tryGet("/tools");
    return JSON.parse(text);
  },

  runOnce: async (toolId, params) => {
    const query = new URLSearchParams({
      tool: toolId,
      ...params,
    }).toString();

    return await tryGet(`/stream?${query}`);
  },

  getStreamUrl: (toolId, params) => {
    return `${API_BASES[0]}/stream?${new URLSearchParams({
      tool: toolId,
      ...params,
    }).toString()}`;
  },

  /* -------- Crypto APIs -------- */

  detectCrypto: async input => {
    return await tryPost("/crypto/detect", { input });
  },

  crackCrypto: async input => {
    return await tryPost("/crypto/crack", { input });
  },

  /* -------- Network Info API -------- */

  getNetworkInfo: async () => {
    return await ipcRenderer.invoke("get-network-info");
  },
});
