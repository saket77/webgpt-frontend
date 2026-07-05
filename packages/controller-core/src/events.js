import { getControllerCorePorts } from "./ports.js";

export async function addEvent(tabId, event) {
  return getControllerCorePorts().eventSink.addEvent(tabId, event);
}
