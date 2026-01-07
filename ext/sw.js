// Copyright (C) 2025 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of Logibooks techdoc helper extension 
//
// ARCHITECTURE NOTE: Page-Activated Screenshot Extension
// =====================================================
// This extension is designed to be activated by host webpages, NOT by user clicks.
// The workflow requires persistent storage (via chrome.storage.local) because:
//
// 1. Page sends activation message with: target URL + upload endpoint + auth token
// 2. Extension navigates TO the target URL to capture screenshot
// 3. UI state must SURVIVE navigation to show screenshot interface on target page
// 4. Extension uploads screenshot and navigates BACK to original page
//
// Without persistent storage, the extension would lose UI state during navigation steps 2-4,
// making it impossible for the screenshot interface to appear on the target page.
// This service worker handles the persistent storage (chrome.storage.local) and navigation logic. 

const ALLOW_LIST = [
  "http://localhost:5177/",
  "<all_urls>"
];

// STATE MACHINE DOCUMENTATION
// ===========================
// Extension state transitions:
//
// "idle" → "navigating" → "awaiting_selection" → "uploading" → "idle"
//                       ↘                      ↙
//                         "idle" (on cancel/error)
//
// State Details:
// - idle: Ready for new activation, no active session
// - navigating: Navigating to target URL for screenshot
// - awaiting_selection: On target page, waiting for user to select area
// - uploading: Processing and uploading the selected screenshot
// 
// All error conditions and cancellations reset to "idle" state
const state = {
  status: "idle",        // Current state: "idle" | "navigating" | "awaiting_selection" | "uploading"
  tabId: null,           // Active tab ID for the current session
  returnUrl: null,       // Original page URL to return to after screenshot
  targetUrl: null,       // Target page URL where screenshot will be taken
  target: null,          // Upload endpoint URL
  token: null            // Authentication token for upload
};

let isUiVisible = false;

// Initialize UI visibility state from storage
async function initializeUiVisibility() {
  try {
    const result = await chrome.storage.local.get(["isUiVisible"]);
    if (result.isUiVisible !== undefined) {
      isUiVisible = result.isUiVisible;
    }
  } catch {
    // Ignore storage errors; UI visibility defaults to false
  }
}

// Save UI visibility state to storage
async function saveUiVisibility(visible) {
  isUiVisible = visible;
  try {
    await chrome.storage.local.set({ isUiVisible: visible });
  } catch {
    // Ignore storage errors; isUiVisible is already updated in memory
  }
}

// Initialize on service worker startup
initializeUiVisibility();

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  const newVisibility = !isUiVisible;
  await saveUiVisibility(newVisibility);
  
  try {
    if (newVisibility) {
      await chrome.tabs.sendMessage(tab.id, { 
        type: "SHOW_UI", 
        message: "Выберите область"
      });
    } else {
      // Note: This path may not be needed for page-activated extension
      // Consider removing action click handling entirely
    }
  } catch {
    // Tab may not have content script loaded; ignore messaging errors
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg?.type) return;

  if (msg.type === "PAGE_ACTIVATE") {
    // STATE: idle → navigating
    // Only accept new activations when idle to prevent concurrent sessions
    if (state.status !== "idle") return;
    const tabId = sender.tab?.id;
    if (tabId == null) return;
    // Move state out of "idle" immediately to avoid concurrent activations.
    state.status = "navigating";
    void handleActivation(tabId, sender.tab?.url, msg);
  }

  if (msg.type === "UI_SAVE") {
    // STATE: awaiting_selection → uploading
    // Only process save when waiting for selection on the correct tab
    if (state.status !== "awaiting_selection") return;
    if (sender.tab?.id !== state.tabId) return;
    void handleSave(msg.rect);
  }

  if (msg.type === "UI_CANCEL") {
    // STATE: any → idle
    // Cancel can happen from any state, always return to idle
    if (sender.tab?.id !== state.tabId) return;
    void handleCancel();
  }

  if (msg.type === "UI_READY") {
    const tabId = sender.tab?.id;
    if (tabId == null) return;
    void syncUiState(tabId);
  }
});



async function handleActivation(tabId, returnUrl, payload) {

  if (!payload?.url || typeof payload.url !== "string") {
    await reportError(new Error("Ошибка выбора страницы (1)"), tabId);
    return;
  }
  if (!payload?.target || typeof payload.target !== "string") {
    await reportError(new Error("Ошибка выбора страницы (2)"), tabId);
    return;
  }
  if (!returnUrl) {
    await reportError(new Error("Ошибка выбора страницы (3)"), tabId);
    return;
  }
  if (!isAllowed(payload.url)) {
    await reportError(new Error(`URL не разрешен: ${payload.url}`), tabId);
    return;
  }

  state.status = "navigating";
  state.tabId = tabId;
  state.returnUrl = returnUrl;
  state.targetUrl = payload.url;
  state.target = payload.target;
  state.token = typeof payload.token === "string" ? payload.token.trim() : null;

  try {
    await navigate(tabId, payload.url);
    await saveUiVisibility(true);
    state.status = "awaiting_selection";
    await sendMessageWithRetry(tabId, { 
      type: "SHOW_UI", 
      message: "Выберите область"
    });
  } catch (error) {
    await reportError(error, tabId);
  }
}

async function handleSave(rect) {
  try {
    // STATE: awaiting_selection → uploading
    // User selected area, now processing and uploading screenshot
    state.status = "uploading";
    
    if (!state.tabId || !state.target) {
      throw new Error("Активная сессия не найдена");
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: "png" });
    const blob = await cropDataUrl(dataUrl, rect);
    await apiUpload(state.target, rect, blob);
    
    // STATE: uploading → idle (via finishSession)
    await finishSession();
  } catch (error) {
    // STATE: uploading → idle (via reportError)
    await reportError(error, state.tabId);
  }
}

async function handleCancel() {
  // STATE: any → idle (via finishSession)
  // User cancelled, return to original page and reset
  await finishSession();
}

async function finishSession() {
  // STATE: any → idle (via resetState)
  // Clean up UI and navigate back to original page
  const { tabId, returnUrl } = state;
  await saveUiVisibility(false);
  if (tabId !== null && tabId !== undefined) {
    await sendMessageWithRetry(tabId, { type: "HIDE_UI" });
  }
  await resetState();  // → idle state
  if (tabId !== null && tabId !== undefined && returnUrl) {
    try {
      await navigate(tabId, returnUrl);
    } catch {
      // Navigation back to returnUrl may fail if tab was closed; ignore errors
    }
  }
}

async function resetState() {
  // STATE: any → idle
  // Reset all session data to initial state
  state.status = "idle";
  state.tabId = null;
  state.returnUrl = null;
  state.targetUrl = null;
  state.target = null;
  state.token = null;
}

async function reportError(error, tabId) {
  // STATE: any → idle
  // Error occurred, show error message and reset all session data
  console.error(error);
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  if (tabId !== null && tabId !== undefined) {
    await sendMessageWithRetry(tabId, { type: "SHOW_ERROR", message });
  }
  // Reset to idle state directly (not via resetState to avoid duplication)
  state.status = "idle";
  state.tabId = null;
  state.returnUrl = null;
  state.targetUrl = null;
  state.target = null;
  state.token = null;
}

async function syncUiState(tabId) {
  if (state.status === "awaiting_selection" || isUiVisible) {
    await sendMessageWithRetry(tabId, { 
      type: "SHOW_UI", 
      message: "Выберите область"
    });
  } 
}

async function sendMessageWithRetry(tabId, message, attempts = 3) {
  for (let i = 0; i < attempts; i += 1) {
    const success = await sendMessageOnce(tabId, message);
    if (success) {
      return true;
    }
    await delay(200);
  }
  return false;
}

function sendMessageOnce(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, () => {
      resolve(!chrome.runtime.lastError);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAllowed(url) {
  try {
    const urlObj = new URL(url);

    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      return false;
    }

    // If ALLOW_LIST explicitly contains the wildcard, accept any http(s) origin
    if (ALLOW_LIST.includes("<all_urls>")) return true;

    return ALLOW_LIST.some((allowed) => {
      try {
        const allowedObj = new URL(allowed);

        if (urlObj.origin !== allowedObj.origin) {
          return false;
        }

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

async function apiUpload(target, rect, blob) {
  const fd = new FormData();
  fd.append("rect", JSON.stringify(rect));
  // Backend expects an IFormFile named 'file'
  fd.append("file", blob, `snap-${Date.now()}.png`);
  const headers = {};
  if (state.token) {
    headers["Authorization"] = `Bearer ${state.token}`;
  }

  const r = await fetch(target, { method: "POST", body: fd, headers });
  if (!r.ok) throw new Error(`Ошибка POST ${target}: ${r.status}`);
}

function navigate(tabId, url) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Navigation timeout"));
    }, 60000);

    function listener(updatedTabId, info) {
      if (settled) return;
      if (updatedTabId !== tabId) return;
      if (info.status === "complete") {
        settled = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 250);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url, active: true });
  });
}

async function cropDataUrl(dataUrl, rect) {
  const img = await loadImage(dataUrl);

  const sx = clamp(rect.x, 0, img.width - 1);
  const sy = clamp(rect.y, 0, img.height - 1);
  const sw = clamp(rect.w, 1, img.width - sx);
  const sh = clamp(rect.h, 1, img.height - sy);

  if (sw < 5 || sh < 5) {
    throw new Error("Слишком маленький размер изображения (минимум 5px)");
  }

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  return await canvas.convertToBlob({ type: "image/png" });
}

async function loadImage(dataUrl) {
  let blob;
  if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
    const comma = dataUrl.indexOf(",");
    const header = dataUrl.substring(0, comma);
    const data = dataUrl.substring(comma + 1);
    const isBase64 = header.indexOf("base64") !== -1;
    const mimeMatch = header.match(/data:([^;]+)[;]?/);
    const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    if (isBase64) {
      const binary = atob(data);
      const len = binary.length;
      const u8 = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) u8[i] = binary.charCodeAt(i);
      blob = new Blob([u8], { type: mime });
    } else {
      blob = new Blob([decodeURIComponent(data)], { type: mime });
    }
  } else {
    const res = await fetch(dataUrl);
    if (!res.ok) throw new Error(`Не удалось загрузить изображение: ${res.status}`);
    blob = await res.blob();
  }

  return await createImageBitmap(blob);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Exports for unit testing
export {
  isAllowed,
  clamp,
  delay,
  sendMessageWithRetry,
  sendMessageOnce,
  loadImage,
  cropDataUrl,
  apiUpload,
  navigate,
  reportError,
  resetState,
  state
};
