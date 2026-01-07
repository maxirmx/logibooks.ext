// Copyright (C) 2025 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of Logibooks techdoc helper extension 
//
import { jest } from "@jest/globals";

// Mock Chrome APIs
global.chrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    lastError: null
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn(),
    captureVisibleTab: jest.fn(),
    update: jest.fn(),
    onUpdated: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },
  action: {
    onClicked: {
      addListener: jest.fn()
    }
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn()
    }
  }
};

// Mock DOM methods for content script testing
global.document = {
  createElement: jest.fn((_tag) => ({
    style: { cssText: "" },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    appendChild: jest.fn(),
    remove: jest.fn(),
    focus: jest.fn(),
    textContent: "",
    id: "",
    title: "",
    type: "",
    disabled: false,
    tabIndex: 0
  })),
  documentElement: {
    appendChild: jest.fn()
  },
  addEventListener: jest.fn(),
  removeEventListener: jest.fn()
};

global.window = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  postMessage: jest.fn(),
  location: { origin: "https://example.com" },
  devicePixelRatio: 1
};

// Mock URL constructor
global.URL = jest.fn((url) => ({
  href: url,
  origin: "https://example.com",
  pathname: "/test"
}));

// Mock fetch for API testing
global.fetch = jest.fn();

// Mock Blob and canvas for image processing
global.Blob = jest.fn();
global.HTMLCanvasElement = {
  prototype: {
    getContext: jest.fn(() => ({
      drawImage: jest.fn(),
      getImageData: jest.fn(() => ({ data: new Uint8Array(4) })),
      putImageData: jest.fn(),
      toBlob: jest.fn((callback) => callback(new Blob()))
    }))
  }
};
global.Image = jest.fn(() => ({
  onload: null,
  onerror: null,
  src: ""
}));

// Console spy to reduce noise in tests
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
  log: jest.fn()
};