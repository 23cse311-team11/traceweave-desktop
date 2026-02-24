import WebSocket from "ws";
import { injectVariables } from "./utils.js";

const activeWebSockets = new Map();

export const WsService = {
  async connect(event, payload) {
    const { connectionId, url, headers = {}, params = {}, environmentValues = {} } = payload;

    // 1. Clean up existing connection
    if (activeWebSockets.has(connectionId)) {
      activeWebSockets.get(connectionId).close();
      activeWebSockets.delete(connectionId);
    }

    // 2. Resolve URL and Params
    const resolvedUrl = new URL(injectVariables(url, environmentValues));
    Object.entries(params).forEach(([key, value]) => {
      const injectedValue = injectVariables(value, environmentValues);
      if (injectedValue) resolvedUrl.searchParams.set(key, injectedValue);
    });

    // 3. Resolve Headers
    const injectedHeaders = {};
    Object.entries(headers).forEach(([key, value]) => {
      injectedHeaders[key] = injectVariables(value, environmentValues);
    });

    try {
      const ws = new WebSocket(resolvedUrl.toString(), { headers: injectedHeaders });
      activeWebSockets.set(connectionId, ws);

      // 4. Event Forwarding
      ws.on("open", () => {
        event.sender.send("ws-event", { connectionId, type: "open" });
      });

      ws.on("message", (data) => {
        event.sender.send("ws-event", {
          connectionId,
          type: "message",
          data: data.toString(),
          timestamp: Date.now(),
        });
      });

      ws.on("error", (err) => {
        event.sender.send("ws-event", { connectionId, type: "error", error: err.message });
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
      return { success: false, error: err.message };
    }
  },

  async send(payload) {
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
  },

  async disconnect(payload) {
    const { connectionId } = payload;
    const ws = activeWebSockets.get(connectionId);
    if (ws) {
      ws.close();
      activeWebSockets.delete(connectionId);
    }
    return { success: true };
  }
};