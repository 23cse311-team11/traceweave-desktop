const { contextBridge, ipcRenderer } = require('electron');

console.log("✅ PRELOAD LOADED");

contextBridge.exposeInMainWorld('electronAPI', {
    executeRequest: (payload) =>
        ipcRenderer.invoke('execute-request', payload),

    wsConnect: (payload) =>
        ipcRenderer.invoke('ws-connect', payload),

    wsSend: (payload) =>
        ipcRenderer.invoke('ws-send', payload),

    wsDisconnect: (payload) =>
        ipcRenderer.invoke('ws-disconnect', payload),
});