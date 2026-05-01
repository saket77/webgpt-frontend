/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SavedArtifactInputSchemaItem,
  SavedArtifactSummary,
} from "./useSavedArtifacts";

type TemplateRunResult = {
  index?: number;
  inputLabel: string;
  inputValue: string;
  summary: string;
  finalResult: any;
};

type UseTemplateRunQueueArgs = {
  artifact: SavedArtifactSummary;
  agent: any;
};

const TERMINAL_EVENT_KINDS = new Set([
  "success_confirmed",
  "stopped_by_user",
  "fatal_error",
  "max_steps_reached",
  "session_reset",
]);

const QUEUE_ADVANCE_EVENT_KINDS = new Set([
  "success_confirmed",
]);

function getEventKey(event: any) {
  if (!event?.kind) return "";
  return `${event.kind}-${event.timestamp ?? ""}`;
}

function isTerminalEvent(event: any) {
  return TERMINAL_EVENT_KINDS.has(event?.kind);
}

function isQueueAdvanceEvent(event: any) {
  return QUEUE_ADVANCE_EVENT_KINDS.has(event?.kind);
}

function buildInitialInputValues(
  inputSchema: SavedArtifactInputSchemaItem[],
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const input of inputSchema || []) {
    result[input.key] = [""];
  }

  return result;
}

function buildSingleRunInputValues(
  inputSchema: SavedArtifactInputSchemaItem[],
  inputValues: Record<string, string[]>,
  index: number,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const input of inputSchema || []) {
    const values = inputValues[input.key] || [];
    result[input.key] = [values[index] || ""];
  }

  return result;
}

function buildGoalFromTemplate(
  goalTemplate: string,
  singleRunInputValues: Record<string, string[]>,
) {
  let goal = goalTemplate || "";

  for (const [key, values] of Object.entries(singleRunInputValues)) {
    const firstValue = Array.isArray(values) ? values[0] || "" : "";
    goal = goal.replaceAll(`{{${key}}}`, firstValue);
  }

  return goal;
}

function getTotalRunCount(
  inputSchema: SavedArtifactInputSchemaItem[],
  inputValues: Record<string, string[]>,
) {
  if ((inputSchema || []).length === 0) {
    return 1;
  }

  let maxCount = 1;

  for (const input of inputSchema || []) {
    const count = (inputValues[input.key] || []).length;
    maxCount = Math.max(maxCount, count || 1);
  }

  return maxCount;
}

export function useTemplateRunQueue({
  artifact,
  agent,
}: UseTemplateRunQueueArgs) {
  const {
    awaitingConfirmation,
    busyAction,
    handleAcceptSuccess: acceptAgentSuccess,
    handleRejectSuccess: rejectAgentSuccess,
    handleSendHint: sendAgentHint,
    handleStart: startAgent,
    handleStartTemplateQueue: startTemplateQueue,
    handleStop: stopAgent,
    isRunning,
    lastEvent,
    setError,
    setEventLog,
    setHint,
    setStatus,
  } = agent;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [queueMode, setQueueMode] = useState(false);
  const [templateResults, setTemplateResults] = useState<TemplateRunResult[]>(
    [],
  );
  const [pendingQueueStartEventKey, setPendingQueueStartEventKey] =
    useState("");

  const handledTerminalEventKeyRef = useRef("");
  const startedQueueStartEventKeyRef = useRef("");
  const handledTemplateEventKeyRef = useRef("");

  const [inputValues, setInputValues] = useState<Record<string, string[]>>(() =>
    buildInitialInputValues(artifact.inputSchema || []),
  );

  useEffect(() => {
    setInputValues(buildInitialInputValues(artifact.inputSchema || []));
    setEventLog([]);
    setError(null);
    setStatus("Template loaded.");
    setHint("");
    setCurrentIndex(0);
    setQueueMode(false);
    handledTerminalEventKeyRef.current = "";
    startedQueueStartEventKeyRef.current = "";
    handledTemplateEventKeyRef.current = "";
    setPendingQueueStartEventKey("");
    setTemplateResults([]);
  }, [artifact, setError, setEventLog, setHint, setStatus]);

  const totalRuns = useMemo(
    () => getTotalRunCount(artifact.inputSchema || [], inputValues),
    [artifact.inputSchema, inputValues],
  );

  const singleRunInputValues = useMemo(
    () =>
      buildSingleRunInputValues(
        artifact.inputSchema || [],
        inputValues,
        currentIndex,
      ),
    [artifact.inputSchema, inputValues, currentIndex],
  );

  const renderedGoal = useMemo(
    () => buildGoalFromTemplate(artifact.goal || "", singleRunInputValues),
    [artifact.goal, singleRunInputValues],
  );

  const canStart = useMemo(() => {
    if (isRunning) return false;
    if (!artifact.successfulReplayArtifactFileName) return false;

    return (artifact.inputSchema || []).every((input) => {
      if (!input.required) return true;
      const value = singleRunInputValues[input.key]?.[0] || "";
      return value.trim().length > 0;
    });
  }, [
    isRunning,
    artifact.successfulReplayArtifactFileName,
    artifact.inputSchema,
    singleRunInputValues,
  ]);

  const canMoveIndex =
    !isRunning && !awaitingConfirmation && busyAction == null;

  const handleInputChange = useCallback(
    (key: string, index: number, value: string) => {
      setInputValues((prev) => {
        const next = { ...prev };
        const currentValues = Array.isArray(next[key]) ? [...next[key]] : [""];
        currentValues[index] = value;
        next[key] = currentValues;
        return next;
      });
    },
    [],
  );

  const handleAddValue = useCallback((key: string) => {
    setInputValues((prev) => {
      const next = { ...prev };
      const currentValues = Array.isArray(next[key]) ? [...next[key]] : [];
      currentValues.push("");
      next[key] = currentValues;
      return next;
    });
  }, []);

  const handleRemoveValue = useCallback(
    (key: string, index: number) => {
      setInputValues((prev) => {
        const next = { ...prev };
        const currentValues = Array.isArray(next[key]) ? [...next[key]] : [""];

        if (currentValues.length <= 1) {
          next[key] = [""];
          return next;
        }

        currentValues.splice(index, 1);
        next[key] = currentValues;
        return next;
      });

      setCurrentIndex((prev) => {
        const nextTotal = Math.max(totalRuns - 1, 1);
        return Math.min(prev, nextTotal - 1);
      });
    },
    [totalRuns],
  );

  const handleStartCurrent = useCallback(async () => {
    const response = await startAgent({
      goal: renderedGoal,
      artifactFileName: artifact.successfulReplayArtifactFileName || null,
      inputValues: singleRunInputValues,
      isTemplate: true,
      options: {
        clearEvents: true,
        pendingStatus: `Starting run ${currentIndex + 1} of ${totalRuns}...`,
        successStatus: `Running ${currentIndex + 1} of ${totalRuns}...`,
      },
    });

    if (!response?.ok) {
      setQueueMode(false);
      setPendingQueueStartEventKey("");
      startedQueueStartEventKeyRef.current = "";
    }
  }, [
    startAgent,
    artifact.successfulReplayArtifactFileName,
    currentIndex,
    renderedGoal,
    singleRunInputValues,
    totalRuns,
  ]);

  const handleStartQueue = useCallback(async () => {
    const lastEventKey = isTerminalEvent(lastEvent)
      ? getEventKey(lastEvent)
      : "";

    if (lastEventKey) {
      handledTerminalEventKeyRef.current = lastEventKey;
    }

    startedQueueStartEventKeyRef.current = "";
    setPendingQueueStartEventKey("");
    setQueueMode(true);
    const response = await startTemplateQueue({
      goalTemplate: artifact.goal || "",
      inputSchema: artifact.inputSchema || [],
      inputValues,
      artifactFileName: artifact.successfulReplayArtifactFileName || null,
      options: {
        clearEvents: true,
        pendingStatus: `Starting template queue with ${totalRuns} run${
          totalRuns === 1 ? "" : "s"
        }...`,
        successStatus: "Template queue running...",
      },
    });

    if (!response?.ok) {
      setQueueMode(false);
    }
  }, [
    startTemplateQueue,
    lastEvent,
    artifact.goal,
    artifact.inputSchema,
    artifact.successfulReplayArtifactFileName,
    inputValues,
    totalRuns,
  ]);

  const handleAcceptSuccess = useCallback(async () => {
    const response = await acceptAgentSuccess();

    if (!response?.ok) {
      setQueueMode(false);
      return;
    }

    const firstInput = artifact.inputSchema?.[0];
    const inputLabel =
      firstInput?.label || firstInput?.key || `Run ${currentIndex + 1}`;
    const inputValue = singleRunInputValues[firstInput?.key || ""]?.[0] || "";

    const confirmed = (response?.result || {}) as {
      finalResult?: {
        summary?: string;
        structuredData?: unknown;
      } | null;
      summary?: string;
    };

    setTemplateResults((prev) => [
      ...prev,
      {
        inputLabel,
        inputValue,
        summary: confirmed?.finalResult?.summary || confirmed?.summary || "",
        finalResult: confirmed?.finalResult || null,
      },
    ]);

    setStatus("Success confirmed.");
  }, [
    acceptAgentSuccess,
    setStatus,
    artifact.inputSchema,
    currentIndex,
    singleRunInputValues,
  ]);

  const handleRejectSuccess = useCallback(async () => {
    setQueueMode(false);
    await rejectAgentSuccess();
  }, [rejectAgentSuccess]);

  const handleStop = useCallback(async () => {
    await stopAgent();
  }, [stopAgent]);

  const handleSendHint = useCallback(async () => {
    await sendAgentHint();
  }, [sendAgentHint]);

  useEffect(() => {
    if (!lastEvent) return;

    if (
      lastEvent.kind !== "template_item_started" &&
      lastEvent.kind !== "template_item_completed" &&
      lastEvent.kind !== "template_queue_finished"
    ) {
      return;
    }

    const eventKey = getEventKey(lastEvent);
    if (handledTemplateEventKeyRef.current === eventKey) {
      return;
    }

    handledTemplateEventKeyRef.current = eventKey;

    if (lastEvent.kind === "template_item_started") {
      const index = Number(lastEvent.item?.index);
      if (Number.isInteger(index)) {
        setCurrentIndex(index);
      }
      return;
    }

    if (lastEvent.kind === "template_item_completed") {
      const item = lastEvent.item || {};
      const index = Number(item.index);

      setTemplateResults((prev) => {
        if (
          Number.isInteger(index) &&
          prev.some((entry) => entry.index === index)
        ) {
          return prev;
        }

        return [
          ...prev,
          {
            index,
            inputLabel: item.inputLabel || `Run ${Number(index || 0) + 1}`,
            inputValue: item.inputValue || "",
            summary: item.summary || "",
            finalResult: item.finalResult || null,
          },
        ];
      });
      return;
    }

    setQueueMode(false);
    setPendingQueueStartEventKey("");
    startedQueueStartEventKeyRef.current = "";

    if (Array.isArray(lastEvent.results)) {
      setTemplateResults(
        lastEvent.results.map((item: any) => ({
          index: item.index,
          inputLabel: item.inputLabel || `Run ${Number(item.index || 0) + 1}`,
          inputValue: item.inputValue || "",
          summary: item.summary || "",
          finalResult: item.finalResult || null,
        })),
      );
    }
  }, [lastEvent]);

  useEffect(() => {
    if (!lastEvent) return;

    if (!isTerminalEvent(lastEvent)) {
      return;
    }

    const eventKey = getEventKey(lastEvent);

    if (handledTerminalEventKeyRef.current === eventKey) {
      return;
    }

    handledTerminalEventKeyRef.current = eventKey;

    if (lastEvent.kind === "stopped_by_user") {
      return;
    }

    if (
      lastEvent.kind === "fatal_error" ||
      lastEvent.kind === "session_reset"
    ) {
      setQueueMode(false);
      setPendingQueueStartEventKey("");
      startedQueueStartEventKeyRef.current = "";
      return;
    }

    if (!isQueueAdvanceEvent(lastEvent)) {
      return;
    }

    if (!queueMode) {
      return;
    }

    if (currentIndex >= totalRuns - 1) {
      setQueueMode(false);
      setPendingQueueStartEventKey("");
      startedQueueStartEventKeyRef.current = "";
      setStatus("Template queue finished.");
      return;
    }

    setPendingQueueStartEventKey(eventKey);
    setCurrentIndex((prev) => prev + 1);
  }, [lastEvent, queueMode, currentIndex, totalRuns, setStatus]);

  useEffect(() => {
    if (!pendingQueueStartEventKey) return;
    if (!queueMode) return;
    if (isRunning) return;
    if (awaitingConfirmation) return;
    if (busyAction) return;
    if (!canStart) return;

    if (
      !isQueueAdvanceEvent(lastEvent) ||
      getEventKey(lastEvent) !== pendingQueueStartEventKey
    ) {
      return;
    }

    if (startedQueueStartEventKeyRef.current === pendingQueueStartEventKey) {
      return;
    }

    startedQueueStartEventKeyRef.current = pendingQueueStartEventKey;
    setPendingQueueStartEventKey("");
    void handleStartCurrent();
  }, [
    pendingQueueStartEventKey,
    queueMode,
    isRunning,
    awaitingConfirmation,
    busyAction,
    canStart,
    lastEvent,
    handleStartCurrent,
  ]);

  return {
    currentIndex,
    setCurrentIndex,
    queueMode,
    templateResults,
    inputValues,
    totalRuns,
    singleRunInputValues,
    renderedGoal,
    canStart,
    canMoveIndex,
    handleInputChange,
    handleAddValue,
    handleRemoveValue,
    handleStartCurrent,
    handleStartQueue,
    handleAcceptSuccess,
    handleRejectSuccess,
    handleStop,
    handleSendHint,
  };
}
