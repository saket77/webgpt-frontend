import { sleep } from "../utils/common.js";
import { BROWSER_STATE_QUALITY_STORAGE_KEY } from "../config.js";
import {
  isBrowserControlAction,
  runBrowserControlAction,
} from "./browserControl.js";
import {
  EXTENSION_CONTENT_SCRIPT_FILES,
} from "@webgpt/page-runtime";

const CONTENT_SCRIPT_PROTOCOL_REVISION = "webmcp-tools-2026-07-11";
const PING_MESSAGE_TYPE = "PING_WEBGPT_CONTENT_SCRIPT";
const EXTRACT_STATE_MESSAGE_TYPE = "WEBGPT_EXTRACT_STATE_V2";
const RUN_ACTIONS_MESSAGE_TYPE = "WEBGPT_RUN_ACTIONS_V2";

const CONTENT_SCRIPT_FILES = EXTENSION_CONTENT_SCRIPT_FILES;

const CONTROL_DROP_REEXTRACT_ATTEMPTS = 4;
const CONTROL_DROP_REEXTRACT_DELAY_MS = 500;
const CONTROL_DROP_MIN_BASELINE = 20;
const CONTROL_DROP_MIN_DELTA = 10;
const CONTROL_DROP_RATIO = 0.75;

const controlHighWaterByTabUrl = new Map();
let stateQualityHydratePromise = null;

async function sendMessageToFrame(tabId, frameId, message) {
  return chrome.tabs.sendMessage(tabId, message, { frameId });
}

function isInjectableUrl(url) {
  if (!url || typeof url !== "string") return false;

  return !(
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("devtools://") ||
    url.startsWith("view-source:")
  );
}

function toFrameKey(frameId) {
  return String(frameId);
}

function getStateFrames(state) {
  return state?.frames && typeof state.frames === "object" ? state.frames : {};
}

function getPrimaryFrameState(state) {
  const frames = getStateFrames(state);
  return frames["0"] || Object.values(frames)[0] || null;
}

function getStateUrl(state) {
  return getPrimaryFrameState(state)?.url || "";
}

function normalizeStateUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";

  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString();
  } catch {
    return raw.split("#")[0];
  }
}

function getStateControlCount(state) {
  return Object.values(getStateFrames(state)).reduce((total, frame) => {
    return total + (Array.isArray(frame?.controls) ? frame.controls.length : 0);
  }, 0);
}

function getStateQualityKey(tabId, state) {
  const url = normalizeStateUrl(getStateUrl(state));
  return url ? `${tabId}:${url}` : "";
}

async function ensureStateQualityHydrated() {
  if (!stateQualityHydratePromise) {
    stateQualityHydratePromise = (async () => {
      const stored = await chrome.storage.session
        .get(BROWSER_STATE_QUALITY_STORAGE_KEY)
        .catch(() => ({}));
      const raw = stored?.[BROWSER_STATE_QUALITY_STORAGE_KEY] || {};

      for (const [key, value] of Object.entries(raw)) {
        if (!key || !value || typeof value !== "object") continue;

        const controlCount = Number(value.controlCount || 0);
        if (!Number.isFinite(controlCount)) continue;

        controlHighWaterByTabUrl.set(key, {
          controlCount,
          url: normalizeStateUrl(value.url || ""),
          updatedAt: Number(value.updatedAt || 0),
        });
      }
    })();
  }

  await stateQualityHydratePromise;
}

async function persistStateQuality() {
  const value = {};

  for (const [key, entry] of controlHighWaterByTabUrl.entries()) {
    value[key] = entry;
  }

  await chrome.storage.session
    .set({
      [BROWSER_STATE_QUALITY_STORAGE_KEY]: value,
    })
    .catch(() => {});
}

async function rememberControlHighWater(tabId, state) {
  await ensureStateQualityHydrated();

  const key = getStateQualityKey(tabId, state);
  if (!key) return;

  const controlCount = getStateControlCount(state);
  const previous = controlHighWaterByTabUrl.get(key);

  if (!previous || controlCount > previous.controlCount) {
    controlHighWaterByTabUrl.set(key, {
      controlCount,
      url: normalizeStateUrl(getStateUrl(state)),
      updatedAt: Date.now(),
    });
    await persistStateQuality();
  }
}

async function getControlDropSignal(tabId, state, meta = {}) {
  await ensureStateQualityHydrated();

  if (!meta?.afterNavigation) return null;

  const key = getStateQualityKey(tabId, state);
  if (!key) return null;

  const previous = controlHighWaterByTabUrl.get(key);
  if (!previous || previous.controlCount < CONTROL_DROP_MIN_BASELINE) {
    return null;
  }

  const controlCount = getStateControlCount(state);
  const delta = previous.controlCount - controlCount;
  const threshold = Math.floor(previous.controlCount * CONTROL_DROP_RATIO);

  if (delta < CONTROL_DROP_MIN_DELTA || controlCount >= threshold) {
    return null;
  }

  return {
    key,
    url: previous.url || normalizeStateUrl(getStateUrl(state)),
    previousControlCount: previous.controlCount,
    controlCount,
    threshold,
  };
}

function controlDropRecovered(signal, state) {
  if (!signal) return true;

  const controlCount = getStateControlCount(state);
  const delta = signal.previousControlCount - controlCount;

  return delta < CONTROL_DROP_MIN_DELTA || controlCount >= signal.threshold;
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
    frameId,
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

    const { frameId, ...rest } = action;
    return rest;
  });
}

function resolveExecutionFrameId(state, actions) {
  const frames = state?.frames || {};
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

  const uniqueFrameIds = [...new Set(explicitFrameIds)].filter((v) =>
    Number.isInteger(v),
  );

  if (uniqueFrameIds.length > 1) {
    throw new Error(
      `Actions span multiple frames (${uniqueFrameIds.join(", ")}). ` +
        "runActionsInTab currently supports one execution frame per call.",
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

async function pingFrame(tabId, frameId) {
  try {
    const response = await sendMessageToFrame(tabId, frameId, {
      type: PING_MESSAGE_TYPE,
      protocolRevision: CONTENT_SCRIPT_PROTOCOL_REVISION,
    });

    return (
      !!response?.ok &&
      response.protocolRevision === CONTENT_SCRIPT_PROTOCOL_REVISION
    );
  } catch (error) {
    console.warn("[WebGPT][pingFrame] failed", {
      tabId,
      frameId,
      error: error?.message || String(error),
    });
    return false;
  }
}

async function injectFrame(tabId, frameId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: CONTENT_SCRIPT_FILES,
    });
    return true;
  } catch (error) {
    console.warn("[WebGPT][injectFrame] failed", {
      tabId,
      frameId,
      error: error?.message || String(error),
    });
    return false;
  }
}

async function injectContentScripts(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);

  if (!tab?.id) {
    throw new Error("Target tab does not exist.");
  }

  if (!isInjectableUrl(tab.url)) {
    throw new Error("Cannot attach agent to this type of tab.");
  }

  const frames = await getAllFrames(tabId).catch(() => []);

  if (!frames.length) {
    throw new Error("No frames found in target tab.");
  }

  await Promise.all(frames.map((frame) => injectFrame(tabId, frame.frameId)));
}

async function getFrameMeta(tabId, frameId, fallback = {}) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: () => ({
        href: location.href,
        title: document.title,
        isTop: window === window.top,
        controlCount: document.querySelectorAll(
          "button, a, input, textarea, select, [role]",
        ).length,
      }),
    });

    return results?.[0]?.result || null;
  } catch (error) {
    console.warn("[WebGPT][getFrameMeta] failed", {
      tabId,
      frameId,
      error: error?.message || String(error),
      href: fallback?.href || "",
    });
    return null;
  }
}

async function getAllFrames(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });

  const normalized = await Promise.all(
    (frames || []).map(async (frame) => {
      const meta = await getFrameMeta(tabId, frame.frameId, {
        href: frame.url || "",
      });

      return {
        frameId: frame.frameId,
        parentFrameId: frame.parentFrameId,
        href: meta?.href || frame.url || "",
        title: meta?.title || "",
        isTop: Boolean(meta?.isTop ?? frame.parentFrameId === -1),
        controlCount: Number(meta?.controlCount || 0),
      };
    }),
  );

  const sorted = normalized.sort((a, b) => a.frameId - b.frameId);
  return sorted;
}

async function getReadyFrames(tabId) {
  const frames = await getAllFrames(tabId).catch(() => []);

  if (!frames.length) {
    return [];
  }

  const results = await Promise.all(
    frames.map(async (frame) => {
      const ok = await pingFrame(tabId, frame.frameId);
      return {
        ...frame,
        ok,
      };
    }),
  );

  const readyFrames = results.filter((item) => item.ok);

  return readyFrames;
}

export async function ensureContentScriptReady(
  tabId,
  { attempts = 20, delayMs = 250, allowInjection = true } = {},
) {
  for (let i = 0; i < attempts; i++) {
    const readyFrames = await getReadyFrames(tabId);
    if (readyFrames.length > 0) {
      return true;
    }
    await sleep(delayMs);
  }

  if (!allowInjection) {
    return false;
  }

  await injectContentScripts(tabId);

  for (let i = 0; i < attempts; i++) {
    const readyFrames = await getReadyFrames(tabId);
    if (readyFrames.length > 0) {
      return true;
    }
    await sleep(delayMs);
  }

  return false;
}

async function extractStateFromFrame(
  tabId,
  frameId,
  { goal, step, meta = {} },
) {
  const response = await sendMessageToFrame(tabId, frameId, {
    type: EXTRACT_STATE_MESSAGE_TYPE,
    protocolRevision: CONTENT_SCRIPT_PROTOCOL_REVISION,
    goal,
    step,
    meta,
  });

  if (!response?.ok || !response?.state) {
    throw new Error(
      response?.error || `Failed to extract page state from frame ${frameId}.`,
    );
  }

  return response.state;
}

async function extractAggregateStateFromTab(tabId, { goal, step, meta = {} }) {
  const ready = await ensureContentScriptReady(tabId, {
    attempts: 20,
    delayMs: 250,
    allowInjection: true,
  });

  if (!ready) {
    throw new Error("Content script is not ready on the target tab.");
  }

  const frameDescriptors = await getReadyFrames(tabId);

  if (!frameDescriptors.length) {
    throw new Error("No ready frames found in the target tab.");
  }

  const settled = await Promise.allSettled(
    frameDescriptors.map(async (frame) => {
      const fullState = await extractStateFromFrame(tabId, frame.frameId, {
        goal,
        step,
        meta,
      });

      return {
        frameId: frame.frameId,
        frameState: stripTopLevelStateForFrame(fullState),
      };
    }),
  );

  const frames = {};
  const failures = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      const { frameId, frameState } = result.value;
      if (frameState) {
        frames[toFrameKey(frameId)] = frameState;
      }
    } else {
      failures.push(result.reason?.message || String(result.reason));
    }
  }

  if (!Object.keys(frames).length) {
    throw new Error(
      failures[0] || "Failed to extract page state from all ready frames.",
    );
  }

  if (failures.length) {
    console.warn(
      "[WebGPT][extractStateFromTab] frame extraction failures",
      failures,
    );
  }

  return {
    goal: meta.goal || goal || "",
    step: meta.step || step || 1,
    timestamp: new Date().toISOString(),
    frames,
  };
}

async function settleStateAfterSuspiciousControlDrop(
  tabId,
  initialState,
  { goal, step, meta = {} },
) {
  const signal = await getControlDropSignal(tabId, initialState, meta);

  if (!signal) {
    await rememberControlHighWater(tabId, initialState);
    return initialState;
  }

  let bestState = initialState;
  let bestControlCount = getStateControlCount(initialState);

  for (let attempt = 0; attempt < CONTROL_DROP_REEXTRACT_ATTEMPTS; attempt++) {
    await sleep(CONTROL_DROP_REEXTRACT_DELAY_MS);

    let candidateState = null;

    try {
      candidateState = await extractAggregateStateFromTab(tabId, {
        goal,
        step,
        meta: {
          ...meta,
          reextractAfterControlDrop: true,
          reextractAttempt: attempt + 1,
        },
      });
    } catch (error) {
      console.warn("[WebGPT][stateQuality] control-drop re-extract failed", {
        url: signal.url,
        attempt: attempt + 1,
        error: error?.message || String(error),
      });
      break;
    }

    const candidateControlCount = getStateControlCount(candidateState);

    if (candidateControlCount > bestControlCount) {
      bestState = candidateState;
      bestControlCount = candidateControlCount;
    }

    if (controlDropRecovered(signal, candidateState)) {
      bestState = candidateState;
      bestControlCount = candidateControlCount;
      break;
    }
  }

  await rememberControlHighWater(tabId, bestState);

  console.info("[WebGPT][stateQuality] re-extracted after control-count drop", {
    url: signal.url,
    previousControlCount: signal.previousControlCount,
    initialControlCount: signal.controlCount,
    finalControlCount: bestControlCount,
  });

  return bestState;
}

export async function extractStateFromTab(tabId, { goal, step, meta = {} }) {
  const state = await extractAggregateStateFromTab(tabId, { goal, step, meta });

  return settleStateAfterSuspiciousControlDrop(tabId, state, {
    goal,
    step,
    meta,
  });
}
export async function runReplayActionsInTab(tabId, replaySteps) {
  const ready = await ensureContentScriptReady(tabId, {
    attempts: 20,
    delayMs: 250,
    allowInjection: true,
  });

  if (!ready) {
    throw new Error("Content script is not ready on the target tab.");
  }

  const readyFrames = await getReadyFrames(tabId);

  if (!readyFrames.length) {
    throw new Error("No ready frames found.");
  }

  const frameId = readyFrames[0].frameId;

  const response = await sendMessageToFrame(tabId, frameId, {
    type: "WEBGPT_RUN_REPLAY",
    steps: replaySteps,
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Replay execution failed.");
  }

  return response.result;
}

async function runDomActionsInTab(tabId, state, actions) {
  const ready = await ensureContentScriptReady(tabId, {
    attempts: 20,
    delayMs: 250,
    allowInjection: true,
  });

  if (!ready) {
    throw new Error("Content script is not ready on the target tab.");
  }

  if (!state || typeof state !== "object" || !state.frames) {
    throw new Error(
      "runActionsInTab expected aggregate tab state with a frames object.",
    );
  }

  const frameId = resolveExecutionFrameId(state, actions);
  const readyFrames = await getReadyFrames(tabId);
  const readyFrameIds = new Set(readyFrames.map((frame) => frame.frameId));

  if (!readyFrameIds.has(frameId)) {
    throw new Error(
      `Execution frame ${frameId} is not ready. Ready frames: ${Array.from(
        readyFrameIds,
      ).join(", ")}`,
    );
  }

  const singleFrameState = buildSingleFrameRunnerState({
    aggregateState: state,
    frameId,
  });

  const runnerActions = sanitizeActionsForRunner(actions);

  const response = await sendMessageToFrame(tabId, frameId, {
    type: RUN_ACTIONS_MESSAGE_TYPE,
    protocolRevision: CONTENT_SCRIPT_PROTOCOL_REVISION,
    state: singleFrameState,
    actions: runnerActions,
  });

  if (!response?.ok) {
    throw new Error(
      response?.error || `Failed to execute actions in frame ${frameId}.`,
    );
  }

  return {
    ...response.result,
    frameId,
    tabId,
  };
}

function buildEmptyExecution() {
  return {
    ok: true,
    summary: "No browser actions were provided; nothing was executed.",
    results: [],
    noActions: true,
  };
}

function buildFailedExecution(results, result, tabId, frameId) {
  return {
    ok: false,
    summary: "Action execution failed.",
    error: result?.error || result?.detail || "Action execution failed.",
    results,
    tabId,
    frameId,
  };
}

function buildNavigationInterruptedExecution({
  execution = {},
  results,
  tabId,
  frameId,
  trailingActions = [],
}) {
  const skippedActions = [
    ...(Array.isArray(execution?.skippedActions)
      ? execution.skippedActions
      : []),
    ...(Array.isArray(trailingActions) ? trailingActions : []),
  ];

  return {
    ...execution,
    ok: true,
    summary: skippedActions.length
      ? `Navigation started; ${skippedActions.length} remaining action(s) were skipped.`
      : execution?.summary || "Navigation started.",
    results,
    navigationStarted: true,
    interruptedByNavigation: true,
    skippedActionCount: skippedActions.length,
    skippedActions,
    tabId,
    frameId,
  };
}

async function extractStateForActionSegment(tabId, previousState) {
  return extractAggregateStateFromTab(tabId, {
    goal: previousState?.goal || "",
    step: previousState?.step || 1,
    meta: { beforeActionSegment: true },
  });
}

export async function runActionsInTab(tabId, state, actions) {
  const safeActions = Array.isArray(actions) ? actions : [];
  if (!safeActions.length) return buildEmptyExecution();

  let activeTabId = tabId;
  let activeState = state;
  let frameId = null;
  let domBatch = [];
  const results = [];

  async function flushDomBatch(trailingActions = []) {
    if (!domBatch.length) return null;

    if (!activeState || typeof activeState !== "object" || !activeState.frames) {
      activeState = await extractStateForActionSegment(activeTabId, state);
    }

    const batch = domBatch;
    domBatch = [];

    const execution = await runDomActionsInTab(activeTabId, activeState, batch);
    if (Number.isInteger(execution?.frameId)) {
      frameId = execution.frameId;
    }
    if (Array.isArray(execution?.results)) {
      results.push(...execution.results);
    }

    if (!execution?.ok) {
      return {
        ...execution,
        results,
        tabId: activeTabId,
        frameId,
      };
    }

    if (execution?.navigationStarted) {
      return buildNavigationInterruptedExecution({
        execution,
        results,
        tabId: activeTabId,
        frameId,
        trailingActions,
      });
    }

    return null;
  }

  for (let index = 0; index < safeActions.length; index += 1) {
    const action = safeActions[index];
    if (isBrowserControlAction(action)) {
      const terminalDomExecution = await flushDomBatch(
        safeActions.slice(index),
      );
      if (terminalDomExecution) return terminalDomExecution;

      const result = await runBrowserControlAction(activeTabId, action, {
        state: activeState,
      });
      results.push({ action, result });

      if (Number.isInteger(result?.tabId)) {
        activeTabId = result.tabId;
      }

      if (!result?.ok) {
        return buildFailedExecution(results, result, activeTabId, frameId);
      }

      if (result?.navigationStarted) {
        return buildNavigationInterruptedExecution({
          results,
          tabId: activeTabId,
          frameId,
          trailingActions: safeActions.slice(index + 1),
        });
      }

      activeState = null;
      await sleep(300);
      continue;
    }

    domBatch.push(action);
  }

  const terminalDomExecution = await flushDomBatch();
  if (terminalDomExecution) return terminalDomExecution;

  return {
    ok: true,
    summary: "All actions executed.",
    results,
    frameId,
    tabId: activeTabId,
  };
}

export function actionsMayCauseNavigation(actions) {
  for (const action of actions || []) {
    if (!action?.type) continue;
    if (action.mayCauseNavigation || action.navigationAction) return true;
    if (action.executor === "browser") return true;
    if (action.type === "click") return true;
    if (action.type === "press") return true;
    if (action.type === "goto") return true;
  }

  return false;
}

export const browserRuntime = {
  actionsMayCauseNavigation,
  ensureContentScriptReady,
  extractStateFromTab,
  runActionsInTab,
  runReplayActionsInTab,
};
