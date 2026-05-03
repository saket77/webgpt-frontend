import { STORAGE_KEY } from "../config.js";
import { tabKey } from "../utils/common.js";

const sessions = new Map();
let hydratePromise = null;

export function getEmptySession(tabId) {
  return {
    tabId,
    attachedTabId: tabId,
    runId: "",
    running: false,
    replayRunning: false,
    awaitingNavigation: false,
    stopRequested: false,
    goal: "",
    inputValues: {},
    isTemplateRun: false,
    templateRunId: "",
    templateQueue: null,
    userHint: "",
    step: 0,
    pausedReason: "",
    pendingStep: null,
    pendingNewTab: null,
    artifactFileName: "",
    events: [],
    lastKnownUrl: "",
    surface: "browser_dom",
    movedToTabId: null,
    movedFromTabId: null,
    finalResult: null,
  };
}

export async function ensureHydrated() {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      const stored = await chrome.storage.session.get(STORAGE_KEY);
      const raw = stored?.[STORAGE_KEY] || {};

      for (const [key, value] of Object.entries(raw)) {
        sessions.set(key, value);
      }
    })();
  }

  await hydratePromise;
}

async function persistSessions() {
  const obj = {};
  for (const [key, value] of sessions.entries()) {
    obj[key] = value;
  }

  await chrome.storage.session.set({
    [STORAGE_KEY]: obj,
  });
}

export async function getSession(tabId) {
  await ensureHydrated();

  const key = tabKey(tabId);
  if (!sessions.has(key)) {
    sessions.set(key, getEmptySession(tabId));
    await persistSessions();
  }

  return sessions.get(key);
}

export async function saveSession(tabId, session) {
  sessions.set(tabKey(tabId), session);
  await persistSessions();
}

export async function replaceSession(tabId, session) {
  sessions.set(tabKey(tabId), session);
  await persistSessions();
}

export async function moveSession(fromTabId, toTabId, nextSession) {
  const fromStub = getEmptySession(fromTabId);
  fromStub.movedToTabId = toTabId;

  const targetSession = {
    ...nextSession,
    tabId: toTabId,
    attachedTabId: toTabId,
    movedToTabId: null,
  };

  sessions.set(tabKey(fromTabId), fromStub);
  sessions.set(tabKey(toTabId), targetSession);

  await persistSessions();
}

export async function getSessionIfExists(tabId) {
  await ensureHydrated();
  return sessions.get(tabKey(tabId)) || null;
}
