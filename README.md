# TraceWeave Desktop

TraceWeave Desktop is the native Electron-based client for TraceWeave.

This application enables local request execution (including localhost endpoints) while keeping execution history and workspace data synchronized with the cloud backend.

It is designed to complement the web version of TraceWeave by providing:

* Local HTTP request execution
* GraphQL execution
* WebSocket connections
* Cookie management
* Secure IPC communication
* Future offline capability
* Localhost support without CORS restrictions

---

## Why Desktop?

Browsers enforce CORS and security restrictions that prevent direct interaction with local services.

The desktop app solves this by:

* Executing requests in the Electron main process
* Using Node.js networking APIs
* Bypassing browser-level CORS limitations
* Keeping the UI consistent with the web version

Execution happens locally, but history is still stored in the TraceWeave backend for collaboration and persistence.

---

## Architecture Overview

The desktop application follows a secure Electron architecture:

Renderer (Next.js UI)
→ IPC Bridge (Preload Script)
→ Main Process (Request Engine)
→ Target Server (Localhost or Internet)

The renderer never gets direct Node.js access.
All privileged operations go through controlled IPC channels.

---

## Development Setup

### Install Dependencies

```bash
npm install
```

### Run in Development Mode

Make sure the frontend dev server is running:

```bash
cd ../traceweave-frontend
npm run dev
```

Then start Electron:

```bash
cd ../desktop
npm start
```

---

## Security Design

The desktop app is configured with:

* contextIsolation enabled
* nodeIntegration disabled
* secure IPC channels
* no direct filesystem access from renderer

This ensures the UI cannot access system-level APIs directly.

---

## Long-Term Goals

* Shared request engine between backend and desktop
* Local workspace export/import
* Certificate handling
* Proxy configuration
* Plugin system
* Auto updates

---

## Repository Structure

```
desktop/
  electron/
    main.js
    preload.js
    ipc/
  package.json
  README.md
```

---

## Relationship With Web Version

The web version executes requests through the cloud backend.
The desktop version executes requests locally.

Both versions:

* Share the same UI
* Use the same backend for authentication
* Persist execution history in the same database

---

## License

Part of the TraceWeave project.