import { addEvent } from "../../events.js";
import { getSession, saveSession } from "../../state/sessionStore.js";
import { getLastKnownUrlFromState } from "../../state/stateViews.js";
import { clone } from "../../utils/common.js";
import { ensureLiveSession, getCommandStep } from "./context.js";

export async function executeRunSourceProviderCommandsCommand(
  tabId,
  command,
  { lastState, plannerAdapter, runtime, stopIfRequested },
) {
  let session = await ensureLiveSession(tabId);
  const step = getCommandStep(command, session);
  const commands = Array.isArray(command.commands) ? command.commands : [];
  const surface = command.surface || session.surface || lastState?.surface || "";
  let state = lastState;

  if (!state && surface) {
    state = await runtime.extractStateFromTab(tabId, {
      goal: session.goal,
      step,
      surface,
      meta: { beforeSourceProviderCommands: true },
    });
  }

  for (const sourceProviderCommand of commands) {
    await addEvent(tabId, {
      kind: "action_planned",
      step: session.step || step,
      action: clone(sourceProviderCommand),
      frameId: null,
      message: `Planned source provider command: ${
        sourceProviderCommand?.name ||
        sourceProviderCommand?.tool ||
        sourceProviderCommand?.type ||
        "unknown"
      }`,
    });
  }

  const stopBeforeExecution = await stopIfRequested(
    tabId,
    "Agent stopped by user before executing source provider commands.",
  );
  if (stopBeforeExecution) {
    return {
      terminal: "result",
      result: stopBeforeExecution,
    };
  }

  const execution = await runtime.runSourceProviderCommands(
    command.provider,
    commands,
    {
      tabId,
      state,
      command,
      goal: session.goal,
      runId: session.runId,
      step,
    },
  );

  let afterState = state;
  if (surface) {
    afterState = await runtime.extractStateFromTab(tabId, {
      goal: session.goal,
      step,
      surface,
      meta: { afterSourceProviderCommands: true },
    });
  }

  const commandResult = await plannerAdapter.postCommandResult({
    runId: session.runId,
    type: "source_provider_commands_executed",
    command,
    execution,
    postState: afterState,
    surface,
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
  session.surface = surface || session.surface;
  session.lastKnownUrl =
    getLastKnownUrlFromState(afterState) || session.lastKnownUrl || "";
  session.attachedTabId = tabId;
  await saveSession(tabId, session);

  await addEvent(tabId, {
    kind: "execution_result",
    step: session.step || step,
    surface,
    nextCommandType: commandResult.command?.type || "",
    nextCommandSurface: commandResult.command?.surface || "",
    nextCommandReason: commandResult.command?.reason || "",
    ok: Boolean(execution?.ok),
    summary: execution?.summary || "",
    error: execution?.error || "",
    results: clone(execution?.results || []),
  });

  const stopAfterExecution = await stopIfRequested(
    tabId,
    "Agent stopped by user after source provider execution.",
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
