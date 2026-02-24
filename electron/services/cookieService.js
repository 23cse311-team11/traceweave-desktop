import { CookieJar } from "tough-cookie";
import { app } from "electron";
import path from "path";
import fs from "fs";

const cookieJarPath = path.join(app.getPath("userData"), "cookie-jar.json");
let cookieJar;

export const CookieService = {
  init() {
    if (fs.existsSync(cookieJarPath)) {
      try {
        cookieJar = CookieJar.fromJSON(fs.readFileSync(cookieJarPath, "utf-8"));
      } catch { cookieJar = new CookieJar(); }
    } else {
      cookieJar = new CookieJar();
    }
  },

  // Added this to support the delete/clear logic in main.js
  initFromData(jsonData) {
    cookieJar = CookieJar.fromJSON(JSON.stringify(jsonData));
  },

  save() {
    fs.writeFileSync(cookieJarPath, JSON.stringify(cookieJar.toJSON()), "utf-8");
  },

  getJar() { return cookieJar; },

  async getCookiesForUrl(url) {
    return await cookieJar.getCookieString(url);
  },

  async setCookiesFromHeaders(headers, url) {
    const setCookie = headers['set-cookie'];
    if (setCookie) {
      setCookie.forEach(c => {
        try {
          cookieJar.setCookieSync(c, url);
        } catch (e) {
          console.warn("[CookieService] Rejected cookie:", e.message);
        }
      });
      this.save();
    }
  },

  parseCookiesToObj(setCookieHeaders) {
    const cookiesObj = {};
    if (setCookieHeaders) {
      setCookieHeaders.forEach(cookieStr => {
        const primaryPart = cookieStr.split(';')[0];
        const splitIndex = primaryPart.indexOf('=');
        if (splitIndex > -1) {
          const key = primaryPart.substring(0, splitIndex).trim();
          const val = primaryPart.substring(splitIndex + 1).trim();
          cookiesObj[key] = val;
        }
      });
    }
    return cookiesObj;
  }
};