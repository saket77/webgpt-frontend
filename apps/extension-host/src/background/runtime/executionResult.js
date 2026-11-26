function nestedActionFailures(execution) {
  const results = Array.isArray(execution?.results) ? execution.results : [];
  return results
    .map((entry) => entry?.result)
    .filter((result) => result && result.ok === false);
}

export function normalizeDomExecutionResult(execution, plannedActions) {
  if (!execution || typeof execution !== "object") return execution;

  if (Array.isArray(plannedActions) && Array.isArray(execution.results)) {
    // The page runner receives frame-local actions and returns them in order.
    // Restore the original frame IDs so the planner can match their receipts.
    const results = execution.results.map((entry, index) => {
      const planned = plannedActions[index];
      if (
        !Number.isInteger(planned?.frameId) ||
        !entry?.action ||
        entry.action.type !== planned.type ||
        entry.action.frameId != null
      ) {
        return entry;
      }
      return { ...entry, action: { ...entry.action, frameId: planned.frameId } };
    });
    execution = { ...execution, results };
  }

  const failures = nestedActionFailures(execution);
  if (!failures.length) return execution;

  const recoverable = failures.every(
    (result) => Boolean(result.recoverable || result.continueBatch),
  );
  const detail = failures
    .map((result) => result.error || result.detail || "")
    .find(Boolean);
  const currentSummary =
    typeof execution.summary === "string" ? execution.summary.trim() : "";
  const summary =
    currentSummary && currentSummary !== "All actions executed."
      ? currentSummary
      : recoverable
        ? `Actions executed with ${failures.length} recoverable connector failure(s).`
        : detail || "Action execution failed.";

  return {
    ...execution,
    ok: false,
    recoverable,
    summary,
    ...(detail ? { error: execution.error || detail } : {}),
  };
}
