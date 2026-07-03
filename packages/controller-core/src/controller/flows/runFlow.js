import { driveCommand } from "../commandRunner.js";
import { MAX_STEPS } from "../../config.js";
import { addEvent } from "../../events.js";
import {
  getEmptySession,
  getSession,
  replaceSession,
  saveSession,
} from "../../state/sessionStore.js";
import { clone } from "../../utils/common.js";
import { BROWSER_DOM_SURFACE, normalizeSurface } from "../../runtime/surfaces.js";
import { handleAskHumanPlan, handleDonePlan } from "./terminalPause.js";
import { handleTemplateQueueDoneFlow } from "./templateQueueFlow.js";

export async function continueRunFlow(
  tabId,
  initialCommand = null,
  {
    continueRun,
    deleteBackendRunAndClearLocal,
    plannerAdapter,
    runtime,
    stopIfRequested,
  } = {},
) {
  const resumeRun =
    continueRun ||
    ((nextTabId, nextCommand = null) =>
      continueRunFlow(nextTabId, nextCommand, {
        continueRun,
        deleteBackendRunAndClearLocal,
        plannerAdapter,
        runtime,
        stopIfRequested,
      }));
  let session = await getSession(tabId);

  if (!session.goal || !String(session.goal).trim()) {
    throw new Error("Goal is required.");
  }

  if (!session.runId) {
    throw new Error("Run ID is required.");
  }

  if (session.movedToTabId) {
    throw new Error(
      `This tab is no longer the live session owner. Session moved to tab ${session.movedToTabId}.`,
    );
  }

  if ((session.attachedTabId || tabId) !== tabId) {
    throw new Error(
      "Refusing to continue from a stale tab binding. Use the attached tab instead.",
    );
  }

  if (session.running) {
    throw new Error("Agent is already running.");
  }

  const stopBeforeStart = await stopIfRequested(
    tabId,
    "Agent stopped by user before continuing.",
  );
  if (stopBeforeStart) {
    return stopBeforeStart;
  }

  session.running = true;
  session.awaitingNavigation = false;
  session.attachedTabId = tabId;
  await saveSession(tabId, session);

  if (session.step === 0) {
    await addEvent(tabId, {
      kind: "loop_started",
      message: `Starting loop for goal: ${session.goal}`,
    });
  } else {
    await addEvent(tabId, {
      kind: "loop_resumed",
      step: session.step,
      message: `Resuming loop for goal: ${session.goal}`,
    });
  }

  try {
    const result = await driveCommand(
      tabId,
      initialCommand || {
        type: "extract_state",
        surface: session.surface || BROWSER_DOM_SURFACE,
        runId: session.runId,
        step: session.step + 1,
        reason: session.step === 0 ? "run_started" : "run_resumed",
      },
      { plannerAdapter, runtime, stopIfRequested },
    );
    const resultTabId = result?.tabId || tabId;

    if (result?.terminal === "result") {
      return result.result;
    }

    if (result?.terminal === "waiting_for_navigation") {
      return (
        result.result || {
          ok: true,
          waitingForNavigation: true,
        }
      );
    }

    if (result?.terminal === "done") {
      const latestSession = await getSession(resultTabId);

      if (latestSession.templateRunId) {
        return handleTemplateQueueDoneFlow(resultTabId, result, {
          continueRun: resumeRun,
          plannerAdapter,
        });
      }

      return handleDonePlan(resultTabId, {
        step: result.step,
        plan: result.plan,
        summary: result.summary,
        plannerSummary: result.plannerSummary,
        finalResult: result.finalResult,
      });
    }

    if (result?.terminal === "ask_human") {
      return handleAskHumanPlan(resultTabId, {
        step: result.step,
        plan: result.plan,
      });
    }

    if (result?.terminal === "access_required") {
      session = await getSession(resultTabId);
      session.running = false;
      session.awaitingNavigation = false;
      session.stopRequested = false;
      session.pausedReason = "awaiting_access";
      session.pendingAccessCommand = clone(result.command || null);
      session.pendingAccessSurface = normalizeSurface(result.surface);
      session.attachedTabId = resultTabId;
      await saveSession(resultTabId, session);

      await addEvent(resultTabId, {
        kind: "paused",
        reason: "awaiting_access",
        surface: session.pendingAccessSurface,
        message: result.message || "Additional access is required.",
      });

      return {
        ok: true,
        accessRequired: true,
        surface: session.pendingAccessSurface,
        reason: result.reason || "access_required",
        message: result.message || "Additional access is required.",
      };
    }

    if (result?.terminal !== "max_steps_reached") {
      throw new Error(
        `Command runner stopped unexpectedly: ${result?.terminal || "unknown"}`,
      );
    }

    session = await getSession(resultTabId);
    const finalStep = session.step;

    try {
      await deleteBackendRunAndClearLocal(resultTabId, session, {
        reason: "max_steps_reached",
        message: `Reached max steps (${MAX_STEPS}) without confirmed completion.`,
      });
    } catch {
      session.running = false;
      session.stopRequested = false;
      session.attachedTabId = resultTabId;
      await saveSession(resultTabId, session);
    }

    await addEvent(resultTabId, {
      kind: "max_steps_reached",
      step: finalStep,
      message: `Reached max steps (${MAX_STEPS}) without confirmed completion.`,
    });

    return {
      ok: true,
      stopped: true,
      reason: "max_steps_reached",
    };
  } catch (error) {
    session = await getSession(tabId);

    try {
      await deleteBackendRunAndClearLocal(tabId, session, {
        reason: "fatal_error",
        message: error?.message || String(error),
      });
    } catch {
      session.running = false;
      session.awaitingNavigation = false;
      session.stopRequested = false;
      session.pausedReason = "";
      await saveSession(tabId, session);
    }

    await addEvent(tabId, {
      kind: "fatal_error",
      error: error?.message || String(error),
    });

    throw error;
  }
}

export async function startAgentFlow(
  tabId,
  goal,
  inputValues = {},
  isTemplate,
  artifactFileName = "",
  surface = "",
  myInfo = null,
  profileAttachments = [],
  { continueRun, plannerAdapter, runtime } = {},
) {
  const resumeRun =
    continueRun ||
    ((nextTabId, command = null) =>
      continueRunFlow(nextTabId, command, {
        continueRun,
        plannerAdapter,
        runtime,
      }));

  if (!goal || !String(goal).trim()) {
    throw new Error("Goal is required.");
  }

  let session = getEmptySession(tabId);
  session.goal = String(goal).trim();
  session.inputValues = clone(inputValues || {});
  session.isTemplateRun =
    isTemplate || (inputValues && Object.keys(inputValues).length > 0);
  session.attachedTabId = tabId;
  session.movedFromTabId = null;
  session.movedToTabId = null;
  session.finalResult = null;
  session.pendingNewTab = null;
  session.replayRunning = false;
  session.artifactFileName = String(artifactFileName || "");
  session.surface =
    normalizeSurface(surface) ||
    (await runtime.detectSurfaceForTab?.(tabId))?.surface ||
    BROWSER_DOM_SURFACE;

  await replaceSession(tabId, session);

  const runResult = await plannerAdapter.startCommandRun({
    goal: session.goal,
    inputValues: session.inputValues,
    isTemplateRun: Boolean(session.isTemplateRun),
    artifactFileName: session.artifactFileName,
    surface: session.surface,
    myInfo,
    profileAttachments,
  });

  session = await getSession(tabId);
  session.runId = runResult.runId;
  session = plannerAdapter.syncSessionWithRun(session, runResult.run);
  await saveSession(tabId, session);

  if (session.isTemplateRun) {
    const replayResult = await plannerAdapter.tryRunReplayPreflight({
      runId: session.runId,
      artifactFileName: session.artifactFileName,
    });
    return resumeRun(tabId, replayResult.command || runResult.command);
  }

  return resumeRun(tabId, runResult.command);
}

export async function resumeAfterAccessFlow(
  tabId,
  { continueRun } = {},
) {
  const session = await getSession(tabId);

  if (session.pausedReason !== "awaiting_access") {
    throw new Error("Session is not waiting for access.");
  }

  const command = session.pendingAccessCommand;
  if (!command) {
    throw new Error("No pending command to resume.");
  }

  session.pausedReason = "";
  session.pendingAccessCommand = null;
  session.pendingAccessSurface = "";
  await saveSession(tabId, session);

  if (!continueRun) {
    throw new Error("Resume handler is not configured.");
  }

  return continueRun(tabId, command);
}
