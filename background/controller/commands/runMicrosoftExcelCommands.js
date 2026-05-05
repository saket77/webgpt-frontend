import { addEvent } from "../../events.js";
import { getSession, saveSession } from "../../state/sessionStore.js";
import { getLastKnownUrlFromState } from "../../state/stateViews.js";
import { clone } from "../../utils/common.js";
import { ensureLiveSession, getCommandStep } from "./context.js";
import { MICROSOFT_EXCEL_SURFACE } from "../../runtime/surfaces.js";

export async function executeRunMicrosoftExcelCommandsCommand(
  tabId,
  command,
  { lastState, plannerAdapter, runtime, stopIfRequested },
) {
  let session = await ensureLiveSession(tabId);
  const step = getCommandStep(command, session);
  const commands = Array.isArray(command.commands) ? command.commands : [];
  let state = lastState;

  if (!state || state.surface !== MICROSOFT_EXCEL_SURFACE) {
    state = await runtime.extractStateFromTab(tabId, {
      goal: session.goal,
      step,
      surface: MICROSOFT_EXCEL_SURFACE,
      meta: { beforeMicrosoftExcelCommands: true },
    });
  }

  for (const excelCommand of commands) {
    await addEvent(tabId, {
      kind: "action_planned",
      step: session.step || step,
      action: clone(excelCommand),
      frameId: null,
      message: `Planned Microsoft Excel command: ${
        excelCommand?.name || excelCommand?.tool || excelCommand?.type || "unknown"
      }`,
    });
  }

  const stopBeforeExecution = await stopIfRequested(
    tabId,
    "Agent stopped by user before executing Microsoft Excel commands.",
  );
  if (stopBeforeExecution) {
    return {
      terminal: "result",
      result: stopBeforeExecution,
    };
  }

  const execution = await runtime.runMicrosoftExcelCommandsInTab(
    tabId,
    state,
    commands,
  );

  const afterState = await runtime.extractStateFromTab(tabId, {
    goal: session.goal,
    step,
    surface: MICROSOFT_EXCEL_SURFACE,
    meta: { afterMicrosoftExcelCommands: true },
  });

  const commandResult = await plannerAdapter.postCommandResult({
    runId: session.runId,
    type: "microsoft_excel_commands_executed",
    command,
    execution,
    postState: afterState,
    surface: MICROSOFT_EXCEL_SURFACE,
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
  session.surface = MICROSOFT_EXCEL_SURFACE;
  session.lastKnownUrl =
    getLastKnownUrlFromState(afterState) || session.lastKnownUrl || "";
  session.attachedTabId = tabId;
  await saveSession(tabId, session);

  await addEvent(tabId, {
    kind: "execution_result",
    step: session.step || step,
    ok: Boolean(execution?.ok),
    summary: execution?.summary || "",
    error: execution?.error || "",
    results: clone(execution?.results || []),
  });

  const stopAfterExecution = await stopIfRequested(
    tabId,
    "Agent stopped by user after Microsoft Excel execution.",
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
