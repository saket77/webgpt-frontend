import { addEvent } from "../../events.js";
import {
  getEmptySession,
  getSession,
  replaceSession,
  saveSession,
} from "../../state/sessionStore.js";
import { clone } from "../../utils/common.js";

export function clearPauseState(session) {
  session.pausedReason = "";
  session.pendingStep = null;
}

export function clearLocalRunTracking(session, { keepGoal = false } = {}) {
  const goal = keepGoal ? session.goal || "" : "";

  session.runId = "";
  session.running = false;
  session.awaitingNavigation = false;
  session.stopRequested = false;
  session.goal = goal;
  session.inputValues = keepGoal ? session.inputValues || {} : {};
  session.isTemplateRun = keepGoal ? Boolean(session.isTemplateRun) : false;
  session.templateRunId = keepGoal ? session.templateRunId || "" : "";
  session.templateQueue = keepGoal ? session.templateQueue || null : null;
  session.userHint = "";
  session.step = 0;
  session.pausedReason = "";
  session.pendingStep = null;
  session.lastKnownUrl = "";
  session.surface = "browser_dom";
  session.finalResult = null;
  session.pendingNewTab = null;
  session.replayRunning = false;
  session.artifactFileName = keepGoal ? session.artifactFileName || "" : "";
}

export function createSessionLifecycleHandlers({ plannerAdapter }) {
  async function deleteBackendRunAndClearLocal(
    tabId,
    session,
    { reason, message, keepGoal = false },
  ) {
    if (session.runId) {
      await plannerAdapter.stopRun({
        runId: session.runId,
        reason,
        message,
        deleteRun: true,
      });
    }

    clearLocalRunTracking(session, { keepGoal });
    session.attachedTabId = tabId;
    await saveSession(tabId, session);
  }

  async function resetSession(tabId) {
    const currentSession = await getSession(tabId);

    if (currentSession.runId) {
      try {
        await plannerAdapter.stopRun({
          runId: currentSession.runId,
          reason: "session_reset",
          message: "Frontend session reset.",
          deleteRun: true,
        });
      } catch {
        // Keep local reset behavior even if backend delete fails.
      }
    }

    const session = getEmptySession(tabId);
    await replaceSession(tabId, session);

    await addEvent(tabId, {
      kind: "session_reset",
      message: "Session reset.",
    });

    return { ok: true };
  }

  async function requestStop(tabId) {
    const session = await getSession(tabId);

    if (session.movedToTabId) {
      throw new Error(
        `This tab is no longer the live session owner. Session moved to tab ${session.movedToTabId}.`,
      );
    }

    session.stopRequested = true;
    session.running = false;
    session.awaitingNavigation = false;
    session.pausedReason = "forced_stop";
    await saveSession(tabId, session);
    if (session.runId) {
      try {
        await plannerAdapter.stopRun({
          runId: session.runId,
          reason: "stop_requested",
          message: "User requested stop.",
          deleteRun: false,
        });
      } catch {
        // Keep local stop behavior even if backend stop fails.
      }
    }

    await addEvent(tabId, {
      kind: "stop_requested",
      step: session.step,
      message: "User requested stop.",
    });

    return { ok: true };
  }

  async function pauseForForcedStop(
    tabId,
    message = "Agent stopped by user.",
  ) {
    const session = await getSession(tabId);

    session.running = false;
    session.awaitingNavigation = false;
    session.stopRequested = false;
    session.pausedReason = "forced_stop";

    if (session.runId) {
      try {
        await plannerAdapter.stopRun({
          runId: session.runId,
          reason: "stopped_by_user",
          message,
          deleteRun: false,
        });
      } catch {
        // Keep local stop behavior even if backend stop fails.
      }
    }

    await saveSession(tabId, session);

    await addEvent(tabId, {
      kind: "stopped_by_user",
      step: session.step,
      message,
    });

    return {
      ok: true,
      paused: true,
      reason: "forced_stop",
      step: session.step,
      message,
    };
  }

  async function stopIfRequested(tabId, message) {
    const session = await getSession(tabId);

    if (session.movedToTabId) {
      throw new Error(
        `Session ownership moved to tab ${session.movedToTabId}. Refusing to continue on stale tab ${tabId}.`,
      );
    }

    if ((session.attachedTabId || tabId) !== tabId) {
      throw new Error(
        "Session ownership drift detected. Refusing to continue on a stale tab binding.",
      );
    }

    if (!session.stopRequested) return null;

    return pauseForForcedStop(tabId, message);
  }

  async function getSessionState(tabId) {
    const session = await getSession(tabId);
    return clone(session);
  }

  return {
    deleteBackendRunAndClearLocal,
    getSessionState,
    pauseForForcedStop,
    requestStop,
    resetSession,
    stopIfRequested,
  };
}
