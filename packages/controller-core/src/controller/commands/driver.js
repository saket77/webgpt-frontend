import { ensureLiveSession, getCommandStep } from "./context.js";
import { executeCommand } from "./router.js";
import { MAX_STEPS } from "../../config.js";
import { getMissingCommandAccess } from "./accessControl.js";
import { BROWSER_DOM_SURFACE } from "../../runtime/surfaces.js";

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

    const readsPage = command?.type === "extract_state" || command?.type === "navigation_completed";
    const usesChromeSteps = session.chromeStepLifecycle === 1 &&
      (command?.surface || session.surface) === BROWSER_DOM_SURFACE;
    const runsBrowserActions = command?.type === "run_actions";
    if (usesChromeSteps
      ? (readsPage || runsBrowserActions) && getCommandStep(command, session) > MAX_STEPS
      : readsPage && session.step >= MAX_STEPS) {
      return {
        terminal: "max_steps_reached",
        step: usesChromeSteps ? Math.min(session.step, MAX_STEPS) : session.step,
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
