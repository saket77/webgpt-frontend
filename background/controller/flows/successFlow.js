import { addEvent } from "../../events.js";
import {
  clearPauseState,
} from "../session/lifecycle.js";
import { getSession, saveSession } from "../../state/sessionStore.js";

export async function confirmSuccessFlow(
  tabId,
  { deleteBackendRunAndClearLocal, plannerAdapter } = {},
) {
  const session = await getSession(tabId);

  if (session.movedToTabId) {
    throw new Error(
      `This tab is no longer the live session owner. Session moved to tab ${session.movedToTabId}.`,
    );
  }

  if (session.pausedReason !== "awaiting_success_confirmation") {
    throw new Error("Agent is not waiting for success confirmation.");
  }

  if (!session.runId) {
    throw new Error("Run ID is required.");
  }

  const isTemplateRun = Boolean(session.isTemplateRun);
  const completedResult = session.finalResult || null;
  const completedSummary = completedResult?.summary || "";

  const confirmResult = await plannerAdapter.confirmRunSuccess({
    runId: session.runId,
  });

  let saveResult = null;

  if (!isTemplateRun) {
    saveResult = await plannerAdapter.saveSuccessfulArtifacts({
      runId: session.runId,
    });
  }

  const nextSession = plannerAdapter.syncSessionWithRun(session, confirmResult.run);
  const finalStep = nextSession.step;

  try {
    await deleteBackendRunAndClearLocal(tabId, nextSession, {
      reason: !isTemplateRun ? "artifacts_saved" : "completed",
      message: !isTemplateRun
        ? "Run completed and artifacts were saved."
        : "Template run completed.",
    });
  } catch {
    clearPauseState(nextSession);
    nextSession.running = false;
    nextSession.stopRequested = false;
    nextSession.attachedTabId = tabId;
    await saveSession(tabId, nextSession);
  }

  await addEvent(tabId, {
    kind: "success_confirmed",
    step: finalStep,
    message: isTemplateRun
      ? "Success confirmed (template run)."
      : "Success confirmed and artifacts saved.",
    saveResult,
  });

  return {
    ok: true,
    completed: true,
    saveResult,
    summary: completedSummary,
    finalResult: completedResult,
  };
}

export async function rejectSuccessAndResumeFlow(
  tabId,
  hint,
  { continueRun, plannerAdapter },
) {
  const session = await getSession(tabId);

  if (session.movedToTabId) {
    throw new Error(
      `This tab is no longer the live session owner. Session moved to tab ${session.movedToTabId}.`,
    );
  }

  if (session.pausedReason !== "awaiting_success_confirmation") {
    throw new Error("Agent is not waiting for success confirmation.");
  }

  if (!session.runId) {
    throw new Error("Run ID is required.");
  }

  const text = String(hint || "").trim();

  const result = await plannerAdapter.rejectRunSuccess({
    runId: session.runId,
    hint: text,
  });

  const nextSession = plannerAdapter.syncSessionWithRun(session, result.run);
  nextSession.userHint = text;
  clearPauseState(nextSession);
  nextSession.stopRequested = false;
  nextSession.attachedTabId = tabId;
  await saveSession(tabId, nextSession);

  await addEvent(tabId, {
    kind: "success_rejected",
    step: nextSession.step,
    hint: text,
    message: text || "User rejected success without extra hint.",
  });

  return continueRun(tabId);
}
