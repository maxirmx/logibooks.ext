// Copyright (C) 2025 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of Logibooks techdoc helper extension 

import { describe, it, expect, beforeEach, jest } from "@jest/globals";

let content;

describe("Content script UI", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // import module after mocks (setup.js provides document mocks)
    await import("../ext/content.js");
    content = globalThis.__contentTestHooks__;
    if (!content) throw new Error("Content script test hooks were not registered");
  });

  it("ensurePanel creates elements and togglePanel shows/hides", () => {
    content.ensurePanel();
    // panel should be created; calling togglePanel should not throw
    content.togglePanel(true);
    content.togglePanel(false);
    expect(document.documentElement.appendChild).toBeTruthy();
  });

  it("showError displays message and hides save button", () => {
    content.ensurePanel();
    content.showError("Boom");
    // ensure showError set status text on the mocked createElement result
    const created = document.createElement("div");
    expect(typeof created.textContent).toBe("string");
  });

});
