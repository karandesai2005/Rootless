// main.js
const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("path");
const os = require("os");

let mainWindow = null;

/* ---------------- Create Window ---------------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,

    webPreferences: {
      preload: path.join(__dirname, "preload.js"),

      // 🔒 SECURITY (DO NOT CHANGE)
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // 🔥 Remove default menu (File / Edit / View / Help)
  Menu.setApplicationMenu(null);

  mainWindow.loadFile("index.html");

  // 🔍 Enable Zoom In / Out / Reset (Ctrl + / Ctrl - / Ctrl 0)
  mainWindow.webContents.setZoomFactor(1.0);

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.control || input.meta) {
      const wc = mainWindow.webContents;

      if (input.key === "=" || input.key === "+") {
        wc.setZoomFactor(wc.getZoomFactor() + 0.1);
        event.preventDefault();
      }

      if (input.key === "-") {
        wc.setZoomFactor(wc.getZoomFactor() - 0.1);
        event.preventDefault();
      }

      if (input.key === "0") {
        wc.setZoomFactor(1.0);
        event.preventDefault();
      }
    }
  });

  // Open DevTools only in dev
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/* ---------------- Network Info IPC (CROSS-PLATFORM) ---------------- */
/*
  Uses Node.js os.networkInterfaces()
  Works on:
   - Linux
   - macOS
   - Windows
*/
ipcMain.handle("get-network-info", async () => {
  const nets = os.networkInterfaces();
  const result = [];

  for (const [name, entries] of Object.entries(nets)) {
    if (!entries) continue;

    const iface = {
      name,
      internal: false,
      mac: null,
      ipv4: [],
      ipv6: [],
    };

    for (const e of entries) {
      iface.internal = e.internal;

      if (e.mac && e.mac !== "00:00:00:00:00:00") {
        iface.mac = e.mac;
      }

      if (e.family === "IPv4") {
        iface.ipv4.push({
          address: e.address,
          netmask: e.netmask,
          cidr: e.cidr,
        });
      }

      if (e.family === "IPv6") {
        iface.ipv6.push({
          address: e.address,
          cidr: e.cidr,
        });
      }
    }

    result.push(iface);
  }

  return result;
});

/* ---------------- App Lifecycle ---------------- */

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // macOS standard behavior
  if (process.platform !== "darwin") {
    app.quit();
  }
});
