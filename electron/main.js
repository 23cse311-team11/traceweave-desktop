import { app, BrowserWindow } from "electron";
import path from "path";

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // During development
  mainWindow.loadURL("http://localhost:3000");

  // Uncomment later for production
  // mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});