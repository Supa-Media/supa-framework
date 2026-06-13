"use strict";

const supaPlugin = require("./index");

/**
 * Shareable ESLint flat config preset for Supa framework projects.
 *
 * Usage in consumer's eslint.config.js:
 *
 *   import supaPreset from '@supa-media/linter/preset';
 *   export default [...supaPreset, { // consumer overrides }];
 */
module.exports = [
  {
    plugins: {
      "@supa": supaPlugin,
    },
    rules: {
      "@supa-media/no-ungated-native-import": "error",
      "@supa-media/route-file-no-logic": "warn",
      "@supa-media/require-layout-file": "warn",
      "@supa-media/keyboard-aware-forms": "warn",
      "@supa-media/platform-file-pairs": "warn",
    },
  },
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      ".expo/**",
      ".next/**",
      "build/**",
      "coverage/**",
      "*.config.js",
      "*.config.ts",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: (() => {
        try {
          return require("@typescript-eslint/parser");
        } catch {
          // TypeScript parser is optional — consumers may not have it installed
          return undefined;
        }
      })(),
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
  },
];
