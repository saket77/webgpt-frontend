import { addEvent } from "../../events.js";
import { clearPauseState } from "../session/lifecycle.js";
import { getSession, saveSession } from "../../state/sessionStore.js";

export async function provideHintAndResumeFlow(
  tabId,
  hint,
  { continueRun, plannerAdapter } = {},
) {
  const session = await getSession(tabId);

  if (session.movedToTabId) {
    throw new Error(
      `This tab is no longer the live session owner. Session moved to tab ${session.movedToTabId}.`,
    );
  }

  if (session.pausedReason !== "awaiting_human_hint") {
    throw new Error("Agent is not waiting for human input.");
  }

  const text = String(hint || "").trim();

  if (!session.runId) {
    throw new Error("Run ID is required.");
  }

  const browserContext = plannerAdapter.buildBrowserContext(
    tabId,
    session,
    session.lastKnownUrl,
  );

  await addEvent(tabId, {
    kind: "human_hint",
    step: session.step,
    hint: text,
    message: text || "Human resumed without hint.",
  });

  let result;

  try {
    result = await plannerAdapter.provideHumanHint({
      runId: session.runId,
      hint: text,
      browserContext,
    });
  } catch (error) {
    if (
      !String(error?.message || "").includes(
        "Run is not waiting for human input.",
      )
    ) {
      throw error;
    }

    const snapshot = await plannerAdapter.getRun({ runId: session.runId });
    result = { run: snapshot.run };
  }

  const nextSession = plannerAdapter.syncSessionWithRun(session, result.run);
  nextSession.userHint = text;
  clearPauseState(nextSession);
  nextSession.stopRequested = false;
  nextSession.attachedTabId = tabId;
  await saveSession(tabId, nextSession);

  return continueRun(tabId);
}
