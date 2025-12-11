// preload.js
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("api", {
  listTools: async () => {
    const res = await fetch("http://127.0.0.1:8000/tools");
    return await res.json();
  },

  runOnce: async (toolId, params) => {
    const query = new URLSearchParams({ tool: toolId, ...params }).toString();
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
});
