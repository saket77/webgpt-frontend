import path from "node:path";
import { fileURLToPath } from "node:url";

export const browserbaseHostRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const repoRoot = path.resolve(browserbaseHostRoot, "..", "..");

export const defaultLogsDir = path.join(
  repoRoot,
  ".webgpt-cloud-runs",
);
