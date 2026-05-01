import { ensureLiveSession } from "./context.js";
import { executeExtractStateCommand } from "./extractState.js";
import { executeWaitForNavigationCommand } from "./navigation.js";
import { executeRunActionsCommand } from "./runActions.js";
import { executeRunReplayBatchCommand } from "./replayBatch.js";
import {
  buildAskHumanTerminal,
  buildDoneTerminal,
} from "./terminal.js";

export async function executeCommand(
  tabId,
  command,
  { lastState = null, plannerAdapter, runtime, stopIfRequested },
) {
  const session = await ensureLiveSession(tabId);

  if (command?.type === "done") {
    return buildDoneTerminal(command, session);
  }

  if (command?.type === "ask_human") {
    return buildAskHumanTerminal(command, session);
  }

  if (command?.type === "wait_for_navigation") {
    return executeWaitForNavigationCommand(tabId, command);
  }

  if (
    command?.type === "extract_state" ||
    command?.type === "navigation_completed"
  ) {
    return executeExtractStateCommand(tabId, command, {
      plannerAdapter,
      runtime,
      stopIfRequested,
    });
  }

  if (command?.type === "run_actions") {
    return executeRunActionsCommand(tabId, command, {
      lastState,
      plannerAdapter,
      runtime,
      stopIfRequested,
    });
  }

  if (command?.type === "run_replay_batch") {
    return executeRunReplayBatchCommand(tabId, command, {
      plannerAdapter,
      runtime,
    });
  }

  throw new Error(`Unsupported browser command: ${command?.type || "unknown"}`);
}
