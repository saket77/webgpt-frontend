import { Card, Stack, Text } from "@mantine/core";
import { useMemo } from "react";
import { useAgentUX } from "../../providers";
import { summarizeEvent } from "./EventLogCard";

type AgentEvent = {
  kind: string;
  step?: number;
  reason?: string;
  url?: string;
};

type AgentSession = {
  attachedTabId?: number;
  running?: boolean;
  awaitingNavigation?: boolean;
  pausedReason?: string | null;
  stopRequested?: boolean;
  step?: number;
  pendingStep?: number | null;
};

type CurrentStepCardProps = {
  activeTabId: number | null;
  attachedTabId: number | null;
  session: AgentSession | null;
};

function deriveEffectiveSessionState(
  session: AgentSession | null,
  lastEvent: AgentEvent | null,
) {
  let isRunning = Boolean(session?.running);
  let isAwaitingNavigation = Boolean(session?.awaitingNavigation);
  let pausedReason = session?.pausedReason || null;

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
      ].includes(lastEvent.kind)
    ) {
      isRunning = true;
      isAwaitingNavigation = false;
      pausedReason = null;
    }

    if (lastEvent.kind === "awaiting_navigation") {
      isRunning = false;
      isAwaitingNavigation = true;
      pausedReason = null;
    }

    if (lastEvent.kind === "paused") {
      isRunning = false;
      isAwaitingNavigation = false;
      pausedReason = lastEvent.reason || "paused";
    }

    if (lastEvent.kind === "stopped_by_user") {
      isRunning = false;
      isAwaitingNavigation = false;
      pausedReason = "forced_stop";
    }

    if (
      [
        "success_confirmed",
        "session_reset",
        "fatal_error",
        "max_steps_reached",
      ].includes(lastEvent.kind)
    ) {
      isRunning = false;
      isAwaitingNavigation = false;
      pausedReason = null;
    }
  }

  return {
    isRunning,
    isAwaitingNavigation,
    pausedReason,
  };
}

export function CurrentStepCard({
  activeTabId,
  attachedTabId,
  session,
}: CurrentStepCardProps) {
  const { eventLog } = useAgentUX();

  const lastEvent = eventLog[eventLog.length - 1] || null;

  const latestStepText = useMemo(() => {
    if (!lastEvent) return "Not started";
    return summarizeEvent(lastEvent);
  }, [lastEvent]);

  const { isRunning, isAwaitingNavigation, pausedReason } = useMemo(
    () => deriveEffectiveSessionState(session, lastEvent),
    [session, lastEvent],
  );

  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="xs">
        <Text fw={700}>Current Step</Text>

        <Text>{latestStepText}</Text>

        <Text size="sm" c="dimmed">
          Active tab: {activeTabId ?? "unknown"}
        </Text>

        <Text size="sm" c="dimmed">
          Attached tab: {attachedTabId ?? session?.attachedTabId ?? "unknown"}
        </Text>

        <Text size="sm" c="dimmed">
          Running: {isRunning ? "yes" : "no"}
        </Text>

        <Text size="sm" c="dimmed">
          Awaiting navigation: {isAwaitingNavigation ? "yes" : "no"}
        </Text>

        <Text size="sm" c="dimmed">
          Paused reason: {pausedReason || "none"}
        </Text>

        <Text size="sm" c="dimmed">
          Stop requested: {session?.stopRequested ? "yes" : "no"}
        </Text>
      </Stack>
    </Card>
  );
}
