import { getSessionIfExists, saveSession } from "../state/sessionStore.js";
import { addEvent } from "../events.js";
import { sleep } from "../utils/common.js";
import { POST_NAVIGATION_RESUME_SETTLE_MS } from "../config.js";

async function stageNewTabHandoff(tab) {
  const newTabId = tab?.id;
  const openerTabId = tab?.openerTabId;

  if (!Number.isInteger(newTabId) || !Number.isInteger(openerTabId)) {
    return;
  }

  const sourceSession = await getSessionIfExists(openerTabId).catch(() => null);
  if (!sourceSession) return;

  if (sourceSession.movedToTabId) return;
  if ((sourceSession.attachedTabId || openerTabId) !== openerTabId) return;
  if (!sourceSession.runId) return;

  const sourceIsLive =
    Boolean(sourceSession.running) || Boolean(sourceSession.replayRunning);

  if (!sourceIsLive) return;

  sourceSession.pendingNewTab = {
    newTabId,
    openerTabId,
    createdAt: Date.now(),
    url: tab?.url || "",
  };

  await saveSession(openerTabId, sourceSession);

  await addEvent(openerTabId, {
    kind: "new_tab_detected",
    step: sourceSession.pendingStep || sourceSession.step,
    message: `New tab ${newTabId} opened from attached tab ${openerTabId}.`,
    newTabId,
    openerTabId,
    url: tab?.url || "",
  });
}

export function createRegisterTabHandlers({ continueRun, pauseForForcedStop, runtime }) {
  /* 
    The controller accepts a runtime, which is good, but tab lifecycle/navigation still calls 
    chrome.tabs directly here and in replay/navigation handoff code. That is fine for the current
    Chrome extension story, but it means the future Playwright/non-browser-runtime split is 
    not actually isolated yet.
  */
  return function registerTabHandlers() {
    chrome.tabs.onCreated.addListener((tab) => {
      stageNewTabHandoff(tab).catch(() => {
        // best effort only
      });
    });

    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status !== "complete") return;

      const session = await getSessionIfExists(tabId).catch(() => null);
      if (!session) return;

      if (session.movedToTabId) return;
      if ((session.attachedTabId || tabId) !== tabId) return;
      if (!session.awaitingNavigation) return;

      const ready = await runtime.ensureContentScriptReady(tabId, {
        attempts: 20,
        delayMs: 250,
        allowInjection: true,
      });

      if (!ready) {
        await addEvent(tabId, {
          kind: "navigation_resume_blocked",
          step: session.pendingStep || session.step,
          url: tab?.url || "",
          message:
            "Navigation completed, but the content script was not ready on the attached tab.",
        });
        return;
      }

      const latestSession = await getSessionIfExists(tabId).catch(() => null);
      if (!latestSession) return;
      if (latestSession.movedToTabId) return;
      if ((latestSession.attachedTabId || tabId) !== tabId) return;
      if (!latestSession.awaitingNavigation) return;

      if (latestSession.stopRequested) {
        latestSession.awaitingNavigation = false;
        latestSession.lastKnownUrl = tab?.url || latestSession.lastKnownUrl || "";
        await saveSession(tabId, latestSession);

        await addEvent(tabId, {
          kind: "navigation_completed",
          step: latestSession.pendingStep || latestSession.step,
          url: latestSession.lastKnownUrl,
          message: "Navigation completed while stop was requested.",
        });

        await pauseForForcedStop(
          tabId,
          "Agent stopped by user after navigation completed.",
        );
        return;
      }

      latestSession.awaitingNavigation = false;
      latestSession.pendingStep = null;
      latestSession.lastKnownUrl = tab?.url || latestSession.lastKnownUrl || "";
      await saveSession(tabId, latestSession);

      await addEvent(tabId, {
        kind: "navigation_completed",
        step: latestSession.step,
        url: latestSession.lastKnownUrl,
        message: "Navigation complete on attached tab. Resuming agent.",
      });
      await sleep(POST_NAVIGATION_RESUME_SETTLE_MS);
      try {
        await continueRun(tabId, {
          type: "navigation_completed",
          runId: latestSession.runId,
          step: Number(latestSession.step || 0) + 1,
          reason: "navigation_completed",
          meta: { afterNavigation: true },
        });
      } catch {
        // continueRun already logs fatal_error
      }
    });
  };
}
