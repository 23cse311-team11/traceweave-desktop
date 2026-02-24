import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "url";
import path from "path";
import http from "http";
import https from "https";
import FormData from "form-data";
import fs from "fs";
import WebSocket from "ws";

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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// =====================================================
// ENV VARIABLE INJECTION
// =====================================================
function injectVariables(value, variables = {}) {
  if (typeof value !== "string") return value;
  return value.replace(/{{(.*?)}}/g, (_, key) => {
    const trimmed = key.trim();
    return variables[trimmed] ?? "";
  });
}

// =====================================================
// HTTP REQUEST HANDLER
// =====================================================
ipcMain.handle("execute-request", async (event, data) => {
  // console.log("\n--- [DEBUG] IPC REQUEST RECEIVED ---");
  
  try {
    const config = data?.overrides?.config || data?.config || data?.payload?.config;
    const envVars = data?.environmentValues || {};
    
    if (!config) throw new Error("No config found in IPC payload");
    
    const { method, url, headers = {}, body } = config;
    // console.log(`[Debug] Method: ${method}, Target URL: ${url}`);
    // console.log(`[Debug] Incoming Body Payload: ${body ? JSON.stringify(body, null, 2) : "No body"}`);
    
    const resolvedUrl = new URL(injectVariables(url, envVars));

    const injectedHeaders = {};
    Object.entries(headers).forEach(([k, v]) => {
      injectedHeaders[k] = injectVariables(v, envVars);
    });

    let form = null;
    let binaryStream = null;

    // --- FORM DATA DEBUGGING ---
    if (body?.type === "formdata") {
      // console.log("[Debug] Executing Form-Data request stream buildup...");
      form = new FormData();
      
      body.formdata.forEach((item) => {
        if (item.isFile) {
          // console.log(`[Debug] Attempting to attach file: Key="${item.key}", Path="${item.path}"`);
          
          if (item.path && fs.existsSync(item.path)) {
            const stats = fs.statSync(item.path);
            // console.log(`[Debug] Success: File found. Size: ${stats.size} bytes`);
            form.append(item.key, fs.createReadStream(item.path));
          } else {
            // console.error(`[Debug] Error: File path is invalid or missing: ${item.path}`);
          }
        } else {
          form.append(item.key, injectVariables(item.value, envVars));
        }
      });

      // CRITICAL: If the user set a Content-Type manually, it breaks the boundary.
      const ctKey = Object.keys(injectedHeaders).find(k => k.toLowerCase() === 'content-type');
      if (ctKey) {
        // console.log(`[Debug] Removing manual Content-Type: ${injectedHeaders[ctKey]} to allow boundary generation.`);
        delete injectedHeaders[ctKey];
      }

      const formHeaders = form.getHeaders();
      Object.assign(injectedHeaders, formHeaders);
      // console.log("[Debug] Final Form Headers:", formHeaders);
    } 
    
    else if (body?.type === "binary" && body?.binaryFile?.path) {
        // console.log(`[Debug] Detected Binary Stream: ${body.binaryFile.path}`);
        if (fs.existsSync(body.binaryFile.path)) {
            binaryStream = fs.createReadStream(body.binaryFile.path);
        } else {
            // console.error(`[Debug] Error: Binary file path is invalid: ${body.binaryFile.path}`);
        }
    }

    const lib = resolvedUrl.protocol === "https:" ? https : http;
    const startTime = Date.now();

    return await new Promise((resolve) => {
      const req = lib.request(resolvedUrl, { method, headers: injectedHeaders }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString();
          resolve({
            data: rawBody,
            status: res.statusCode,
            headers: res.headers,
            duration: Date.now() - startTime,
          });
        });
      });

      req.on("error", (err) => {
        // console.error("[Debug] Request Error:", err.message);
        resolve({ error: err.message });
      });

      // Streaming the body
      if (form) {
        // console.log("[Debug] Piping Form-Data to request...");
        form.pipe(req);
      } else if (binaryStream) {
        // console.log("[Debug] Piping Binary Stream to request...");
        binaryStream.pipe(req);
      } else if (config.body?.raw) {
        req.write(injectVariables(config.body.raw, envVars));
        req.end();
      } else {
        req.end();
      }
    });

  } catch (err) {
    // console.error("[Debug] Fatal Error:", err.message);
    return { error: err.message };
  }
});

// =====================================================
// WEBSOCKET EXECUTION LOGIC
// =====================================================
const activeWebSockets = new Map();

ipcMain.handle("ws-connect", async (event, payload) => {
  try {
    const { connectionId, url, headers = {}, params = {}, environmentValues = {} } = payload;

    if (activeWebSockets.has(connectionId)) {
      activeWebSockets.get(connectionId).close();
      activeWebSockets.delete(connectionId);
    }

    const resolvedUrl = injectVariables(url, environmentValues);
    const parsedUrl = new URL(resolvedUrl);

    Object.entries(params || {}).forEach(([key, value]) => {
      const injectedValue = injectVariables(value, environmentValues);
      if (injectedValue !== undefined && injectedValue !== null) {
        parsedUrl.searchParams.set(key, injectedValue);
      }
    });

    const injectedHeaders = {};
    Object.entries(headers || {}).forEach(([key, value]) => {
      injectedHeaders[key] = injectVariables(value, environmentValues);
    });

    const ws = new WebSocket(parsedUrl.toString(), { headers: injectedHeaders });
    activeWebSockets.set(connectionId, ws);

    ws.on("open", () => event.sender.send("ws-event", { connectionId, type: "open" }));
    ws.on("message", (data) => event.sender.send("ws-event", { connectionId, type: "message", data: data.toString(), timestamp: Date.now() }));
    ws.on("error", (err) => event.sender.send("ws-event", { connectionId, type: "error", error: err.message }));
    ws.on("close", (code, reason) => {
      event.sender.send("ws-event", { connectionId, type: "close", code, reason: reason.toString() });
      activeWebSockets.delete(connectionId);
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("ws-send", async (_, payload) => {
  const { connectionId, message } = payload;
  const ws = activeWebSockets.get(connectionId);

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { success: false, error: "WebSocket is not connected" };
  }

  try {
    ws.send(message);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("ws-disconnect", async (_, payload) => {
  const { connectionId } = payload;
  const ws = activeWebSockets.get(connectionId);

  if (ws) {
    ws.close();
    activeWebSockets.delete(connectionId);
  }
  return { success: true };
});