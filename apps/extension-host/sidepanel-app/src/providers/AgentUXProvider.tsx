/* eslint-disable react-refresh/only-export-components */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  useAgentActions,
  type StartAgentRequest,
} from "../hooks/useAgentActions";
import { useAgentEventStream } from "../hooks/useAgentEventStream";
import { sendToWorker } from "../hooks/useSavedArtifacts";

declare const chrome: any;
type AgentEvent = {
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
};

type BusyAction =
  | "start"
  | "stop"
  | "hint"
  | "acceptSuccess"
  | "rejectSuccess"
  | "refresh"
  | "attach"
  | "reset"
  | string
  | null;

type WorkerResponse<T = unknown> = {
  ok?: boolean;
  error?: string;
  result?: T;
};

type AgentUXContextValue = {
  status: string;
  setStatus: React.Dispatch<React.SetStateAction<string>>;

  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;

  busyAction: BusyAction;
  setBusyAction: React.Dispatch<React.SetStateAction<BusyAction>>;

  eventLog: AgentEvent[];
  setEventLog: React.Dispatch<React.SetStateAction<AgentEvent[]>>;
  clearEventLog: () => void;

  hint: string;
  setHint: React.Dispatch<React.SetStateAction<string>>;

  isRunning: boolean;
  setIsRunning: React.Dispatch<React.SetStateAction<boolean>>;

  runAction: <T>(
    label: Exclude<BusyAction, null>,
    fn: () => Promise<T>,
    options?: {
      pendingStatus?: string;
      successStatus?: string;
      errorStatus?: string;
    },
  ) => Promise<T | null>;

  startAgentRun: (
    request: StartAgentRequest,
    options?: {
      clearEvents?: boolean;
      pendingStatus?: string;
      successStatus?: string;
    },
  ) => Promise<WorkerResponse | null>;

  stopAgentRun: (
    tabId?: number | null,
    options?: {
      pendingStatus?: string;
      successStatus?: string;
    },
  ) => Promise<WorkerResponse | null>;

  acceptAgentSuccess: (
    tabId?: number | null,
    options?: {
      pendingStatus?: string;
      successStatus?: string;
    },
  ) => Promise<WorkerResponse | null>;

  rejectAgentSuccess: (
    args?: {
      tabId?: number | null;
      hint?: string;
    },
    options?: {
      pendingStatus?: string;
      successStatus?: string;
    },
  ) => Promise<WorkerResponse | null>;

  sendAgentHint: (
    args?: {
      tabId?: number | null;
      hint?: string;
    },
    options?: {
      pendingStatus?: string;
      successStatus?: string;
    },
  ) => Promise<WorkerResponse | null>;

  resetAgentSession: (
    tabId?: number | null,
    options?: {
      pendingStatus?: string;
      successStatus?: string;
    },
  ) => Promise<WorkerResponse | null>;
};

const AgentUXContext = createContext<AgentUXContextValue | null>(null);

async function resolveTabId(tabId?: number | null) {
  return typeof tabId === "number" ? tabId : getActiveTabId();
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error("No active tab.");
  }

  return tab.id;
}

export function AgentUXProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [eventLog, setEventLog] = useState<AgentEvent[]>([]);
  const [hint, setHint] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const { startRun, stopRun, acceptSuccess, sendHumanHint } = useAgentActions();

  useAgentEventStream({
    setEvents: setEventLog as React.Dispatch<React.SetStateAction<any[]>>,
    setStatus,
    setIsRunning,
  });

  const clearEventLog = useCallback(() => {
    setEventLog([]);
  }, []);

  const runAction = useCallback(
    async <T,>(
      label: Exclude<BusyAction, null>,
      fn: () => Promise<T>,
      options: {
        pendingStatus?: string;
        successStatus?: string;
        errorStatus?: string;
      } = {},
    ): Promise<T | null> => {
      try {
        setBusyAction(label);
        setError(null);

        if (options.pendingStatus) {
          setStatus(options.pendingStatus);
        }

        const result = await fn();

        if (options.successStatus) {
          setStatus(options.successStatus);
        }

        return result;
      } catch (err) {
        const message = getErrorMessage(err);
        setError(message);
        setStatus(options.errorStatus || message || "Something went wrong");
        return null;
      } finally {
        setBusyAction(null);
      }
    },
    [],
  );

  const startAgentRun = useCallback(
    async (
      request: StartAgentRequest,
      options: {
        clearEvents?: boolean;
        pendingStatus?: string;
        successStatus?: string;
      } = {},
    ) => {
      return runAction(
        "start",
        async () => {
          if (options.clearEvents ?? true) {
            setEventLog([]);
          }

          const response = await startRun(request);

          if (!response?.ok) {
            throw new Error(response?.error || "Failed to start agent.");
          }

          setIsRunning(true);
          return response;
        },
        {
          pendingStatus: options.pendingStatus || "Starting agent...",
          successStatus: options.successStatus || "Agent started.",
        },
      );
    },
    [runAction, startRun],
  );

  const stopAgentRun = useCallback(
    async (
      tabId?: number | null,
      options: {
        pendingStatus?: string;
        successStatus?: string;
      } = {},
    ) => {
      return runAction(
        "stop",
        async () => {
          const resolvedTabId = await resolveTabId(tabId);
          const response = await stopRun(resolvedTabId);

          if (!response?.ok) {
            throw new Error(response?.error || "Failed to request stop.");
          }

          return response;
        },
        {
          pendingStatus: options.pendingStatus || "Stop requested...",
          successStatus: options.successStatus || "Stop requested.",
        },
      );
    },
    [runAction, stopRun],
  );

  const acceptAgentSuccess = useCallback(
    async (
      tabId?: number | null,
      options: {
        pendingStatus?: string;
        successStatus?: string;
      } = {},
    ) => {
      return runAction(
        "acceptSuccess",
        async () => {
          const resolvedTabId = await resolveTabId(tabId);
          const response = await acceptSuccess(resolvedTabId);

          if (!response?.ok) {
            throw new Error(response?.error || "Failed to confirm success.");
          }

          setIsRunning(false);
          return response;
        },
        {
          pendingStatus: options.pendingStatus || "Confirming success...",
          successStatus: options.successStatus || "Success confirmed.",
        },
      );
    },
    [acceptSuccess, runAction],
  );

  const rejectAgentSuccess = useCallback(
    async (
      args: {
        tabId?: number | null;
        hint?: string;
      } = {},
      options: {
        pendingStatus?: string;
        successStatus?: string;
      } = {},
    ) => {
      return runAction(
        "rejectSuccess",
        async () => {
          const resolvedTabId = await resolveTabId(args.tabId);
          const response = await sendToWorker<WorkerResponse>({
            type: "WEBGPT_REJECT_SUCCESS",
            tabId: resolvedTabId,
            hint: args.hint ?? hint ?? "",
          });

          if (!response?.ok) {
            throw new Error(response?.error || "Failed to reject success.");
          }

          setHint("");
          setIsRunning(true);
          return response;
        },
        {
          pendingStatus:
            options.pendingStatus || "Rejecting success and resuming...",
          successStatus:
            options.successStatus || "Success rejected. Agent resumed.",
        },
      );
    },
    [hint, runAction],
  );

  const sendAgentHint = useCallback(
    async (
      args: {
        tabId?: number | null;
        hint?: string;
      } = {},
      options: {
        pendingStatus?: string;
        successStatus?: string;
      } = {},
    ) => {
      return runAction(
        "hint",
        async () => {
          const resolvedTabId = await resolveTabId(args.tabId);
          const response = await sendHumanHint(
            resolvedTabId,
            args.hint ?? hint ?? "",
          );

          if (!response?.ok) {
            throw new Error(response?.error || "Failed to send hint.");
          }

          setHint("");
          setIsRunning(true);
          return response;
        },
        {
          pendingStatus: options.pendingStatus || "Sending hint...",
          successStatus: options.successStatus || "Hint sent.",
        },
      );
    },
    [hint, runAction, sendHumanHint],
  );

  const resetAgentSession = useCallback(
    async (
      tabId?: number | null,
      options: {
        pendingStatus?: string;
        successStatus?: string;
      } = {},
    ) => {
      return runAction(
        "reset",
        async () => {
          const resolvedTabId = await resolveTabId(tabId);
          const response = await sendToWorker<WorkerResponse>({
            type: "WEBGPT_RESET_SESSION",
            tabId: resolvedTabId,
          });

          if (!response?.ok) {
            throw new Error(response?.error || "Failed to reset session.");
          }

          setEventLog([]);
          setHint("");
          setIsRunning(false);
          return response;
        },
        {
          pendingStatus: options.pendingStatus || "Resetting session...",
          successStatus: options.successStatus || "Session reset.",
        },
      );
    },
    [runAction],
  );

  const value = useMemo<AgentUXContextValue>(
    () => ({
      status,
      setStatus,
      error,
      setError,
      busyAction,
      setBusyAction,
      eventLog,
      setEventLog,
      clearEventLog,
      hint,
      setHint,
      isRunning,
      setIsRunning,
      runAction,
      startAgentRun,
      stopAgentRun,
      acceptAgentSuccess,
      rejectAgentSuccess,
      sendAgentHint,
      resetAgentSession,
    }),
    [
      status,
      error,
      busyAction,
      eventLog,
      clearEventLog,
      hint,
      isRunning,
      runAction,
      startAgentRun,
      stopAgentRun,
      acceptAgentSuccess,
      rejectAgentSuccess,
      sendAgentHint,
      resetAgentSession,
    ],
  );

  return (
    <AgentUXContext.Provider value={value}>{children}</AgentUXContext.Provider>
  );
}

export function useAgentUX() {
  const context = useContext(AgentUXContext);

  if (!context) {
    throw new Error("useAgentUX must be used within AgentUXProvider.");
  }

  return context;
}
