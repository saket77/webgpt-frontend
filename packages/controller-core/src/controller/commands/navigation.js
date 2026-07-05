import { addEvent } from "../../events.js";
import { getSession, saveSession } from "../../state/sessionStore.js";

export async function executeWaitForNavigationCommand(tabId, command) {
  const session = await getSession(tabId);
  session.running = false;
  session.awaitingNavigation = true;
  session.pendingStep = command.step || session.step;
  session.surface = command.surface || session.surface;
  session.lastKnownUrl =
    command.observedUrl || session.lastKnownUrl || command.url || "";
  session.attachedTabId = tabId;
  await saveSession(tabId, session);

  await addEvent(tabId, {
    kind: "awaiting_navigation",
    step: session.pendingStep || session.step,
    message: "Navigation detected. Waiting for the next document to load.",
    url: session.lastKnownUrl,
    interruptedAfterExecution: true,
    source: command.source || "",
  });

  return {
    terminal: "waiting_for_navigation",
    result: {
      ok: true,
      waitingForNavigation: true,
    },
  };
}
