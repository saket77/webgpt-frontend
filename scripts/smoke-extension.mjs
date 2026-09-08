#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXTENSION_CONTENT_SCRIPT_FILES,
} from "../apps/extension-host/src/background/runtime/contentScriptFiles.js";
import { PAGE_RUNTIME_SCRIPT_FILES } from "../packages/page-runtime/src/manifest.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(repoRoot, "apps", "extension-host", "dist-extension");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return [absolute];
  });
}

const requiredDistEntries = [
  "manifest.json",
  "background/service-worker.js",
  "background/controller/index.js",
  "background/controller-core/index.js",
  "background/planner-http-adapter/index.js",
  "background/page-runtime/manifest.js",
  "background/page-runtime/layers.js",
  "background/runtime/contentScriptFiles.js",
  "content-scripts/connectorTools.js",
  "content-scripts/extractState.js",
  "content-scripts/runner.js",
  "content-scripts/agent.js",
  "sidepanel-app/dist/assets/index.js",
  "sidepanel-app/dist/assets/index.css",
];

for (const entry of requiredDistEntries) {
  assert(
    fs.existsSync(path.join(distDir, entry)),
    `Missing built extension entry: ${entry}`,
  );
}

const pageRuntimeFiles = walk(
  path.join(repoRoot, "packages", "page-runtime", "src", "content-scripts"),
);
const badPageRuntimeFile = pageRuntimeFiles.find((file) =>
  /\bchrome\./.test(fs.readFileSync(file, "utf8")),
);
assert(
  !badPageRuntimeFile,
  `page-runtime must not contain unguarded chrome.*: ${path.relative(repoRoot, badPageRuntimeFile || "")}`,
);

const distJsFiles = walk(distDir).filter((file) => file.endsWith(".js"));
const unresolvedWorkspaceImport = distJsFiles.find((file) =>
  /from\s+["']@webgpt\//.test(fs.readFileSync(file, "utf8")) ||
  /from\s+["'].*packages\//.test(fs.readFileSync(file, "utf8")),
);
assert(
  !unresolvedWorkspaceImport,
  `Built extension has unresolved workspace import: ${path.relative(repoRoot, unresolvedWorkspaceImport || "")}`,
);

assert(
  PAGE_RUNTIME_SCRIPT_FILES.includes("content-scripts/connectorTools.js"),
  "page-runtime manifest should include connectorTools first",
);
assert(
  PAGE_RUNTIME_SCRIPT_FILES.indexOf("content-scripts/connectorTools.js") <
    PAGE_RUNTIME_SCRIPT_FILES.indexOf("content-scripts/adapters/greenhouse.js"),
  "connectorTools must load before site adapters",
);
assert(
  EXTENSION_CONTENT_SCRIPT_FILES.indexOf("content-scripts/runner.js") <
    EXTENSION_CONTENT_SCRIPT_FILES.indexOf("content-scripts/agent.js"),
  "runner must load before extension bridge",
);

console.log("Extension smoke checks passed.");
