import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  PAGE_RUNTIME_ADAPTER_IDS,
  PAGE_RUNTIME_ADAPTER_SCRIPT_FILES,
  PAGE_RUNTIME_PRELUDE_SCRIPT_FILES,
  PAGE_RUNTIME_TAIL_SCRIPT_FILES,
  PAGE_RUNTIME_WEBMCP_SCRIPT_FILES,
  pageRuntimeScriptFilesFor,
} from "../src/layers.js";
import { PAGE_RUNTIME_SCRIPT_FILES } from "../src/manifest.js";
import {
  PAGE_RUNTIME_ERROR_CODES,
  readPageRuntime,
  resolvePageRuntimeScriptPath,
} from "../src/node.js";
import {
  PAGE_RUNTIME_ABI,
  PAGE_RUNTIME_ADAPTER_DEFINITIONS,
  PAGE_RUNTIME_PACKAGE_NAME,
  PAGE_RUNTIME_RELEASE_VERSION,
  getPageRuntimeAdapterDefinition,
  listPageRuntimeAdapters,
} from "../src/catalog.js";
import { readPageRuntimeFromRoot } from "../src/reader.js";
import {
  DEFAULT_PAGE_RUNTIME_DIST,
  LAYER_SOURCE_SEPARATOR,
  buildPageRuntime,
} from "../scripts/build.mjs";

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runtimeLayers(runtime) {
  return [
    runtime.layers.prelude,
    ...runtime.layers.adapters,
    runtime.layers.tail,
  ];
}

async function source(relativeFile) {
  return readFile(resolvePageRuntimeScriptPath(relativeFile), "utf8");
}

async function sources(relativeFiles) {
  return Promise.all(relativeFiles.map(source));
}

async function temporaryPackage(t) {
  const packageRoot = await mkdtemp(
    path.join(os.tmpdir(), "webgpt-page-runtime-test-"),
  );
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await buildPageRuntime({ outputRoot: path.join(packageRoot, "dist") });
  return packageRoot;
}

async function rewriteManifest(packageRoot, update) {
  const manifestPath = path.join(packageRoot, "dist/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  update(manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function rejectsWithCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

before(async () => {
  await buildPageRuntime();
});

test("layer declarations preserve the exact page-runtime aggregate shared by both hosts", () => {
  assert.deepEqual(PAGE_RUNTIME_SCRIPT_FILES, [
    ...PAGE_RUNTIME_WEBMCP_SCRIPT_FILES,
    ...PAGE_RUNTIME_PRELUDE_SCRIPT_FILES,
    ...Object.values(PAGE_RUNTIME_ADAPTER_SCRIPT_FILES),
    ...PAGE_RUNTIME_TAIL_SCRIPT_FILES,
  ]);
  assert.equal(PAGE_RUNTIME_SCRIPT_FILES.length, 30);
  assert.deepEqual(PAGE_RUNTIME_ADAPTER_IDS, [
    "canvas.quiz",
    "yelp.local",
    "ncm_movie_calendar.local",
    "docusign.local",
    "dotloop.local",
    "ashby.application",
    "greenhouse.application",
    "investorgain.ipo_gmp_report",
    "eprocure.latest_active_tenders",
  ]);
});

test("selection supports zero or many adapters in canonical order with optional WebMCP", () => {
  assert.deepEqual(pageRuntimeScriptFilesFor(), [
    ...PAGE_RUNTIME_PRELUDE_SCRIPT_FILES,
    ...PAGE_RUNTIME_TAIL_SCRIPT_FILES,
  ]);
  assert.deepEqual(
    pageRuntimeScriptFilesFor(
      ["eprocure.latest_active_tenders", "ashby.application", "canvas.quiz"],
      { includeWebMcp: true },
    ),
    [
      ...PAGE_RUNTIME_WEBMCP_SCRIPT_FILES,
      ...PAGE_RUNTIME_PRELUDE_SCRIPT_FILES,
      PAGE_RUNTIME_ADAPTER_SCRIPT_FILES["canvas.quiz"],
      PAGE_RUNTIME_ADAPTER_SCRIPT_FILES["ashby.application"],
      PAGE_RUNTIME_ADAPTER_SCRIPT_FILES["eprocure.latest_active_tenders"],
      ...PAGE_RUNTIME_TAIL_SCRIPT_FILES,
    ],
  );
  assert.throws(
    () => pageRuntimeScriptFilesFor(["ashby.application", "ashby.application"]),
    /Duplicate page-runtime adapter/u,
  );
  for (const adapterId of ["unknown.site", "toString", "constructor", "__proto__"]) {
    assert.throws(
      () => pageRuntimeScriptFilesFor([adapterId]),
      /Unknown page-runtime adapter/u,
    );
  }
  assert.throws(() => pageRuntimeScriptFilesFor("ashby.application"), /array/u);
  assert.throws(
    () => pageRuntimeScriptFilesFor([], { includeWebMcp: "yes" }),
    /boolean/u,
  );
});

test("catalog is workflow-neutral and supplies serializable candidate match hints", () => {
  assert.deepEqual(
    Object.keys(PAGE_RUNTIME_ADAPTER_DEFINITIONS),
    PAGE_RUNTIME_ADAPTER_IDS,
  );
  for (const adapterId of PAGE_RUNTIME_ADAPTER_IDS) {
    const definition = getPageRuntimeAdapterDefinition(adapterId);
    assert.equal(definition.id, adapterId);
    assert.equal(definition.sourceFile, PAGE_RUNTIME_ADAPTER_SCRIPT_FILES[adapterId]);
    assert.equal(Number.isFinite(definition.priority), true);
    assert.equal(typeof definition.matchHints, "object");
    assert.deepEqual(JSON.parse(JSON.stringify(definition.matchHints)), definition.matchHints);
    assert.equal(Object.isFrozen(definition), true);
    assert.equal("workflow" in definition, false);
    assert.equal("operations" in definition, false);
  }
  assert.ok(
    getPageRuntimeAdapterDefinition("ashby.application").matchHints.hostnames.includes(
      "jobs.ashbyhq.com",
    ),
  );
  assert.ok(
    getPageRuntimeAdapterDefinition(
      "greenhouse.application",
    ).matchHints.hostnames.includes("job-boards.greenhouse.io"),
  );
  assert.equal(getPageRuntimeAdapterDefinition("toString"), null);

  const firstList = listPageRuntimeAdapters();
  const secondList = listPageRuntimeAdapters();
  assert.notEqual(firstList, secondList);
  assert.deepEqual(firstList.map(({ id }) => id), PAGE_RUNTIME_ADAPTER_IDS);
  assert.equal(Object.isFrozen(firstList), true);
  assert.equal(Object.isFrozen(firstList[0]), true);
  assert.equal(Object.isFrozen(firstList[0].matchHints), true);
  assert.notEqual(firstList[0], secondList[0]);
});

test("builder emits deterministic shared layers and every isolated adapter", async (t) => {
  const firstPackageRoot = await mkdtemp(path.join(os.tmpdir(), "webgpt-runtime-a-"));
  const secondPackageRoot = await mkdtemp(path.join(os.tmpdir(), "webgpt-runtime-b-"));
  const firstRoot = path.join(firstPackageRoot, "dist");
  const secondRoot = path.join(secondPackageRoot, "dist");
  t.after(() => rm(firstPackageRoot, { recursive: true, force: true }));
  t.after(() => rm(secondPackageRoot, { recursive: true, force: true }));

  const first = await buildPageRuntime({ outputRoot: firstRoot });
  const second = await buildPageRuntime({ outputRoot: secondRoot });
  assert.deepEqual(first, second);

  for (const [layerName, files, artifactFile] of [
    ["webmcp", PAGE_RUNTIME_WEBMCP_SCRIPT_FILES, "assets/webmcp.js"],
    ["prelude", PAGE_RUNTIME_PRELUDE_SCRIPT_FILES, "assets/runtime-prelude.js"],
    ["tail", PAGE_RUNTIME_TAIL_SCRIPT_FILES, "assets/runtime-tail.js"],
  ]) {
    const expected = (await sources(files)).join(LAYER_SOURCE_SEPARATOR);
    assert.equal(await readFile(path.join(firstRoot, artifactFile), "utf8"), expected);
    assert.equal(first.layers[layerName].sha256, digest(expected));
  }

  for (const [adapterId, adapterFile] of Object.entries(
    PAGE_RUNTIME_ADAPTER_SCRIPT_FILES,
  )) {
    const descriptor = first.adapters[adapterId];
    assert.equal(
      await readFile(path.join(firstRoot, descriptor.artifact.file), "utf8"),
      await source(adapterFile),
    );
  }
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.runtimeAbi, PAGE_RUNTIME_ABI);
  assert.deepEqual(first.compositionOrder, ["webmcp", "prelude", "adapters", "tail"]);
  assert.deepEqual(first.optionalLayers, ["webmcp"]);
  assert.equal(
    await readFile(path.join(firstRoot, "manifest.json"), "utf8"),
    await readFile(path.join(secondRoot, "manifest.json"), "utf8"),
  );
});

test("reader returns zero or many verified adapter layers in canonical order", async () => {
  const generic = await readPageRuntime();
  assert.deepEqual(generic.adapters, []);
  assert.deepEqual(runtimeLayers(generic).map(({ kind }) => kind), ["prelude", "tail"]);

  const selected = await readPageRuntime({
    adapterIds: [
      "eprocure.latest_active_tenders",
      "greenhouse.application",
      "canvas.quiz",
    ],
    expectedRuntimeAbi: PAGE_RUNTIME_ABI,
    includeWebMcp: true,
  });
  assert.equal(selected.releaseVersion, PAGE_RUNTIME_RELEASE_VERSION);
  assert.equal(selected.runtimeAbi, PAGE_RUNTIME_ABI);
  assert.deepEqual(selected.adapters.map(({ id }) => id), [
    "canvas.quiz",
    "greenhouse.application",
    "eprocure.latest_active_tenders",
  ]);
  assert.deepEqual(runtimeLayers(selected).map(({ kind }) => kind), [
    "prelude",
    "adapter",
    "adapter",
    "adapter",
    "tail",
  ]);
  assert.deepEqual(
    selected.layers.adapters.map(({ adapterId }) => adapterId),
    selected.adapters.map(({ id }) => id),
  );
  assert.ok(selected.layers.prelude.source.startsWith(await source("content-scripts/webMcp.js")));
  assert.equal(
    selected.compositionHash,
    digest(runtimeLayers(selected).map(({ source: value }) => value).join(LAYER_SOURCE_SEPARATOR)),
  );
  assert.equal(Object.isFrozen(selected.adapters[0]), true);
});

test("reader uses stable errors for bad selection and ABI mismatch", async () => {
  for (const adapterId of ["unknown.site", "toString", "__proto__", "constructor"]) {
    await assert.rejects(
      readPageRuntime({ adapterIds: [adapterId] }),
      rejectsWithCode(PAGE_RUNTIME_ERROR_CODES.UNKNOWN_ADAPTER),
    );
  }
  await assert.rejects(
    readPageRuntime({
      adapterIds: ["ashby.application", "ashby.application"],
    }),
    rejectsWithCode(PAGE_RUNTIME_ERROR_CODES.INVALID_ARGUMENT),
  );
  await assert.rejects(
    readPageRuntime({ expectedRuntimeAbi: "webgpt-future-abi-v2" }),
    rejectsWithCode(PAGE_RUNTIME_ERROR_CODES.ABI_MISMATCH),
  );
});

test("reader couples manifest metadata to the installed package and catalog", async (t) => {
  for (const mutate of [
    (manifest) => { manifest.packageName = "@example/substituted-runtime"; },
    (manifest) => { manifest.releaseVersion = "99.0.0"; },
    (manifest) => { manifest.adapters["ashby.application"].priority = -1; },
    (manifest) => { manifest.adapters["ashby.application"].matchHints = {}; },
    (manifest) => { delete manifest.adapters["eprocure.latest_active_tenders"]; },
  ]) {
    const packageRoot = await temporaryPackage(t);
    await rewriteManifest(packageRoot, mutate);
    await assert.rejects(
      readPageRuntimeFromRoot(packageRoot, {
        adapterIds: ["ashby.application"],
      }),
      rejectsWithCode(PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID),
    );
  }
  assert.equal(PAGE_RUNTIME_PACKAGE_NAME, "@webgpt/page-runtime");
});

test("reader rejects malformed, missing, or modified release files", async (t) => {
  const malformedRoot = await temporaryPackage(t);
  await writeFile(path.join(malformedRoot, "dist/manifest.json"), "not json", "utf8");
  await assert.rejects(
    readPageRuntimeFromRoot(malformedRoot),
    rejectsWithCode(PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID),
  );

  const missingManifestRoot = await temporaryPackage(t);
  await unlink(path.join(missingManifestRoot, "dist/manifest.json"));
  await assert.rejects(
    readPageRuntimeFromRoot(missingManifestRoot),
    rejectsWithCode(PAGE_RUNTIME_ERROR_CODES.MANIFEST_MISSING),
  );

  const missingAssetRoot = await temporaryPackage(t);
  await unlink(path.join(missingAssetRoot, "dist/assets/adapters/canvas.quiz.js"));
  await assert.rejects(
    readPageRuntimeFromRoot(missingAssetRoot, {
      adapterIds: ["canvas.quiz"],
    }),
    rejectsWithCode(PAGE_RUNTIME_ERROR_CODES.ASSET_MISSING),
  );

  const modifiedAssetRoot = await temporaryPackage(t);
  await writeFile(path.join(modifiedAssetRoot, "dist/assets/runtime-tail.js"), "tampered", "utf8");
  await assert.rejects(
    readPageRuntimeFromRoot(modifiedAssetRoot),
    rejectsWithCode(PAGE_RUNTIME_ERROR_CODES.INTEGRITY_MISMATCH),
  );

  const lexicalEscapeRoot = await temporaryPackage(t);
  await rewriteManifest(lexicalEscapeRoot, (manifest) => {
    manifest.layers.prelude.file = "../runtime-prelude.js";
  });
  await assert.rejects(
    readPageRuntimeFromRoot(lexicalEscapeRoot),
    rejectsWithCode(PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID),
  );
});

test(
  "reader rejects runtime files that escape dist through symbolic links",
  { skip: process.platform === "win32" && "file symlinks require elevated privileges" },
  async (t) => {
    const packageRoot = await temporaryPackage(t);
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "webgpt-runtime-outside-"));
    t.after(() => rm(outsideRoot, { recursive: true, force: true }));

    const insideAsset = path.join(packageRoot, "dist/assets/runtime-prelude.js");
    const outsideAsset = path.join(outsideRoot, "runtime-prelude.js");
    await copyFile(insideAsset, outsideAsset);
    await unlink(insideAsset);
    await symlink(outsideAsset, insideAsset);

    await assert.rejects(
      readPageRuntimeFromRoot(packageRoot),
      rejectsWithCode(PAGE_RUNTIME_ERROR_CODES.MANIFEST_INVALID),
    );
  },
);

test("default build location is package-local and self-contained", async () => {
  assert.equal(DEFAULT_PAGE_RUNTIME_DIST, path.join(PACKAGE_ROOT, "dist"));
  const nodeSource = await readFile(path.join(PACKAGE_ROOT, "src/node.js"), "utf8");
  assert.doesNotMatch(nodeSource, /application-runtime|webgpt-frontend/u);
});

test("package boundary exposes no legacy application-runtime API", async () => {
  const packageMetadata = JSON.parse(
    await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(packageMetadata.exports).sort(), [
    ".",
    "./catalog",
    "./layers",
    "./manifest",
    "./node",
  ]);
  const packageEntries = await readdir(PACKAGE_ROOT, { recursive: true });
  assert.deepEqual(
    packageEntries.filter((entry) =>
      /(?:^|[\\/])application-(?:runtime|layers)(?:[.\\/]|$)/u.test(entry),
    ),
    [],
  );

  const forbiddenLegacySurface =
    /@webgpt\/application-runtime|application-layers|readApplicationRuntime|APPLICATION_RUNTIME_/u;
  for (const relativeFile of [
    "package.json",
    "scripts/build.mjs",
    "src/catalog.js",
    "src/layers.js",
    "src/manifest.js",
    "src/node.js",
    "src/reader.js",
  ]) {
    assert.doesNotMatch(
      await readFile(path.join(PACKAGE_ROOT, relativeFile), "utf8"),
      forbiddenLegacySurface,
      `${relativeFile} must remain workflow-neutral`,
    );
  }
});
