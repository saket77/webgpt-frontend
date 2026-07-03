import { addEvent } from "../../events.js";
import { getSession, saveSession } from "../../state/sessionStore.js";
import { getLastKnownUrlFromState } from "../../state/stateViews.js";
import { clone } from "../../utils/common.js";
import { ensureLiveSession, getCommandStep } from "./context.js";
import {
  activateSurfaceFromContext,
  rememberSurfaceContext,
} from "./surfaceContext.js";
import { GOOGLE_SHEETS_SURFACE } from "../../runtime/surfaces.js";

export async function executeRunGoogleSheetsCommandsCommand(
  tabId,
  command,
  { lastState, plannerAdapter, runtime, stopIfRequested },
) {
  let session = await ensureLiveSession(tabId);
  const step = getCommandStep(command, session);
  const commands = Array.isArray(command.commands) ? command.commands : [];
  let state = lastState;

  session = await activateSurfaceFromContext(
    tabId,
    session,
    GOOGLE_SHEETS_SURFACE,
    runtime,
    command?.surfaceContextId || command?.nextSurfaceContextId,
  );

  if (!state || state.surface !== GOOGLE_SHEETS_SURFACE) {
    state = await runtime.extractStateFromTab(tabId, {
      goal: session.goal,
      step,
      surface: GOOGLE_SHEETS_SURFACE,
      meta: { beforeGoogleSheetsCommands: true },
    });
  }

  for (const sheetsCommand of commands) {
    await addEvent(tabId, {
      kind: "action_planned",
      step: session.step || step,
      action: clone(sheetsCommand),
      frameId: null,
      message: `Planned Google Sheets command: ${
        sheetsCommand?.name || sheetsCommand?.tool || sheetsCommand?.type || "unknown"
      }`,
    });
  }

  const stopBeforeExecution = await stopIfRequested(
    tabId,
    "Agent stopped by user before executing Google Sheets commands.",
  );
  if (stopBeforeExecution) {
    return {
      terminal: "result",
      result: stopBeforeExecution,
    };
  }

  const execution = await runtime.runGoogleSheetsCommandsInTab(
    tabId,
    state,
    commands,
  );

  const afterState = await runtime.extractStateFromTab(tabId, {
    goal: session.goal,
    step,
    surface: GOOGLE_SHEETS_SURFACE,
    meta: { afterGoogleSheetsCommands: true },
  });

  const commandResult = await plannerAdapter.postCommandResult({
    runId: session.runId,
    type: "google_sheets_commands_executed",
    command,
    execution,
    postState: afterState,
    surface: GOOGLE_SHEETS_SURFACE,
    browserContext: plannerAdapter.buildBrowserContext(
      tabId,
      session,
      getLastKnownUrlFromState(afterState),
    ),
    navigationInfo: {},
  });

  session = await getSession(tabId);
  session = plannerAdapter.syncSessionWithRun(
    session,
    commandResult.run || commandResult.command?.run,
  );
  session.userHint = execution?.ok ? "" : session.userHint;
  session.surface = GOOGLE_SHEETS_SURFACE;
  session.lastKnownUrl =
    getLastKnownUrlFromState(afterState) || session.lastKnownUrl || "";
  session.attachedTabId = tabId;
  await saveSession(tabId, session);
  session = await rememberSurfaceContext(tabId, session, afterState);

  await addEvent(tabId, {
    kind: "execution_result",
    step: session.step || step,
    surface: GOOGLE_SHEETS_SURFACE,
    nextCommandType: commandResult.command?.type || "",
    nextCommandSurface: commandResult.command?.surface || "",
    nextCommandReason: commandResult.command?.reason || "",
    nextSurface:
      commandResult.command?.reason === "surface_handoff"
        ? commandResult.command?.surface || ""
        : "",
    nextSurfaceContextId: commandResult.command?.surfaceContextId || "",
    ok: Boolean(execution?.ok),
    summary: execution?.summary || "",
    error: execution?.error || "",
    results: clone(execution?.results || []),
  });

  const stopAfterExecution = await stopIfRequested(
    tabId,
    "Agent stopped by user after Google Sheets execution.",
  );
  if (stopAfterExecution) {
    return {
      terminal: "result",
      result: stopAfterExecution,
    };
  }

  return {
    nextCommand: commandResult.command || {},
    lastState: afterState,
  };
}
