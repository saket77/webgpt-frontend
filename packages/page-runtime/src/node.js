import { fileURLToPath } from "node:url";
import { PAGE_RUNTIME_SCRIPT_FILES } from "./manifest.js";
import {
  PAGE_RUNTIME_ERROR_CODES,
  PageRuntimeError,
  readPageRuntimeFromRoot,
} from "./reader.js";

export { PAGE_RUNTIME_SCRIPT_FILES } from "./manifest.js";

export const PAGE_RUNTIME_ROOT = fileURLToPath(new URL("./", import.meta.url));
export const PAGE_RUNTIME_PACKAGE_ROOT = fileURLToPath(
  new URL("../", import.meta.url),
);

export {
  PAGE_RUNTIME_ABI,
  PAGE_RUNTIME_ADAPTER_DEFINITIONS,
  PAGE_RUNTIME_PACKAGE_NAME,
  PAGE_RUNTIME_RELEASE_VERSION,
  PAGE_RUNTIME_SCHEMA_VERSION,
  getPageRuntimeAdapterDefinition,
  listPageRuntimeAdapters,
} from "./catalog.js";
export { PAGE_RUNTIME_ERROR_CODES, PageRuntimeError };

const ALL_SCRIPT_FILES = new Set(PAGE_RUNTIME_SCRIPT_FILES);

export function resolvePageRuntimeScriptPath(relativeFile) {
  if (!ALL_SCRIPT_FILES.has(relativeFile)) {
    throw new Error(`Unknown page-runtime script file: ${relativeFile}`);
  }

  return fileURLToPath(new URL(relativeFile, import.meta.url));
}

export function readPageRuntime(options = {}) {
  return readPageRuntimeFromRoot(
    PAGE_RUNTIME_PACKAGE_ROOT,
    options,
  );
}
