const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  executeRequest: (payload) =>
    ipcRenderer.invoke("execute-request", payload),
});