// Copyright (C) 2025 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of Logibooks techdoc helper extension 

export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        chrome: "readonly",
        console: "readonly",
        document: "readonly",
        window: "readonly",
        Image: "readonly",
        Blob: "readonly",
        FileReader: "readonly",
        OffscreenCanvas: "readonly",
        FormData: "readonly",
        fetch: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        atob: "readonly",
        createImageBitmap: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { 
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_"
      }],
      "no-undef": "error",
      "semi": ["warn", "always"],
      "quotes": ["warn", "double", { avoidEscape: true }],
      "no-console": "off"
    }
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        assert: "readonly",
        global: "writable",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        jest: "readonly"
      }
    }
  },
  {
    ignores: ["node_modules/**"]
  }
];
