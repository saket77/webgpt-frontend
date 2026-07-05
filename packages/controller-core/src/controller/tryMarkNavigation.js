import { getSession, saveSession, moveSession } from "../state/sessionStore.js";
import { addEvent } from "../events.js";
import { getControllerCorePorts } from "../ports.js";

function buildSyntheticExecution(actions, observedUrl) {
  const meaningful = (actions || []).filter(
    (a) => a?.type && a.type !== "wait",
  );

  if (!meaningful.length) return null;

  const last = meaningful[meaningful.length - 1];

  return {
    ok: true,
    summary: `Navigation triggered by ${last.type}`,
    synthetic: true,
    results: [
      {
        action: last,
        result: {
          ok: true,
          detail:
            last.type === "goto"
              ? `Navigating to ${last.url || observedUrl}`
              : `Navigation triggered by ${last.type}`,
          synthetic: true,
        },
      },
    ],
  };
}

export async function tryMarkAwaitingNavigation(
  tabId,
  step,
  actions,
  execution = null,
  options = {},
  { plannerAdapter, runtime } = {},
) {
  const session = await getSession(tabId);

  if (!session.runId) {
    return false;
  }

  if (!runtime.actionsMayCauseNavigation(actions)) {
    return false;
  }

  const forcedObservedUrl = options?.observedUrl || "";
  const handoffToTabId = Number.isInteger(options?.handoffToTabId)
    ? options.handoffToTabId
    : null;
  const source = options?.source || "";

  const tab = await getControllerCorePorts().host.getTab(tabId).catch(() => null);
  const observedUrl = forcedObservedUrl || tab?.url || "";
  const loading = handoffToTabId ? false : tab?.status === "loading";
  const urlChanged = Boolean(
    observedUrl && session.lastKnownUrl && observedUrl !== session.lastKnownUrl,
  );

  if (!handoffToTabId && !loading && !urlChanged) {
    return false;
  }

  const browserContext = plannerAdapter.buildBrowserContext(
    tabId,
    session,
    observedUrl,
  );
  const syntheticExecution =
    execution || buildSyntheticExecution(actions, observedUrl);

  const commandResult = await plannerAdapter.postCommandResult({
    runId: session.runId,
    type: "navigation_detected",
    command: {
      type: "run_actions",
      step,
    },
    execution: syntheticExecution,
    browserContext,
    navigationInfo: {
      observedUrl,
      loading,
      interruptedAfterExecution: Boolean(execution),
      browserContext,
      handoffToTabId,
      source,
    },
  });

  const waitCommand = commandResult.command || {};
  const nextSession = plannerAdapter.syncSessionWithRun(
    session,
    commandResult.run || waitCommand.run,
  );

  if (handoffToTabId) {
    const movedSession = {
      ...nextSession,
      tabId: handoffToTabId,
      attachedTabId: handoffToTabId,
      movedFromTabId: tabId,
      movedToTabId: null,
      running: false,
      awaitingNavigation: true,
      pendingStep: step,
      lastKnownUrl: observedUrl || nextSession.lastKnownUrl || "",
      pendingNewTab: null,
    };

    await moveSession(tabId, handoffToTabId, movedSession);

    await addEvent(tabId, {
      kind: "session_detached",
      step,
      message: `Session moved from tab ${tabId} to new tab ${handoffToTabId}.`,
      toTabId: handoffToTabId,
      reason: "new_tab_navigation",
    });

    await addEvent(handoffToTabId, {
      kind: "session_attached",
      step,
      message: `Session attached from tab ${tabId}. Waiting for new tab document to load.`,
      fromTabId: tabId,
      url: movedSession.lastKnownUrl,
      reason: "new_tab_navigation",
    });

    await addEvent(handoffToTabId, {
      kind: "awaiting_navigation",
      step,
      message:
        "New tab handoff detected. Waiting for the next document to load.",
      url: movedSession.lastKnownUrl,
      interruptedAfterExecution: Boolean(execution),
      source: source || "new_tab",
    });

    const handoffTab = await getControllerCorePorts()
      .host.getTab(handoffToTabId)
      .catch(() => null);

    if (handoffTab?.status === "complete") {
      const ready = await runtime.ensureContentScriptReady(handoffToTabId, {
        attempts: 10,
        delayMs: 200,
        allowInjection: true,
      });

      if (ready) {
        const latestMovedSession = await getSession(handoffToTabId);
        latestMovedSession.running = true;
        latestMovedSession.awaitingNavigation = false;
        latestMovedSession.pendingStep = null;
        latestMovedSession.lastKnownUrl =
          handoffTab.url || latestMovedSession.lastKnownUrl || "";
        await saveSession(handoffToTabId, latestMovedSession);

        await addEvent(handoffToTabId, {
          kind: "navigation_completed",
          step: latestMovedSession.step,
          url: latestMovedSession.lastKnownUrl,
          message:
            "New tab was already complete when session was attached. Resuming agent.",
        });

        return {
          marked: true,
          tabId: handoffToTabId,
          resumeCommand: {
            type: "navigation_completed",
            runId: latestMovedSession.runId,
            step: Number(latestMovedSession.step || 0) + 1,
            reason: "navigation_completed",
            meta: { afterNavigation: true },
          },
        };
      }
    }

    return {
      marked: true,
      tabId: handoffToTabId,
    };
  }

  nextSession.running = false;
  nextSession.awaitingNavigation = true;
  nextSession.pendingStep = step;
  nextSession.lastKnownUrl = observedUrl || nextSession.lastKnownUrl || "";
  nextSession.attachedTabId = tabId;

  await saveSession(tabId, nextSession);

  await addEvent(tabId, {
    kind: "awaiting_navigation",
    step,
    message: "Navigation detected. Waiting for the next document to load.",
    url: nextSession.lastKnownUrl,
    interruptedAfterExecution: Boolean(execution),
  });

  return {
    marked: true,
    tabId,
  };
}
