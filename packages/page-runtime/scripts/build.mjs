import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PAGE_RUNTIME_PRELUDE_SCRIPT_FILES,
  PAGE_RUNTIME_TAIL_SCRIPT_FILES,
  PAGE_RUNTIME_WEBMCP_SCRIPT_FILES,
} from "../src/layers.js";
import { resolvePageRuntimeScriptPath } from "../src/node.js";
import {
  PAGE_RUNTIME_ABI,
  PAGE_RUNTIME_ADAPTER_DEFINITIONS,
  PAGE_RUNTIME_PACKAGE_NAME,
  PAGE_RUNTIME_RELEASE_VERSION,
  PAGE_RUNTIME_SCHEMA_VERSION,
} from "../src/catalog.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const DEFAULT_PAGE_RUNTIME_DIST = path.join(PACKAGE_ROOT, "dist");
export const LAYER_SOURCE_SEPARATOR = "\n;\n";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function composeSourceFiles(relativeFiles) {
  const sources = await Promise.all(
    relativeFiles.map((relativeFile) =>
      readFile(resolvePageRuntimeScriptPath(relativeFile), "utf8"),
    ),
  );
  return sources.join(LAYER_SOURCE_SEPARATOR);
}

async function writeArtifact(outputRoot, relativeFile, source) {
  const outputPath = path.join(outputRoot, relativeFile);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, source, "utf8");
  return Object.freeze({
    file: relativeFile,
    sha256: sha256(source),
  });
}

function releaseDescriptor(definition, artifact) {
  return {
    id: definition.id,
    version: definition.version,
    runtimeAbi: definition.runtimeAbi,
    priority: definition.priority,
    matchHints: structuredClone(definition.matchHints),
    sourceFile: definition.sourceFile,
    artifact,
  };
}

export async function buildPageRuntime({
  outputRoot = DEFAULT_PAGE_RUNTIME_DIST,
} = {}) {
  const resolvedOutputRoot = path.resolve(outputRoot);
  if (path.basename(resolvedOutputRoot) !== "dist") {
    throw new TypeError("page-runtime outputRoot must be a dist directory");
  }

  const packageMetadata = JSON.parse(
    await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
  );
  if (
    packageMetadata.name !== PAGE_RUNTIME_PACKAGE_NAME ||
    packageMetadata.version !== PAGE_RUNTIME_RELEASE_VERSION
  ) {
    throw new Error("page-runtime catalog version must match its package metadata");
  }

  await rm(resolvedOutputRoot, { recursive: true, force: true });
  await mkdir(path.join(resolvedOutputRoot, "assets", "adapters"), {
    recursive: true,
  });

  const webMcpSource = await composeSourceFiles(PAGE_RUNTIME_WEBMCP_SCRIPT_FILES);
  const preludeSource = await composeSourceFiles(PAGE_RUNTIME_PRELUDE_SCRIPT_FILES);
  const tailSource = await composeSourceFiles(PAGE_RUNTIME_TAIL_SCRIPT_FILES);
  const webMcpArtifact = await writeArtifact(
    resolvedOutputRoot,
    "assets/webmcp.js",
    webMcpSource,
  );
  const preludeArtifact = await writeArtifact(
    resolvedOutputRoot,
    "assets/runtime-prelude.js",
    preludeSource,
  );
  const tailArtifact = await writeArtifact(
    resolvedOutputRoot,
    "assets/runtime-tail.js",
    tailSource,
  );

  const adapters = {};
  for (const adapterId of Object.keys(PAGE_RUNTIME_ADAPTER_DEFINITIONS).sort()) {
    const definition = PAGE_RUNTIME_ADAPTER_DEFINITIONS[adapterId];
    const adapterSource = await composeSourceFiles([definition.sourceFile]);
    const artifact = await writeArtifact(
      resolvedOutputRoot,
      definition.artifact.file,
      adapterSource,
    );
    adapters[adapterId] = releaseDescriptor(definition, artifact);
  }

  const manifest = {
    schemaVersion: PAGE_RUNTIME_SCHEMA_VERSION,
    packageName: packageMetadata.name,
    releaseVersion: PAGE_RUNTIME_RELEASE_VERSION,
    runtimeAbi: PAGE_RUNTIME_ABI,
    compositionOrder: ["webmcp", "prelude", "adapters", "tail"],
    optionalLayers: ["webmcp"],
    layers: {
      webmcp: {
        ...webMcpArtifact,
        sourceFiles: [...PAGE_RUNTIME_WEBMCP_SCRIPT_FILES],
      },
      prelude: {
        ...preludeArtifact,
        sourceFiles: [...PAGE_RUNTIME_PRELUDE_SCRIPT_FILES],
      },
      tail: {
        ...tailArtifact,
        sourceFiles: [...PAGE_RUNTIME_TAIL_SCRIPT_FILES],
      },
    },
    adapters,
  };

  await writeFile(
    path.join(resolvedOutputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await buildPageRuntime();
}
