window.addEventListener("DOMContentLoaded", () => {

  const outEl = document.getElementById('out');
  const runBtn = document.getElementById('runStream');

  runBtn.onclick = () => {
    const tool = document.getElementById('tool').value.trim();
    const target = document.getElementById('target').value.trim();

    if (!tool || !target) {
      outEl.textContent = "Error: Tool and Target are required.\n";
      return;
    }

    outEl.textContent = "[Connecting...]\n";
    console.log("🔥 Renderer: Creating EventSource directly...");

    // 1. Build the URL manually here (Standard Web API)
    //    We bypass window.api because EventSource objects cannot be passed through contextBridge.
    const url = `http://127.0.0.1:8000/stream?tool=${encodeURIComponent(tool)}&target=${encodeURIComponent(target)}`;
    
    // 2. Instantiate EventSource directly in the Renderer
    const evtSource = new EventSource(url);

    evtSource.onopen = () => {
      console.log("🔥 Renderer: EventSource OPEN");
      // Clear the "Connecting..." text or append to it
      outEl.textContent = "[Stream opened]\n"; 
    };

    evtSource.onmessage = (event) => {
      console.log("📩 Renderer message:", event.data);
      
      // Optional: Close stream if backend sends a specific "DONE" signal
      if (event.data.includes("DONE")) {
         evtSource.close();
         outEl.textContent += "\n[Finished]";
         return;
      }

      outEl.textContent += event.data + "\n";
    };

    evtSource.onerror = (err) => {
      console.error("❌ Renderer: EventSource ERROR:", err);
      
      // Check if the stream was closed by the server or a network error occurred
      if (evtSource.readyState === EventSource.CLOSED) {
        outEl.textContent += "[Stream closed]\n";
      } else {
        outEl.textContent += "[Connection error]\n";
      }
      
      // Close to prevent infinite retry loops if the server is down
      evtSource.close();
    };
  };

});