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
```

The server will start on `http://localhost:3000`.

---

## Loading the Chrome extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `ext/` directory from this repository

The extension will now appear in your extensions list and toolbar.

---

## Using the extension

**Note:** Make sure the simulation server is running before using the extension.

1. **Click the extension icon** in your Chrome toolbar
2. The extension will:
   - Open or reuse a worker tab
   - Navigate to each URL from the `/next` endpoint on the simulation server
   - Prompt you to drag-select a rectangle on the page
   - Capture and crop the selected area
   - Upload the cropped PNG to the server (`sim-server/uploads/`)
   - Repeat until the server sends an end marker
