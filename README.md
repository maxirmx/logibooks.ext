# techdoc.exe
Chrome extension to support documentation generator

A Chrome Manifest V3 extension that:
- navigates to URLs from a server-controlled job queue,
- asks the user to select a rectangle in the visible viewport,
- captures and crops the selected area,
- uploads the resulting image back to the server,
- repeats until an end marker is received.

The repository includes a **local simulation server** for development and testing.

---

## Components

### 1. Chrome Extension (`/ext`)
- Manifest V3
- Visible-area capture using `chrome.tabs.captureVisibleTab`
- User-driven rectangle selection (drag overlay)
- Cropping via `OffscreenCanvas`
- Upload via `fetch` + `multipart/form-data`

### 2. Simulation Server (`/sim-server`)
- Node.js + Express
- Serves a queue of URLs from an allow-list
- Accepts uploaded screenshots
- Stores images and metadata locally

---

## Prerequisites

- Chrome (latest stable)
- Node.js ≥ 18

---

## Running the simulation server

```bash
cd sim-server
npm install
npm start
