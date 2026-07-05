#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCloudEnv } from "./env.js";
import { runCloudWebGpt } from "./runCloud.js";

loadCloudEnv();

const DEFAULT_EPROCURE_URL =
  "https://eprocure.gov.in/eprocure/app?page=FrontEndLatestActiveTendersOrgwise&service=page&org=";
const DEFAULT_EPROCURE_GOAL =
  "Extract today's active tenders and return title, reference number, closing date, and bid opening date.";

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

export function parseArgs(argv = []) {
  const options = {
    url: "",
    goal: "",
    backend: process.env.WEBGPT_BACKEND_URL || "http://localhost:3000",
    projectId: process.env.BROWSERBASE_PROJECT_ID || "",
    dryRun: false,
    json: false,
    autoConfirm: true,
    logsDir: "",
    timeoutMs: 120000,
    eprocure: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--url") {
      options.url = readArgValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--url=")) {
      options.url = arg.slice("--url=".length);
    } else if (arg === "--goal") {
      options.goal = readArgValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--goal=")) {
      options.goal = arg.slice("--goal=".length);
    } else if (arg === "--backend") {
      options.backend = readArgValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--backend=")) {
      options.backend = arg.slice("--backend=".length);
    } else if (arg === "--project-id") {
      options.projectId = readArgValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--project-id=")) {
      options.projectId = arg.slice("--project-id=".length);
    } else if (arg === "--logs-dir") {
      options.logsDir = readArgValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--logs-dir=")) {
      options.logsDir = arg.slice("--logs-dir=".length);
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(readArgValue(argv, index, arg));
      index += 1;
    } else if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--no-auto-confirm") {
      options.autoConfirm = false;
    } else if (arg === "--eprocure") {
      options.eprocure = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.eprocure) {
    options.url ||= DEFAULT_EPROCURE_URL;
    options.goal ||= DEFAULT_EPROCURE_GOAL;
  }

  return options;
}

function printHelp() {
  console.log(`WebGPT Browserbase cloud host

Usage:
  npm run cloud:run -- --url <url> --goal <goal> [--backend <url>]
  npm run cloud:run -- --eprocure

Options:
  --url <url>           Initial page URL.
  --goal <text>         Natural-language WebGPT goal.
  --backend <url>       WebGPT planner backend URL. Defaults to WEBGPT_BACKEND_URL or http://localhost:3000.
  --project-id <id>     Browserbase project ID. Defaults to BROWSERBASE_PROJECT_ID.
  --eprocure            Use the eProcure tender bench URL and goal.
  --timeout-ms <ms>     Browser navigation timeout. Defaults to 120000.
  --logs-dir <path>     Directory for JSONL cloud event logs.
  --json                Print final result as JSON.
  --no-auto-confirm     Do not auto-confirm planner done.
  --dry-run             Validate CLI wiring without creating a Browserbase session.
`);
}

function validateOptions(options) {
  if (!options.url || !String(options.url).trim()) {
    throw new Error("Missing --url. Use --eprocure for the default bench run.");
  }
  if (!options.goal || !String(options.goal).trim()) {
    throw new Error("Missing --goal. Use --eprocure for the default bench run.");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number.");
  }
}

export function printSessionReady(session, { stream = process.stderr } = {}) {
  const lines = [
    "",
    "Browserbase session started.",
    `Browserbase session: ${session.browserbaseSessionId || "(none)"}`,
  ];

  if (session.liveViewUrl) lines.push(`Live View: ${session.liveViewUrl}`);
  if (session.sessionUrl) lines.push(`Session: ${session.sessionUrl}`);
  lines.push("");

  stream.write(`${lines.join("\n")}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  validateOptions(options);

  if (options.dryRun) {
    const result = {
      ok: true,
      dryRun: true,
      url: options.url,
      goal: options.goal,
      backend: options.backend,
      projectId: options.projectId,
      autoConfirm: options.autoConfirm,
    };
    console.log(options.json ? JSON.stringify(result, null, 2) : "Cloud smoke dry-run passed.");
    return;
  }

  const result = await runCloudWebGpt({
    ...options,
    logStream: process.stderr,
    onSessionReady(session) {
      printSessionReady(session);
    },
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("\nWebGPT cloud run complete.");
  console.log(`Browserbase session: ${result.browserbaseSessionId || "(none)"}`);
  if (result.liveViewUrl) console.log(`Live View: ${result.liveViewUrl}`);
  if (result.sessionUrl) console.log(`Session: ${result.sessionUrl}`);
  console.log(`Planner run: ${result.plannerRunId || "(none)"}`);
  console.log(`Event log: ${result.eventLogPath}`);
  console.log(`Status: ${result.status}`);
  if (result.summary) console.log(`Summary: ${result.summary}`);
  if (result.finalResult) {
    console.log("\nFinal result:");
    console.log(JSON.stringify(result.finalResult, null, 2));
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
