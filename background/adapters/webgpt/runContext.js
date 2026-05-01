export function syncSessionWithRun(session, run) {
  if (!run || typeof run !== "object") {
    return session;
  }

  return {
    ...session,
    step: Number.isInteger(run.step) ? run.step : session.step,
    finalResult:
      run.finalResult === undefined ? session.finalResult : run.finalResult,
  };
}

export function buildBrowserContext(tabId, session, observedUrl = "") {
  return {
    tabId,
    attachedTabId: session.attachedTabId || tabId,
    lastKnownUrl: session.lastKnownUrl || "",
    observedUrl: observedUrl || "",
    goal: session.goal || "",
    step: session.step || 0,
  };
}
