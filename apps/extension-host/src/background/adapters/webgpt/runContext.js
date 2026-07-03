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
  const url = observedUrl || session.lastKnownUrl || "";

  return {
    tabId,
    attachedTabId: session.attachedTabId || tabId,
    surface: session.surface || "browser_dom",
    lastKnownUrl: session.lastKnownUrl || "",
    observedUrl: observedUrl || "",
    url,
    goal: session.goal || "",
    step: session.step || 0,
  };
}
