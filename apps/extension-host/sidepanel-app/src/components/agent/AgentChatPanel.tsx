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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useAgentUX } from "../../providers";
import type {
  ProfileAttachmentPayload,
  ProfileAttachmentRole,
} from "../../hooks/useAgentActions";

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
  actionCount?: number;
  executedActionCount?: number;
  noActions?: boolean;
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
  onStart: (
    submittedGoal?: string,
    profileAttachments?: ProfileAttachmentPayload[],
  ) => void;
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

type ExtractedItemView = {
  key?: string;
  text?: string;
  label?: string;
  nearbyText?: string;
  heading?: string;
  href?: string;
};

const PROFILE_ATTACHMENT_ACCEPT =
  ".txt,.md,.pdf,text/plain,text/markdown,text/x-markdown,application/pdf";
const MAX_PROFILE_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_PROFILE_ATTACHMENTS = 4;

type LocalProfileAttachment = ProfileAttachmentPayload & {
  localId: string;
};

function isAcceptedProfileAttachment(file: File) {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".pdf") ||
    type === "text/plain" ||
    type === "text/markdown" ||
    type === "text/x-markdown" ||
    type === "application/pdf"
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function inferProfileAttachmentRole(file: File): ProfileAttachmentRole {
  const name = file.name.toLowerCase();
  return name.includes("cover") || name.includes("letter")
    ? "cover_letter"
    : "resume";
}

function makeProfileAttachmentId(file: File) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${file.name}:${file.size}:${file.lastModified}:${Date.now()}`;
}

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
    return JSON.stringify(action, null, 2);
  } catch {
    return "Prepared the next browser action.";
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getExtractedItems(finalResult: AgentEvent["finalResult"]) {
  const structuredData = finalResult?.structuredData;

  if (!isObjectRecord(structuredData) || !Array.isArray(structuredData.items)) {
    return [];
  }

  return structuredData.items.map((item, index): ExtractedItemView => {
    if (isObjectRecord(item)) {
      return {
        key: textValue(item.key) || `item-${index + 1}`,
        text: textValue(item.text) || JSON.stringify(item, null, 2),
        label: textValue(item.label),
        nearbyText: textValue(item.nearbyText),
        heading: textValue(item.heading),
        href: textValue(item.href),
      };
    }

    return {
      key: `item-${index + 1}`,
      text: String(item ?? ""),
    };
  });
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
      if (event.nextCommandReason === "surface_handoff" || event.nextSurface) {
        return "Handoff";
      }
      return event.plannerStatus === "success" ? "Answer ready" : "Thinking";
    case "action_planned":
      return "Next action";
    case "execution_result":
      if (event.noActions) return "No actions";
      return event.ok ? "Action worked" : "Action failed";
    case "surface_handoff":
      return "Transition";
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
  const handoff =
    event.nextSurface && event.nextSurface !== event.commandSurface
      ? `\nHandoff: ${event.commandSurface || event.surface || "current"} -> ${
          event.nextSurface
        }${event.nextSurfaceContextId ? ` (${event.nextSurfaceContextId})` : ""}`
      : "";

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
      if (!event.reasoning && handoff) {
        return handoff.trim();
      }
      return `${event.reasoning || "The agent is deciding what to do next."}${handoff}`;
    case "action_planned":
      return summarizeAction(event.action);
    case "execution_result":
      if (event.noActions) {
        return event.summary || "No actions were executed.";
      }
      return (
        event.error ||
        event.summary ||
        (event.ok ? "Completed successfully." : "Did not complete.")
      );
    case "surface_handoff":
      return (
        event.message ||
        `Handoff: ${event.commandSurface || event.surface || "current"} -> ${
          event.nextSurface || event.nextCommandSurface || "next"
        }${
          event.nextSurfaceContextId ? ` (${event.nextSurfaceContextId})` : ""
        }`
      );
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

function getLatestConfirmationResult(events: AgentEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (
      event?.kind === "paused" &&
      event.reason === "awaiting_success_confirmation"
    ) {
      return event.finalResult || null;
    }
  }

  return null;
}

function ExtractedItemsDisclosure({ items }: { items: ExtractedItemView[] }) {
  if (!items.length) return null;

  return (
    <details className="extracted-items-disclosure">
      <summary className="extracted-items-summary">
        Extracted items ({items.length})
      </summary>
      <Stack gap={10} mt="xs">
        {items.map((item, index) => {
          const title =
            item.heading || item.label || item.nearbyText || `Item ${index + 1}`;
          const meta = [item.href, item.nearbyText]
            .filter(
              (value, itemIndex, values) =>
                value && values.indexOf(value) === itemIndex,
            )
            .join(" | ");

          return (
            <Box className="extracted-item" key={item.key || `${title}-${index}`}>
              <Text size="sm" fw={700} className="extracted-item-title">
                {title}
              </Text>
              {item.text ? (
                <Text size="sm" className="extracted-item-text">
                  {item.text}
                </Text>
              ) : null}
              {meta ? (
                <Text size="xs" c="dimmed" className="extracted-item-meta">
                  {meta}
                </Text>
              ) : null}
            </Box>
          );
        })}
      </Stack>
    </details>
  );
}

function isNearScrollBottom(viewport: HTMLDivElement | null) {
  if (!viewport) return true;

  const distanceFromBottom =
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  return distanceFromBottom <= 96;
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
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const profileAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const autoScrollInitializedRef = useRef(false);
  const autoFollowRef = useRef(true);
  const [submittedGoal, setSubmittedGoal] = useState("");
  const [draft, setDraft] = useState("");
  const [profileAttachments, setProfileAttachments] = useState<
    LocalProfileAttachment[]
  >([]);
  const [profileAttachmentError, setProfileAttachmentError] = useState("");
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
  const confirmationExtractedItems = useMemo(
    () => getExtractedItems(getLatestConfirmationResult(eventLog)),
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
  const profileAttachmentDisabled =
    composerLocked || awaitingUserInput || agentBusy || !allowFreeformStart;
  const tabContextKey = `${activeTabId ?? "none"}:${
    attachedTabId ?? session?.attachedTabId ?? "none"
  }`;
  const previousTabContextRef = useRef<string | null>(null);
  const handleScrollPositionChange = useCallback(() => {
    autoFollowRef.current = isNearScrollBottom(scrollViewportRef.current);
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    autoFollowRef.current = true;
    scrollAnchorRef.current?.scrollIntoView({
      block: "end",
      behavior,
    });
  }, []);

  const handleProfileAttachmentChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = "";
    setProfileAttachmentError("");

    if (!files.length) return;

    const acceptedFiles: File[] = [];
    const errors: string[] = [];

    for (const file of files) {
      if (!isAcceptedProfileAttachment(file)) {
        errors.push(`${file.name} must be .txt, .md, or .pdf.`);
        continue;
      }

      if (file.size > MAX_PROFILE_ATTACHMENT_BYTES) {
        errors.push(`${file.name} must be 4 MB or smaller.`);
        continue;
      }

      acceptedFiles.push(file);
    }

    const openSlots = Math.max(0, MAX_PROFILE_ATTACHMENTS - profileAttachments.length);
    const selectedFiles = acceptedFiles.slice(0, openSlots);

    if (acceptedFiles.length > openSlots) {
      errors.push(`You can attach up to ${MAX_PROFILE_ATTACHMENTS} files.`);
    }

    if (!selectedFiles.length) {
      setProfileAttachmentError(errors[0] || "No attachment was added.");
      return;
    }

    try {
      const nextAttachments = await Promise.all(
        selectedFiles.map(async (file) => ({
          localId: makeProfileAttachmentId(file),
          name: file.name,
          mimeType: file.type || "",
          size: file.size,
          role: inferProfileAttachmentRole(file),
          contentBase64: arrayBufferToBase64(await file.arrayBuffer()),
        })),
      );

      setProfileAttachments((current) => [...current, ...nextAttachments]);
      if (errors.length) setProfileAttachmentError(errors[0]);
    } catch (error) {
      setProfileAttachmentError(
        error instanceof Error ? error.message : "Could not read attachment.",
      );
    }
  };

  const removeProfileAttachment = (localId: string) => {
    setProfileAttachments((current) =>
      current.filter((attachment) => attachment.localId !== localId),
    );
  };

  const startProfileAttachmentPayload: ProfileAttachmentPayload[] =
    profileAttachments.map((attachment) => ({
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      role: attachment.role,
      contentBase64: attachment.contentBase64,
    }));

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
    onStart(submitted, startProfileAttachmentPayload);
    setDraft("");
    setGoal("");
    setProfileAttachments([]);
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
      onStart(submitted, startProfileAttachmentPayload);
      setDraft("");
      setGoal("");
      setProfileAttachments([]);
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

    if (!autoFollowRef.current) return;

    const animationFrame = window.requestAnimationFrame(() => {
      scrollToLatest();
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
    scrollToLatest,
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

        <ScrollArea
          className="chat-scroll"
          offsetScrollbars
          viewportRef={scrollViewportRef}
          onScrollPositionChange={handleScrollPositionChange}
        >
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
                  <ExtractedItemsDisclosure items={confirmationExtractedItems} />
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
          <input
            ref={profileAttachmentInputRef}
            className="profile-attachment-input"
            type="file"
            accept={PROFILE_ATTACHMENT_ACCEPT}
            multiple
            onChange={(event) => void handleProfileAttachmentChange(event)}
          />
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

          {allowFreeformStart && !awaitingUserInput ? (
            <Stack className="profile-attachments" gap={6}>
              <Group className="profile-attachment-row" gap={6} wrap="wrap">
                <Tooltip label="Add attachments">
                  <ActionIcon
                    aria-label="Add attachments"
                    className="profile-attachment-add"
                    size="sm"
                    variant="default"
                    radius="xl"
                    disabled={profileAttachmentDisabled}
                    onClick={() => profileAttachmentInputRef.current?.click()}
                  >
                    +
                  </ActionIcon>
                </Tooltip>

                {profileAttachments.map((attachment) => (
                  <Badge
                    key={attachment.localId}
                    className="profile-attachment-badge"
                    variant="light"
                    color="violet"
                    rightSection={
                      <button
                        className="profile-attachment-remove"
                        type="button"
                        disabled={profileAttachmentDisabled}
                        onClick={() => removeProfileAttachment(attachment.localId)}
                        aria-label={`Remove ${attachment.name}`}
                      >
                        X
                      </button>
                    }
                  >
                    {attachment.name}
                  </Badge>
                ))}
              </Group>

              {profileAttachmentError ? (
                <Text size="xs" c="red">
                  {profileAttachmentError}
                </Text>
              ) : null}
            </Stack>
          ) : null}

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
