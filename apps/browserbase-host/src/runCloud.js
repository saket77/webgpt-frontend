import {
  BROWSER_DOM_SURFACE,
  createControllerCore,
} from "@webgpt/controller-core";
import { createWebGptPlannerAdapter } from "@webgpt/planner-http-adapter";
import { createBrowserbaseSession, connectPlaywrightBrowser } from "./browserbaseClient.js";
import { createBrowserbaseRuntime } from "./browserbaseRuntime.js";
import { createCloudEventSink } from "./eventSink.js";
import { createCloudHost, CLOUD_TAB_ID } from "./host.js";
import { createCloudSessionStore } from "./sessionStore.js";

async function loadInitialPage(runtime, url) {
  await runtime.goto(url);
  await runtime.ensureContentScriptReady(CLOUD_TAB_ID, {
    attempts: 10,
    delayMs: 250,
    allowInjection: true,
  });
}

async function autoResumeNavigation({
  controller,
  result,
  runtime,
  sessionStore,
  maxResumes = 3,
}) {
  let current = result;

  for (let count = 0; count < maxResumes && current?.waitingForNavigation; count += 1) {
    await runtime.waitForPageReady();
    const session = await sessionStore.getSession(CLOUD_TAB_ID);

    current = await controller.continueRun(CLOUD_TAB_ID, {
      type: "navigation_completed",
      surface: session.surface || BROWSER_DOM_SURFACE,
      runId: session.runId,
      step: Number(session.pendingStep || session.step || 0) + 1,
      reason: "navigation_completed",
      meta: { afterNavigation: true },
    });
  }

  return current;
}

async function maybeAutoConfirm({
  autoConfirm,
  controller,
  result,
  sessionStore,
}) {
  const session = await sessionStore.getSession(CLOUD_TAB_ID);

  if (
    autoConfirm &&
    result?.paused &&
    session.pausedReason === "awaiting_success_confirmation"
  ) {
    return controller.confirmSuccess(CLOUD_TAB_ID);
  }

  return result;
}

function statusForResult(result, session) {
  if (result?.completed) return "completed";
  if (result?.accessRequired) {
    return result.reason || "access_required";
  }
  if (result?.waitingForNavigation) return "waiting_for_navigation";
  if (result?.paused) return session.pausedReason || result.reason || "paused";
  if (result?.stopped) return result.reason || "stopped";
  return result?.ok ? "ok" : "unknown";
}

export async function runCloudWebGpt({
  url,
  goal,
  backend,
  projectId,
  autoConfirm = true,
  logsDir = "",
  timeoutMs = 120000,
  logStream = process.stdout,
  onEvent,
  onEventLogReady,
  onSessionReady,
} = {}) {
  const browserbase = await createBrowserbaseSession({ projectId });
  if (typeof onSessionReady === "function") {
    await onSessionReady({
      browserbaseSessionId: browserbase.sessionId,
      sessionUrl: browserbase.sessionUrl,
      liveViewUrl: browserbase.liveViewUrl,
    });
  }
  const browser = await connectPlaywrightBrowser(browserbase.connectUrl);
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());

  const sessionStore = createCloudSessionStore();
  const runtime = createBrowserbaseRuntime({
    page,
    navigationTimeoutMs: timeoutMs,
  });
  const host = createCloudHost({ runtime });
  const { eventSink, eventLogPath } = await createCloudEventSink({
    logsDir,
    runLabel: "browserbase",
    stream: logStream,
    onEvent,
  });
  if (typeof onEventLogReady === "function") {
    await onEventLogReady({ eventLogPath });
  }
  const plannerAdapter = createWebGptPlannerAdapter({ baseUrl: backend });

  const controller = createControllerCore({
    plannerAdapter,
    runtime,
    sessionStore,
    eventSink,
    host,
  });

  controller.registerTabHandlers();

  try {
    await loadInitialPage(runtime, url);

    let result = await controller.startAgent(
      CLOUD_TAB_ID,
      goal,
      {},
      false,
      "",
      BROWSER_DOM_SURFACE,
      null,
      [],
    );

    result = await autoResumeNavigation({
      controller,
      result,
      runtime,
      sessionStore,
    });

    result = await maybeAutoConfirm({
      autoConfirm,
      controller,
      result,
      sessionStore,
    });

    const session = await sessionStore.getSession(CLOUD_TAB_ID);

    return {
      ok: Boolean(result?.ok && !result?.accessRequired),
      status: statusForResult(result, session),
      browserbaseSessionId: browserbase.sessionId,
      sessionUrl: browserbase.sessionUrl,
      liveViewUrl: browserbase.liveViewUrl,
      plannerRunId: session.runId || "",
      eventLogPath,
      summary: result?.summary || result?.message || session.finalResult?.summary || "",
      finalResult: result?.finalResult || session.finalResult || null,
      result,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
