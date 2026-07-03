/* eslint-disable react-refresh/only-export-components */
import { Card, ScrollArea, Stack, Text } from "@mantine/core";
import { useAgentUX } from "../../providers";

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
  surface?: string;
  commandSurface?: string;
  nextSurface?: string;
  nextSurfaceContextId?: string;
  nextCommandType?: string;
  nextCommandSurface?: string;
  nextCommandReason?: string;
  reasoning?: string;
  action?: unknown;
  ok?: boolean;
  error?: string;
  reason?: string;
  hint?: string;
  fromTabId?: number;
  toTabId?: number;
};

function formatTimestamp(timestamp?: number) {
  if (!timestamp) return "";
  try {
    return new Date(timestamp).toLocaleTimeString();
  } catch {
    return "";
  }
}

export function summarizeEvent(event: AgentEvent) {
  const ts = formatTimestamp(event.timestamp);
  const frameSuffix =
    typeof event.frameId === "number" ? ` | frame=${event.frameId}` : "";
  const primaryFrameSuffix =
    typeof event.primaryFrameId === "number"
      ? ` | primaryFrame=${event.primaryFrameId}`
      : "";
  const frameCountSuffix =
    typeof event.frameCount === "number" ? ` | frames=${event.frameCount}` : "";
  const surfaceSuffix = event.surface ? ` | surface=${event.surface}` : "";
  const handoffSuffix = event.nextSurface
    ? ` | handoff=${event.commandSurface || event.surface || "current"}->${
        event.nextSurface
      }${event.nextSurfaceContextId ? ` context=${event.nextSurfaceContextId}` : ""}`
    : "";

  switch (event.kind) {
    case "loop_started":
      return `[${ts}] Loop started: ${event.message ?? ""}`;
    case "loop_resumed":
      return `[${ts}] Loop resumed: ${event.message ?? ""}`;
    case "step_started":
      return `[${ts}] Step ${event.step} started${surfaceSuffix}`;
    case "state_extracted":
      return `[${ts}] State extracted${surfaceSuffix} on ${event.url ?? ""} (${event.controlsCount ?? 0} controls${frameCountSuffix}${primaryFrameSuffix})`;
    case "planner_output":
      return `[${ts}] Planner${surfaceSuffix} → status=${event.plannerStatus || "continue"}${handoffSuffix} | ${event.reasoning || ""}`;
    case "action_planned":
      return `[${ts}] Action planned${frameSuffix} → ${JSON.stringify(event.action)}`;
    case "execution_result":
      return `[${ts}] Execution ${event.ok ? "succeeded" : "failed"}${surfaceSuffix}${frameSuffix}${handoffSuffix}${event.error ? ` | ${event.error}` : ""}`;
    case "awaiting_navigation":
      return `[${ts}] Waiting for navigation${frameSuffix}${event.url ? ` → ${event.url}` : "..."}`;
    case "navigation_completed":
      return `[${ts}] Navigation completed → ${event.url || ""}`;
    case "navigation_resume_blocked":
      return `[${ts}] Navigation resume blocked${event.message ? ` | ${event.message}` : ""}`;
    case "stop_requested":
      return `[${ts}] Stop requested`;
    case "stopped_by_user":
      return `[${ts}] Stopped by user${event.message ? ` → ${event.message}` : ""}`;
    case "paused":
      return `[${ts}] Paused → ${event.reason || ""}${event.message ? ` | ${event.message}` : ""}`;
    case "human_hint":
      return `[${ts}] Human input provided${event.message ? ` → ${event.message}` : ""}`;
    case "success_confirmed":
      return `[${ts}] Success confirmed; artifacts saved`;
    case "success_rejected":
      return `[${ts}] Success rejected${event.hint ? ` → ${event.hint}` : ""}`;
    case "max_steps_reached":
      return `[${ts}] Max steps reached`;
    case "fatal_error":
      return `[${ts}] Fatal error → ${event.error || "Unknown error"}`;
    case "session_reset":
      return `[${ts}] Session reset`;
    case "session_attached":
      return `[${ts}] Session attached${event.fromTabId ? ` from tab ${event.fromTabId}` : ""}`;
    case "session_detached":
      return `[${ts}] Session detached${event.toTabId ? ` to tab ${event.toTabId}` : ""}`;
    default:
      return `[${ts}] ${event.kind || "event"} ${JSON.stringify(event)}`;
  }
}

export function EventLogCard() {
  const { eventLog } = useAgentUX();

  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Text fw={700}>Event Log</Text>

        <ScrollArea h={360} offsetScrollbars>
          <Stack gap={6}>
            {eventLog.length === 0 ? (
              <Text size="sm" c="dimmed">
                No events yet.
              </Text>
            ) : (
              eventLog.map((event, index) => (
                <Text
                  key={`${event.kind}-${event.timestamp ?? index}-${index}`}
                  ff="monospace"
                  size="xs"
                >
                  {summarizeEvent(event as AgentEvent)}
                </Text>
              ))
            )}
          </Stack>
        </ScrollArea>
      </Stack>
    </Card>
  );
}
