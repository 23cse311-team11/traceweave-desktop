import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "url";
import path from "path";
import http from "http";
import https from "https";
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
  console.log("IPC RECEIVED:", JSON.stringify(data, null, 2));

  try {
    const config =
      data?.payload?.overrides?.config ||
      data?.payload?.config; 

    const envVars = data?.payload?.environmentValues || {};

    if (!config?.url || !config?.method) {
      return { error: "Missing method or URL in config" };
    }

    const { method, url, headers = {}, params = {}, body } = config;

    // -----------------------------
    // URL + PARAM INJECTION
    // -----------------------------
    const resolvedUrl = injectVariables(url, envVars);
    const parsedUrl = new URL(resolvedUrl);

    Object.entries(params || {}).forEach(([key, value]) => {
      const injectedValue = injectVariables(value, envVars);
      if (injectedValue !== undefined && injectedValue !== null) {
        parsedUrl.searchParams.set(key, injectedValue);
      }
    });

    // -----------------------------
    // HEADER INJECTION
    // -----------------------------
    const injectedHeaders = {};
    Object.entries(headers || {}).forEach(([key, value]) => {
      injectedHeaders[key] = injectVariables(value, envVars);
    });

    const startTime = Date.now();
    const lib = parsedUrl.protocol === "https:" ? https : http;

    return await new Promise((resolve, reject) => {
      const req = lib.request(
        parsedUrl,
        { method, headers: injectedHeaders },
        (res) => {
          const chunks = [];

          res.on("data", (chunk) => chunks.push(chunk));

          res.on("end", () => {
            const rawBody = Buffer.concat(chunks).toString();

            let parsedData = rawBody;

            try {
              parsedData = JSON.parse(rawBody);
            } catch {
              // Not JSON, keep as string
            }

            resolve({
              data: parsedData,  // Axios-compatible
              status: res.statusCode,
              statusText: res.statusMessage,
              headers: res.headers,
              size: Buffer.byteLength(rawBody),
              duration: Date.now() - startTime,
            });
          });
        }
      );

      req.on("error", (err) => {
        console.error("REQUEST ERROR:", err);
        reject({ error: err.message });
      });

      // -----------------------------
      // BODY HANDLING WITH INJECTION
      // -----------------------------

      if (body?.type === "raw") {
        const injectedRaw = injectVariables(body.raw || "", envVars);
        req.write(injectedRaw);
      }

      else if (body?.type === "urlencoded") {
        const encoded = new URLSearchParams();
        body.urlencoded?.forEach((item) => {
          const injectedValue = injectVariables(item.value, envVars);
          encoded.append(item.key, injectedValue);
        });
        req.write(encoded.toString());
      }

      else if (body?.graphql) {
        const gqlString = injectVariables(
          JSON.stringify(body.graphql),
          envVars
        );
        req.write(gqlString);
      }

      else if (body?.type === "formdata") {
        console.warn("⚠️ Multipart form-data not implemented in Electron main yet.");
      }

      req.end();
    });

  } catch (err) {
    console.error("EXECUTION FAILED:", err);
    return { error: err.message };
  }
});


// =====================================================
// WEBSOCKET EXECUTION LOGIC
// =====================================================

const activeWebSockets = new Map();

ipcMain.handle("ws-connect", async (event, payload) => {
  console.log("WS Connect Request:", payload);
  try {
    const { connectionId, url, headers = {}, params = {}, environmentValues = {} } = payload;

    // 1. Clean up existing connection if it exists
    if (activeWebSockets.has(connectionId)) {
      activeWebSockets.get(connectionId).close();
      activeWebSockets.delete(connectionId);
    }

    // 2. URL and Param Injection
    const resolvedUrl = injectVariables(url, environmentValues);
    const parsedUrl = new URL(resolvedUrl);

    Object.entries(params || {}).forEach(([key, value]) => {
      const injectedValue = injectVariables(value, environmentValues);
      if (injectedValue !== undefined && injectedValue !== null) {
        parsedUrl.searchParams.set(key, injectedValue);
      }
    });

    // 3. Header Injection
    const injectedHeaders = {};
    Object.entries(headers || {}).forEach(([key, value]) => {
      injectedHeaders[key] = injectVariables(value, environmentValues);
    });

    // 4. Initialize Connection
    const ws = new WebSocket(parsedUrl.toString(), {
      headers: injectedHeaders,
    });

    activeWebSockets.set(connectionId, ws);

    // 5. Wire up Event Listeners to push data to the Renderer
    ws.on("open", () => {
      event.sender.send("ws-event", { connectionId, type: "open" });
    });

    ws.on("message", (data) => {
      // Data is a Buffer, convert to string for the frontend
      event.sender.send("ws-event", {
        connectionId,
        type: "message",
        data: data.toString(),
        timestamp: Date.now()
      });
    });

    ws.on("error", (err) => {
      console.error(`WS Error [${connectionId}]:`, err.message);
      event.sender.send("ws-event", {
        connectionId,
        type: "error",
        error: err.message,
      });
    });

    ws.on("close", (code, reason) => {
      event.sender.send("ws-event", {
        connectionId,
        type: "close",
        code,
        reason: reason.toString(),
      });
      activeWebSockets.delete(connectionId);
    });

    return { success: true };
  } catch (err) {
    console.error("WS CONNECTION FAILED:", err);
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