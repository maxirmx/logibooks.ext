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
  uploadPrefix: null,
  key: null
};

let isUiVisible = false;

// Initialize UI visibility state from storage
async function initializeUiVisibility() {
  try {
    const result = await chrome.storage.local.get(["isUiVisible"]);
    if (result.isUiVisible !== undefined) {
      isUiVisible = result.isUiVisible;
    }
  } catch (error) {
    console.error("Failed to load UI visibility state:", error);
  }
}

// Save UI visibility state to storage
async function saveUiVisibility(visible) {
  isUiVisible = visible;
  try {
    await chrome.storage.local.set({ isUiVisible: visible });
  } catch (error) {
    console.error("Failed to save UI visibility state:", error);
  }
}

// Initialize on service worker startup
initializeUiVisibility();

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  const newVisibility = !isUiVisible;
  await saveUiVisibility(newVisibility);
  
  try {
    await chrome.tabs.sendMessage(tab.id, { 
      type: "TOGGLE_UI", 
      visible: isUiVisible 
    });
  } catch (error) {
    console.error("Failed to toggle UI:", error);
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
    void (async () => {
      await syncUiState(tabId);
      // Send current visibility state to the newly loaded content script
      try {
        await chrome.tabs.sendMessage(tabId, { 
          type: "TOGGLE_UI", 
          visible: isUiVisible 
        });
      } catch (error) {
        // Content script may not be ready yet
      }
    })();
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
      await chrome.tabs.sendMessage(tab.id, { 
        type: "TOGGLE_UI", 
        visible: isUiVisible 
      });
    } catch (error) {
      // Tab may not have content script loaded
    }
  }
}

async function handleActivation(tabId, returnUrl, payload) {
  if (!payload?.url || typeof payload.url !== "string") {
    await reportError(new Error("Invalid activation url"), tabId);
    return;
  }
  if (!payload?.key || typeof payload.key !== "string") {
    await reportError(new Error("Invalid activation key"), tabId);
    return;
  }
  if (!returnUrl) {
    await reportError(new Error("Missing return url"), tabId);
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
  state.uploadPrefix = payload.url;
  state.key = payload.key;

  try {
    notifyState(tabId, "idle", "Переход на страницу...");
    await navigate(tabId, payload.url);
    await saveUiVisibility(true);
    await sendMessageWithRetry(tabId, { type: "TOGGLE_UI", visible: true });
    state.status = "awaiting_selection";
    await sendMessageWithRetry(tabId, { type: "START_SELECT" });
    notifyState(tabId, "selecting", "Выберите область и нажмите Сохранить");
  } catch (error) {
    await reportError(error, tabId);
  }
}

async function handleSave(rect) {
  try {
    state.status = "uploading";
    if (!state.tabId || !state.uploadPrefix || !state.key) {
      throw new Error("Активная сессия не найдена");
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: "png" });
    const blob = await cropDataUrl(dataUrl, rect);
    await apiUpload(state.uploadPrefix, state.key, rect, blob);
    await finishSession("Готово");
  } catch (error) {
    await reportError(error, state.tabId);
  }
}

async function handleCancel() {
  await finishSession("Готово");
}

async function finishSession(message) {
  const { tabId, returnUrl } = state;
  await saveUiVisibility(false);
  if (tabId !== null && tabId !== undefined) {
    await sendMessageWithRetry(tabId, { type: "TOGGLE_UI", visible: false });
  }
  await resetState(message, true);
  if (tabId !== null && tabId !== undefined && returnUrl) {
    try {
      await navigate(tabId, returnUrl);
    } catch (error) {
      console.error("Failed to navigate back to return url:", error);
    }
  }
}

async function resetState(message, notify) {
  state.status = "idle";
  state.returnUrl = null;
  state.targetUrl = null;
  state.uploadPrefix = null;
  state.key = null;

  if (notify && state.tabId !== null && state.tabId !== undefined) {
    await sendMessageWithRetry(state.tabId, { type: "RESET_SELECTION", message });
    notifyState(state.tabId, "idle", message);
  }
  state.tabId = null;
}

async function reportError(error, tabId) {
  console.error(error);
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  if (tabId !== null && tabId !== undefined) {
    await sendMessageWithRetry(tabId, { type: "RESET_SELECTION", message });
    notifyState(tabId, "idle", message);
  }
  state.status = "idle";
  state.tabId = null;
  state.returnUrl = null;
  state.targetUrl = null;
  state.uploadPrefix = null;
  state.key = null;
}

async function syncUiState(tabId) {
  if (state.status === "awaiting_selection") {
    await sendMessageWithRetry(tabId, { type: "START_SELECT" });
    notifyState(tabId, "selecting", "Выберите область и нажмите Сохранить");
  } else {
    notifyState(tabId, "idle", "Готово");
  }
}

function notifyState(tabId, stateName, message) {
  if (tabId === null || tabId === undefined) return;
  chrome.tabs.sendMessage(tabId, { type: "UI_STATE", state: stateName, message }, () => {
    if (chrome.runtime.lastError) {
      // Content script may not be ready yet; ignore.
    }
  });
}

async function sendMessageWithRetry(tabId, message, attempts = 10) {
  for (let i = 0; i < attempts; i += 1) {
    const success = await sendMessageOnce(tabId, message);
    if (success) {
      return true;
    }
    await delay(200);
  }
  console.warn(
    "Failed to deliver message to tab after all retry attempts",
    {
      tabId,
      attempts,
      messageType: message && message.type ? message.type : undefined
    }
  );
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

async function apiUpload(prefix, key, rect, blob) {
  const fd = new FormData();
  fd.append("rect", JSON.stringify(rect));
  fd.append("image", blob, `snap-${Date.now()}.png`);

  const url = new URL(key, prefix).toString();
  const r = await fetch(url, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`POST ${url} failed: ${r.status}`);
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
    throw new Error("Cropped dimensions too small (minimum 5px required)");
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
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
    blob = await res.blob();
  }

  return await createImageBitmap(blob);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
