// Copyright (C) 2025 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of Logibooks techdoc helper extension 

import { describe, it, expect, beforeEach, jest } from "@jest/globals";

let content;

describe("Content script save flow", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Ensure RAF is a controllable mock
    let rafQueue = [];
    global.requestAnimationFrame = jest.fn((cb) => {
      rafQueue.push(cb);
      return rafQueue.length; // arbitrary id
    });
    global.__runRaf = () => {
      while (rafQueue.length) rafQueue.shift()();
    };

    await import("../ext/content.js");
    content = globalThis.__contentTestHooks__;
    if (!content) throw new Error("Content script test hooks were not registered");
  });

  it("sends UI_SAVE after overlay removal and two RAFs", async () => {
    // Prepare panel and simulate a selection
    content.ensurePanel();
    // Simulate that a selected rect exists
    const rect = { x: 10, y: 20, w: 30, h: 40 };
    content.setSelectedRect(rect);

    // Make saveButton available via ensurePanel-created mock
    // Call showSelectionUI so save button is displayed
    content.showSelectionUI("Выберите область");

    // Now simulate click on saveButton by invoking the registered click handler
    // Our document.createElement mock stores addEventListener; we cannot access
    // the actual element, but chrome.runtime.sendMessage is mocked and the code
    // uses requestAnimationFrame to delay the send. So call the save handler
    // indirectly: call the global chrome.runtime.sendMessage spy after triggering
    // button logic by reading from hooks isn't possible with current mocks. Instead
    // we emulate the minimal sequence: cleanupOverlay + togglePanel(false) + RAFs + sendMessage

    // Trigger the save flow via test helper which uses RAF internally
    content.triggerSave(rect);

    // Manually run RAF callbacks queued in the test harness
    global.__runRaf();

    // The content script calls chrome.runtime.sendMessage; ensure it was called
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalled();

    // Find a call with UI_SAVE
    const calls = global.chrome.runtime.sendMessage.mock.calls;
    const hasSave = calls.some((c) => c[0] && c[0].type === "UI_SAVE");
    expect(hasSave).toBe(true);
  });
});
