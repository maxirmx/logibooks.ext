// Copyright (C) 2025 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of Logibooks techdoc helper extension 

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { URL as NodeURL } from "url";

let sw;

describe("Service worker helpers", () => {
  beforeEach(async () => {
    // ensure a real URL implementation for parsing
    global.URL = NodeURL;
    // basic chrome mock used by sw.js top-level initialization
    global.chrome = {
      runtime: { sendMessage: jest.fn(), lastError: null, onMessage: { addListener: jest.fn(), removeListener: jest.fn() } },
      tabs: {
        sendMessage: jest.fn(),
        update: jest.fn(),
        captureVisibleTab: jest.fn(),
        onUpdated: { addListener: jest.fn(), removeListener: jest.fn() }
      },
      action: { onClicked: { addListener: jest.fn() } },
      storage: { local: { get: jest.fn(async () => ({})), set: jest.fn(), remove: jest.fn(), clear: jest.fn() } }
    };
    global.fetch = jest.fn();
    // Provide a minimal FormData mock to avoid jsdom Blob instance checks
    global.FormData = class {
      constructor() { this._pairs = []; }
      append(k, v, filename) { this._pairs.push([k, v, filename]); }
    };
    sw = await import("../ext/sw.js");
    // reset state between tests
    if (sw.resetState) sw.resetState();
  });

  it("clamp keeps values inside bounds", () => {
    expect(sw.clamp(5, 0, 10)).toBe(5);
    expect(sw.clamp(-1, 0, 10)).toBe(0);
    expect(sw.clamp(11, 0, 10)).toBe(10);
  });

  it("isAllowed accepts http and https and wildcard", () => {
    expect(sw.isAllowed("http://example.com/test")).toBe(true);
    expect(sw.isAllowed("https://example.com/test")).toBe(true);
    // malformed url
    expect(sw.isAllowed("not a url")).toBe(false);
  });

  it("sendMessageWithRetry retries on failure", async () => {
    let called = 0;
    global.chrome = {
      runtime: { lastError: null },
      tabs: { sendMessage: jest.fn((tabId, message, cb) => { called += 1; cb(); }) }
    };
    sw = await import("../ext/sw.js");
    const ok = await sw.sendMessageWithRetry(1, { type: "X" }, 2);
    expect(ok).toBe(true);
    expect(called).toBeGreaterThanOrEqual(1);
  });

  it("apiUpload throws on non-ok response", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
    sw = await import("../ext/sw.js");
    await expect(sw.apiUpload("https://api.local/upload", { x: 0, y: 0, w: 10, h: 10 }, new Blob())).rejects.toThrow(
      /Ошибка POST/
    );
  });

});
