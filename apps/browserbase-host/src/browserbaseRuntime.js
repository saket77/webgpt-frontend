import fs from "node:fs/promises";
import path from "node:path";
import { PAGE_RUNTIME_SCRIPT_FILES } from "../../../packages/page-runtime/src/manifest.js";
import { BROWSER_DOM_SURFACE } from "../../../packages/controller-core/src/runtime/surfaces.js";
import { pageRuntimeRoot } from "./paths.js";
import { CLOUD_TAB_ID } from "./host.js";

const CONTROL_DROP_REEXTRACT_ATTEMPTS = 2;
const CONTROL_DROP_REEXTRACT_DELAY_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toFrameKey(frameId) {
  return String(frameId);
}

function getStateFrames(state) {
  return state?.frames && typeof state.frames === "object" ? state.frames : {};
}

function stripTopLevelStateForFrame(frameState) {
  if (!frameState || typeof frameState !== "object") {
    return null;
  }

  const {
    goal: _goal,
    step: _step,
    timestamp: _timestamp,
    ...rest
  } = frameState;

  return rest;
}

function buildSingleFrameRunnerState({
  aggregateState,
  frameId,
  fallbackGoal = "",
  fallbackStep = 1,
}) {
  const frameKey = toFrameKey(frameId);
  const frameState = aggregateState?.frames?.[frameKey];

  if (!frameState) {
    throw new Error(`Frame ${frameId} is not present in aggregate state.`);
  }

  return {
    goal: aggregateState?.goal || fallbackGoal || "",
    step: aggregateState?.step || fallbackStep || 1,
    url: frameState.url || "",
    title: frameState.title || "",
    viewport: frameState.viewport || {
      width: 0,
      height: 0,
    },
    scroll: frameState.scroll || {
      x: 0,
      y: 0,
      viewportWidth: 0,
      viewportHeight: 0,
      documentWidth: 0,
      documentHeight: 0,
      atTop: true,
      atBottom: true,
    },
    headings: Array.isArray(frameState.headings) ? frameState.headings : [],
    visibleTextSummary: Array.isArray(frameState.visibleTextSummary)
      ? frameState.visibleTextSummary
      : [],
    overlays: Array.isArray(frameState.overlays) ? frameState.overlays : [],
    groups: Array.isArray(frameState.groups) ? frameState.groups : [],
    controls: Array.isArray(frameState.controls) ? frameState.controls : [],
    scrollableContainers: Array.isArray(frameState.scrollableContainers)
      ? frameState.scrollableContainers
      : [],
    timestamp: aggregateState?.timestamp || new Date().toISOString(),
  };
}

function sanitizeActionsForRunner(actions) {
  return (actions || []).map((action) => {
    if (!action || typeof action !== "object") return action;

    const { frameId: _frameId, ...rest } = action;
    return rest;
  });
}

function resolveExecutionFrameId(state, actions) {
  const frames = getStateFrames(state);
  const frameKeys = Object.keys(frames);

  if (!frameKeys.length) {
    throw new Error(
      "Cannot execute actions because aggregate state has no frames.",
    );
  }

  const explicitFrameIds = [];
  for (const action of actions || []) {
    if (action?.frameId !== undefined && action?.frameId !== null) {
      explicitFrameIds.push(Number(action.frameId));
    }
  }

  const uniqueFrameIds = [...new Set(explicitFrameIds)].filter((value) =>
    Number.isInteger(value),
  );

  if (uniqueFrameIds.length > 1) {
    throw new Error(
      `Actions span multiple frames (${uniqueFrameIds.join(", ")}). ` +
        "Browserbase host currently supports one execution frame per call.",
    );
  }

  if (uniqueFrameIds.length === 1) {
    const frameId = uniqueFrameIds[0];
    if (!frames[toFrameKey(frameId)]) {
      throw new Error(
        `Planner selected frame ${frameId}, but that frame is not present in current state.`,
      );
    }
    return frameId;
  }

  if (frameKeys.length === 1) {
    return Number(frameKeys[0]);
  }

  if (frames["0"]) {
    return 0;
  }

  throw new Error(
    "Could not resolve execution frame. Planner must include frameId when multiple frames exist.",
  );
}

function replayStepAction(step) {
  return step?.action || step?.command || step || {};
}

function resolveReplayFrameId(replaySteps = []) {
  const explicitFrameIds = [];
  for (const step of replaySteps || []) {
    const action = replayStepAction(step);
    if (action?.frameId !== undefined && action?.frameId !== null) {
      explicitFrameIds.push(Number(action.frameId));
    }
  }

  const uniqueFrameIds = [...new Set(explicitFrameIds)].filter((value) =>
    Number.isInteger(value),
  );

  if (uniqueFrameIds.length > 1) {
    throw new Error(
      `Replay steps span multiple frames (${uniqueFrameIds.join(", ")}).`,
    );
  }

  return uniqueFrameIds[0] || 0;
}

function actionMayCauseNavigation(action) {
  if (!action || typeof action !== "object") return false;
  if (action.type === "goto") return true;
  if (action.mayCauseNavigation || action.navigationAction) return true;
  if (action.expectedNavigation || action.opensNewTab) return true;
  return false;
}

export function getBrowserbasePageRuntimeScriptFiles() {
  return [...PAGE_RUNTIME_SCRIPT_FILES];
}

export function createBrowserbaseRuntime({
  page,
  readScript = async (filePath) => fs.readFile(filePath, "utf8"),
  runtimeRoot = pageRuntimeRoot,
  navigationTimeoutMs = 120000,
} = {}) {
  if (!page) {
    throw new Error("createBrowserbaseRuntime requires a Playwright page.");
  }

  let nextFrameId = 1;
  const frameIds = new Map();
  const navigationListeners = new Set();

  function normalizeFrameList() {
    const mainFrame = page.mainFrame();
    const frames = page.frames();
    const ordered = [
      mainFrame,
      ...frames.filter((frame) => frame !== mainFrame),
    ].filter(Boolean);

    frameIds.set(mainFrame, 0);
    for (const frame of ordered) {
      if (!frameIds.has(frame)) {
        frameIds.set(frame, nextFrameId);
        nextFrameId += 1;
      }
    }

    return ordered.map((frame) => ({
      frame,
      frameId: frameIds.get(frame),
    }));
  }

  function frameForId(frameId) {
    const entry = normalizeFrameList().find((item) => item.frameId === frameId);
    if (!entry) {
      throw new Error(`Frame ${frameId} is not available.`);
    }
    return entry.frame;
  }

  async function emitNavigationComplete() {
    const tab = await runtime.getTabInfo();
    for (const listener of navigationListeners) {
      await listener(tab);
    }
  }

  page.on?.("load", () => {
    emitNavigationComplete().catch(() => {});
  });

  async function injectRuntimeIntoFrame(frame) {
    for (const relativeFile of PAGE_RUNTIME_SCRIPT_FILES) {
      const absoluteFile = path.join(runtimeRoot, relativeFile);
      const source = await readScript(absoluteFile, relativeFile);

      await frame.evaluate(
        ({ file, code }) => {
          globalThis.__WEBGPT_CLOUD_RUNTIME_INJECTED_FILES__ =
            globalThis.__WEBGPT_CLOUD_RUNTIME_INJECTED_FILES__ || {};
          if (globalThis.__WEBGPT_CLOUD_RUNTIME_INJECTED_FILES__[file]) {
            return false;
          }

          (0, eval)(code);
          globalThis.__WEBGPT_CLOUD_RUNTIME_INJECTED_FILES__[file] = true;
          return true;
        },
        { file: relativeFile, code: source },
      );
    }
  }

  async function isFrameReady(frame) {
    return frame.evaluate(() => {
      return Boolean(
        typeof globalThis.WebGPTExtractState === "function" &&
          globalThis.WebGPTRunner &&
          typeof globalThis.WebGPTRunner.runActions === "function",
      );
    }).catch(() => false);
  }

  async function readyFrames() {
    const frames = normalizeFrameList();
    const results = [];

    for (const item of frames) {
      const ok = await isFrameReady(item.frame);
      if (ok) results.push(item);
    }

    return results;
  }

  const runtime = {
    addNavigationListener(listener) {
      navigationListeners.add(listener);
      return () => navigationListeners.delete(listener);
    },

    async goto(url) {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: navigationTimeoutMs,
      });
      await emitNavigationComplete();
    },

    async waitForPageReady() {
      await page.waitForLoadState("domcontentloaded", {
        timeout: navigationTimeoutMs,
      }).catch(() => {});
      await runtime.ensureContentScriptReady(CLOUD_TAB_ID, {
        attempts: 8,
        delayMs: 250,
        allowInjection: true,
      });
      await emitNavigationComplete();
    },

    async getTabInfo() {
      return {
        id: CLOUD_TAB_ID,
        url: page.url(),
        title: await page.title().catch(() => ""),
        status: "complete",
      };
    },

    async detectSurfaceForTab() {
      const tab = await runtime.getTabInfo();
      return {
        surface: BROWSER_DOM_SURFACE,
        url: tab.url,
        title: tab.title,
      };
    },

    async ensureContentScriptReady(
      _tabId,
      { attempts = 10, delayMs = 250, allowInjection = true } = {},
    ) {
      for (let index = 0; index < attempts; index += 1) {
        if ((await readyFrames()).length > 0) return true;
        await sleep(delayMs);
      }

      if (!allowInjection) return false;

      for (const { frame } of normalizeFrameList()) {
        await injectRuntimeIntoFrame(frame).catch((error) => {
          console.warn("[WebGPT Cloud] frame injection failed", {
            url: frame.url?.() || "",
            error: error?.message || String(error),
          });
        });
      }

      for (let index = 0; index < attempts; index += 1) {
        if ((await readyFrames()).length > 0) return true;
        await sleep(delayMs);
      }

      return false;
    },

    async extractStateFromTab(_tabId, { goal, step, meta = {} } = {}) {
      const ready = await runtime.ensureContentScriptReady(CLOUD_TAB_ID, {
        attempts: 10,
        delayMs: 250,
        allowInjection: true,
      });

      if (!ready) {
        throw new Error("Page runtime is not ready in the Browserbase session.");
      }

      const frameDescriptors = await readyFrames();
      const frames = {};
      const failures = [];

      for (const { frame, frameId } of frameDescriptors) {
        try {
          const fullState = await frame.evaluate(
            ({ nextGoal, nextStep, nextMeta }) => {
              return globalThis.WebGPTExtractState({
                goal: nextGoal || "",
                step: nextStep || 1,
                ...(nextMeta || {}),
              });
            },
            {
              nextGoal: goal || "",
              nextStep: step || 1,
              nextMeta: meta || {},
            },
          );

          const frameState = stripTopLevelStateForFrame(fullState);
          if (frameState) frames[toFrameKey(frameId)] = frameState;
        } catch (error) {
          failures.push(error?.message || String(error));
        }
      }

      if (!Object.keys(frames).length) {
        throw new Error(
          failures[0] || "Failed to extract state from all Browserbase frames.",
        );
      }

      let state = {
        goal: meta.goal || goal || "",
        step: meta.step || step || 1,
        timestamp: new Date().toISOString(),
        frames,
      };

      for (let attempt = 0; attempt < CONTROL_DROP_REEXTRACT_ATTEMPTS; attempt += 1) {
        if (Object.keys(getStateFrames(state)).length > 0) break;
        await sleep(CONTROL_DROP_REEXTRACT_DELAY_MS);
      }

      return state;
    },

    async runActionsInTab(_tabId, state, actions = []) {
      const browserActions = actions.filter(
        (action) => action?.executor === "browser",
      );
      if (browserActions.length) {
        const results = [];
        for (const action of browserActions) {
          if (action.type === "return_to_previous_page") {
            const response = await page.goBack({
              waitUntil: "domcontentloaded",
              timeout: navigationTimeoutMs,
            }).catch((error) => ({ error }));
            results.push({
              action,
              result: response?.error
                ? {
                    ok: false,
                    error: response.error.message || String(response.error),
                  }
                : {
                    ok: true,
                    detail: "Returned to previous page.",
                    navigationStarted: true,
                  },
            });
          } else {
            results.push({
              action,
              result: {
                ok: false,
                error: `Unsupported browser executor action: ${action.type}`,
              },
            });
          }
        }
        return {
          ok: results.every((item) => item.result.ok),
          summary: "Browser executor actions completed.",
          results,
        };
      }

      const frameId = resolveExecutionFrameId(state, actions);
      const frame = frameForId(frameId);
      await runtime.ensureContentScriptReady(CLOUD_TAB_ID);

      const runnerState = buildSingleFrameRunnerState({
        aggregateState: state,
        frameId,
        fallbackGoal: state?.goal || "",
        fallbackStep: state?.step || 1,
      });

      const runnerActions = sanitizeActionsForRunner(actions);
      const result = await frame.evaluate(
        ({ nextState, nextActions }) => {
          return globalThis.WebGPTRunner.runActions(nextState, nextActions);
        },
        {
          nextState: runnerState,
          nextActions: runnerActions,
        },
      );

      if (actions.some(actionMayCauseNavigation)) {
        await page.waitForLoadState("domcontentloaded", {
          timeout: 5000,
        }).catch(() => {});
      }

      return result;
    },

    async runReplayActionsInTab(_tabId, replaySteps = []) {
      const frameId = resolveReplayFrameId(replaySteps);
      const frame = frameForId(frameId);
      await runtime.ensureContentScriptReady(CLOUD_TAB_ID);

      return frame.evaluate(
        ({ steps }) => globalThis.WebGPTRunner.runReplaySteps(steps),
        { steps: replaySteps },
      );
    },

    actionsMayCauseNavigation(actions = []) {
      return (actions || []).some(actionMayCauseNavigation);
    },

    async connectGoogleSheets() {
      throw new Error("Google Sheets runtime is not supported in Browserbase host v1.");
    },

    async connectMicrosoftExcel() {
      throw new Error("Microsoft Excel runtime is not supported in Browserbase host v1.");
    },

    async getGoogleSheetsAuthStatus() {
      return { ok: false, supported: false, reason: "unsupported_cloud_host_v1" };
    },

    async getMicrosoftExcelAuthStatus() {
      return { ok: false, supported: false, reason: "unsupported_cloud_host_v1" };
    },

    async runGoogleSheetsCommandsInTab() {
      throw new Error("Google Sheets commands are not supported in Browserbase host v1.");
    },

    async runMicrosoftExcelCommandsInTab() {
      throw new Error("Microsoft Excel commands are not supported in Browserbase host v1.");
    },
  };

  return runtime;
}
