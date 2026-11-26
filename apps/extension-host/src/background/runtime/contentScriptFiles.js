import { PAGE_RUNTIME_SCRIPT_FILES } from "@webgpt-mundhada/page-runtime";

export const PAGE_RUNTIME_VERSION = ""; // Set from the bundled package by the extension build.

export const EXTENSION_BRIDGE_SCRIPT_FILES = Object.freeze([
  "content-scripts/agent.js",
]);

export const EXTENSION_CONTENT_SCRIPT_FILES = Object.freeze([
  ...PAGE_RUNTIME_SCRIPT_FILES,
  ...EXTENSION_BRIDGE_SCRIPT_FILES,
]);
