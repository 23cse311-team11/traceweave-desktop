import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL("http://localhost:3000");
}

ipcMain.handle('execute-request', async (event, payload) => {
    console.log('Execute request via Electron:', payload);

    return {
        status: 200,
        body: "Electron execution working"
    };
});

ipcMain.handle('ws-connect', async (event, payload) => {
    console.log('WS connect:', payload);
    return { success: true };
});

ipcMain.handle('ws-send', async (event, payload) => {
    console.log('WS send:', payload);
    return { success: true };
});

ipcMain.handle('ws-disconnect', async (event, payload) => {
    console.log('WS disconnect:', payload);
    return { success: true };
});

app.whenReady().then(createWindow);