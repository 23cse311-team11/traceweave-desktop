import { app, BrowserWindow, ipcMain } from "electron";
import http from "http";
import https from "https";
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
// WEBSOCKET PLACEHOLDERS
// =====================================================

ipcMain.handle("ws-connect", async (_, payload) => {
  console.log("WS connect:", payload);
  return { success: true };
});

ipcMain.handle("ws-send", async (_, payload) => {
  console.log("WS send:", payload);
  return { success: true };
});

ipcMain.handle("ws-disconnect", async (_, payload) => {
  console.log("WS disconnect:", payload);
  return { success: true };
});