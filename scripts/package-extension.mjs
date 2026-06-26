#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function parseArgs(argv) {
  const options = {
    output: path.resolve(repoRoot, "..", "webgpt-extension-frontend.zip"),
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
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (!arg.startsWith("-")) {
      options.output = path.resolve(process.cwd(), arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/package-extension.mjs [options] [output.zip]

Build and package the loadable WebGPT Chrome extension frontend.

Options:
  -o, --output <path>   Zip output path. Defaults to ../webgpt-extension-frontend.zip
      --skip-build      Reuse the existing sidepanel-app/dist build
  -h, --help            Show this help
`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }

  return result.stdout || "";
}

function assertExists(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Required extension file is missing: ${relativePath}`);
  }
}

function copyFiltered(source, target) {
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (entry) => {
      const base = path.basename(entry);
      return base !== ".DS_Store";
    },
  });
}

function copyRequiredFiles(stageDir) {
  const rootFiles = ["manifest.json", "sidepanel.html"];
  const rootDirs = ["background", "content-scripts", "icons"];

  for (const file of rootFiles) {
    assertExists(file);
    fs.copyFileSync(path.join(repoRoot, file), path.join(stageDir, file));
  }

  for (const dir of rootDirs) {
    assertExists(dir);
    copyFiltered(path.join(repoRoot, dir), path.join(stageDir, dir));
  }

  assertExists("sidepanel-app/dist/assets/index.js");
  assertExists("sidepanel-app/dist/assets/index.css");
  fs.mkdirSync(path.join(stageDir, "sidepanel-app"), { recursive: true });
  copyFiltered(
    path.join(repoRoot, "sidepanel-app", "dist"),
    path.join(stageDir, "sidepanel-app", "dist"),
  );
}

function verifyZip(outputPath) {
  const listing = run("zipinfo", ["-1", outputPath], { capture: true });
  const entries = listing.split("\n").filter(Boolean);
  const requiredEntries = [
    "manifest.json",
    "background/service-worker.js",
    "sidepanel.html",
    "sidepanel-app/dist/assets/index.js",
    "sidepanel-app/dist/assets/index.css",
  ];
  const forbiddenPatterns = [
    /(^|\/)\.git(\/|$)/,
    /(^|\/)node_modules(\/|$)/,
    /^sidepanel-app\/src\//,
    /^sidepanel-app\/node_modules\//,
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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!options.skipBuild) {
    run("npm", ["run", "build"], {
      cwd: path.join(repoRoot, "sidepanel-app"),
    });
  }

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "webgpt-extension-package-"));
  try {
    copyRequiredFiles(stageDir);

    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    if (fs.existsSync(options.output)) {
      fs.unlinkSync(options.output);
    }

    run("zip", ["-r", "-q", options.output, "."], { cwd: stageDir });
    const entryCount = verifyZip(options.output);
    const size = fs.statSync(options.output).size;

    console.log(`Packaged ${entryCount} files into ${options.output}`);
    console.log(`Size: ${formatBytes(size)}`);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
