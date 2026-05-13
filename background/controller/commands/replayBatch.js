import { addEvent } from "../../events.js";
import {
  getSession,
  moveSession,
  saveSession,
} from "../../state/sessionStore.js";
import { sleep } from "../../utils/common.js";
import { ensureLiveSession } from "./context.js";

async function waitForReplayNavigation(tabId, beforeUrl = "", runtime) {
  let sawLoading = false;

  for (let i = 0; i < 40; i += 1) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const currentUrl = tab?.url || "";
    const currentStatus = tab?.status || "";

    if (currentStatus === "loading") {
      sawLoading = true;
    }

    const urlChanged = Boolean(
      beforeUrl && currentUrl && currentUrl !== beforeUrl,
    );

    if ((urlChanged || sawLoading) && currentStatus === "complete") {
      const ready = await runtime.ensureContentScriptReady(tabId, {
        attempts: 5,
        delayMs: 200,
        allowInjection: true,
      });

      if (ready) {
        return {
          ok: true,
          observedUrl: currentUrl,
          urlChanged,
          sawLoading,
        };
      }
    }

    await sleep(250);
  }

  return {
    ok: false,
    observedUrl: beforeUrl,
    urlChanged: false,
    sawLoading: false,
  };
}

async function waitForReplayNewTab(tabId, runtime) {
  for (let i = 0; i < 40; i += 1) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const currentUrl = tab?.url || "";
    const currentStatus = tab?.status || "";

    if (tab?.id && currentStatus === "complete") {
      const ready = await runtime.ensureContentScriptReady(tabId, {
        attempts: 5,
        delayMs: 200,
        allowInjection: true,
      });

      if (ready) {
        return {
          ok: true,
          observedUrl: currentUrl,
        };
      }
    }

    await sleep(250);
  }

  return {
    ok: false,
    observedUrl: "",
  };
}

async function getReplayNavigationInfo(
  tabId,
  session,
  plannerAdapter,
  interrupted = false,
) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const observedUrl = tab?.url || "";

  return {
    observedUrl,
    loading: Boolean(tab?.status === "loading"),
    interruptedAfterExecution: interrupted,
    browserContext: plannerAdapter.buildBrowserContext(tabId, session, observedUrl),
  };
}

async function markReplayRunning(tabId, isRunning) {
  const session = await getSession(tabId);
  session.replayRunning = Boolean(isRunning);
  if (!isRunning) {
    session.pendingNewTab = null;
  }
  await saveSession(tabId, session);
}

export async function executeRunReplayBatchCommand(
  tabId,
  command,
  { plannerAdapter, runtime },
) {
  let activeTabId = tabId;
  let session = await ensureLiveSession(activeTabId);
  const batch = command.batch || {};
  const batchIndex = Number(command.batchIndex || 0);
  const totalBatchCount = Number(command.totalBatchCount || 0);
  const mayNavigate = Boolean(command.mayCauseNavigation);

  await markReplayRunning(activeTabId, true);

  if (command.isFirstBatch) {
    await addEvent(activeTabId, {
      kind: "replay_found",
      message: `Replay artifact found: ${command.fileName || ""}`,
    });

    await addEvent(activeTabId, {
      kind: "replay_started",
      message: `Running ${totalBatchCount} replay batch${
        totalBatchCount === 1 ? "" : "es"
      }...`,
    });
  }

  await addEvent(activeTabId, {
    kind: "replay_batch_started",
    message: `Running replay batch ${batchIndex + 1}/${totalBatchCount}.`,
    batchIndex,
    batchStepCount: Array.isArray(batch.steps) ? batch.steps.length : 0,
    mayCauseNavigation: mayNavigate,
  });

  let batchResult = null;
  let navigationInterrupted = false;
  let replayErrorMessage = "";
  let handoffToTabId = null;
  let forcedObservedUrl = "";
  const beforeTab = await chrome.tabs.get(activeTabId).catch(() => null);
  const beforeUrl = beforeTab?.url || "";

  try {
    batchResult = await runtime.runReplayActionsInTab(activeTabId, batch.steps || []);
  } catch (error) {
    replayErrorMessage = error?.message || String(error);

    if (!mayNavigate) {
      batchResult = {
        ok: false,
        error: replayErrorMessage,
        results: [],
      };
    } else {
      batchResult = {
        ok: true,
        swallowedNavigationError: true,
        navigationError: replayErrorMessage,
        results: [],
      };
    }
  }

  session = await getSession(activeTabId);
  const pendingNewTab = session.pendingNewTab || null;

  if (Number.isInteger(pendingNewTab?.newTabId)) {
    const newTabId = pendingNewTab.newTabId;
    const newTabReady = await waitForReplayNewTab(newTabId, runtime);

    if (newTabReady.ok) {
      navigationInterrupted = true;
      handoffToTabId = newTabId;
      forcedObservedUrl = newTabReady.observedUrl || "";

      await addEvent(activeTabId, {
        kind: "replay_batch_new_tab_confirmed",
        message: `Replay batch ${batchIndex + 1}/${totalBatchCount} opened new tab ${newTabId}.`,
        batchIndex,
        newTabId,
        observedUrl: forcedObservedUrl,
      });
    } else {
      batchResult = {
        ok: false,
        error:
          replayErrorMessage ||
          `Replay batch opened new tab ${newTabId}, but it never became ready.`,
        results: [],
      };
    }
  } else if (mayNavigate) {
    const navWait = await waitForReplayNavigation(activeTabId, beforeUrl, runtime);

    if (navWait.ok) {
      navigationInterrupted = true;
      forcedObservedUrl = navWait.observedUrl || "";

      await addEvent(activeTabId, {
        kind: batchResult?.swallowedNavigationError
          ? "replay_batch_navigation_assumed"
          : "replay_batch_navigation_confirmed",
        message: batchResult?.swallowedNavigationError
          ? `Replay batch ${batchIndex + 1}/${totalBatchCount} likely triggered navigation. New document became ready.`
          : `Replay batch ${batchIndex + 1}/${totalBatchCount} triggered navigation and new document became ready.`,
        batchIndex,
        error: replayErrorMessage,
        observedUrl: navWait.observedUrl,
        urlChanged: navWait.urlChanged,
        sawLoading: navWait.sawLoading,
      });
    } else if (!batchResult?.ok) {
      batchResult = {
        ok: false,
        error:
          replayErrorMessage ||
          "Replay batch likely triggered navigation, but new document never became ready.",
        results: [],
      };
    }
  }

  session = await getSession(activeTabId);

  const navigationInfo = handoffToTabId
    ? {
        observedUrl: forcedObservedUrl || "",
        loading: false,
        interruptedAfterExecution: true,
        browserContext: plannerAdapter.buildBrowserContext(
          activeTabId,
          session,
          forcedObservedUrl || "",
        ),
        handoffToTabId,
        source: "new_tab",
      }
    : await getReplayNavigationInfo(
        activeTabId,
        session,
        plannerAdapter,
        navigationInterrupted,
      );

  const commandResult = await plannerAdapter.postCommandResult({
    runId: session.runId,
    type: "replay_batch_executed",
    command,
    batchResult,
    surface: session.surface || "",
    navigationInterrupted,
    navigationInfo,
  });

  if (
    commandResult?.extractedData &&
    Number(commandResult.extractedData?.count || 0) > 0
  ) {
    await addEvent(activeTabId, {
      kind: "replay_extraction_applied",
      message: `Replay extraction applied (${Number(
        commandResult.extractedData.count || 0,
      )} item${
        Number(commandResult.extractedData.count || 0) === 1 ? "" : "s"
      }).`,
      batchIndex,
      extractedCount: Number(commandResult.extractedData.count || 0),
    });
  }

  session = await getSession(activeTabId);
  session = plannerAdapter.syncSessionWithRun(
    session,
    commandResult.run || commandResult.command?.run,
  );
  session.lastKnownUrl = navigationInfo.observedUrl || session.lastKnownUrl || "";
  session.pendingNewTab = null;

  if (handoffToTabId) {
    const movedSession = {
      ...session,
      tabId: handoffToTabId,
      attachedTabId: handoffToTabId,
      movedFromTabId: activeTabId,
      movedToTabId: null,
      running: false,
      replayRunning: true,
      awaitingNavigation: false,
      pendingStep: null,
      pendingNewTab: null,
      lastKnownUrl: forcedObservedUrl || session.lastKnownUrl || "",
    };

    await moveSession(activeTabId, handoffToTabId, movedSession);

    await addEvent(activeTabId, {
      kind: "session_detached",
      step: movedSession.step,
      message: `Replay session moved from tab ${activeTabId} to tab ${handoffToTabId}.`,
      toTabId: handoffToTabId,
      reason: "replay_new_tab_navigation",
    });

    await addEvent(handoffToTabId, {
      kind: "session_attached",
      step: movedSession.step,
      message: `Replay session attached from tab ${activeTabId}.`,
      fromTabId: activeTabId,
      url: movedSession.lastKnownUrl,
      reason: "replay_new_tab_navigation",
    });

    activeTabId = handoffToTabId;
  } else {
    await saveSession(activeTabId, session);
  }

  await addEvent(activeTabId, {
    kind: "replay_batch_finished",
    ok: Boolean(batchResult?.ok),
    message: `Replay batch ${batchIndex + 1}/${totalBatchCount} completed.`,
    batchIndex,
    swallowedNavigationError: Boolean(batchResult?.swallowedNavigationError),
    navigationInterrupted,
  });

  const nextCommand = commandResult.command || {};

  if (nextCommand.type !== "run_replay_batch") {
    await markReplayRunning(activeTabId, false);

    const replay = nextCommand.replay || {};
    await addEvent(activeTabId, {
      kind: "replay_finished",
      ok: replay.status !== "failed",
      error: replay.error || "",
      message:
        replay.status === "failed" ? "Replay failed." : "Replay completed.",
      completedBatchCount: Number(replay.completedBatchCount || 0),
      totalBatchCount: Number(replay.totalBatchCount || totalBatchCount),
      waitingForNavigation: false,
    });
  }

  return {
    nextCommand,
    nextTabId: activeTabId,
  };
}
