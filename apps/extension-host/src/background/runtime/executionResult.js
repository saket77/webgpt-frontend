function nestedActionFailures(execution) {
  const results = Array.isArray(execution?.results) ? execution.results : [];
  return results
    .map((entry) => entry?.result)
    .filter((result) => result && result.ok === false);
}

export function normalizeDomExecutionResult(execution) {
  if (!execution || typeof execution !== "object") return execution;

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
