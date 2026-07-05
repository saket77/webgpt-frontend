import { ensureLiveSession } from "./context.js";
import { executeCommand } from "./router.js";
import { MAX_STEPS } from "../../config.js";
import { getMissingCommandAccess } from "./accessControl.js";

export async function driveCommand(
  tabId,
  initialCommand,
  { plannerAdapter, runtime, stopIfRequested },
) {
  let command = initialCommand;
  let lastState = null;
  let activeTabId = tabId;

  while (true) {
    const session = await ensureLiveSession(activeTabId);

    if (
      (command?.type === "extract_state" ||
        command?.type === "navigation_completed") &&
      session.step >= MAX_STEPS
    ) {
      return {
        terminal: "max_steps_reached",
        step: session.step,
      };
    }

    const stopBeforeCommand = await stopIfRequested(
      activeTabId,
      "Agent stopped by user before starting the next step.",
    );
    if (stopBeforeCommand) {
      return {
        terminal: "result",
        result: stopBeforeCommand,
      };
    }

    const missingAccess = await getMissingCommandAccess(
      command,
      session,
      runtime,
    );

    if (missingAccess) {
      return {
        terminal: "access_required",
        tabId: activeTabId,
        command,
        ...missingAccess,
      };
    }

    const result = await executeCommand(activeTabId, command, {
      lastState,
      plannerAdapter,
      runtime,
      stopIfRequested,
    });

    if (result?.terminal) {
      return {
        ...result,
        tabId: result.tabId || activeTabId,
      };
    }

    command = result.nextCommand;
    if ("lastState" in result) {
      lastState = result.lastState;
    }
    activeTabId = result.nextTabId || activeTabId;
  }
}
