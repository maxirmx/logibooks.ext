// Copyright (C) 2025 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of Logibooks techdoc helper extension 
//
// Content script for page-activated screenshot extension.
// See sw.js for architecture documentation and localStorage justification. 

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
    const targetOrigin = event.origin || window.location.origin;
    window.postMessage({ type: "LOGIBOOKS_EXTENSION_ACTIVE", active: true }, targetOrigin);
    return;
  }

  // Handle activation messages from the host webpage
  // This triggers the cross-page screenshot workflow that requires localStorage persistence
  if (payload.type === "LOGIBOOKS_EXTENSION_ACTIVATE") {
    // Extract and validate parameters for the screenshot workflow:
    // - target: Upload endpoint URL where screenshot will be sent
    // - url: Target page URL to navigate to for screenshot capture  
    // - token: Authentication token for upload endpoint
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
      // Invalid URL in payload.url; treat as bad input and ignore this activation request
      return;
    }

    try {
      new URL(target);
    } catch (e) {
      // Invalid URL in payload.target; treat as bad input and ignore this activation request
      return;
    }

    // Forward to background script which will:
    // 1. Store these parameters in local storage using Chrome API 
    // 2. Navigate to the target URL
    // 3. Restore UI state on the target page to show screenshot interface
    chrome.runtime.sendMessage({
      type: "PAGE_ACTIVATE",
      target,
      url,
      token
    });
  }
});

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
    cleanupSelection();

    try {
      chrome.runtime.sendMessage({ type: "UI_CANCEL" }, () => {
        if (chrome.runtime.lastError) {
          // Log the error and ensure the panel stays hidden locally.
          console.error("Failed to send UI_CANCEL message:", chrome.runtime.lastError);
          togglePanel(false);
        }
      });
    } catch (error) {
      console.error("Exception while sending UI_CANCEL message:", error);
      togglePanel(false);
    }
  });

  panel.appendChild(closeButton);

  statusLabel = document.createElement("div");
  statusLabel.textContent = "";

  saveButton = document.createElement("button");
  saveButton.textContent = "Сохранить";
  saveButton.type = "button";
  saveButton.style.cssText = "padding: 6px 12px; cursor: pointer;";
  saveButton.addEventListener("click", () => {
    if (!selectedRect) return;
    const rectToSend = selectedRect;
    // Hide overlay and panel first so the captured tab image does not
    // include selection UI artifacts. Use a short timeout to allow the
    // browser to repaint before the background captures the visible tab.
    try {
      cleanupOverlay();
    } catch (e) {
      // best-effort
    }
    togglePanel(false);
    // Use two animation frames to ensure the browser repaints after we
    // removed the overlay and hid the panel. This is more reliable than
    // a fixed short timeout which may be too short on some systems.
    // Use guarded globalThis.requestAnimationFrame to satisfy linters
    const raf = typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame : null;
    if (raf) {
      raf(() => {
        raf(() => {
          try {
            chrome.runtime.sendMessage({ type: "UI_SAVE", rect: rectToSend });
          } catch (err) {
            console.error("Failed to send UI_SAVE message:", err);
          }
        });
      });
    } else {
      // Fallback to timeout in environments without RAF
      setTimeout(() => {
        try {
          chrome.runtime.sendMessage({ type: "UI_SAVE", rect: rectToSend });
        } catch (err) {
          console.error("Failed to send UI_SAVE message:", err);
        }
      }, 150);
    }
  });

  cancelButton = document.createElement("button");
  cancelButton.textContent = "Отменить";
  cancelButton.type = "button";
  cancelButton.style.cssText = "padding: 6px 12px; cursor: pointer;";
  cancelButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "UI_CANCEL" });
  });

  panel.appendChild(statusLabel);
  panel.appendChild(saveButton);
  panel.appendChild(cancelButton);
  // Note: reselection is initiated by pressing mouse on the overlay;
  // no explicit "reselect" button is needed.
  document.documentElement.appendChild(panel);
}

function showSelectionUI(message) {
  if (!panel) ensurePanel();
  
  statusLabel.textContent = message || "Выберите область";
  saveButton.style.display = "inline-flex";
  cancelButton.style.display = "inline-flex";
  saveButton.disabled = !selectedRect;
  togglePanel(true);
  startSelection();
}



function showError(message) {
  if (!panel) ensurePanel();
  
  statusLabel.textContent = message || "Ошибка";
  saveButton.style.display = "none";
  cancelButton.style.display = "inline-flex";
  togglePanel(true);
  cleanupSelection();
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
    // If a previous selection exists and the user presses again, drop
    // the old selection and start a fresh selection from the new point.
    if (selectedRect) {
      // Remove the persistent selection visuals.
      cleanupOverlay();
      // Restart selection on a clean overlay in a separate tick to avoid
      // stacking event handlers or recursively re-entering initialization.
      setTimeout(() => {
        startSelection();
      }, 0);
      return;
    }

    selecting = true;
    startX = e.clientX;
    startY = e.clientY;
    box.style.left = `${startX}px`;
    box.style.top = `${startY}px`;
    box.style.width = "0px";
    box.style.height = "0px";
    // When starting a new selection, clear previous rect and disable Save
    selectedRect = null;
    saveButton.disabled = true;
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
    // Make the box visually persistent but allow pointer-events through the
    // selection box so panel buttons remain clickable. Keep the overlay
    // cursor as crosshair per user's request; panel buttons will show pointer.
    box.style.pointerEvents = "none";
    // Ensure overlay remains crosshair (do not change to default)
    overlay.style.cursor = "crosshair";
  };

  document.addEventListener("mouseup", mouseupHandler);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "SHOW_UI") {
    showSelectionUI(msg.message);
  }

  if (msg?.type === "SHOW_ERROR") {
    showError(msg.message);
  }
});

chrome.runtime.sendMessage({ type: "UI_READY" });

// Expose internal helpers for unit testing
const isTestEnv =
  typeof globalThis !== "undefined" &&
  (
    globalThis.__CONTENT_TEST_ENV__ === true ||
    globalThis.process?.env?.NODE_ENV === "test"
  );
if (isTestEnv) {
  globalThis.__contentTestHooks__ = {
    togglePanel,
    ensurePanel,
    showSelectionUI,
    showError,
    cleanupSelection,
    cleanupOverlay
  };

  // Expose selectedRect accessors for tests
  globalThis.__contentTestHooks__.getSelectedRect = () => selectedRect;
  globalThis.__contentTestHooks__.setSelectedRect = (r) => { selectedRect = r; };

  // Test helper: trigger save flow (as if user clicked Save)
  globalThis.__contentTestHooks__.triggerSave = (rect) => {
    if (rect) selectedRect = rect;
    // run the same steps as saveButton click
    const rectToSend = selectedRect;
    try { cleanupOverlay(); } catch (e) {}
    togglePanel(false);
    const raf = typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame : null;
    if (raf) {
      raf(() => {
        raf(() => {
          try {
            chrome.runtime.sendMessage({ type: "UI_SAVE", rect: rectToSend });
          } catch (err) {}
        });
      });
    } else {
      setTimeout(() => {
        try { chrome.runtime.sendMessage({ type: "UI_SAVE", rect: rectToSend }); } catch (err) {}
      }, 150);
    }
  };
}
