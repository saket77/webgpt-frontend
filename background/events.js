import { MAX_EVENTS } from "./config.js";
import { nowIso } from "./utils/common.js";
import { getSession, saveSession } from "./state/sessionStore.js";

export async function addEvent(tabId, event) {
  const session = await getSession(tabId);

  const entry = {
    timestamp: nowIso(),
    ...event,
  };

  session.events.push(entry);
  if (session.events.length > MAX_EVENTS) {
    session.events = session.events.slice(-MAX_EVENTS);
  }

  await saveSession(tabId, session);

  try {
    await chrome.runtime.sendMessage({
      type: "WEBGPT_AGENT_EVENT",
      tabId,
      event: entry,
    });
  } catch {
    // Side panel may not be open.
  }

  return entry;
}
