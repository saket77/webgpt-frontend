import fs from "node:fs";
import path from "node:path";
import { browserbaseHostRoot, repoRoot } from "./paths.js";

const ENV_FILES = [
  path.join(repoRoot, ".env.local"),
  path.join(browserbaseHostRoot, ".env.local"),
];

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;

  const source = fs.readFileSync(filePath, "utf8");
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = unquoteEnvValue(line.slice(separatorIndex + 1));
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = value;
  }

  return true;
}

export function loadCloudEnv() {
  return ENV_FILES.filter(loadEnvFile);
}
