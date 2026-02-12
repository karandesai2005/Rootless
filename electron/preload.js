// preload.js
const { contextBridge, ipcRenderer } = require("electron");

/*
  Secure bridge between Renderer and Backend
  - No Node.js access in renderer
  - Explicit APIs only
*/

contextBridge.exposeInMainWorld("api", {
  /* -------- Tool APIs -------- */

  listTools: async () => {
    const res = await fetch("http://127.0.0.1:8000/tools");
    return await res.json();
  },

  runOnce: async (toolId, params) => {
    const query = new URLSearchParams({
      tool: toolId,
      ...params,
    }).toString();

    const url = `http://127.0.0.1:8000/stream?${query}`;
    const res = await fetch(url);
    return await res.text();
  },

  getStreamUrl: (toolId, params) => {
    return `http://127.0.0.1:8000/stream?${new URLSearchParams({
      tool: toolId,
      ...params,
    }).toString()}`;
  },

  detectCrypto: async input => {
    const endpoints = [
      "http://localhost:5000/crypto/detect",
      "http://127.0.0.1:5000/crypto/detect",
      "http://localhost:5001/crypto/detect",
      "http://127.0.0.1:5001/crypto/detect",
    ];

    let lastError = "Unknown error";

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ input }),
        });

        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          lastError = body?.details || `Request failed with status ${res.status}`;
          continue;
        }

        return body;
      } catch (err) {
        lastError = String(err);
      }
    }

    throw new Error(
      `Crypto API unreachable on localhost ports 5000/5001. Last error: ${lastError}`
    );
  },

  /* -------- Network Info API -------- */

  getNetworkInfo: async () => {
    return await ipcRenderer.invoke("get-network-info");
  },
});
