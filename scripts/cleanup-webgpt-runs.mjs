#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reposRoot = path.resolve(repoRoot, "..");
const plannerRoot = path.join(
  reposRoot,
  "webgpt-backend",
  "web-agent-chrome-extension",
  "BackEnd",
  "planner-server",
);

const args = new Set(process.argv.slice(2));
const shouldDelete = args.has("--yes");

const targets = [
  {
    label: "Cloud service SQLite/data",
    type: "directory",
    path: path.join(repoRoot, "apps", "webgpt-cloud-service", "data"),
    recreate: true,
  },
  {
    label: "Browserbase cloud event logs",
    type: "directory",
    path: path.join(repoRoot, ".webgpt-cloud-runs"),
    recreate: true,
  },
  {
    label: "Planner run-debug artifacts",
    type: "directory",
    path: path.join(plannerRoot, "planner-artifacts", "run-debug"),
    recreate: true,
  },
  {
    label: "Planner successful run artifacts",
    type: "directory",
    path: path.join(plannerRoot, "planner-artifacts", "successful-runs"),
    recreate: true,
  },
  {
    label: "Planner successful replay artifacts",
    type: "directory",
    path: path.join(plannerRoot, "planner-artifacts", "successful-replay-artifacts"),
    recreate: true,
  },
  {
    label: "Planner successful execution traces",
    type: "directory",
    path: path.join(plannerRoot, "planner-artifacts", "successful-execution-traces"),
    recreate: true,
  },
  {
    label: "Planner latest success artifact",
    type: "file",
    path: path.join(plannerRoot, "planner-artifacts", "latest-success-artifact.json"),
  },
  {
    label: "Planner latest success replay artifact",
    type: "file",
    path: path.join(plannerRoot, "planner-artifacts", "latest-success-replay-artifact.json"),
  },
  {
    label: "Planner latest success execution trace",
    type: "file",
    path: path.join(plannerRoot, "planner-artifacts", "latest-success-execution-trace.json"),
  },
  {
    label: "Planner successful runs JSONL",
    type: "file",
    path: path.join(plannerRoot, "planner-artifacts", "successful-runs.jsonl"),
  },
  {
    label: "Planner successful replay artifacts JSONL",
    type: "file",
    path: path.join(plannerRoot, "planner-artifacts", "successful-replay-artifacts.jsonl"),
  },
  {
    label: "Planner successful execution traces JSONL",
    type: "file",
    path: path.join(plannerRoot, "planner-artifacts", "successful-execution-traces.jsonl"),
  },
  {
    label: "Planner stop/error logs",
    type: "directory",
    path: path.join(plannerRoot, "logs", "runs"),
    recreate: true,
  },
  {
    label: "Planner eProcure latest POC log",
    type: "file",
    path: path.join(plannerRoot, "logs", "eprocure-latest-poc.json"),
  },
];

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function cleanupTarget(target) {
  const present = await exists(target.path);
  const action = present ? "delete" : "missing";

  if (!shouldDelete) {
    return { ...target, action: present ? "would_delete" : "missing" };
  }

  if (target.type === "directory") {
    await fs.rm(target.path, { recursive: true, force: true });
    if (target.recreate) {
      await fs.mkdir(target.path, { recursive: true });
    }
  } else {
    await fs.rm(target.path, { force: true });
  }

  return { ...target, action: present ? "deleted" : "missing" };
}

const results = [];
for (const target of targets) {
  results.push(await cleanupTarget(target));
}

if (!shouldDelete) {
  console.log("Dry run only. Re-run with --yes to delete fresh-run artifacts.\n");
}

for (const result of results) {
  console.log(`${result.action.padEnd(8)} ${result.label}`);
  console.log(`         ${result.path}`);
}
