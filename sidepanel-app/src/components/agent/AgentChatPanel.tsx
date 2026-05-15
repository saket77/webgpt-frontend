import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Collapse,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from "@mantine/core";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useAgentUX } from "../../providers";

type AgentEvent = {
  kind: string;
  timestamp?: number;
  message?: string;
  summary?: string;
  finalResult?: {
    summary?: string;
    structuredData?: unknown;
  } | null;
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
};

type AgentSession = {
  attachedTabId?: number;
  running?: boolean;
  awaitingNavigation?: boolean;
  pausedReason?: string | null;
  stopRequested?: boolean;
  step?: number;
  pendingStep?: number | null;
  goal?: string;
};

type AgentChatPanelProps = {
  goal: string;
  setGoal: (value: string) => void;
  activeTabId: number | null;
  attachedTabId: number | null;
  session: AgentSession | null;
  isRunning: boolean;
  isAwaitingNavigation: boolean;
  awaitingConfirmation: boolean;
  awaitingHumanHint: boolean;
  canStart: boolean;
  canStop: boolean;
  canReset: boolean;
  title?: string;
  subtitle?: string;
  preActivity?: ReactNode;
  postActivity?: ReactNode;
  showSessionGoal?: boolean;
  allowFreeformStart?: boolean;
  autoScrollOnMount?: boolean;
  showEmptySuggestions?: boolean;
  onStart: (submittedGoal?: string) => void;
  onStop: () => void;
  onReset: () => void;
  onSendHint: () => void;
  onAcceptSuccess: () => void;
  onRejectSuccess: () => void;
};

type StepGroup = {
  id: string;
  step: number | null;
  events: AgentEvent[];
};

function formatTimestamp(timestamp?: number) {
  if (!timestamp) return "";

  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function summarizeAction(action: unknown) {
  if (!action) return "Prepared the next browser action.";

  if (typeof action === "string") return action;

  try {
    const text = JSON.stringify(action);
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
  } catch {
    return "Prepared the next browser action.";
  }
}

function eventTone(event: AgentEvent) {
  if (["fatal_error", "max_steps_reached"].includes(event.kind)) return "bad";
  if (["success_confirmed", "success_rejected", "paused"].includes(event.kind)) {
    return "bright";
  }
  if (event.kind === "execution_result" && event.ok === false) return "bad";
  if (event.kind === "human_hint") return "bright";
  return "muted";
}

function eventTitle(event: AgentEvent) {
  switch (event.kind) {
    case "loop_started":
      return "Started";
    case "loop_resumed":
      return "Resumed";
    case "step_started":
      return `Step ${event.step ?? ""}`;
    case "state_extracted":
      return "Read page";
    case "planner_output":
      return event.plannerStatus === "success" ? "Answer ready" : "Thinking";
    case "action_planned":
      return "Next action";
    case "execution_result":
      return event.ok ? "Action worked" : "Action failed";
    case "awaiting_navigation":
      return "Waiting for page";
    case "navigation_completed":
      return "Page loaded";
    case "navigation_resume_blocked":
      return "Resume blocked";
    case "stop_requested":
      return "Stopping";
    case "stopped_by_user":
      return "Stopped";
    case "paused":
      return "Needs review";
    case "human_hint":
      return "Your hint";
    case "success_confirmed":
      return "Saved";
    case "success_rejected":
      return "Continuing";
    case "session_reset":
      return "Session reset";
    case "session_attached":
      return "Attached";
    case "session_detached":
      return "Moved";
    case "fatal_error":
      return "Error";
    case "max_steps_reached":
      return "Step limit reached";
    default:
      return event.kind.replaceAll("_", " ");
  }
}

function eventBody(event: AgentEvent) {
  switch (event.kind) {
    case "loop_started":
    case "loop_resumed":
    case "stopped_by_user":
    case "navigation_resume_blocked":
      return event.message || "";
    case "state_extracted": {
      const pieces = [
        event.url,
        typeof event.controlsCount === "number"
          ? `${event.controlsCount} controls`
          : null,
        typeof event.frameCount === "number" ? `${event.frameCount} frames` : null,
      ].filter(Boolean);
      return pieces.join(" | ");
    }
    case "planner_output":
      return event.reasoning || "The agent is deciding what to do next.";
    case "action_planned":
      return summarizeAction(event.action);
    case "execution_result":
      return event.error || (event.ok ? "Completed successfully." : "Did not complete.");
    case "awaiting_navigation":
    case "navigation_completed":
      return event.url || "";
    case "paused":
      if (event.reason === "awaiting_success_confirmation") {
        return (
          event.finalResult?.summary ||
          event.summary ||
          event.message ||
          "WebGPT thinks the task is complete. Confirm it or add a correction."
        );
      }
      return event.message || event.reason || "";
    case "human_hint":
      return event.hint || event.message || "";
    case "success_confirmed":
      return "Successful artifacts were saved for replay.";
    case "success_rejected":
      return event.hint || "WebGPT will keep working.";
    case "fatal_error":
      return event.error || "Something went wrong.";
    case "max_steps_reached":
      return "The run stopped because it hit the step limit.";
    default:
      return event.message || "";
  }
}

function groupEvents(events: AgentEvent[]) {
  const groups: StepGroup[] = [];

  events.forEach((event, index) => {
    const step = typeof event.step === "number" ? event.step : null;
    const startsNewStep = event.kind === "step_started" || groups.length === 0;

    if (startsNewStep) {
      groups.push({
        id: `${step ?? "intro"}-${event.timestamp ?? index}-${index}`,
        step,
        events: [event],
      });
      return;
    }

    groups[groups.length - 1]?.events.push(event);
  });

  return groups;
}

function getLatestConfirmationSummary(events: AgentEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (
      event?.kind === "paused" &&
      event.reason === "awaiting_success_confirmation"
    ) {
      return (
        event.finalResult?.summary ||
        event.summary ||
        event.message ||
        "Review the result and choose whether WebGPT should save it."
      );
    }
  }

  return "Review the result and choose whether WebGPT should save it.";
}

function StepActivity({
  group,
  active,
}: {
  group: StepGroup;
  active: boolean;
}) {
  const [manuallyOpened, setManuallyOpened] = useState(false);
  const opened = active || manuallyOpened;
  const latestEvent = group.events[group.events.length - 1];
  const title = group.step == null ? "Session" : `Step ${group.step}`;
  const latestBody = latestEvent ? eventBody(latestEvent) : "";

  return (
    <Paper className="activity-step" withBorder>
      <button
        className="activity-step-header"
        type="button"
        onClick={() => {
          if (!active) setManuallyOpened((value) => !value);
        }}
      >
        <span>
          <Text fw={700} size="sm" c={active ? "var(--wg-ink)" : "dimmed"}>
            {title}
          </Text>
          {!opened && latestBody ? (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {latestBody}
            </Text>
          ) : null}
        </span>
        <Badge
          size="xs"
          variant={active ? "filled" : "light"}
          color={active ? "violet" : "gray"}
        >
          {active ? "Live" : `${group.events.length}`}
        </Badge>
      </button>

      <Collapse in={opened}>
        <Stack gap={10} px="md" pb="md">
          {group.events.map((event, index) => {
            const tone = eventTone(event);
            const body = eventBody(event);

            return (
              <Box
                className={`activity-event activity-event-${tone}`}
                key={`${event.kind}-${event.timestamp ?? index}-${index}`}
              >
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="sm" fw={tone === "muted" ? 500 : 700}>
                    {eventTitle(event)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {formatTimestamp(event.timestamp)}
                  </Text>
                </Group>
                {body ? (
                  <Text size="sm" className="activity-event-body">
                    {body}
                  </Text>
                ) : null}
              </Box>
            );
          })}
        </Stack>
      </Collapse>
    </Paper>
  );
}

export function AgentChatPanel({
  goal,
  setGoal,
  activeTabId,
  attachedTabId,
  session,
  isRunning,
  isAwaitingNavigation,
  awaitingConfirmation,
  awaitingHumanHint,
  canStart,
  canStop,
  canReset,
  title = "WebGPT",
  subtitle,
  preActivity,
  postActivity,
  showSessionGoal = true,
  allowFreeformStart = true,
  autoScrollOnMount = true,
  showEmptySuggestions = true,
  onStart,
  onStop,
  onReset,
  onSendHint,
  onAcceptSuccess,
  onRejectSuccess,
}: AgentChatPanelProps) {
  const { eventLog, hint, setHint, status, busyAction } = useAgentUX();
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const autoScrollInitializedRef = useRef(false);
  const [submittedGoal, setSubmittedGoal] = useState("");
  const [draft, setDraft] = useState("");
  const groupedEvents = useMemo(() => groupEvents(eventLog), [eventLog]);
  const awaitingUserInput = awaitingConfirmation || awaitingHumanHint;
  const agentBusy = isRunning || isAwaitingNavigation || busyAction === "start";
  const composerLocked =
    !awaitingUserInput && (agentBusy || !allowFreeformStart);
  const activityIsLive =
    isRunning || isAwaitingNavigation || awaitingHumanHint || awaitingConfirmation;
  const confirmationSummary = useMemo(
    () => getLatestConfirmationSummary(eventLog),
    [eventLog],
  );
  const runControlsVisible = isRunning || isAwaitingNavigation || busyAction === "start";
  const visibleGoal =
    submittedGoal ||
    (showSessionGoal && eventLog.length > 0 ? session?.goal || "" : "");
  const composerValue = awaitingUserInput ? hint : draft;
  const composerPlaceholder = awaitingUserInput
    ? "Add a hint, correction, or instruction for WebGPT..."
    : agentBusy
    ? "WebGPT is working..."
    : !allowFreeformStart
    ? "Start this routine from the controls above..."
    : "Ask WebGPT to do something in the current tab...";
  const hasHint = hint.trim().length > 0;
  const canSendHint = awaitingUserInput && hasHint && busyAction !== "hint";
  const primaryLabel = awaitingUserInput ? "Send" : "Start";
  const primaryDisabled = composerLocked
    ? true
    : awaitingUserInput ? !canSendHint : !canStart;
  const primaryLoading =
    busyAction === "start" ||
    busyAction === "hint";
  const tabContextKey = `${activeTabId ?? "none"}:${
    attachedTabId ?? session?.attachedTabId ?? "none"
  }`;
  const previousTabContextRef = useRef<string | null>(null);

  const handlePrimaryAction = () => {
    if (composerLocked) return;

    if (awaitingUserInput) {
      if (hasHint) {
        onSendHint();
        return;
      }
      return;
    }

    const submitted = draft.trim() || goal.trim();
    setSubmittedGoal(submitted);
    onStart(submitted);
    setDraft("");
    setGoal("");
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();

    if (composerLocked) return;

    if (awaitingUserInput) {
      if (hasHint && canSendHint) onSendHint();
      return;
    }

    if (canStart) {
      const submitted = draft.trim() || goal.trim();
      setSubmittedGoal(submitted);
      onStart(submitted);
      setDraft("");
      setGoal("");
    }
  };

  useEffect(() => {
    if (previousTabContextRef.current === null) {
      previousTabContextRef.current = tabContextKey;
      return;
    }

    if (previousTabContextRef.current === tabContextKey) return;

    previousTabContextRef.current = tabContextKey;
    const nextGoal = session?.goal || "";
    setSubmittedGoal(nextGoal);
    setDraft("");
    if (!nextGoal) setGoal("");
  }, [session?.goal, setGoal, tabContextKey]);

  useEffect(() => {
    if (!autoScrollInitializedRef.current) {
      autoScrollInitializedRef.current = true;

      if (!autoScrollOnMount) return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      scrollAnchorRef.current?.scrollIntoView({
        block: "end",
        behavior: "smooth",
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [
    eventLog.length,
    awaitingConfirmation,
    awaitingHumanHint,
    isRunning,
    isAwaitingNavigation,
    autoScrollOnMount,
    visibleGoal,
  ]);

  return (
    <Paper className="chat-surface" withBorder>
      <Stack className="chat-layout" gap={0}>
        <Group className="chat-toolbar" justify="space-between" wrap="nowrap">
          <Box>
            <Text fw={700} size="sm" c="dimmed">
              {subtitle || status || title}
            </Text>
          </Box>
        </Group>

        <ScrollArea className="chat-scroll" offsetScrollbars>
          <Stack gap="md" p="md">
            {preActivity}

            {visibleGoal ? (
              <Paper className="user-message">
                <Text size="md" fw={520}>
                  {visibleGoal}
                </Text>
              </Paper>
            ) : null}

            {showEmptySuggestions && eventLog.length === 0 && !visibleGoal ? (
              <Stack className="empty-state" gap="sm">
                <Text fw={800}>Try asking</Text>
                <Button
                  variant="light"
                  color="violet"
                  radius="xl"
                  onClick={() => {
                    const suggestion =
                      "Summarize this page and identify the next best action.";
                    setDraft(suggestion);
                    setGoal(suggestion);
                  }}
                >
                  Summarize and analyze this page
                </Button>
                <Button
                  variant="subtle"
                  color="gray"
                  radius="xl"
                  onClick={() => {
                    const suggestion =
                      "Find the best option on this page and explain why.";
                    setDraft(suggestion);
                    setGoal(suggestion);
                  }}
                >
                  Find the best option
                </Button>
              </Stack>
            ) : eventLog.length > 0 ? (
              groupedEvents.map((group, index) => (
                <StepActivity
                  key={group.id}
                  group={group}
                  active={activityIsLive && index === groupedEvents.length - 1}
                />
              ))
            ) : null}

            {awaitingConfirmation ? (
              <Paper className="confirmation-panel" withBorder>
                <Stack gap="sm">
                  <Text fw={800}>{confirmationSummary}</Text>
                  <Text size="sm" c="dimmed">
                    Accept if this is correct, or reject it with a hint in the
                    composer.
                  </Text>
                  <Group grow>
                    <Button
                      color="green"
                      radius="xl"
                      onClick={onAcceptSuccess}
                      loading={busyAction === "acceptSuccess"}
                    >
                      Accept
                    </Button>
                    <Button
                      color="red"
                      variant="light"
                      radius="xl"
                      onClick={onRejectSuccess}
                      loading={busyAction === "rejectSuccess"}
                    >
                      Reject
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            ) : null}

            {postActivity}

            <div ref={scrollAnchorRef} />
          </Stack>
        </ScrollArea>

        <Box className="composer-wrap">
          <Textarea
            className="composer-input"
            autosize
            minRows={1}
            maxRows={5}
            disabled={composerLocked}
            value={composerValue}
            onChange={(event) => {
              if (composerLocked) return;

              if (awaitingUserInput) {
                setHint(event.currentTarget.value);
                return;
              }

              setDraft(event.currentTarget.value);
              setGoal(event.currentTarget.value);
            }}
            onKeyDown={handleComposerKeyDown}
            placeholder={composerPlaceholder}
          />

          <Group justify="space-between" mt={10} wrap="nowrap">
            <Group gap={6} wrap="nowrap">
              {runControlsVisible ? (
                <Button
                  radius="xl"
                  color="red"
                  variant="light"
                  disabled={!canStop}
                  loading={busyAction === "stop"}
                  onClick={onStop}
                >
                  Stop
                </Button>
              ) : null}
              <Tooltip label="Reset session">
                <ActionIcon
                  variant="subtle"
                  color="red"
                  radius="xl"
                  disabled={!canReset}
                  loading={busyAction === "reset"}
                  onClick={() => {
                    setSubmittedGoal("");
                    onReset();
                  }}
                  aria-label="Reset session"
                >
                  X
                </ActionIcon>
              </Tooltip>
            </Group>

            <Group gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed" lineClamp={1}>
                Tab{" "}
                {attachedTabId ??
                  session?.attachedTabId ??
                  activeTabId ??
                  "unknown"}
              </Text>
              <Button
                radius="xl"
                color="violet"
                variant="filled"
                disabled={primaryDisabled}
                loading={primaryLoading}
                onClick={handlePrimaryAction}
              >
                {primaryLabel}
              </Button>
            </Group>
          </Group>
        </Box>
      </Stack>
    </Paper>
  );
}
