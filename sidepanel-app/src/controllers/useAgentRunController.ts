/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type RunLaunchRequest,
  useAgentLaunchRequest,
} from "../hooks/useAgentLaunchRequest";
import { useAgentUX } from "../providers";

declare const chrome: any;

export type AgentEvent = {
  kind: string;
  timestamp?: number;
  message?: string;
  step?: number;
  url?: string;
  title?: string;
  controlsCount?: number;
  frameCount?: number;
  primaryFrameId?: number | null;
  frameId?: number | null;
  plannerStatus?: string;
  reasoning?: string;
  action?: unknown;
  ok?: boolean;
  error?: string;
  reason?: string;
  hint?: string;
  pendingStep?: number;
  fromTabId?: number;
  toTabId?: number;
  item?: any;
  queue?: any;
  results?: any[];
};

export type AgentSession = {
  runId?: string;
  goal?: string;
  running?: boolean;
  stopRequested?: boolean;
  step?: number;
  pendingStep?: number | null;
  awaitingNavigation?: boolean;
  pausedReason?: string | null;
  events?: AgentEvent[];
  attachedTabId?: number;
  movedToTabId?: number | null;
  movedFromTabId?: number | null;
  lastKnownUrl?: string;
  surface?: Surface;
  isTemplateRun?: boolean;
  templateRunId?: string;
  templateQueue?: unknown;
  artifactFileName?: string;
};

type SessionScope = "home" | "template";

type UseAgentRunControllerArgs = {
  launchRequest?: RunLaunchRequest | null;
  onLaunchRequestHandled?: () => void;
  sessionScope?: SessionScope;
};

const DISCLOSURE_STORAGE_KEY = "webgpt_pre_run_disclosure_accepted_v1";
const WEBGPT_HOST_ORIGINS = ["http://*/*", "https://*/*"];
const BROWSER_DOM_SURFACE = "browser_dom";
const GOOGLE_SHEETS_SURFACE = "google_sheets";
const MICROSOFT_EXCEL_SURFACE = "microsoft_excel";

type Surface =
  | typeof BROWSER_DOM_SURFACE
  | typeof GOOGLE_SHEETS_SURFACE
  | typeof MICROSOFT_EXCEL_SURFACE;

type StartOverrides = {
  goal?: string;
  artifactFileName?: string | null;
  inputValues?: Record<string, string[]>;
  isTemplate?: boolean;
  surface?: Surface;
  options?: {
    clearEvents?: boolean;
    pendingStatus?: string;
    successStatus?: string;
  };
};

type TemplateQueueStartRequest = {
  goalTemplate: string;
  inputSchema?: Array<{
    key: string;
    label?: string;
    required?: boolean;
  }>;
  inputValues?: Record<string, string[]>;
  artifactFileName?: string | null;
  surface?: Surface;
  options?: {
    clearEvents?: boolean;
    pendingStatus?: string;
    successStatus?: string;
  };
};

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id) {
    throw new Error("No active tab.");
  }

  return tab.id as number;
}

async function hasAcceptedPreRunDisclosure() {
  const stored = await chrome.storage.local.get(DISCLOSURE_STORAGE_KEY);
  return stored?.[DISCLOSURE_STORAGE_KEY] === true;
}

async function setAcceptedPreRunDisclosure() {
  await chrome.storage.local.set({
    [DISCLOSURE_STORAGE_KEY]: true,
  });
}

async function hasWebGptHostAccess() {
  return chrome.permissions.contains({
    origins: WEBGPT_HOST_ORIGINS,
  });
}

async function requestWebGptHostAccess() {
  return chrome.permissions.request({
    origins: WEBGPT_HOST_ORIGINS,
  });
}

function normalizeSurface(value: unknown): Surface {
  if (value === GOOGLE_SHEETS_SURFACE) return GOOGLE_SHEETS_SURFACE;
  if (value === MICROSOFT_EXCEL_SURFACE) return MICROSOFT_EXCEL_SURFACE;
  return BROWSER_DOM_SURFACE;
}

async function getTabSurface(tabId: number): Promise<Surface> {
  const response = await chrome.runtime.sendMessage({
    type: "WEBGPT_GET_TAB_SURFACE",
    tabId,
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Unable to detect tab surface.");
  }

  return normalizeSurface(response.surface);
}

async function getGoogleSheetsAuthStatus() {
  const response = await chrome.runtime.sendMessage({
    type: "WEBGPT_GET_GOOGLE_SHEETS_AUTH_STATUS",
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Unable to check Google Sheets auth.");
  }

  return response as {
    ok?: boolean;
    authenticated?: boolean;
    authStatus?: string;
    configMissing?: boolean;
    error?: string;
  };
}

async function connectGoogleSheets() {
  const response = await chrome.runtime.sendMessage({
    type: "WEBGPT_CONNECT_GOOGLE_SHEETS",
  });

  if (!response?.ok || !response?.authenticated) {
    throw new Error(response?.error || "Google Sheets authorization failed.");
  }

  return response;
}

async function getMicrosoftExcelAuthStatus() {
  const response = await chrome.runtime.sendMessage({
    type: "WEBGPT_GET_MICROSOFT_EXCEL_AUTH_STATUS",
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Unable to check Microsoft Excel auth.");
  }

  return response as {
    ok?: boolean;
    authenticated?: boolean;
    authStatus?: string;
    configMissing?: boolean;
    error?: string;
  };
}

async function connectMicrosoftExcel() {
  const response = await chrome.runtime.sendMessage({
    type: "WEBGPT_CONNECT_MICROSOFT_EXCEL",
  });

  if (!response?.ok || !response?.authenticated) {
    throw new Error(response?.error || "Microsoft Excel authorization failed.");
  }

  return response;
}

function sessionStatusText(session?: AgentSession | null) {
  if (!session) return "Idle";

  if (session.movedToTabId) {
    return `Session moved to tab ${session.movedToTabId}`;
  }

  if (session.awaitingNavigation) {
    return `Waiting for navigation after step ${
      session.pendingStep || session.step || 0
    }`;
  }

  if (session.running) {
    return `Running step ${session.step || 0}`;
  }

  if (session.pausedReason) {
    return `Paused: ${session.pausedReason}`;
  }

  if (session.goal) {
    return `Idle. Goal loaded: ${session.goal}`;
  }

  return "Idle";
}

function sessionHasWork(session?: AgentSession | null) {
  return Boolean(
    session?.runId ||
      session?.goal ||
      session?.events?.length ||
      session?.templateRunId ||
      session?.templateQueue,
  );
}

function isTemplateSession(session?: AgentSession | null) {
  return Boolean(
    session?.isTemplateRun || session?.templateRunId || session?.templateQueue,
  );
}

function sessionMatchesScope(
  session: AgentSession | null,
  scope?: SessionScope,
) {
  if (!scope || !sessionHasWork(session)) return true;

  return scope === "template"
    ? isTemplateSession(session)
    : !isTemplateSession(session);
}

function foreignSessionStatusText(scope?: SessionScope) {
  if (scope === "template") {
    return "Home session active. Open Home to continue.";
  }

  return "Routine session active. Open Routines to continue.";
}

function foreignSessionBlocksStart(session?: AgentSession | null) {
  return Boolean(
    session?.running ||
      session?.awaitingNavigation ||
      session?.pausedReason ||
      session?.stopRequested,
  );
}

function applyEventToSession(
  prev: AgentSession | null,
  event: AgentEvent,
): AgentSession | null {
  const next: AgentSession = {
    ...(prev || {}),
  };

  switch (event.kind) {
    case "loop_started":
    case "loop_resumed":
      next.running = true;
      next.awaitingNavigation = false;
      next.pausedReason = null;
      next.stopRequested = false;
      break;

    case "step_started":
      next.running = true;
      next.awaitingNavigation = false;
      next.pausedReason = null;
      if (typeof event.step === "number") next.step = event.step;
      break;

    case "state_extracted":
    case "planner_output":
    case "action_planned":
    case "execution_result":
      next.running = true;
      next.awaitingNavigation = false;
      if (typeof event.step === "number") next.step = event.step;
      if (event.url) next.lastKnownUrl = event.url;
      break;

    case "awaiting_navigation":
      next.running = false;
      next.awaitingNavigation = true;
      next.pausedReason = null;
      if (typeof event.step === "number") next.pendingStep = event.step;
      if (event.url) next.lastKnownUrl = event.url;
      break;

    case "navigation_completed":
      next.awaitingNavigation = false;
      next.running = true;
      next.pendingStep = null;
      if (event.url) next.lastKnownUrl = event.url;
      break;

    case "navigation_resume_blocked":
      next.running = false;
      next.awaitingNavigation = false;
      break;

    case "stop_requested":
      next.stopRequested = true;
      break;

    case "stopped_by_user":
      next.running = false;
      next.awaitingNavigation = false;
      next.stopRequested = false;
      next.pausedReason = "forced_stop";
      break;

    case "paused":
      next.running = false;
      next.awaitingNavigation = false;
      next.stopRequested = false;
      next.pausedReason = event.reason || "paused";
      if (typeof event.step === "number") next.pendingStep = event.step;
      break;

    case "human_hint":
      next.pausedReason = null;
      break;

    case "success_confirmed":
      next.running = false;
      next.awaitingNavigation = false;
      next.pausedReason = null;
      next.stopRequested = false;
      break;

    case "success_rejected":
      next.running = true;
      next.awaitingNavigation = false;
      next.pausedReason = null;
      next.stopRequested = false;
      break;

    case "template_queue_started":
    case "template_item_started":
      next.running = true;
      next.awaitingNavigation = false;
      next.pausedReason = null;
      next.stopRequested = false;
      if (event.queue) next.templateQueue = event.queue;
      break;

    case "template_item_completed":
      if (event.queue) next.templateQueue = event.queue;
      break;

    case "template_queue_finished":
      next.running = false;
      next.awaitingNavigation = false;
      next.pausedReason = null;
      next.stopRequested = false;
      if (event.queue) next.templateQueue = event.queue;
      break;

    case "max_steps_reached":
    case "fatal_error":
    case "session_reset":
      next.running = false;
      next.awaitingNavigation = false;
      next.pausedReason = null;
      next.stopRequested = false;
      break;

    case "session_attached":
      if (typeof event.fromTabId === "number") {
        next.movedFromTabId = event.fromTabId;
      }
      break;

    case "session_detached":
      if (typeof event.toTabId === "number") {
        next.movedToTabId = event.toTabId;
      }
      break;
  }

  return next;
}

export function deriveEffectiveSessionState(
  session: AgentSession | null,
  lastEvent: AgentEvent | null,
) {
  const runningFromSession = Boolean(session?.running);
  const awaitingNavigationFromSession = Boolean(session?.awaitingNavigation);
  const pausedReasonFromSession = session?.pausedReason || null;

  let inferredRunning = runningFromSession;
  let inferredAwaitingNavigation = awaitingNavigationFromSession;
  let inferredPausedReason = pausedReasonFromSession;

  if (!session && lastEvent) {
    if (
      [
        "loop_started",
        "loop_resumed",
        "step_started",
        "state_extracted",
        "planner_output",
        "action_planned",
        "execution_result",
        "navigation_completed",
        "success_rejected",
        "template_queue_started",
        "template_item_started",
      ].includes(lastEvent.kind)
    ) {
      inferredRunning = true;
      inferredAwaitingNavigation = false;
      inferredPausedReason = null;
    }

    if (lastEvent.kind === "awaiting_navigation") {
      inferredRunning = false;
      inferredAwaitingNavigation = true;
      inferredPausedReason = null;
    }

    if (lastEvent.kind === "paused") {
      inferredRunning = false;
      inferredAwaitingNavigation = false;
      inferredPausedReason = lastEvent.reason || "paused";
    }

    if (lastEvent.kind === "stopped_by_user") {
      inferredRunning = false;
      inferredAwaitingNavigation = false;
      inferredPausedReason = "forced_stop";
    }

    if (
      [
        "success_confirmed",
        "template_queue_finished",
        "session_reset",
        "fatal_error",
        "max_steps_reached",
      ].includes(lastEvent.kind)
    ) {
      inferredRunning = false;
      inferredAwaitingNavigation = false;
      inferredPausedReason = null;
    }
  }

  return {
    isRunning: inferredRunning,
    isAwaitingNavigation: inferredAwaitingNavigation,
    pausedReason: inferredPausedReason,
    isPaused: Boolean(inferredPausedReason),
  };
}

export function useAgentRunController({
  launchRequest,
  onLaunchRequestHandled,
  sessionScope,
}: UseAgentRunControllerArgs = {}) {
  const [goal, setGoal] = useState("");
  const [artifactFileName, setArtifactFileName] = useState<string | null>(null);
  const [preRunDisclosureOpened, setPreRunDisclosureOpened] = useState(false);
  const [preRunSurface, setPreRunSurface] =
    useState<Surface>(BROWSER_DOM_SURFACE);
  const [pendingStartOverrides, setPendingStartOverrides] =
    useState<StartOverrides | null>(null);
  const [pendingTemplateQueueStart, setPendingTemplateQueueStart] =
    useState<TemplateQueueStartRequest | null>(null);

  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [attachedTabId, setAttachedTabId] = useState<number | null>(null);
  const [session, setSession] = useState<AgentSession | null>(null);
  const [foreignSession, setForeignSession] = useState<AgentSession | null>(
    null,
  );

  const {
    status,
    setStatus,
    error,
    setError,
    busyAction,
    setBusyAction,
    eventLog,
    setEventLog,
    hint,
    setHint,
    startAgentRun,
    stopAgentRun,
    acceptAgentSuccess,
    rejectAgentSuccess,
    sendAgentHint,
    resetAgentSession,
    runAction,
  } = useAgentUX();

  const ensureActiveTabId = useCallback(async () => {
    if (activeTabId != null) return activeTabId;

    const tabId = await getActiveTabId();
    setActiveTabId(tabId);
    return tabId;
  }, [activeTabId]);

  const resolveStartSurface = useCallback(
    async (tabId: number, requestedSurface?: Surface) => {
      if (requestedSurface) return requestedSurface;
      return getTabSurface(tabId);
    },
    [],
  );

  const getSessionForTab = useCallback(async (tabId: number) => {
    const response = await chrome.runtime.sendMessage({
      type: "WEBGPT_GET_SESSION",
      tabId,
    });

    if (!response?.ok || !response?.session) {
      throw new Error(response?.error || "Unable to read session.");
    }

    return response.session as AgentSession;
  }, []);

  const resolveSessionTarget = useCallback(async () => {
    const currentActiveTabId = await getActiveTabId();
    setActiveTabId(currentActiveTabId);

    let tabId = currentActiveTabId;
    let currentSession = await getSessionForTab(tabId);

    if (
      currentSession.movedToTabId &&
      Number.isInteger(currentSession.movedToTabId)
    ) {
      tabId = currentSession.movedToTabId;
      currentSession = await getSessionForTab(tabId);
    }

    const liveTabId = currentSession.attachedTabId || tabId;
    setAttachedTabId(liveTabId);

    return {
      tabId: liveTabId,
      session: currentSession,
      activeTabId: currentActiveTabId,
    };
  }, [getSessionForTab]);

  const refreshSessionView = useCallback(async () => {
    try {
      setError(null);

      const { tabId, session: nextSession } = await resolveSessionTarget();

      if (!sessionMatchesScope(nextSession, sessionScope)) {
        setSession(null);
        setForeignSession(nextSession);
        setEventLog([]);
        setAttachedTabId(nextSession.attachedTabId || tabId);
        setStatus(foreignSessionStatusText(sessionScope));
        if (sessionScope === "home") {
          setGoal("");
        }
        return;
      }

      setForeignSession(null);
      setSession(nextSession);
      setStatus(sessionStatusText(nextSession));
      setEventLog(nextSession.events || []);
      setAttachedTabId(nextSession.attachedTabId || tabId);
      setGoal(nextSession.goal || "");
    } catch (err: any) {
      setError(err?.message || String(err));
      setStatus(err?.message || "Failed to refresh session");
    }
  }, [resolveSessionTarget, sessionScope, setError, setEventLog, setGoal, setStatus]);

  useEffect(() => {
    void refreshSessionView();
  }, [refreshSessionView]);

  useEffect(() => {
    const refreshActiveTab = async () => {
      try {
        const tabId = await getActiveTabId();
        setActiveTabId(tabId);
      } catch {
        // ignore
      }
    };

    void refreshActiveTab();

    const handleActivated = () => {
      void refreshSessionView();
    };

    const handleUpdated = (
      _tabId: number,
      changeInfo: { status?: string },
      tab: { active?: boolean },
    ) => {
      if (tab?.active || changeInfo?.status === "complete") {
        void refreshSessionView();
      }
    };

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onUpdated.addListener(handleUpdated);

    return () => {
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    };
  }, [refreshSessionView]);

  useEffect(() => {
    const lastEvent = eventLog[eventLog.length - 1] as AgentEvent | undefined;
    if (!lastEvent) return;
    if (foreignSession) {
      setEventLog([]);
      return;
    }

    setSession((prev) => applyEventToSession(prev, lastEvent));

    if (lastEvent.kind === "session_reset") {
      setAttachedTabId(null);
    }

    if (
      lastEvent.kind === "session_detached" &&
      typeof lastEvent.toTabId === "number"
    ) {
      setAttachedTabId(lastEvent.toTabId);
    }
  }, [eventLog, foreignSession, setEventLog]);

  useEffect(() => {
    if (session) {
      setStatus(sessionStatusText(session));
    }
  }, [session, setStatus]);

  const startAgentAfterPreRunChecks = useCallback(
    async (overrides: StartOverrides = {}) => {
      const tabId = await ensureActiveTabId();

      const effectiveGoal = overrides.goal ?? goal ?? "";
      const effectiveArtifactFileName =
        overrides.artifactFileName ?? artifactFileName ?? null;
      const effectiveSurface = await resolveStartSurface(
        tabId,
        overrides.surface,
      );

      const response = await startAgentRun(
        {
          tabId,
          goal: effectiveGoal,
          artifactFileName: effectiveArtifactFileName,
          inputValues: overrides.inputValues,
          isTemplate: Boolean(overrides.isTemplate),
          surface: effectiveSurface,
        },
        overrides.options,
      );

      if (!response?.ok) return response;

      setAttachedTabId(tabId);
      setForeignSession(null);
      setSession((prev) => ({
        ...(prev || {}),
        goal: effectiveGoal,
        attachedTabId: tabId,
        surface: effectiveSurface,
        running: true,
        awaitingNavigation: false,
        pausedReason: null,
        stopRequested: false,
      }));

      return response;
    },
    [artifactFileName, ensureActiveTabId, goal, resolveStartSurface, startAgentRun],
  );

  const startTemplateQueueAfterPreRunChecks = useCallback(
    async (request: TemplateQueueStartRequest) => {
      const tabId = await ensureActiveTabId();
      const effectiveSurface = await resolveStartSurface(
        tabId,
        request.surface,
      );

      return runAction(
        "start",
        async () => {
          if (request.options?.clearEvents ?? true) {
            setEventLog([]);
          }

          const response = await chrome.runtime.sendMessage({
            type: "WEBGPT_START_TEMPLATE_QUEUE",
            tabId,
            goalTemplate: request.goalTemplate || "",
            inputSchema: request.inputSchema || [],
            inputValues: request.inputValues || {},
            artifactFileName: request.artifactFileName || "",
            surface: effectiveSurface,
          });

          if (!response?.ok) {
            throw new Error(
              response?.error || "Failed to start template queue.",
            );
          }

          const result = response.result || {};
          setAttachedTabId(tabId);
          setForeignSession(null);
          setSession((prev) => ({
            ...(prev || {}),
            goal: result.item?.goal || request.goalTemplate || "",
            attachedTabId: tabId,
            surface: effectiveSurface,
            running: true,
            awaitingNavigation: false,
            pausedReason: null,
            stopRequested: false,
            templateRunId: result.templateRunId || "",
            templateQueue: result.queue || null,
          }));

          return response;
        },
        {
          pendingStatus:
            request.options?.pendingStatus || "Starting template queue...",
          successStatus:
            request.options?.successStatus || "Template queue started.",
        },
      );
    },
    [ensureActiveTabId, resolveStartSurface, runAction, setEventLog],
  );

  const handleStart = useCallback(
    async (overrides: StartOverrides = {}) => {
      const tabId = await ensureActiveTabId();
      const surface = await resolveStartSurface(tabId, overrides.surface);

      if (surface === GOOGLE_SHEETS_SURFACE || surface === MICROSOFT_EXCEL_SURFACE) {
        const authStatus =
          surface === GOOGLE_SHEETS_SURFACE
            ? await getGoogleSheetsAuthStatus()
            : await getMicrosoftExcelAuthStatus();
        const surfaceLabel =
          surface === GOOGLE_SHEETS_SURFACE ? "Google Sheets" : "Microsoft Excel";

        if (authStatus.configMissing) {
          const message =
            authStatus.error || `${surfaceLabel} OAuth is not configured.`;
          setError(message);
          setStatus(message);
          return {
            ok: false,
            requiresSurfaceAuth: true,
          };
        }

        if (!authStatus.authenticated) {
          setPendingStartOverrides({ ...overrides, surface });
          setPreRunSurface(surface);
          setPreRunDisclosureOpened(true);
          setStatus(`Connect ${surfaceLabel} before starting.`);
          return {
            ok: false,
            requiresSurfaceAuth: true,
          };
        }

        return startAgentAfterPreRunChecks({ ...overrides, surface });
      }

      const disclosureAccepted = await hasAcceptedPreRunDisclosure();
      const hasHostAccess = await hasWebGptHostAccess();

      if (!disclosureAccepted || !hasHostAccess) {
        setPendingStartOverrides({ ...overrides, surface });
        setPreRunSurface(surface);
        setPreRunDisclosureOpened(true);
        setStatus("Review WebGPT access before starting.");
        return {
          ok: false,
          requiresDisclosure: true,
        };
      }

      return startAgentAfterPreRunChecks({ ...overrides, surface });
    },
    [
      ensureActiveTabId,
      resolveStartSurface,
      setError,
      setStatus,
      startAgentAfterPreRunChecks,
    ],
  );

  const handleStartTemplateQueue = useCallback(
    async (request: TemplateQueueStartRequest) => {
      const tabId = await ensureActiveTabId();
      const surface = await resolveStartSurface(tabId, request.surface);

      if (surface === GOOGLE_SHEETS_SURFACE || surface === MICROSOFT_EXCEL_SURFACE) {
        const authStatus =
          surface === GOOGLE_SHEETS_SURFACE
            ? await getGoogleSheetsAuthStatus()
            : await getMicrosoftExcelAuthStatus();
        const surfaceLabel =
          surface === GOOGLE_SHEETS_SURFACE ? "Google Sheets" : "Microsoft Excel";

        if (authStatus.configMissing) {
          const message =
            authStatus.error || `${surfaceLabel} OAuth is not configured.`;
          setError(message);
          setStatus(message);
          return {
            ok: false,
            requiresSurfaceAuth: true,
          };
        }

        if (!authStatus.authenticated) {
          setPendingTemplateQueueStart({ ...request, surface });
          setPendingStartOverrides(null);
          setPreRunSurface(surface);
          setPreRunDisclosureOpened(true);
          setStatus(`Connect ${surfaceLabel} before starting.`);
          return {
            ok: false,
            requiresSurfaceAuth: true,
          };
        }

        return startTemplateQueueAfterPreRunChecks({ ...request, surface });
      }

      const disclosureAccepted = await hasAcceptedPreRunDisclosure();
      const hasHostAccess = await hasWebGptHostAccess();

      if (!disclosureAccepted || !hasHostAccess) {
        setPendingTemplateQueueStart({ ...request, surface });
        setPendingStartOverrides(null);
        setPreRunSurface(surface);
        setPreRunDisclosureOpened(true);
        setStatus("Review WebGPT access before starting.");
        return {
          ok: false,
          requiresDisclosure: true,
        };
      }

      return startTemplateQueueAfterPreRunChecks({ ...request, surface });
    },
    [
      ensureActiveTabId,
      resolveStartSurface,
      setError,
      setStatus,
      startTemplateQueueAfterPreRunChecks,
    ],
  );

  const handlePreRunDisclosureCancel = useCallback(() => {
    setPreRunDisclosureOpened(false);
    setPendingStartOverrides(null);
    setPendingTemplateQueueStart(null);
    setPreRunSurface(BROWSER_DOM_SURFACE);
    setStatus("Start cancelled.");
  }, [setStatus]);

  const handlePreRunDisclosureAccept = useCallback(async () => {
    try {
      setBusyAction("permissions");
      setError(null);
      setStatus(
        preRunSurface === GOOGLE_SHEETS_SURFACE
          ? "Connecting Google Sheets..."
          : preRunSurface === MICROSOFT_EXCEL_SURFACE
            ? "Connecting Microsoft Excel..."
          : "Requesting website access...",
      );

      if (preRunSurface === GOOGLE_SHEETS_SURFACE) {
        await connectGoogleSheets();
      } else if (preRunSurface === MICROSOFT_EXCEL_SURFACE) {
        await connectMicrosoftExcel();
      } else {
        const granted = await requestWebGptHostAccess();

        if (!granted) {
          throw new Error(
            "Website access was not granted. WebGPT needs this to run on pages you choose.",
          );
        }

        await setAcceptedPreRunDisclosure();
      }

      const overrides = pendingStartOverrides || {};
      const templateQueueRequest = pendingTemplateQueueStart;
      setPreRunDisclosureOpened(false);
      setPendingStartOverrides(null);
      setPendingTemplateQueueStart(null);
      setPreRunSurface(BROWSER_DOM_SURFACE);

      if (templateQueueRequest) {
        await startTemplateQueueAfterPreRunChecks(templateQueueRequest);
      } else {
        await startAgentAfterPreRunChecks(overrides);
      }
    } catch (err: any) {
      setError(err?.message || String(err));
      setStatus(err?.message || "Could not start WebGPT.");
    } finally {
      setBusyAction(null);
    }
  }, [
    pendingStartOverrides,
    pendingTemplateQueueStart,
    preRunSurface,
    setBusyAction,
    setError,
    setStatus,
    startAgentAfterPreRunChecks,
    startTemplateQueueAfterPreRunChecks,
  ]);

  const handleStop = useCallback(async () => {
    const tabId = attachedTabId ?? activeTabId ?? (await getActiveTabId());

    const response = await stopAgentRun(tabId);

    if (!response?.ok) return response;

    setSession((prev) => ({
      ...(prev || {}),
      attachedTabId: tabId,
      running: false,
      awaitingNavigation: false,
      pausedReason: "forced_stop",
      stopRequested: false,
    }));

    return response;
  }, [activeTabId, attachedTabId, stopAgentRun]);

  const handleRefresh = useCallback(async () => {
    try {
      setBusyAction("refresh");
      setStatus("Refreshing session...");
      await refreshSessionView();
    } catch (err: any) {
      setError(err?.message || String(err));
      setStatus(err?.message || "Failed to refresh session");
    } finally {
      setBusyAction(null);
    }
  }, [refreshSessionView, setBusyAction, setError, setStatus]);

  const handleAttachToActiveTab = useCallback(async () => {
    return runAction(
      "attach",
      async () => {
        const sourceTabId = attachedTabId ?? (await ensureActiveTabId());

        const response = await chrome.runtime.sendMessage({
          type: "WEBGPT_ATTACH_TO_ACTIVE_TAB",
          tabId: sourceTabId,
        });

        if (!response?.ok) {
          throw new Error(
            response?.error || "Failed to attach session to active tab.",
          );
        }

        const nextAttachedTabId =
          response.result?.attachedTabId ?? (await getActiveTabId());

        setAttachedTabId(nextAttachedTabId);
        setSession((prev) => ({
          ...(prev || {}),
          attachedTabId: nextAttachedTabId,
          movedToTabId: null,
        }));

        await refreshSessionView();

        return response;
      },
      {
        pendingStatus: "Attaching session to active tab...",
        successStatus: "Agent attached.",
      },
    );
  }, [attachedTabId, ensureActiveTabId, refreshSessionView, runAction]);

  const handleSendHint = useCallback(async () => {
    const { tabId } = await resolveSessionTarget();

    const response = await sendAgentHint({
      tabId,
      hint: hint || "",
    });

    if (!response?.ok) return response;

    setSession((prev) => ({
      ...(prev || {}),
      pausedReason: null,
      running: true,
    }));

    return response;
  }, [hint, resolveSessionTarget, sendAgentHint]);

  const handleAcceptSuccess = useCallback(async () => {
    const { tabId } = await resolveSessionTarget();

    const response = await acceptAgentSuccess(tabId);

    if (!response?.ok) return response;

    setSession((prev) => ({
      ...(prev || {}),
      pausedReason: null,
      running: false,
      awaitingNavigation: false,
      stopRequested: false,
    }));

    return response;
  }, [acceptAgentSuccess, resolveSessionTarget]);

  const handleRejectSuccess = useCallback(async () => {
    const { tabId } = await resolveSessionTarget();

    const response = await rejectAgentSuccess({
      tabId,
      hint: hint || "",
    });

    if (!response?.ok) return response;

    setSession((prev) => ({
      ...(prev || {}),
      pausedReason: null,
      running: true,
      awaitingNavigation: false,
    }));

    return response;
  }, [hint, rejectAgentSuccess, resolveSessionTarget]);

  const handleReset = useCallback(async () => {
    const tabId = attachedTabId ?? activeTabId ?? (await getActiveTabId());

    const response = await resetAgentSession(tabId);

    if (!response?.ok) return response;

    setSession(null);
    setAttachedTabId(null);

    return response;
  }, [activeTabId, attachedTabId, resetAgentSession]);

  const applyLaunchRequest = useCallback(
    (request: RunLaunchRequest) => {
      setGoal(request.goal || "");
      setArtifactFileName(request.artifactFileName || null);
      setStatus("Loaded saved artifact.");
      setEventLog([]);
      setError(null);
    },
    [setError, setEventLog, setStatus],
  );

  const autoStartLaunchRequest = useCallback(
    async (request: RunLaunchRequest) => {
      await handleStart({
        goal: request.goal || "",
        artifactFileName: request.artifactFileName || null,
      });
    },
    [handleStart],
  );

  useAgentLaunchRequest({
    launchRequest,
    onLaunchRequestHandled,
    applyLaunchRequest,
    autoStartLaunchRequest,
  });

  const lastEvent = (eventLog[eventLog.length - 1] ||
    null) as AgentEvent | null;

  const { isRunning, isAwaitingNavigation, pausedReason } = useMemo(
    () => deriveEffectiveSessionState(session, lastEvent),
    [session, lastEvent],
  );

  const awaitingConfirmation =
    pausedReason === "awaiting_success_confirmation" ||
    (lastEvent?.kind === "paused" &&
      lastEvent?.reason === "awaiting_success_confirmation");

  const awaitingHumanHint =
    pausedReason === "awaiting_human_hint" ||
    (lastEvent?.kind === "paused" &&
      lastEvent?.reason === "awaiting_human_hint");

  const hasGoal = Boolean(goal.trim());

  const canStart =
    hasGoal &&
    !isRunning &&
    !isAwaitingNavigation &&
    !awaitingHumanHint &&
    !foreignSessionBlocksStart(foreignSession) &&
    busyAction !== "start";

  const runHasStarted = isRunning || isAwaitingNavigation || busyAction === "start";

  const canStop =
    runHasStarted && !session?.stopRequested && busyAction !== "stop";

  const canRefresh = busyAction !== "refresh";

  const canAttach =
    !isRunning && !isAwaitingNavigation && busyAction !== "attach";

  const hasSessionToReset = Boolean(session || eventLog.length > 0);

  const canReset =
    hasSessionToReset &&
    !isRunning &&
    !isAwaitingNavigation &&
    !awaitingConfirmation &&
    busyAction !== "reset" &&
    busyAction !== "start" &&
    busyAction !== "stop";

  return {
    goal,
    setGoal,
    artifactFileName,
    preRunDisclosureOpened,
    preRunSurface,

    activeTabId,
    attachedTabId,
    session,

    status,
    error,
    busyAction,
    hint,
    setHint,
    eventLog,

    lastEvent,
    isRunning,
    isAwaitingNavigation,
    pausedReason,
    awaitingConfirmation,
    awaitingHumanHint,

    canStart,
    canStop,
    canRefresh,
    canAttach,
    canReset,

    handleStart,
    handleStartTemplateQueue,
    handlePreRunDisclosureAccept,
    handlePreRunDisclosureCancel,
    handleStop,
    handleRefresh,
    handleAttachToActiveTab,
    handleSendHint,
    handleAcceptSuccess,
    handleRejectSuccess,
    handleReset,
    refreshSessionView,

    setStatus,
    setError,
    setEventLog,
  };
}
