import { addEvent } from "../../events.js";
import { getSession, saveSession } from "../../state/sessionStore.js";
import { getLastKnownUrlFromState } from "../../state/stateViews.js";
import { tryMarkAwaitingNavigation } from "../tryMarkNavigation.js";
import { clone, sleep } from "../../utils/common.js";
import { ensureLiveSession, getCommandStep } from "./context.js";

async function maybeMarkNavigation({
  tabId,
  command,
  actions,
  execution = null,
  options = {},
  plannerAdapter,
  runtime,
}) {
  const session = await getSession(tabId);
  const marked = await tryMarkAwaitingNavigation(
    tabId,
    command.step || session.step,
    actions,
    execution,
    options,
    { plannerAdapter, runtime },
  );

  if (!marked) {
    return null;
  }

  if (marked.resumeCommand) {
    return {
      nextCommand: marked.resumeCommand,
      nextTabId: marked.tabId || tabId,
      lastState: null,
    };
  }

  return {
    terminal: "waiting_for_navigation",
    tabId: marked.tabId || tabId,
    result: {
      ok: true,
      waitingForNavigation: true,
    },
  };
}

export async function executeRunActionsCommand(
  tabId,
  command,
  { lastState, plannerAdapter, runtime, stopIfRequested },
) {
  let session = await ensureLiveSession(tabId);
  const step = getCommandStep(command, session);
  const actions = Array.isArray(command.actions) ? command.actions : [];
  let state = lastState;

  if (!state) {
    state = await runtime.extractStateFromTab(tabId, {
      goal: session.goal,
      step,
      meta: { beforeActions: true },
    });
  }

  for (const action of actions) {
    await addEvent(tabId, {
      kind: "action_planned",
      step: session.step || step,
      action: clone(action),
      frameId: Number.isInteger(action?.frameId) ? action.frameId : 0,
      message: `Planned action: ${action.type}`,
    });
  }

  const stopBeforeExecution = await stopIfRequested(
    tabId,
    "Agent stopped by user before executing actions.",
  );
  if (stopBeforeExecution) {
    return {
      terminal: "result",
      result: stopBeforeExecution,
    };
  }

  let execution = null;

  try {
    execution = await runtime.runActionsInTab(tabId, state, actions);
  } catch (error) {
    const navigation = await maybeMarkNavigation({
      tabId,
      command,
      actions,
      execution: null,
      plannerAdapter,
      runtime,
    });

    if (navigation) return navigation;

    throw error;
  }

  session = await getSession(tabId);
  const pendingNewTab = session.pendingNewTab || null;

  if (Number.isInteger(pendingNewTab?.newTabId)) {
    const navigation = await maybeMarkNavigation({
      tabId,
      command,
      actions,
      execution,
      options: {
        handoffToTabId: pendingNewTab.newTabId,
        observedUrl: pendingNewTab.url || "",
        source: "new_tab",
      },
      plannerAdapter,
      runtime,
    });

    if (navigation) return navigation;
  }

  let afterState = null;

  try {
    await sleep(10000);

    afterState = await runtime.extractStateFromTab(tabId, {
      goal: session.goal,
      step: command.step || step,
      meta: { afterActions: true },
    });
  } catch (error) {
    const navigation = await maybeMarkNavigation({
      tabId,
      command,
      actions,
      execution,
      plannerAdapter,
      runtime,
    });

    if (navigation) return navigation;

    throw error;
  }

  const commandResult = await plannerAdapter.postCommandResult({
    runId: session.runId,
    type: "actions_executed",
    command,
    execution,
    postState: afterState,
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
    "Agent stopped by user after action execution.",
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
