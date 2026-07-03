#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(repoRoot, "apps", "extension-host");
const distDir = path.join(extensionRoot, "dist-extension");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    encoding: "utf8",
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function copyFiltered(source, target) {
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (entry) => path.basename(entry) !== ".DS_Store",
  });
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function assertExists(value) {
  if (!fs.existsSync(value)) {
    throw new Error(`Required file or directory is missing: ${path.relative(repoRoot, value)}`);
  }
}

function rewriteDistImport(file, replacements) {
  const absolute = path.join(distDir, file);
  let source = fs.readFileSync(absolute, "utf8");
  for (const [from, to] of replacements) {
    source = source.split(from).join(to);
  }
  fs.writeFileSync(absolute, source);
}

async function main() {
  run("npm", ["run", "build"], {
    cwd: path.join(extensionRoot, "sidepanel-app"),
  });

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  copyFile(
    path.join(extensionRoot, "src", "manifest.json"),
    path.join(distDir, "manifest.json"),
  );
  copyFile(
    path.join(extensionRoot, "src", "sidepanel.html"),
    path.join(distDir, "sidepanel.html"),
  );
  copyFiltered(
    path.join(extensionRoot, "src", "icons"),
    path.join(distDir, "icons"),
  );
  copyFiltered(
    path.join(extensionRoot, "src", "background"),
    path.join(distDir, "background"),
  );

  copyFiltered(
    path.join(repoRoot, "packages", "controller-core", "src"),
    path.join(distDir, "background", "controller-core"),
  );
  copyFiltered(
    path.join(repoRoot, "packages", "planner-http-adapter", "src"),
    path.join(distDir, "background", "planner-http-adapter"),
  );
  copyFile(
    path.join(repoRoot, "packages", "page-runtime", "src", "manifest.js"),
    path.join(distDir, "background", "page-runtime", "manifest.js"),
  );
  copyFiltered(
    path.join(repoRoot, "packages", "page-runtime", "src", "content-scripts"),
    path.join(distDir, "content-scripts"),
  );
  copyFiltered(
    path.join(extensionRoot, "src", "content-scripts"),
    path.join(distDir, "content-scripts"),
  );
  copyFiltered(
    path.join(extensionRoot, "sidepanel-app", "dist"),
    path.join(distDir, "sidepanel-app", "dist"),
  );

  const plannerAdapterSourceImport =
    "../../../../../../packages/planner-http-adapter/src/index.js";
  const plannerAdapterDistImport = "../../planner-http-adapter/index.js";
  rewriteDistImport("background/adapters/webgpt/api.js", [
    [plannerAdapterSourceImport, plannerAdapterDistImport],
  ]);
  rewriteDistImport("background/adapters/webgpt/plannerAdapter.js", [
    [plannerAdapterSourceImport, plannerAdapterDistImport],
  ]);

  const required = [
    "manifest.json",
    "background/service-worker.js",
    "background/controller/index.js",
    "background/controller-core/index.js",
    "background/planner-http-adapter/index.js",
    "background/page-runtime/manifest.js",
    "content-scripts/agent.js",
    "content-scripts/extractState.js",
    "content-scripts/runner.js",
    "sidepanel-app/dist/assets/index.js",
    "sidepanel-app/dist/assets/index.css",
  ];

  for (const entry of required) {
    assertExists(path.join(distDir, entry));
  }

  console.log(`Built extension at ${distDir}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
