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

    // --- COOKIE HANDLERS ---
    getJarCookies: (payload) => ipcRenderer.invoke('get-jar-cookies', payload),
    createJarCookie: (payload) => ipcRenderer.invoke('create-jar-cookie', payload),
    deleteJarCookie: (payload) => ipcRenderer.invoke('delete-jar-cookie', payload),
    clearJarCookies: (payload) => ipcRenderer.invoke('clear-jar-cookies', payload),

    getFilePath: (file) => {
        if (webUtils && webUtils.getPathForFile) {
            return webUtils.getPathForFile(file);
        }
        return file.path; // Fallback for older Electron versions
    }
});