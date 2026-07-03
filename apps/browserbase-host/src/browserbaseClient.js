export async function createBrowserbaseSession({
  apiKey = process.env.BROWSERBASE_API_KEY,
  projectId = process.env.BROWSERBASE_PROJECT_ID,
  sessionConfig = {},
} = {}) {
  if (!apiKey) {
    throw new Error("BROWSERBASE_API_KEY is required for live cloud runs.");
  }
  if (!projectId && !sessionConfig.projectId) {
    throw new Error("BROWSERBASE_PROJECT_ID is required for live cloud runs.");
  }

  const sdkModule = await import("@browserbasehq/sdk");
  const Browserbase = sdkModule.Browserbase || sdkModule.default;
  if (!Browserbase) {
    throw new Error("@browserbasehq/sdk did not export a Browserbase client.");
  }

  const bb = new Browserbase({ apiKey });
  const session = await bb.sessions.create({
    projectId,
    ...sessionConfig,
  });
  const debugUrls = await bb.sessions.debug(session.id).catch(() => null);

  return {
    bb,
    session,
    debugUrls,
    connectUrl: session.connectUrl,
    sessionId: session.id,
    sessionUrl: `https://browserbase.com/sessions/${session.id}`,
    liveViewUrl:
      debugUrls?.debuggerFullscreenUrl ||
      debugUrls?.debuggerUrl ||
      debugUrls?.pages?.[0]?.debuggerFullscreenUrl ||
      "",
  };
}

export async function connectPlaywrightBrowser(connectUrl) {
  const { chromium } = await import("playwright-core");
  return chromium.connectOverCDP(connectUrl);
}
