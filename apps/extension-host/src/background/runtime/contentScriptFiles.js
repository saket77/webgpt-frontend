import { PAGE_RUNTIME_SCRIPT_FILES } from "@webgpt/page-runtime";

export const EXTENSION_BRIDGE_SCRIPT_FILES = Object.freeze([
  "content-scripts/agent.js",
]);

export const EXTENSION_CONTENT_SCRIPT_FILES = Object.freeze([
  ...PAGE_RUNTIME_SCRIPT_FILES,
  ...EXTENSION_BRIDGE_SCRIPT_FILES,
]);
