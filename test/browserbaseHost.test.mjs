import test from "node:test";
import assert from "node:assert/strict";

import {
  createBrowserbaseRuntime,
  getBrowserbasePageRuntimeScriptFiles,
} from "../apps/browserbase-host/src/browserbaseRuntime.js";
import { parseArgs } from "../apps/browserbase-host/src/cli.js";
import { PAGE_RUNTIME_SCRIPT_FILES } from "@webgpt/page-runtime";

function createFakeFrame(name, url = `https://example.test/${name}`) {
  return {
    name,
    injectedFiles: [],
    lastRunActionsArg: null,
    url() {
      return url;
    },
    async evaluate(fn, arg) {
      const source = String(fn);

      if (source.includes("__WEBGPT_CLOUD_RUNTIME_INJECTED_FILES__")) {
        this.injectedFiles.push(arg.file);
        return true;
      }

      if (source.includes("typeof globalThis.WebGPTExtractState")) {
        return this.injectedFiles.length > 0;
      }

      if (source.includes("globalThis.WebGPTExtractState")) {
        return {
          goal: arg.nextGoal,
          step: arg.nextStep,
          timestamp: "2026-07-03T00:00:00.000Z",
          url,
          title: name,
          viewport: { width: 1280, height: 720 },
          scroll: {
            x: 0,
            y: 0,
            viewportWidth: 1280,
            viewportHeight: 720,
            documentWidth: 1280,
            documentHeight: 720,
            atTop: true,
            atBottom: true,
          },
          controls: [{ id: `${name}_button`, label: "Run" }],
          scrollableContainers: [],
          headings: [],
          visibleTextSummary: [],
          overlays: [],
          groups: [],
        };
      }

      if (source.includes("globalThis.WebGPTRunner.runActions")) {
        this.lastRunActionsArg = arg;
        return {
          ok: true,
          summary: "fake actions ok",
          results: arg.nextActions.map((action) => ({
            action,
            result: { ok: true },
          })),
        };
      }

      if (source.includes("globalThis.WebGPTRunner.runReplaySteps")) {
        return {
          ok: true,
          summary: "fake replay ok",
          results: arg.steps.map((step) => ({ step, result: { ok: true } })),
        };
      }

      return null;
    },
  };
}

function createFakePage(frames) {
  let currentUrl = "https://example.test";
  return {
    mainFrame() {
      return frames[0];
    },
    frames() {
      return frames;
    },
    on() {},
    url() {
      return currentUrl;
    },
    async title() {
      return "Fake page";
    },
    async goto(url) {
      currentUrl = url;
      return { ok: true };
    },
    async goBack() {
      currentUrl = "https://example.test/back";
      return { ok: true };
    },
    async waitForLoadState() {},
  };
}

function createRuntimeWithFakePage(frames) {
  return createBrowserbaseRuntime({
    page: createFakePage(frames),
    readScript: async (_absolutePath, relativePath) => `// ${relativePath}`,
    navigationTimeoutMs: 100,
  });
}

test("browserbase host uses canonical page-runtime files without extension bridge", async () => {
  const scriptFiles = getBrowserbasePageRuntimeScriptFiles();
  const mainFrame = createFakeFrame("main");
  const runtime = createRuntimeWithFakePage([mainFrame]);

  assert.deepEqual(scriptFiles, PAGE_RUNTIME_SCRIPT_FILES);
  assert.equal(scriptFiles.includes("content-scripts/agent.js"), false);

  const ready = await runtime.ensureContentScriptReady(1, {
    attempts: 1,
    delayMs: 0,
  });

  assert.equal(ready, true);
  assert.deepEqual(mainFrame.injectedFiles, PAGE_RUNTIME_SCRIPT_FILES);
});

test("browserbase runtime extracts aggregate state from ready frames", async () => {
  const mainFrame = createFakeFrame("main");
  const childFrame = createFakeFrame("child", "https://example.test/iframe");
  const runtime = createRuntimeWithFakePage([mainFrame, childFrame]);

  await runtime.ensureContentScriptReady(1, { attempts: 1, delayMs: 0 });
  const state = await runtime.extractStateFromTab(1, {
    goal: "Extract tenders",
    step: 2,
  });

  assert.equal(state.goal, "Extract tenders");
  assert.equal(state.step, 2);
  assert.equal(state.frames["0"].title, "main");
  assert.equal(state.frames["1"].title, "child");
  assert.equal(state.frames["1"].controls[0].id, "child_button");
});

test("browserbase runtime executes planner actions in the selected frame", async () => {
  const mainFrame = createFakeFrame("main");
  const childFrame = createFakeFrame("child", "https://example.test/iframe");
  const runtime = createRuntimeWithFakePage([mainFrame, childFrame]);

  await runtime.ensureContentScriptReady(1, { attempts: 1, delayMs: 0 });
  const result = await runtime.runActionsInTab(
    1,
    {
      goal: "Click child",
      step: 3,
      frames: {
        1: {
          url: "https://example.test/iframe",
          title: "child",
          controls: [{ id: "child_button", label: "Run" }],
        },
      },
    },
    [{ type: "click", targetId: "child_button", frameId: 1 }],
  );

  assert.equal(result.ok, true);
  assert.equal(mainFrame.lastRunActionsArg, null);
  assert.deepEqual(childFrame.lastRunActionsArg.nextActions, [
    { type: "click", targetId: "child_button" },
  ]);
  assert.equal(childFrame.lastRunActionsArg.nextState.title, "child");
});

test("browserbase runtime rejects unsupported cloud-only surfaces clearly", async () => {
  const runtime = createRuntimeWithFakePage([createFakeFrame("main")]);

  await assert.rejects(
    () => runtime.runGoogleSheetsCommandsInTab(),
    /Google Sheets commands are not supported in Browserbase host v1/,
  );
  await assert.rejects(
    () => runtime.runMicrosoftExcelCommandsInTab(),
    /Microsoft Excel commands are not supported in Browserbase host v1/,
  );
});

test("browserbase CLI supports eProcure dry-run defaults", () => {
  const options = parseArgs(["--eprocure", "--dry-run", "--project-id", "project_123"]);

  assert.equal(options.dryRun, true);
  assert.equal(options.projectId, "project_123");
  assert.match(options.url, /FrontEndLatestActiveTendersOrgwise/);
  assert.match(options.goal, /today's active tenders/);
});
