import http from "http";
import https from "https";
import FormData from "form-data";
import fs from "fs";
import { injectVariables } from "./utils.js";
import { CookieService } from "./cookieService.js";

export async function executeHttpRequest(data) {
  const config = data?.overrides?.config || data?.config || data?.payload?.config;
  const envVars = data?.environmentValues || {};
  if (!config) throw new Error("No config found");

  const { method, url, headers = {}, body } = config;
  const resolvedUrl = new URL(injectVariables(url, envVars));
  const lib = resolvedUrl.protocol === "https:" ? https : http;

  // Header Preparation
  const injectedHeaders = {};
  Object.entries(headers).forEach(([k, v]) => {
    injectedHeaders[k] = injectVariables(v, envVars);
  });

  // Cookie Injection
  const existingCookies = injectedHeaders['Cookie'] || '';
  const jarCookies = await CookieService.getCookiesForUrl(resolvedUrl.toString());
  if (jarCookies) {
    injectedHeaders['Cookie'] = existingCookies ? `${jarCookies}; ${existingCookies}` : jarCookies;
  }

  // Body Handling
  let form = null;
  let binaryStream = null;
  if (body?.type === "formdata") {
    form = new FormData();
    body.formdata.forEach(item => {
      if (item.isFile && item.path && fs.existsSync(item.path)) {
        form.append(item.key, fs.createReadStream(item.path));
      } else {
        form.append(item.key, injectVariables(item.value, envVars));
      }
    });
    const ctKey = Object.keys(injectedHeaders).find(k => k.toLowerCase() === 'content-type');
    if (ctKey) delete injectedHeaders[ctKey];
    Object.assign(injectedHeaders, form.getHeaders());
  } else if (body?.type === "binary" && body?.binaryFile?.path) {
    if (fs.existsSync(body.binaryFile.path)) binaryStream = fs.createReadStream(body.binaryFile.path);
  }

  const startTime = Date.now();
  return new Promise((resolve) => {
    const req = lib.request(resolvedUrl, { method, headers: injectedHeaders }, (res) => {
      CookieService.setCookiesFromHeaders(res.headers, resolvedUrl.toString());
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString();
        let parsedData = rawBody;
        try { parsedData = JSON.parse(rawBody); } catch { }

        resolve({
          data: parsedData,
          status: res.statusCode,
          statusText: res.statusMessage || "OK",
          headers: res.headers,
          cookies: CookieService.parseCookiesToObj(res.headers['set-cookie']),
          size: Buffer.byteLength(rawBody),
          duration: Date.now() - startTime,
        });
      });
    });

    req.on("error", (err) => resolve({ error: err.message }));

    if (form) form.pipe(req);
    else if (binaryStream) binaryStream.pipe(req);
    else if (config.body?.raw) {
      req.write(injectVariables(config.body.raw, envVars));
      req.end();
    } else req.end();
  });
}