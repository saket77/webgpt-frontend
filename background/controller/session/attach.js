import { addEvent } from "../../events.js";
import {
  getSession,
  moveSession,
} from "../../state/sessionStore.js";
import { clone } from "../../utils/common.js";

function hasMeaningfulSession(session) {
  if (!session) return false;

  return Boolean(
    session.goal ||
      session.runId ||
      session.running ||
      session.awaitingNavigation ||
      session.pausedReason ||
      session.step > 0 ||
      (Array.isArray(session.events) && session.events.length > 0),
  );
}

export function createAttachSessionToTab({ runtime }) {
  return async function attachSessionToTab(fromTabId, toTabId) {
    if (!Number.isInteger(fromTabId) || !Number.isInteger(toTabId)) {
      throw new Error("Both source and target tab IDs are required.");
    }

    if (fromTabId === toTabId) {
      const session = await getSession(fromTabId);
      return {
        ok: true,
        attachedTabId: session.attachedTabId || fromTabId,
        alreadyAttached: true,
      };
    }

    const sourceSession = await getSession(fromTabId);
    const targetTab = await chrome.tabs.get(toTabId).catch(() => null);

    if (!targetTab?.id) {
      throw new Error("Target tab no longer exists.");
    }

    if (!hasMeaningfulSession(sourceSession)) {
      throw new Error("No active or paused session exists on the source tab.");
    }

    if (sourceSession.movedToTabId) {
      throw new Error(
        `Source session has already been moved to tab ${sourceSession.movedToTabId}.`,
      );
    }

    if (sourceSession.running || sourceSession.awaitingNavigation) {
      throw new Error(
        "Cannot attach while the agent is actively running or awaiting navigation. Pause or stop it first.",
      );
    }

    const targetReady = await runtime.ensureContentScriptReady(toTabId, {
      attempts: 10,
      delayMs: 200,
      allowInjection: true,
    });

    if (!targetReady) {
      throw new Error("Could not prepare the target tab for WebGPT.");
    }

    const targetSession = await getSession(toTabId);

    if (
      hasMeaningfulSession(targetSession) &&
      !targetSession.movedToTabId &&
      (targetSession.attachedTabId || toTabId) === toTabId
    ) {
      throw new Error(
        "Target tab already has a WebGPT session. Reset it first or choose another tab.",
      );
    }

    const nextSession = {
      ...clone(sourceSession),
      tabId: toTabId,
      attachedTabId: toTabId,
      movedFromTabId: fromTabId,
      movedToTabId: null,
      running: false,
      awaitingNavigation: false,
      stopRequested: false,
      lastKnownUrl: targetTab.url || sourceSession.lastKnownUrl || "",
    };

    await moveSession(fromTabId, toTabId, nextSession);

    await addEvent(fromTabId, {
      kind: "session_detached",
      step: sourceSession.step,
      message: `Session moved from tab ${fromTabId} to tab ${toTabId}.`,
      toTabId,
    });

    await addEvent(toTabId, {
      kind: "session_attached",
      step: nextSession.step,
      message: `Session attached from tab ${fromTabId}.`,
      fromTabId,
      url: nextSession.lastKnownUrl,
    });

    return {
      ok: true,
      fromTabId,
      toTabId,
      attachedTabId: toTabId,
    };
  };
}
