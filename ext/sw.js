const API_BASE = "http://localhost:5177";
const ALLOW_LIST = [
  "http://localhost:5177/"
];

let running = false;
let workerTabId = null;

chrome.action.onClicked.addListener(async () => {
  if (running) return;
  running = true;
  try {
    await runLoop();
  } catch (e) {
    console.error(e);
  } finally {
    running = false;
  }
});

async function runLoop() {
  workerTabId = workerTabId ?? (await chrome.tabs.create({ url: "about:blank", active: true })).id;
  const currentWorkerTabId = workerTabId;

  try {
    while (true) {
      const next = await apiGetNext();
      if (next.end) {
        console.log("End marker received. Stopping.");
        break;
      }

      if (!isAllowed(next.url)) {
        console.warn("Blocked URL (not in allow-list):", next.url);
        // You can POST an error back to the server here if you want.
        continue;
      }

      await navigate(currentWorkerTabId, next.url);

      // Ask user to select a rectangle on the visible area.
      const rect = await requestUserSelection(currentWorkerTabId);

      // Capture and crop.
      const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: "png" });
      const blob = await cropDataUrl(dataUrl, rect);

      // Upload.
      await apiUpload(next, rect, blob);

      console.log("Uploaded:", next.id);
    }
  } finally {
    if (currentWorkerTabId !== null && currentWorkerTabId !== undefined) {
      try {
        await chrome.tabs.remove(currentWorkerTabId);
      } catch (e) {
        console.warn("Failed to remove worker tab", currentWorkerTabId, e);
      }
    }

   if (workerTabId === currentWorkerTabId) {
      workerTabId = null;
    }
  }
}

function isAllowed(url) {
  try {
    const urlObj = new URL(url);
    
    // Only allow http and https protocols
    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      return false;
    }
    
    // Check if the URL's origin and path match any allowed entry
    return ALLOW_LIST.some(allowed => {
      try {
        const allowedObj = new URL(allowed);
        
        // Compare origins (protocol + hostname + port)
        if (urlObj.origin !== allowedObj.origin) {
          return false;
        }
        
        // If the allowed entry has a path, ensure the URL's path starts with it
        const allowedPath = allowedObj.pathname;
        return urlObj.pathname.startsWith(allowedPath);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

async function apiGetNext() {
  const r = await fetch(`${API_BASE}/next`, { method: "GET" });
  if (!r.ok) throw new Error(`GET /next failed: ${r.status}`);
  return await r.json(); // { end: boolean, id, url }
}

async function apiUpload(next, rect, blob) {
  const fd = new FormData();
  fd.append("id", next.id);
  fd.append("url", next.url);
  fd.append("rect", JSON.stringify(rect));
  fd.append("image", blob, `snap-${next.id}.png`);

  const r = await fetch(`${API_BASE}/upload`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`POST /upload failed: ${r.status}`);
}

function navigate(tabId, url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Navigation timeout"));
    }, 60000);

    function listener(updatedTabId, info) {
      if (updatedTabId !== tabId) return;
      if (info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 250); // small settle delay
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url, active: true });
  });
}

function requestUserSelection(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.runtime.onMessage.removeListener(onMsg);
      // Tell the content script to clean up the selection UI on timeout
      chrome.tabs.sendMessage(tabId, { type: "CANCEL_SELECT" });
      reject(new Error("User selection timeout"));
    }, 10 * 60 * 1000);

    chrome.tabs.sendMessage(tabId, { type: "START_SELECT" });

    function onMsg(msg, sender) {
      if (settled) return;
      if (sender.tab?.id !== tabId) return;
      if (msg?.type === "RECT_SELECTED") {
        settled = true;
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(onMsg);
        resolve(msg.rect); // device-pixel rect: {x,y,w,h}
      } else if (msg?.type === "RECT_CANCEL") {
        settled = true;
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(onMsg);
        reject(new Error("User cancelled selection"));
      }
    }

    chrome.runtime.onMessage.addListener(onMsg);
  });
}

async function cropDataUrl(dataUrl, rect) {
  const img = await loadImage(dataUrl);

  const sx = clamp(rect.x, 0, img.width - 1);
  const sy = clamp(rect.y, 0, img.height - 1);
  const sw = clamp(rect.w, 1, img.width - sx);
  const sh = clamp(rect.h, 1, img.height - sy);

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  return await canvas.convertToBlob({ type: "image/png" });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
