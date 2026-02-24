import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "url";
import path from "path";
import { CookieService } from "./services/cookieService.js";
import { executeHttpRequest } from "./services/requestService.js";
import { WsService } from "./services/wsService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL("http://localhost:3000");
}

// Initialize persistence and window
app.whenReady().then(() => {
  CookieService.init();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// =====================================================
// IPC ROUTING
// =====================================================

// HTTP Request
ipcMain.handle("execute-request", async (_, data) => {
  return await executeHttpRequest(data);
});

// WebSocket Handlers
ipcMain.handle("ws-connect", async (event, payload) => WsService.connect(event, payload));
ipcMain.handle("ws-send", async (_, payload) => WsService.send(payload));
ipcMain.handle("ws-disconnect", async (_, payload) => WsService.disconnect(payload));

// Cookie Jar Handlers
ipcMain.handle("get-jar-cookies", async (_, { domain }) => {
  const serialized = CookieService.getJar().toJSON();
  const cookies = Array.isArray(serialized.cookies) ? serialized.cookies : [];
  return domain ? cookies.filter(c => c.domain.includes(domain)) : cookies;
});

ipcMain.handle("create-jar-cookie", async (_, { url, cookieString }) => {
  try {
    await CookieService.getJar().setCookie(cookieString, url);
    CookieService.save();
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("delete-jar-cookie", async (_, { domain, key }) => {
  const jar = CookieService.getJar();
  const serialized = jar.toJSON();
  serialized.cookies = (serialized.cookies || []).filter(c => !(c.domain === domain && c.key === key));
  
  // Re-instantiate jar from filtered JSON
  CookieService.initFromData(serialized); 
  CookieService.save();
  return { success: true };
});

ipcMain.handle("clear-jar-cookies", async (_, { domain }) => {
  if (domain) {
    const jar = CookieService.getJar();
    const serialized = jar.toJSON();
    serialized.cookies = (serialized.cookies || []).filter(c => c.domain !== domain);
    CookieService.initFromData(serialized);
  } else {
    CookieService.getJar().removeAllCookiesSync();
  }
  CookieService.save();
  return { success: true };
});