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
let startButton;
let saveButton;
let cancelButton;
let statusLabel;

const UI_STATE = {
  IDLE: "idle",
  SELECTING: "selecting"
};

let uiState = UI_STATE.IDLE;

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
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 180px;
  `;

  statusLabel = document.createElement("div");
  statusLabel.textContent = "Готово";

  startButton = document.createElement("button");
  startButton.textContent = "Начать";
  startButton.type = "button";
  startButton.style.cssText = "padding: 6px 12px;";
  startButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "UI_START" });
  });

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
  panel.appendChild(startButton);
  panel.appendChild(saveButton);
  panel.appendChild(cancelButton);
  document.documentElement.appendChild(panel);

  setUiState(UI_STATE.IDLE);
}

function setUiState(state, message) {
  uiState = state;
  if (message) statusLabel.textContent = message;

  if (state === UI_STATE.IDLE) {
    startButton.style.display = "inline-flex";
    saveButton.style.display = "none";
    cancelButton.style.display = "none";
    saveButton.disabled = true;
    cleanupSelection();
  }

  if (state === UI_STATE.SELECTING) {
    startButton.style.display = "none";
    saveButton.style.display = "inline-flex";
    cancelButton.style.display = "inline-flex";
    saveButton.disabled = !selectedRect;
    if (!message) {
      statusLabel.textContent = "Выберите область";
    }
  }
}

function cleanupSelection() {
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
  selectedRect = null;
}

function startSelection() {
  if (overlay) return;

  selectedRect = null;
  if (uiState !== UI_STATE.SELECTING) {
    setUiState(UI_STATE.SELECTING);
  }

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
  };

  document.addEventListener("mouseup", mouseupHandler);
}

chrome.runtime.onMessage.addListener((msg) => {
  ensurePanel();

  if (msg?.type === "START_SELECT") {
    setUiState(UI_STATE.SELECTING, msg.message);
    startSelection();
  }

  if (msg?.type === "UI_STATE") {
    setUiState(msg.state, msg.message);
  }

  if (msg?.type === "RESET_SELECTION") {
    cleanupSelection();
    setUiState(UI_STATE.IDLE, msg.message || "Готово");
  }
});

ensurePanel();
chrome.runtime.sendMessage({ type: "UI_READY" });
