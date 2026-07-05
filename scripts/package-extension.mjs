#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(repoRoot, "apps", "extension-host");
const distDir = path.join(extensionRoot, "dist-extension");

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(extensionRoot, "src", "manifest.json"), "utf8"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout || "";
}

function parseArgs(argv) {
  const manifest = readManifest();
  const options = {
    output: path.resolve(repoRoot, "..", `webgpt-extension-frontend-v${manifest.version}.zip`),
    skipBuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (arg === "--output" || arg === "-o") {
      const next = argv[index + 1];
      if (!next) throw new Error(`${arg} requires a file path.`);
      options.output = path.resolve(process.cwd(), next);
      index += 1;
    } else if (arg.startsWith("--output=")) {
      options.output = path.resolve(process.cwd(), arg.slice("--output=".length));
    } else if (!arg.startsWith("-")) {
      options.output = path.resolve(process.cwd(), arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function copyFiltered(source, target) {
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (entry) => path.basename(entry) !== ".DS_Store",
  });
}

function verifyZip(outputPath) {
  const listing = run("zipinfo", ["-1", outputPath], { capture: true });
  const entries = listing.split("\n").filter(Boolean);
  const requiredEntries = [
    "manifest.json",
    "background/service-worker.js",
    "background/controller/index.js",
    "background/controller-core/index.js",
    "background/planner-http-adapter/index.js",
    "background/page-runtime/manifest.js",
    "sidepanel.html",
    "sidepanel-app/dist/assets/index.js",
    "sidepanel-app/dist/assets/index.css",
    "content-scripts/agent.js",
    "content-scripts/extractState.js",
    "content-scripts/runner.js",
  ];
  const forbiddenPatterns = [
    /(^|\/)\.git(\/|$)/,
    /(^|\/)node_modules(\/|$)/,
    /^apps\//,
    /^packages\//,
    /^test\//,
    /^docs\//,
    /\.DS_Store$/,
  ];

  for (const required of requiredEntries) {
    if (!entries.includes(required)) {
      throw new Error(`Packaged zip is missing required entry: ${required}`);
    }
  }

  const forbidden = entries.find((entry) =>
    forbiddenPatterns.some((pattern) => pattern.test(entry)),
  );
  if (forbidden) {
    throw new Error(`Packaged zip includes forbidden entry: ${forbidden}`);
  }

  return entries.length;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.skipBuild) {
    run("npm", ["run", "build"], { cwd: repoRoot });
  }

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "webgpt-extension-package-"));
  try {
    copyFiltered(distDir, stageDir);

    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    if (fs.existsSync(options.output)) {
      fs.unlinkSync(options.output);
    }

    run("zip", ["-r", "-q", options.output, "."], { cwd: stageDir });
    const entryCount = verifyZip(options.output);
    const size = fs.statSync(options.output).size;
    console.log(`Packaged ${entryCount} files into ${options.output}`);
    console.log(`Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
