import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PAGE_RUNTIME_ADAPTER_IDS } from "../packages/page-runtime/src/layers.js";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const PACKAGE_ROOT = path.join(REPO_ROOT, "packages", "page-runtime");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
        ),
      );
    });
  });
}

async function listFiles(root, relativeRoot = "") {
  const entries = await readdir(path.join(root, relativeRoot), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, relativePath)));
    } else {
      files.push(relativePath);
    }
  }
  return files.sort();
}

const packageMetadata = JSON.parse(
  await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
);
const archiveName = `${packageMetadata.name
  .replace(/^@/, "")
  .replaceAll("/", "-")}-${packageMetadata.version}.tgz`;
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "webgpt-page-runtime-consumer-"),
);

try {
  const releaseRoot = path.join(temporaryRoot, "release");
  const consumerRoot = path.join(temporaryRoot, "consumer");
  const npmCache = path.join(temporaryRoot, "npm-cache");
  await mkdir(releaseRoot, { recursive: true });
  await mkdir(consumerRoot, { recursive: true });

  await run(
    npmCommand,
    [
      "pack",
      "--workspace",
      packageMetadata.name,
      "--pack-destination",
      releaseRoot,
      "--cache",
      npmCache,
    ],
    { cwd: REPO_ROOT },
  );

  const archivePath = path.join(releaseRoot, archiveName);
  await access(archivePath);
  await run(
    npmCommand,
    [
      "install",
      "--prefix",
      consumerRoot,
      archivePath,
      "--ignore-scripts",
      "--no-package-lock",
      "--no-save",
      "--cache",
      npmCache,
    ],
    { cwd: consumerRoot },
  );

  const installedPackageRoot = path.join(
    consumerRoot,
    "node_modules",
    "@webgpt",
    "page-runtime",
  );
  const installedFiles = await listFiles(installedPackageRoot);
  const sourceFiles = (await listFiles(path.join(PACKAGE_ROOT, "src"))).map(
    (file) => `src/${file}`,
  );
  const expectedFiles = [
    "LICENSE",
    "README.md",
    "dist/assets/runtime-prelude.js",
    "dist/assets/runtime-tail.js",
    "dist/assets/webmcp.js",
    ...PAGE_RUNTIME_ADAPTER_IDS.map(
      (adapterId) => `dist/assets/adapters/${adapterId}.js`,
    ),
    "dist/manifest.json",
    "package.json",
    ...sourceFiles,
  ].sort();
  if (JSON.stringify(installedFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `Unexpected page-runtime tarball contents: ${installedFiles.join(", ")}`,
    );
  }

  const installedRuntime = await import(
    pathToFileURL(path.join(installedPackageRoot, "src", "node.js")),
  );
  const advertisedInventories = Object.entries(installedRuntime).filter(
    ([name, value]) => name.endsWith("_SCRIPT_FILES") && Array.isArray(value),
  );
  for (const [inventoryName, advertisedFiles] of advertisedInventories) {
    for (const advertisedFile of advertisedFiles) {
      const resolvedPath =
        installedRuntime.resolvePageRuntimeScriptPath(advertisedFile);
      await access(resolvedPath);
      if (!installedFiles.includes(`src/${advertisedFile}`)) {
        throw new Error(
          `${inventoryName} advertises a source absent from the tarball: ${advertisedFile}`,
        );
      }
    }
  }

  const consumerCheck = `
    const { PAGE_RUNTIME_ABI } = await import("@webgpt/page-runtime/catalog");
    const { readPageRuntime } = await import("@webgpt/page-runtime/node");
    const generic = await readPageRuntime();
    if (generic.adapters.length !== 0 || generic.layers.adapters.length !== 0) {
      throw new Error("The zero-adapter generic runtime is incomplete");
    }
    const selected = await readPageRuntime({
      adapterIds: [
        "eprocure.latest_active_tenders",
        "yelp.local",
        "ashby.application",
      ],
      expectedRuntimeAbi: PAGE_RUNTIME_ABI,
      includeWebMcp: true,
    });
    if (selected.adapters.map(({ id }) => id).join(">") !== "yelp.local>ashby.application>eprocure.latest_active_tenders") {
      throw new Error("Adapter selection is not in canonical order");
    }
    if (selected.layers.adapters.length !== 3 || !selected.layers.prelude.source.includes("WebGPTWebMCP")) {
      throw new Error("Unexpected selected layer order");
    }
    for (const layer of selected.layers.adapters) {
      if (!layer.source.includes(\`const ADAPTER_ID = "\${layer.adapterId}"\`)) {
        throw new Error(\`Adapter artifact isolation failed for \${layer.adapterId}\`);
      }
    }
    if (!selected.compositionHash) throw new Error("Missing composition hash");
  `;
  await run(
    process.execPath,
    ["--input-type=module", "--eval", consumerCheck],
    { cwd: consumerRoot },
  );

  console.log(
    "Page-runtime tarball installed and loaded generic plus multi-adapter compositions in a clean consumer.",
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
