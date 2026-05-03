import { addEvent } from "../../events.js";
import { getSession, saveSession } from "../../state/sessionStore.js";
import {
  getAggregateStateSummary,
  getLastKnownUrlFromState,
} from "../../state/stateViews.js";
import { clone } from "../../utils/common.js";
import { ensureLiveSession, getCommandStep } from "./context.js";
import { BROWSER_DOM_SURFACE, normalizeSurface } from "../../runtime/surfaces.js";

export async function executeExtractStateCommand(
  tabId,
  command,
  { plannerAdapter, runtime, stopIfRequested },
) {
  let session = await ensureLiveSession(tabId);
  const step = getCommandStep(command, session);
  const commandSurface = normalizeSurface(command?.surface);
  const sessionSurface = normalizeSurface(session.surface);
  const tabSurface = await runtime.detectSurfaceForTab?.(tabId).catch(() => null);
  const surface =
    sessionSurface === "google_sheets" && tabSurface?.surface === "google_sheets"
      ? "google_sheets"
      : commandSurface || sessionSurface || tabSurface?.surface || BROWSER_DOM_SURFACE;
  const replay = command?.replay || null;
  const resultType =
    command?.type === "navigation_completed"
      ? "navigation_completed"
      : "state_extracted";

  if (replay?.status === "skipped") {
    await addEvent(tabId, {
      kind: "replay_skipped",
      message: "No replay artifact found.",
      fileName: replay.fileName || "",
    });
  }

  await addEvent(tabId, {
    kind: "step_started",
    step,
    message: `Step ${step} started.`,
  });

  const state = await runtime.extractStateFromTab(tabId, {
    goal: session.goal,
    step,
    surface,
    meta:
      command?.meta ||
      (command?.type === "navigation_completed"
        ? { afterNavigation: true }
        : {}),
  });

  const stateSummary = getAggregateStateSummary(state);

  session = await getSession(tabId);
  session.surface = state?.surface || surface;
  session.lastKnownUrl =
    getLastKnownUrlFromState(state) || session.lastKnownUrl || "";
  await saveSession(tabId, session);

  await addEvent(tabId, {
    kind: "state_extracted",
    step,
    url: stateSummary.url,
    title: stateSummary.title,
    controlsCount: stateSummary.controlsCount,
    scrollableContainersCount: stateSummary.scrollableContainersCount,
    frameCount: stateSummary.frameCount,
    primaryFrameId: stateSummary.primaryFrameId,
  });

  const stopAfterState = await stopIfRequested(
    tabId,
    "Agent stopped by user after state extraction.",
  );
  if (stopAfterState) {
    return {
      terminal: "result",
      result: stopAfterState,
    };
  }

  const commandResponse = await plannerAdapter.postCommandResult({
    runId: session.runId,
    type: resultType,
    state,
    userHint: session.userHint,
    browserContext: plannerAdapter.buildBrowserContext(
      tabId,
      session,
      stateSummary.url,
    ),
    artifactFileName: "",
    surface: session.surface,
  });

  const nextCommand = commandResponse.command || {};
  const plan = nextCommand.plan || {};

  session = await getSession(tabId);
  session = plannerAdapter.syncSessionWithRun(
    session,
    commandResponse.run || nextCommand.run,
  );
  session.attachedTabId = tabId;
  await saveSession(tabId, session);

  await addEvent(tabId, {
    kind: "planner_output",
    step: session.step || step,
    plannerStatus: plan.status || nextCommand.type || "",
    reasoning: plan.reasoning || "",
    summary: nextCommand.summary || plan.summary || "",
    plannerSummary: nextCommand.plannerSummary || "",
    actions: clone(
      nextCommand.actions ||
        nextCommand.commands ||
        plan.actions ||
        plan.commands ||
        [],
    ),
  });

  const stopAfterPlan = await stopIfRequested(
    tabId,
    "Agent stopped by user after planner response.",
  );
  if (stopAfterPlan) {
    return {
      terminal: "result",
      result: stopAfterPlan,
    };
  }

  return {
    nextCommand,
    lastState: state,
  };
}
