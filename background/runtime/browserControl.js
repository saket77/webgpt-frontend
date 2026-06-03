import { addEvent } from "../events.js";
import { getSession, moveSession } from "../state/sessionStore.js";
import { BROWSER_DOM_SURFACE } from "./surfaces.js";

export function isBrowserControlAction(action) {
  return action?.executor === "browser";
}

function browserControlTrace(action, strategyUsed, extra = {}) {
  return {
    actionType: action?.type || "",
    executor: "browser",
    strategyUsed,
    strategiesTried: [strategyUsed],
    replayTarget: null,
    ...extra,
  };
}

function failedResult(action, detail, error, extra = {}) {
  return {
    ok: false,
    detail,
    error: error?.message || String(error || detail),
    executionTrace: browserControlTrace(action, "browser-control-failed", extra),
  };
}

async function focusTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.id) return null;

  if (Number.isInteger(tab.windowId)) {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  }

  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  return tab;
}

async function returnToMovedFromTab(tabId, action, session) {
  const sourceTabId = Number.isInteger(session?.movedFromTabId)
    ? session.movedFromTabId
    : null;

  if (!sourceTabId || sourceTabId === tabId) return null;

  const sourceTab = await chrome.tabs.get(sourceTabId).catch(() => null);
  if (!sourceTab?.id) {
    return failedResult(
      action,
      `Original tab ${sourceTabId} is no longer available.`,
      null,
      { sourceTabId, closedTabId: tabId },
    );
  }

  const restoredSession = {
    ...session,
    tabId: sourceTabId,
    attachedTabId: sourceTabId,
    movedFromTabId: null,
    movedToTabId: null,
    pendingNewTab: null,
    awaitingNavigation: false,
    lastKnownUrl: sourceTab.url || session.lastKnownUrl || "",
    surface: session.surface || BROWSER_DOM_SURFACE,
  };

  await moveSession(tabId, sourceTabId, restoredSession);
  await focusTab(sourceTabId);
  await chrome.tabs.remove(tabId).catch(() => {});

  await addEvent(sourceTabId, {
    kind: "browser_control",
    actionType: action.type,
    step: restoredSession.step,
    message: `Returned from tab ${tabId} to original tab ${sourceTabId}.`,
    closedTabId: tabId,
    sourceTabId,
  });

  return {
    ok: true,
    detail: `Returned to original tab ${sourceTabId}.`,
    tabId: sourceTabId,
    closedTabId: tabId,
    sourceTabId,
    navigationStarted: false,
    executionTrace: browserControlTrace(
      action,
      "close-current-tab-return-to-source",
      { sourceTabId, closedTabId: tabId },
    ),
  };
}

async function goBackInTab(tabId, action, session) {
  try {
    await chrome.tabs.goBack(tabId);
  } catch (error) {
    return failedResult(
      action,
      "Chrome back navigation is not available for the current tab.",
      error,
      { tabId },
    );
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);

  await addEvent(tabId, {
    kind: "browser_control",
    actionType: action.type,
    step: session?.step || null,
    message: "Requested Chrome back navigation.",
    url: tab?.url || "",
  });

  return {
    ok: true,
    detail: "Requested Chrome back navigation.",
    tabId,
    navigationStarted: true,
    observedUrl: tab?.url || "",
    executionTrace: browserControlTrace(action, "chrome-tabs-goBack", {
      tabId,
      observedUrl: tab?.url || "",
    }),
  };
}

async function returnToPreviousPage(tabId, action) {
  const session = await getSession(tabId);
  const movedTabResult = await returnToMovedFromTab(tabId, action, session);
  if (movedTabResult) return movedTabResult;

  return goBackInTab(tabId, action, session);
}

export async function runBrowserControlAction(tabId, action) {
  switch (action?.type) {
    case "return_to_previous_page":
      return returnToPreviousPage(tabId, action);

    default:
      return failedResult(
        action,
        `Unsupported browser executor action: ${action?.type || "unknown"}.`,
      );
  }
}
