const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 8000,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,

      // 🔥 REQUIRED FOR EventSource to localhost
      webSecurity: false,
      allowRunningInsecureContent: true
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
