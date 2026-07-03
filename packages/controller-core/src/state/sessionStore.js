import { getControllerCorePorts } from "../ports.js";

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
    pendingAccessCommand: null,
    pendingAccessSurface: "",
    artifactFileName: "",
    events: [],
    lastKnownUrl: "",
    surface: "browser_dom",
    surfaceContexts: {},
    movedToTabId: null,
    movedFromTabId: null,
    finalResult: null,
  };
}

export async function ensureHydrated() {
  return getControllerCorePorts().sessionStore.ensureHydrated();
}

export async function getSession(tabId) {
  return getControllerCorePorts().sessionStore.getSession(tabId);
}

export async function saveSession(tabId, session) {
  return getControllerCorePorts().sessionStore.saveSession(tabId, session);
}

export async function replaceSession(tabId, session) {
  return getControllerCorePorts().sessionStore.replaceSession(tabId, session);
}

export async function moveSession(fromTabId, toTabId, nextSession) {
  return getControllerCorePorts().sessionStore.moveSession(
    fromTabId,
    toTabId,
    nextSession,
  );
}

export async function getSessionIfExists(tabId) {
  return getControllerCorePorts().sessionStore.getSessionIfExists(tabId);
}
