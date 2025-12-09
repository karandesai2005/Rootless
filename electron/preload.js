const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runTool: async (payload) => {
    // basic client to your future Python orchestrator at :8000/run
    // we catch errors and return a JSON object consistently
    try {
      const res = await fetch('http://127.0.0.1:8000/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      return { ok: true, data: json };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
});
