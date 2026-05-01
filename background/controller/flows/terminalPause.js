import { addEvent } from "../../events.js";
import { getSession, saveSession } from "../../state/sessionStore.js";

async function pauseForHuman(
  tabId,
  { reason, step, message, finalResult, plan = null },
) {
  const session = await getSession(tabId);

  session.running = false;
  session.awaitingNavigation = false;
  session.pausedReason = reason;
  session.pendingStep = step;
  session.stopRequested = false;
  session.attachedTabId = tabId;

  if (finalResult !== undefined) {
    session.finalResult = finalResult;
  }

  await saveSession(tabId, session);

  await addEvent(tabId, {
    kind: "paused",
    reason,
    step,
    message,
    plannerStatus: plan?.status || "",
    reasoning: plan?.reasoning || "",
    summary: plan?.summary || "",
  });

  return {
    ok: true,
    paused: true,
    reason,
    step,
    message,
  };
}

export async function handleDonePlan(
  tabId,
  { step, plan, summary, plannerSummary = "", finalResult = null },
) {
  const resolvedSummary =
    summary || plan?.summary || "Planner reported success.";

  const resolvedFinalResult =
    finalResult ||
    (resolvedSummary
      ? {
          summary: resolvedSummary,
          structuredData: {
            items: [],
          },
        }
      : null);

  return pauseForHuman(tabId, {
    reason: "awaiting_success_confirmation",
    step,
    message: resolvedSummary,
    finalResult: resolvedFinalResult,
    plannerSummary,
    plan: {
      ...(plan || {}),
      summary: resolvedSummary,
      plannerSummary,
    },
  });
}

export async function handleAskHumanPlan(tabId, { step, plan }) {
  return pauseForHuman(tabId, {
    reason: "awaiting_human_hint",
    step,
    message: plan.reasoning || "Planner requested human guidance.",
    plan,
  });
}
