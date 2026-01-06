// Copyright (C) 2025 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of Logibooks techdoc helper extension 

const ALLOW_LIST = [
  "http://localhost:5177/",
  "<all_urls>"
];

const state = {
  status: "idle",
  tabId: null,
  returnUrl: null,
  targetUrl: null,
  target: null,
  token: null
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
      await chrome.tabs.sendMessage(tab.id, { type: "HIDE_UI" });
    }
  } catch {
    // Tab may not have content script loaded; ignore messaging errors
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg?.type) return;

  if (msg.type === "PAGE_ACTIVATE") {
    if (state.status !== "idle") return;
    const tabId = sender.tab?.id;
    if (tabId == null) return;
    // Move state out of "idle" immediately to avoid concurrent activations.
    state.status = "navigating";
    void handleActivation(tabId, sender.tab?.url, msg);
  }

  if (msg.type === "UI_SAVE") {
    if (state.status !== "awaiting_selection") return;
    if (sender.tab?.id !== state.tabId) return;
    void handleSave(msg.rect);
  }

  if (msg.type === "UI_CANCEL") {
    if (sender.tab?.id !== state.tabId) return;
    void handleCancel();
  }

  if (msg.type === "UI_READY") {
    const tabId = sender.tab?.id;
    if (tabId == null) return;
    void syncUiState(tabId);
  }

  if (msg.type === "HIDE_UI") {
    void (async () => {
      await saveUiVisibility(false);
      await broadcastUiVisibility();
    })();
  }
});

async function broadcastUiVisibility() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "HIDE_UI" });
    } catch {
      // Tab may not have content script loaded; ignore messaging errors
    }
  }
}

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
    state.status = "uploading";
    if (!state.tabId || !state.target) {
      throw new Error("Активная сессия не найдена");
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: "png" });
    const blob = await cropDataUrl(dataUrl, rect);
    await apiUpload(state.target, rect, blob);
    await finishSession();
  } catch (error) {
    await reportError(error, state.tabId);
  }
}

async function handleCancel() {
  await finishSession();
}

async function finishSession() {
  const { tabId, returnUrl } = state;
  await saveUiVisibility(false);
  if (tabId !== null && tabId !== undefined) {
    await sendMessageWithRetry(tabId, { type: "HIDE_UI" });
  }
  await resetState();
  if (tabId !== null && tabId !== undefined && returnUrl) {
    try {
      await navigate(tabId, returnUrl);
    } catch {
      // Navigation back to returnUrl may fail if tab was closed; ignore errors
    }
  }
}

async function resetState() {
  state.status = "idle";
  state.tabId = null;
  state.returnUrl = null;
  state.targetUrl = null;
  state.target = null;
  state.token = null;
}

async function reportError(error, tabId) {
  console.error(error);
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  if (tabId !== null && tabId !== undefined) {
    await sendMessageWithRetry(tabId, { type: "SHOW_ERROR", message });
  }
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
