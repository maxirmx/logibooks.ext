// Copyright (C) 2025 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of Logibooks techdoc helper extension 

let overlay;
let box;
let startX;
let startY;
let selecting = false;
let selectedRect = null;
let keydownHandler;
let mousedownHandler;
let mousemoveHandler;
let mouseupHandler;
let panel;
let saveButton;
let cancelButton;
let statusLabel;
let closeButton;

// Handle messages from the page for presence queries and activation
window.addEventListener("message", (event) => {
  if (!event || event.source !== window || !event.data) return;
  const payload = event.data;

  // Respond to presence queries from the page
  if (payload.type === "LOGIBOOKS_EXTENSION_QUERY") {
    window.postMessage({ type: "LOGIBOOKS_EXTENSION_ACTIVE", active: true }, "*");
    return;
  }

  // Handle activation messages forwarded to the extension
  if (payload.type === "LOGIBOOKS_EXTENSION_ACTIVATE") {

    const target = typeof payload.target === "string" ? payload.target.trim() : "";
    const url = typeof payload.url === "string" ? payload.url.trim() : "";
    const token = typeof payload.token === "string" ? payload.token.trim() : "";

    // Basic validation to avoid forwarding arbitrary or malformed data
    if (!token || token.length > 256) {
      return;
    }

    if (!target || target.length > 2048) {
      return;
    }

    if (!url || url.length > 2048) {
      return;
    }

    try {
      new URL(url);
    } catch (e) {
      return;
    }

    try {
      new URL(target);
    } catch (e) {
      return;
    }

    chrome.runtime.sendMessage({
      type: "PAGE_ACTIVATE",
      target,
      url,
      token
    });
  }
});

let uiState = "idle";

function togglePanel(visible) {
  if (panel) {
    panel.style.display = visible ? "flex" : "none";
  }
}

function ensurePanel() {
  if (panel) return;

  panel = document.createElement("div");
  panel.id = "logibooks-panel";
  panel.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 2147483647;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    padding: 12px;
    font-family: system-ui, sans-serif;
    font-size: 14px;
    color: #222;
    display: none;
    flex-direction: column;
    gap: 8px;
    min-width: 180px;
  `;

  closeButton = document.createElement("button");
  closeButton.textContent = "✕";
  closeButton.type = "button";
  closeButton.title = "Скрыть панель";
  closeButton.style.cssText = `
    position: absolute;
    top: 4px;
    right: 4px;
    padding: 2px 6px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    color: #666;
  `;
  closeButton.addEventListener("mouseover", () => {
    closeButton.style.color = "#000";
  });
  closeButton.addEventListener("mouseout", () => {
    closeButton.style.color = "#666";
  });
  closeButton.addEventListener("click", () => {
    // Hide locally to avoid UI being stuck if the message fails.
    togglePanel(false);

    try {
      chrome.runtime.sendMessage({ type: "HIDE_UI" }, () => {
        if (chrome.runtime.lastError) {
          // Log the error and ensure the panel stays hidden locally.
          console.error("Failed to send HIDE_UI message:", chrome.runtime.lastError);
          togglePanel(false);
        }
      });
    } catch (error) {
      console.error("Exception while sending HIDE_UI message:", error);
      togglePanel(false);
    }
  });

  panel.appendChild(closeButton);

  statusLabel = document.createElement("div");
  statusLabel.textContent = "";

  saveButton = document.createElement("button");
  saveButton.textContent = "Сохранить";
  saveButton.type = "button";
  saveButton.style.cssText = "padding: 6px 12px;";
  saveButton.addEventListener("click", () => {
    if (!selectedRect) return;
    chrome.runtime.sendMessage({ type: "UI_SAVE", rect: selectedRect });
  });

  cancelButton = document.createElement("button");
  cancelButton.textContent = "Отменить";
  cancelButton.type = "button";
  cancelButton.style.cssText = "padding: 6px 12px;";
  cancelButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "UI_CANCEL" });
  });

  panel.appendChild(statusLabel);
  panel.appendChild(saveButton);
  panel.appendChild(cancelButton);
  document.documentElement.appendChild(panel);
}

function showSelectionUI(message) {
  uiState = "selecting";
  if (!panel) ensurePanel();
  
  statusLabel.textContent = message || "Выберите область";
  saveButton.style.display = "inline-flex";
  cancelButton.style.display = "inline-flex";
  saveButton.disabled = !selectedRect;
  togglePanel(true);
  startSelection();
}

function hideUI() {
  uiState = "idle";
  togglePanel(false);
  cleanupSelection();
}

function showError(message) {
  uiState = "idle";
  if (!panel) ensurePanel();
  
  statusLabel.textContent = message || "Ошибка";
  saveButton.style.display = "none";
  cancelButton.style.display = "none";
  togglePanel(true);
  cleanupSelection();
  
  // Auto-hide error after 5 seconds
  setTimeout(() => {
    if (uiState === "idle") {
      togglePanel(false);
    }
  }, 5000);
}

function cleanupSelection() {
  cleanupOverlay();
  selectedRect = null;
}

function cleanupOverlay() {
  if (overlay) {
    if (keydownHandler) overlay.removeEventListener("keydown", keydownHandler);
    if (mousedownHandler) overlay.removeEventListener("mousedown", mousedownHandler);
    if (mousemoveHandler) overlay.removeEventListener("mousemove", mousemoveHandler);
    if (mouseupHandler) document.removeEventListener("mouseup", mouseupHandler);
    overlay.remove();
  }
  overlay = null;
  box = null;
  keydownHandler = null;
  mousedownHandler = null;
  mousemoveHandler = null;
  mouseupHandler = null;
  selecting = false;
}

function startSelection() {
  if (overlay) return;

  selectedRect = null;

  overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483646;
    cursor: crosshair; background: rgba(0,0,0,0.02);
  `;

  box = document.createElement("div");
  box.style.cssText = `
    position: absolute; border: 2px dashed #333;
    background: rgba(255,255,255,0.15);
    left: 0; top: 0; width: 0; height: 0;
  `;

  overlay.appendChild(box);
  document.documentElement.appendChild(overlay);

  overlay.tabIndex = -1;
  overlay.focus();

  keydownHandler = (e) => {
    if (e.key === "Escape") {
      chrome.runtime.sendMessage({ type: "UI_CANCEL" });
    }
  };

  overlay.addEventListener("keydown", keydownHandler);

  mousedownHandler = (e) => {
    selecting = true;
    startX = e.clientX;
    startY = e.clientY;
    box.style.left = `${startX}px`;
    box.style.top = `${startY}px`;
    box.style.width = "0px";
    box.style.height = "0px";
    e.preventDefault();
  };

  overlay.addEventListener("mousedown", mousedownHandler);

  mousemoveHandler = (e) => {
    if (!selecting) return;
    const x1 = Math.min(startX, e.clientX);
    const y1 = Math.min(startY, e.clientY);
    const x2 = Math.max(startX, e.clientX);
    const y2 = Math.max(startY, e.clientY);
    box.style.left = `${x1}px`;
    box.style.top = `${y1}px`;
    box.style.width = `${x2 - x1}px`;
    box.style.height = `${y2 - y1}px`;
    e.preventDefault();
  };

  overlay.addEventListener("mousemove", mousemoveHandler);

  mouseupHandler = (e) => {
    if (!selecting) return;
    selecting = false;

    const x1 = Math.min(startX, e.clientX);
    const y1 = Math.min(startY, e.clientY);
    const x2 = Math.max(startX, e.clientX);
    const y2 = Math.max(startY, e.clientY);

    const w = x2 - x1;
    const h = y2 - y1;
    if (w < 5 || h < 5) {
      selectedRect = null;
      saveButton.disabled = true;
      cleanupOverlay();
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    selectedRect = {
      x: Math.round(x1 * dpr),
      y: Math.round(y1 * dpr),
      w: Math.round(w * dpr),
      h: Math.round(h * dpr)
    };
    saveButton.disabled = false;
    // Keep the overlay and selection box visible after mouseup so the user
    // can still see and confirm the selected area before saving.
    // Remove the overlay only when the user cancels or starts a new selection.
    // Make the box visually persistent (ensure pointer-events are none so it
    // doesn't block clicks on the panel buttons).
    box.style.pointerEvents = "none";
    overlay.style.cursor = "default";
  };

  document.addEventListener("mouseup", mouseupHandler);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "SHOW_UI") {
    showSelectionUI(msg.message);
  }

  if (msg?.type === "HIDE_UI") {
    hideUI();
  }

  if (msg?.type === "SHOW_ERROR") {
    showError(msg.message);
  }
});

chrome.runtime.sendMessage({ type: "UI_READY" });

