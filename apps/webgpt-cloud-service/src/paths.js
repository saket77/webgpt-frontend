import path from "node:path";
import { fileURLToPath } from "node:url";

export const cloudServiceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const defaultDataDir = path.join(cloudServiceRoot, "data");
export const defaultDatabasePath = path.join(defaultDataDir, "cloud-runs.sqlite");
