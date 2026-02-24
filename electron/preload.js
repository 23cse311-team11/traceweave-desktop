const { contextBridge, ipcRenderer, webUtils } = require('electron');

// console.log("✅ PRELOAD LOADED");

contextBridge.exposeInMainWorld('electronAPI', {
    executeRequest: (payload) =>
        ipcRenderer.invoke('execute-request', payload),

    wsConnect: (payload) =>
        ipcRenderer.invoke('ws-connect', payload),

    wsSend: (payload) =>
        ipcRenderer.invoke('ws-send', payload),

    wsDisconnect: (payload) =>
        ipcRenderer.invoke('ws-disconnect', payload),

    onWsEvent: (callback) => {
        // Strip the event object and just pass the data to the frontend
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('ws-event', listener);
        
        // Return a cleanup function
        return () => {
            ipcRenderer.removeListener('ws-event', listener);
        };
    },

    getFilePath: (file) => {
        if (webUtils && webUtils.getPathForFile) {
            return webUtils.getPathForFile(file);
        }
        return file.path; // Fallback for older Electron versions
    }
});