import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "url";
import { CookieJar } from "tough-cookie";
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

const cookieJarPath = path.join(app.getPath("userData"), "cookie-jar.json");
let cookieJar;

function initCookieJar() {
  if (fs.existsSync(cookieJarPath)) {
    try {
      const data = fs.readFileSync(cookieJarPath, "utf-8");
      cookieJar = CookieJar.fromJSON(data);
    } catch (err) {
      console.error("Failed to load cookie jar:", err);
      cookieJar = new CookieJar();
    }
  } else {
    cookieJar = new CookieJar();
  }
}

function saveCookieJar() {
  try {
    fs.writeFileSync(cookieJarPath, JSON.stringify(cookieJar.toJSON()), "utf-8");
  } catch (err) {
    console.error("Failed to save cookie jar:", err);
  }
}

// Initialize on startup
app.whenReady().then(() => {
  initCookieJar();
  createWindow();
});

// --- Cookie IPC Handlers ---

ipcMain.handle("get-jar-cookies", async (_, { domain }) => {
  const serialized = cookieJar.toJSON();
  // ✨ FIX: tough-cookie v4 uses an array for serialized.cookies
  let cookies = Array.isArray(serialized.cookies) ? serialized.cookies : [];
  
  if (domain) {
    cookies = cookies.filter(c => c.domain.includes(domain));
  }
  return cookies;
});

ipcMain.handle("create-jar-cookie", async (_, { url, cookieString }) => {
  try {
    await cookieJar.setCookie(cookieString, url);
    saveCookieJar();
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("delete-jar-cookie", async (_, { domain, key }) => {
    const serialized = cookieJar.toJSON();
    serialized.cookies = (serialized.cookies || []).filter(c => !(c.domain === domain && c.key === key));
    
    cookieJar = CookieJar.fromJSON(serialized);
    saveCookieJar();
    return { success: true };
});

ipcMain.handle("clear-jar-cookies", async (_, { domain }) => {
  if (domain) {
    const serialized = cookieJar.toJSON();
    serialized.cookies = (serialized.cookies || []).filter(c => c.domain !== domain);
    cookieJar = CookieJar.fromJSON(serialized);
  } else {
    cookieJar.removeAllCookiesSync();
  }
  saveCookieJar();
  return { success: true };
});

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
  try {
    const config = data?.overrides?.config || data?.config || data?.payload?.config;
    const envVars = data?.environmentValues || {};
    
    if (!config) throw new Error("No config found in IPC payload");
    
    const { method, url, headers = {}, body } = config;
    const resolvedUrl = new URL(injectVariables(url, envVars));

    const injectedHeaders = {};
    Object.entries(headers).forEach(([k, v]) => {
      injectedHeaders[k] = injectVariables(v, envVars);
    });

    const existingCookies = injectedHeaders['Cookie'] || '';
    const jarCookies = await cookieJar.getCookieString(resolvedUrl.toString());
    
    if (jarCookies) {
      injectedHeaders['Cookie'] = existingCookies ? `${existingCookies}; ${jarCookies}` : jarCookies;
    }

    let form = null;
    let binaryStream = null;

    if (body?.type === "formdata") {
      form = new FormData();
      body.formdata.forEach((item) => {
        if (item.isFile) {
          if (item.path && fs.existsSync(item.path)) {
            form.append(item.key, fs.createReadStream(item.path));
          }
        } else {
          form.append(item.key, injectVariables(item.value, envVars));
        }
      });

      const ctKey = Object.keys(injectedHeaders).find(k => k.toLowerCase() === 'content-type');
      if (ctKey) delete injectedHeaders[ctKey];

      Object.assign(injectedHeaders, form.getHeaders());
    } 
    else if (body?.type === "binary" && body?.binaryFile?.path) {
        if (fs.existsSync(body.binaryFile.path)) {
            binaryStream = fs.createReadStream(body.binaryFile.path);
        }
    }

    const lib = resolvedUrl.protocol === "https:" ? https : http;
    const startTime = Date.now();

    return await new Promise((resolve) => {
      const req = lib.request(resolvedUrl, { method, headers: injectedHeaders }, (res) => {
        
        // ✨ 5. EXTRACT SET-COOKIE HEADERS AND SECURELY SAVE TO JAR
        const setCookieHeaders = res.headers['set-cookie'];
        if (setCookieHeaders) {
          setCookieHeaders.forEach(cookieStr => {
            try {
              cookieJar.setCookieSync(cookieStr, resolvedUrl.toString());
            } catch (err) {
              console.warn(`[Tough-Cookie] Rejected cookie from server: ${cookieStr}`, err.message);
            }
          });
          saveCookieJar();
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString();
          
          // ✨ FIX 1: Parse the body as JSON if possible
          let parsedData = rawBody;
          try {
            parsedData = JSON.parse(rawBody);
          } catch {
            // If it fails, keep it as a raw string (e.g. for HTML/text responses)
          }

          // ✨ FIX 2: Manually construct a `cookies` object for the frontend
          const cookiesObj = {};
          const setCookieHeaders = res.headers['set-cookie'];
          if (setCookieHeaders) {
              setCookieHeaders.forEach(cookieStr => {
                  // A standard Set-Cookie looks like: "session_id=123abc; Path=/; Secure"
                  // We split by ';' to get the first chunk, then split by '=' to get key/value
                  const primaryPart = cookieStr.split(';')[0]; 
                  const splitIndex = primaryPart.indexOf('=');
                  if (splitIndex > -1) {
                      const key = primaryPart.substring(0, splitIndex).trim();
                      const val = primaryPart.substring(splitIndex + 1).trim();
                      cookiesObj[key] = val;
                  }
              });
          }

          resolve({
            data: parsedData, // Now an Object (if it was JSON)
            status: res.statusCode,
            statusText: res.statusMessage || "OK",
            headers: res.headers,
            cookies: cookiesObj, // Now populated so the UI can render them!
            size: Buffer.byteLength(rawBody),
            duration: Date.now() - startTime,
          });
        });
      });

      req.on("error", (err) => {
        resolve({ error: err.message });
      });

      if (form) {
        form.pipe(req);
      } else if (binaryStream) {
        binaryStream.pipe(req);
      } else if (config.body?.raw) {
        req.write(injectVariables(config.body.raw, envVars));
        req.end();
      } else {
        req.end();
      }
    });

  } catch (err) {
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