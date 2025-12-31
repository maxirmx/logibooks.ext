let overlay, box, startX, startY, selecting = false;

function cleanup() {
  overlay?.remove();
  overlay = box = null;
  selecting = false;
}

function startSelection() {
  if (overlay) return;

  overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647;
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

  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      cleanup();
      chrome.runtime.sendMessage({ type: "RECT_CANCEL" });
    }
  });

  overlay.addEventListener("mousedown", (e) => {
    selecting = true;
    startX = e.clientX;
    startY = e.clientY;
    box.style.left = `${startX}px`;
    box.style.top = `${startY}px`;
    box.style.width = "0px";
    box.style.height = "0px";
    e.preventDefault();
  });

  overlay.addEventListener("mousemove", (e) => {
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
  });

  overlay.addEventListener("mouseup", (e) => {
    if (!selecting) return;
    selecting = false;

    const x1 = Math.min(startX, e.clientX);
    const y1 = Math.min(startY, e.clientY);
    const x2 = Math.max(startX, e.clientX);
    const y2 = Math.max(startY, e.clientY);

    cleanup();

    const w = x2 - x1;
    const h = y2 - y1;
    if (w < 5 || h < 5) {
      chrome.runtime.sendMessage({ type: "RECT_CANCEL" });
      return;
    }

    const dpr = window.devicePixelRatio || 1;

    chrome.runtime.sendMessage({
      type: "RECT_SELECTED",
      rect: {
        x: Math.round(x1 * dpr),
        y: Math.round(y1 * dpr),
        w: Math.round(w * dpr),
        h: Math.round(h * dpr)
      }
    });
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "START_SELECT") startSelection();
});

