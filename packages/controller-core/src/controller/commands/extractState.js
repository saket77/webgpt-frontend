import { addEvent } from "../../events.js";
import { getSession, saveSession } from "../../state/sessionStore.js";
import {
  getAggregateStateSummary,
  getLastKnownUrlFromState,
} from "../../state/stateViews.js";
import { clone } from "../../utils/common.js";
import { ensureLiveSession, getCommandStep, recordStepStarted } from "./context.js";
import { captureMint, isClassicMintHandoff, recordMintProgress, saveMintRunState } from "./mint.js";
import {
  activateSurfaceFromContext,
  rememberSurfaceContext,
} from "./surfaceContext.js";
import {
  BROWSER_DOM_SURFACE,
  GOOGLE_SHEETS_SURFACE,
  MICROSOFT_EXCEL_SURFACE,
  normalizeSurface,
} from "../../runtime/surfaces.js";

function isApiRuntimeSurface(surface) {
  return [GOOGLE_SHEETS_SURFACE, MICROSOFT_EXCEL_SURFACE].includes(surface);
}

export async function executeExtractStateCommand(
  tabId,
  command,
  { plannerAdapter, runtime, stopIfRequested },
) {
  let session = await ensureLiveSession(tabId);
  const step = getCommandStep(command, session);
  const classicMintHandoff = isClassicMintHandoff(command);
  const resumesHumanHint = session.chromeStepLifecycle === 1 && command.reason === "human_hint";
  const commandSurface = normalizeSurface(command?.surface);
  const sessionSurface = normalizeSurface(session.surface);
  const tabSurface = await runtime.detectSurfaceForTab?.(tabId).catch(() => null);
  const surface =
    commandSurface ||
    (isApiRuntimeSurface(sessionSurface) && tabSurface?.surface === sessionSurface
      ? sessionSurface
      : sessionSurface || tabSurface?.surface || BROWSER_DOM_SURFACE);
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

  if (command?.reason === "surface_handoff") {
    const fromSurface =
      normalizeSurface(command?.plan?.commandSurface) ||
      normalizeSurface(command?.plan?.surface) ||
      sessionSurface ||
      "current";

    await addEvent(tabId, {
      kind: "surface_handoff",
      step,
      surface: fromSurface,
      commandSurface: fromSurface,
      nextSurface: surface,
      nextSurfaceContextId:
        command?.surfaceContextId || command?.nextSurfaceContextId || "",
      nextCommandType: command?.type || "",
      nextCommandReason: command?.reason || "",
      message: `Handoff: ${fromSurface} -> ${surface}`,
    });
  }

  await recordStepStarted(tabId, session, step, {
    surface,
    ...(classicMintHandoff && { activePlanner: "classic", reason: command.reason }),
    surfaceContextId: command?.surfaceContextId || command?.nextSurfaceContextId || "",
  });

  session = await activateSurfaceFromContext(
    tabId,
    session,
    surface,
    runtime,
    command?.surfaceContextId || command?.nextSurfaceContextId,
  );

  let mintObservation;
  if (session.step === 0 && command?.type === "extract_state" &&
      session.mintBinding && !session.mintBinding.observationId && surface === BROWSER_DOM_SURFACE) {
    const discovery = await captureMint(tabId, session, runtime).catch(() => null);
    if (discovery?.discoveryOk === true && Array.isArray(discovery.activeAdapterIds) &&
        discovery.activeAdapterIds.length === 0 && discovery.page?.url === session.mintBinding?.url &&
        discovery.observationId && discovery.observationId === session.mintBinding?.observationId) {
      mintObservation = discovery;
    } else {
      delete session.mintBinding;
    }
  }

  const state = mintObservation
    ? { surface, frames: { 0: { ...mintObservation.state, ...mintObservation.page } } }
    : await runtime.extractStateFromTab(tabId, {
        goal: session.goal,
        step,
        surface,
        meta: {
          ...(command?.type === "navigation_completed"
            ? { afterNavigation: true }
            : {}),
          ...(command?.meta || {}),
        },
      });

  const stateSummary = getAggregateStateSummary(state);

  session = await getSession(tabId);
  session.surface = state?.surface || surface;
  session.lastKnownUrl =
    getLastKnownUrlFromState(state) || session.lastKnownUrl || "";
  await saveSession(tabId, session);
  session = await rememberSurfaceContext(tabId, session, state);

  await addEvent(tabId, {
    kind: "state_extracted",
    step,
    surface,
    surfaceContextId: command?.surfaceContextId || command?.nextSurfaceContextId || "",
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

  if (mintObservation) {
    session.mintPhase = "exploring";
    await saveSession(tabId, session);
    await recordMintProgress(tabId, step, session.mintPhase, "Starting Pomerado teaching for this page.");
  }

  const runId = session.runId;
  const commandResponse = await plannerAdapter.postCommandResult({
    runId,
    ...(mintObservation
      ? { type: "mint_requested", mintObservation }
      : { type: resultType, state }),
    ...((classicMintHandoff || resumesHumanHint) && {
      step,
      command: {
        type: command.type, runId, step, reason: command.reason,
        ...(resumesHumanHint && { operationId: command.operationId }),
      },
    }),
    userHint: session.userHint,
    browserContext: {
      ...plannerAdapter.buildBrowserContext(tabId, session, stateSummary.url),
      ...(mintObservation && { mintHandoffProtocol: 1 }),
    },
    artifactFileName: "",
    surface: session.surface,
  });

  const nextCommand = commandResponse.command || {};
  const plan = nextCommand.plan || {};
  const backendRun = commandResponse.run || nextCommand.run;
  session = await getSession(tabId);
  if ((mintObservation || classicMintHandoff || resumesHumanHint) &&
      (session.runId !== runId || session.stopRequested || !session.running)) {
    return { terminal: "result", result: { ok: true, stopped: true } };
  }
  if (mintObservation && nextCommand.type !== "adapter_mint_outcome" &&
      !isClassicMintHandoff(nextCommand) &&
      backendRun?.activePlanner !== "pomerado") {
    throw new Error("The local backend did not start the site adapter planner.");
  }

  const nextSession = plannerAdapter.syncSessionWithRun(session, backendRun);
  nextSession.attachedTabId = tabId;
  if (mintObservation) {
    await saveMintRunState(tabId, session, nextSession, backendRun, nextCommand, step);
  } else {
    await saveSession(tabId, nextSession);
    await addEvent(tabId, {
      kind: "planner_output",
      step: nextSession.step || step,
      ...(classicMintHandoff && { activePlanner: "classic", reason: command.reason }),
      plannerStatus: plan.status || nextCommand.type || "",
      surface: plan.surface || nextCommand.surface || "",
      commandSurface: plan.commandSurface || nextCommand.surface || "",
      nextSurface:
        plan.nextSurface ||
        (nextCommand.reason === "surface_handoff" ? nextCommand.surface : ""),
      nextSurfaceContextId:
        plan.nextSurfaceContextId || nextCommand.surfaceContextId || "",
      nextCommandType: nextCommand.type || "",
      nextCommandReason: nextCommand.reason || "",
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
  }

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
