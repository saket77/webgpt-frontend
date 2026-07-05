import { fileURLToPath } from "node:url";
import { EXTENSION_CONTENT_SCRIPT_FILES } from "./manifest.js";

export {
  EXTENSION_BRIDGE_SCRIPT_FILES,
  EXTENSION_CONTENT_SCRIPT_FILES,
  PAGE_RUNTIME_SCRIPT_FILES,
} from "./manifest.js";

export const PAGE_RUNTIME_ROOT = fileURLToPath(new URL("./", import.meta.url));

const ALL_SCRIPT_FILES = new Set(EXTENSION_CONTENT_SCRIPT_FILES);

export function resolvePageRuntimeScriptPath(relativeFile) {
  if (!ALL_SCRIPT_FILES.has(relativeFile)) {
    throw new Error(`Unknown page-runtime script file: ${relativeFile}`);
  }

  return fileURLToPath(new URL(relativeFile, import.meta.url));
}
