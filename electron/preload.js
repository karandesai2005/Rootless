const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runStream: (tool, target) => {
    const url = `http://127.0.0.1:8000/stream?tool=${encodeURIComponent(tool)}&target=${encodeURIComponent(target)}`;
    console.log("🔥 Preload: EventSource ->", url);
    return new EventSource(url);   // ✅ FIXED
  }
});
