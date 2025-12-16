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

  /* -------- Network Info API -------- */

  getNetworkInfo: async () => {
    return await ipcRenderer.invoke("get-network-info");
  },
});
