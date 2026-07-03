/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect } from "react";
declare const chrome: any;

type AgentEvent = {
  kind: string;
  timestamp?: number;
  message?: string;
  step?: number;
  url?: string;
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

type UseAgentEventStreamArgs = {
  setEvents: React.Dispatch<React.SetStateAction<AgentEvent[]>>;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  setIsRunning?: React.Dispatch<React.SetStateAction<boolean>>;
};

export function useAgentEventStream({
  setEvents,
  setStatus,
  setIsRunning,
}: UseAgentEventStreamArgs) {
  useEffect(() => {
    function onMessage(message: any) {
      if (!message || typeof message !== "object") return;

      if (message.type === "WEBGPT_AGENT_EVENT") {
        const event = message.event;
        if (!event) return;

        setEvents((prev) => [...prev, event]);

        if (event.message) {
          setStatus(event.message);
        }

        if (
          event.kind === "loop_started" ||
          event.kind === "loop_resumed" ||
          event.kind === "step_started" ||
          event.kind === "state_extracted" ||
          event.kind === "planner_output" ||
          event.kind === "action_planned" ||
          event.kind === "execution_result" ||
          event.kind === "navigation_completed" ||
          event.kind === "success_rejected" ||
          event.kind === "template_queue_started" ||
          event.kind === "template_item_started"
        ) {
          setIsRunning?.(true);
        }

        if (
          event.kind === "paused" ||
          event.kind === "awaiting_navigation" ||
          event.kind === "stopped_by_user" ||
          event.kind === "success_confirmed" ||
          event.kind === "template_queue_finished" ||
          event.kind === "fatal_error" ||
          event.kind === "max_steps_reached" ||
          event.kind === "session_reset"
        ) {
          setIsRunning?.(false);
        }
      }

      if (message.type === "WEBGPT_AGENT_STATUS") {
        setStatus(String(message.status || ""));
      }
    }

    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, [setEvents, setStatus, setIsRunning]);
}
