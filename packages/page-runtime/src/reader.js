import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  PAGE_RUNTIME_ABI,
  PAGE_RUNTIME_ADAPTER_DEFINITIONS,
  PAGE_RUNTIME_PACKAGE_NAME,
  PAGE_RUNTIME_RELEASE_VERSION,
  PAGE_RUNTIME_SCHEMA_VERSION,
} from "./catalog.js";
import {
  PAGE_RUNTIME_PRELUDE_SCRIPT_FILES,
  PAGE_RUNTIME_TAIL_SCRIPT_FILES,
  PAGE_RUNTIME_WEBMCP_SCRIPT_FILES,
  canonicalPageRuntimeAdapterIds,
} from "./layers.js";

export const PAGE_RUNTIME_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "PAGE_RUNTIME_INVALID_ARGUMENT",
  MANIFEST_MISSING: "PAGE_RUNTIME_MANIFEST_MISSING",
  MANIFEST_INVALID: "PAGE_RUNTIME_MANIFEST_INVALID",
  UNKNOWN_ADAPTER: "PAGE_RUNTIME_UNKNOWN_ADAPTER",
  ABI_MISMATCH: "PAGE_RUNTIME_ABI_MISMATCH",
  ASSET_MISSING: "PAGE_RUNTIME_ASSET_MISSING",
  INTEGRITY_MISMATCH: "PAGE_RUNTIME_INTEGRITY_MISMATCH",
});

export class PageRuntimeError extends Error {
  constructor(message, code, options = {}) {
    super(message, options);
    this.name = "PageRuntimeError";
    this.code = code;
  }
}

function fail(message, code, cause) {
  throw new PageRuntimeError(message, code, cause ? { cause } : {});
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isJsonStructurallyEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) =>
        isJsonStructurallyEqual(value, right[index]),
      )
    );
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        isJsonStructurallyEqual(left[key], right[key]),
    )
  );
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function assertArtifact(artifact, label) {
  if (
    !isObject(artifact) ||
    !isNonEmptyString(artifact.file) ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256 || "")
  ) {
    fail(
      `${label} must declare a relative file and SHA-256 digest.`,
      PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID,
    );
  }
}

function assertKnownDescriptorMetadata(adapterId, descriptor) {
  const expected = PAGE_RUNTIME_ADAPTER_DEFINITIONS[adapterId];
  if (!expected) {
    fail(
      `The manifest declares an unsupported adapter: ${adapterId}.`,
      PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID,
    );
  }

  for (const field of [
    "id",
    "version",
    "runtimeAbi",
    "priority",
    "matchHints",
    "sourceFile",
  ]) {
    const matches =
      field === "matchHints"
        ? isJsonStructurallyEqual(descriptor[field], expected[field])
        : isDeepStrictEqual(descriptor[field], expected[field]);
    if (!matches) {
      fail(
        `The ${adapterId} descriptor has invalid ${field} metadata.`,
        PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID,
      );
    }
  }

  if (descriptor.artifact?.file !== expected.artifact.file) {
    fail(
      `The ${adapterId} descriptor has an invalid artifact path.`,
      PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID,
    );
  }
}

function validateManifest(manifest) {
  if (
    !isObject(manifest) ||
    manifest.schemaVersion !== PAGE_RUNTIME_SCHEMA_VERSION ||
    manifest.packageName !== PAGE_RUNTIME_PACKAGE_NAME ||
    manifest.releaseVersion !== PAGE_RUNTIME_RELEASE_VERSION ||
    manifest.runtimeAbi !== PAGE_RUNTIME_ABI ||
    !isDeepStrictEqual(manifest.compositionOrder, [
      "webmcp",
      "prelude",
      "adapters",
      "tail",
    ]) ||
    !isDeepStrictEqual(manifest.optionalLayers, ["webmcp"]) ||
    !isObject(manifest.layers) ||
    !isObject(manifest.adapters)
  ) {
    fail(
      "The page-runtime manifest does not satisfy schemaVersion 1.",
      PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID,
    );
  }

  assertArtifact(manifest.layers.webmcp, "The WebMCP layer");
  assertArtifact(manifest.layers.prelude, "The prelude layer");
  assertArtifact(manifest.layers.tail, "The tail layer");
  if (
    !isDeepStrictEqual(
      manifest.layers.webmcp.sourceFiles,
      PAGE_RUNTIME_WEBMCP_SCRIPT_FILES,
    ) ||
    !isDeepStrictEqual(
      manifest.layers.prelude.sourceFiles,
      PAGE_RUNTIME_PRELUDE_SCRIPT_FILES,
    ) ||
    !isDeepStrictEqual(
      manifest.layers.tail.sourceFiles,
      PAGE_RUNTIME_TAIL_SCRIPT_FILES,
    )
  ) {
    fail(
      "The page-runtime layer provenance is malformed.",
      PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID,
    );
  }

  const expectedAdapterIds = Object.keys(PAGE_RUNTIME_ADAPTER_DEFINITIONS).sort();
  const actualAdapterIds = Object.keys(manifest.adapters).sort();
  if (!isDeepStrictEqual(actualAdapterIds, expectedAdapterIds)) {
    fail(
      "The page-runtime manifest must declare the complete adapter catalog.",
      PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID,
    );
  }

  for (const [adapterId, descriptor] of Object.entries(manifest.adapters)) {
    if (
      !isObject(descriptor) ||
      descriptor.id !== adapterId ||
      descriptor.version !== manifest.releaseVersion ||
      descriptor.runtimeAbi !== manifest.runtimeAbi ||
      !Number.isFinite(descriptor.priority) ||
      !isObject(descriptor.matchHints) ||
      !isNonEmptyString(descriptor.sourceFile)
    ) {
      fail(
        `The ${adapterId} descriptor is malformed.`,
        PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID,
      );
    }
    assertArtifact(descriptor.artifact, `The ${adapterId} adapter artifact`);
    assertKnownDescriptorMetadata(adapterId, descriptor);
  }

  return manifest;
}

function resolveLexicallyContainedPath(distRoot, relativeFile) {
  const absolutePath = path.resolve(distRoot, relativeFile);
  if (
    absolutePath === distRoot ||
    !absolutePath.startsWith(`${distRoot}${path.sep}`)
  ) {
    fail(
      `Runtime asset path escapes the package: ${relativeFile}`,
      PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID,
    );
  }
  return absolutePath;
}

function isStrictlyContained(root, candidate) {
  const relativePath = path.relative(root, candidate);
  return (
    Boolean(relativePath) &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

async function readVerifiedAsset(distRoot, artifact, kind, extra = {}) {
  const unresolvedPath = resolveLexicallyContainedPath(distRoot, artifact.file);
  let absolutePath;
  let source;
  try {
    absolutePath = await realpath(unresolvedPath);
    if (!isStrictlyContained(distRoot, absolutePath)) {
      fail(
        `Runtime asset path escapes the package through a symbolic link: ${artifact.file}`,
        PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID,
      );
    }
    source = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (error instanceof PageRuntimeError) throw error;
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      fail(
        `The ${kind} runtime asset is missing: ${artifact.file}`,
        PAGE_RUNTIME_ERROR_CODES.ASSET_MISSING,
        error,
      );
    }
    fail(
      `The ${kind} runtime asset could not be read: ${artifact.file}`,
      PAGE_RUNTIME_ERROR_CODES.ASSET_MISSING,
      error,
    );
  }

  const actualHash = sha256(source);
  if (actualHash !== artifact.sha256) {
    fail(
      `The ${kind} runtime asset failed integrity verification: ${artifact.file}`,
      PAGE_RUNTIME_ERROR_CODES.INTEGRITY_MISMATCH,
    );
  }
  return Object.freeze({ kind, ...extra, source, sha256: actualHash });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeReadOptions(options) {
  if (!isObject(options)) {
    fail(
      "runtime options must be an object.",
      PAGE_RUNTIME_ERROR_CODES.INVALID_ARGUMENT,
    );
  }
  const adapterIds = normalizeAdapterIds(options.adapterIds ?? []);
  const expectedRuntimeAbi = options.expectedRuntimeAbi ?? PAGE_RUNTIME_ABI;
  const includeWebMcp = options.includeWebMcp ?? false;
  if (!isNonEmptyString(expectedRuntimeAbi)) {
    fail(
      "expectedRuntimeAbi must be a non-empty string.",
      PAGE_RUNTIME_ERROR_CODES.INVALID_ARGUMENT,
    );
  }
  if (typeof includeWebMcp !== "boolean") {
    fail(
      "includeWebMcp must be a boolean.",
      PAGE_RUNTIME_ERROR_CODES.INVALID_ARGUMENT,
    );
  }
  return { adapterIds, expectedRuntimeAbi, includeWebMcp };
}

function normalizeAdapterIds(adapterIds) {
  try {
    return canonicalPageRuntimeAdapterIds(adapterIds);
  } catch (error) {
    const message = error?.message || String(error);
    const code = message.startsWith("Unknown page-runtime adapter:")
      ? PAGE_RUNTIME_ERROR_CODES.UNKNOWN_ADAPTER
      : PAGE_RUNTIME_ERROR_CODES.INVALID_ARGUMENT;
    fail(message, code, error);
  }
}

export async function readPageRuntimeFromRoot(
  packageRoot,
  options = {},
) {
  if (!isNonEmptyString(packageRoot)) {
    fail(
      "packageRoot must be a non-empty string.",
      PAGE_RUNTIME_ERROR_CODES.INVALID_ARGUMENT,
    );
  }
  const {
    adapterIds: canonicalAdapterIds,
    expectedRuntimeAbi,
    includeWebMcp,
  } = normalizeReadOptions(options);

  const unresolvedPackageRoot = path.resolve(packageRoot);
  const unresolvedDistRoot = path.resolve(unresolvedPackageRoot, "dist");
  const unresolvedManifestPath = path.join(unresolvedDistRoot, "manifest.json");
  let packageRealRoot;
  let distRoot;
  let manifestPath;
  let manifest;
  try {
    packageRealRoot = await realpath(unresolvedPackageRoot);
    distRoot = await realpath(unresolvedDistRoot);
    manifestPath = await realpath(unresolvedManifestPath);
  } catch (error) {
    fail(
      "The page-runtime manifest is missing.",
      PAGE_RUNTIME_ERROR_CODES.MANIFEST_MISSING,
      error,
    );
  }
  if (
    !isStrictlyContained(packageRealRoot, distRoot) ||
    !isStrictlyContained(distRoot, manifestPath)
  ) {
    fail(
      "The page-runtime manifest escapes the installed package through a symbolic link.",
      PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID,
    );
  }
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      fail(
        "The page-runtime manifest is not valid JSON.",
        PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID,
        error,
      );
    }
    fail(
      "The page-runtime manifest is missing.",
      PAGE_RUNTIME_ERROR_CODES.MANIFEST_MISSING,
      error,
    );
  }
  validateManifest(manifest);

  if (manifest.runtimeAbi !== expectedRuntimeAbi) {
    fail(
      `Runtime ABI ${manifest.runtimeAbi} is incompatible with expected ABI ${expectedRuntimeAbi}.`,
      PAGE_RUNTIME_ERROR_CODES.ABI_MISMATCH,
    );
  }

  let webMcpLayer = null;
  if (includeWebMcp) {
    webMcpLayer = await readVerifiedAsset(
      distRoot,
      manifest.layers.webmcp,
      "webmcp",
    );
  }
  const basePreludeLayer = await readVerifiedAsset(
    distRoot,
    manifest.layers.prelude,
    "prelude",
  );
  const preludeSource = webMcpLayer
    ? [webMcpLayer.source, basePreludeLayer.source].join("\n;\n")
    : basePreludeLayer.source;
  const prelude = Object.freeze({
    kind: "prelude",
    source: preludeSource,
    sha256: sha256(preludeSource),
  });

  const adapterLayers = [];
  for (const adapterId of canonicalAdapterIds) {
    const descriptor = manifest.adapters[adapterId];
    adapterLayers.push(
      await readVerifiedAsset(distRoot, descriptor.artifact, "adapter", {
        adapterId,
      }),
    );
  }
  const tail = await readVerifiedAsset(distRoot, manifest.layers.tail, "tail");

  const compositionHash = sha256(
    [prelude, ...adapterLayers, tail]
      .map(({ source }) => source)
      .join("\n;\n"),
  );
  const adapters = canonicalAdapterIds.map((adapterId) =>
    deepFreeze(structuredClone(manifest.adapters[adapterId])),
  );

  return Object.freeze({
    releaseVersion: manifest.releaseVersion,
    runtimeAbi: manifest.runtimeAbi,
    adapters: Object.freeze(adapters),
    layers: Object.freeze({
      prelude,
      adapters: Object.freeze(adapterLayers),
      tail,
    }),
    compositionHash,
  });
}
