import { getSession } from "../../state/sessionStore.js";

export function getCommandStep(command, session) {
  if (Number.isInteger(command?.step)) {
    return command.step;
  }

  return Number(session?.step || 0) + 1;
}

export async function ensureLiveSession(tabId) {
  const session = await getSession(tabId);

  if (session.movedToTabId) {
    throw new Error(
      `Session ownership moved during execution to tab ${session.movedToTabId}.`,
    );
  }

  if ((session.attachedTabId || tabId) !== tabId) {
    throw new Error(
      "Session ownership drift detected. Refusing to continue on a stale tab binding.",
    );
  }

  return session;
}
