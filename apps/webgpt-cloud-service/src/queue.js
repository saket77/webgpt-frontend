import { runIpoGmpDailyDeterministic } from "./deterministic/ipoGmpDaily.js";

function parseRequest(row) {
  try {
    return JSON.parse(row.request_json);
  } catch {
    return {};
  }
}

function nonOkError(result) {
  const status = result?.status ? ` (${result.status})` : "";
  return new Error(`Cloud run returned a non-ok result${status}.`);
}

function progressMessageFromEvent(event = {}) {
  return (
    event.message ||
    event.summary ||
    event.error ||
    event.reason ||
    event.kind ||
    "Cloud runtime progress updated."
  );
}

function shouldTryIpoGmpDailyDeterministic(request = {}) {
  return (
    request.type === "supported_workflow" &&
    request.templateId === "ipo_gmp_daily" &&
    request.strategy === "deterministic_then_browserbase"
  );
}

export function createCloudRunQueue({
  store,
  runner,
  config,
  logStream = process.stderr,
  deterministicRunners = {
    ipo_gmp_daily: runIpoGmpDailyDeterministic,
  },
} = {}) {
  if (!store) throw new Error("createCloudRunQueue requires store.");
  if (typeof runner !== "function") {
    throw new Error("createCloudRunQueue requires runner.");
  }

  let active = false;
  let closed = false;

  async function runOne(row) {
    store.markRunning(row.id);
    const request = parseRequest(row);

    try {
      if (shouldTryIpoGmpDailyDeterministic(request)) {
        store.recordProgressEvent(row.id, {
          kind: "deterministic_starting",
          message: "Trying deterministic IPO GMP workflow.",
          event: {
            templateId: request.templateId,
            strategy: request.strategy,
            filters: request.filters || {},
          },
        });

        try {
          const deterministicResult = await deterministicRunners.ipo_gmp_daily({
            workflow: request,
          });
          if (deterministicResult?.ok) {
            store.recordProgressEvent(row.id, {
              kind: "deterministic_completed",
              message: deterministicResult.summary || "Deterministic IPO GMP workflow completed.",
              event: {
                matchedRows: deterministicResult.finalResult?.matchedRows ?? null,
                totalRowsRead: deterministicResult.finalResult?.totalRowsRead ?? null,
              },
            });
            store.markCompleted(row.id, deterministicResult);
            return;
          }

          throw nonOkError(deterministicResult);
        } catch (error) {
          store.recordProgressEvent(row.id, {
            kind: "deterministic_failed_browserbase_fallback",
            message: `Deterministic IPO GMP workflow failed; falling back to Browserbase: ${
              error?.message || String(error)
            }`,
            event: {
              error: error?.message || String(error),
            },
          });
        }
      }

      store.recordProgressEvent(row.id, {
        kind: "browserbase_starting",
        message: "Starting Browserbase session.",
      });

      const result = await runner({
        url: row.url,
        goal: row.goal,
        backend: config.backend,
        projectId: config.projectId,
        autoConfirm: request.autoConfirm,
        logsDir: config.logsDir,
        timeoutMs: request.timeoutMs || config.timeoutMs,
        logStream,
        onEvent(event) {
          store.recordProgressEvent(row.id, {
            kind: event.kind || "event",
            message: progressMessageFromEvent(event),
            event,
            createdAt: event.timestamp || undefined,
          });
        },
        onEventLogReady(eventLog) {
          store.markEventLogReady(row.id, eventLog);
        },
        onSessionReady(session) {
          store.markSessionReady(row.id, session);
        },
      });

      if (result?.ok) {
        store.markCompleted(row.id, result);
      } else {
        store.markFailed(row.id, nonOkError(result), result);
      }
    } catch (error) {
      store.markFailed(row.id, error);
    }
  }

  async function pump() {
    if (active || closed) return;
    active = true;

    try {
      while (!closed) {
        const row = store.getNextQueuedRun();
        if (!row) break;
        await runOne(row);
      }
    } finally {
      active = false;
      if (!closed && store.hasQueuedRuns()) {
        queueMicrotask(() => {
          void pump();
        });
      }
    }
  }

  return {
    enqueue() {
      queueMicrotask(() => {
        void pump();
      });
    },
    start() {
      this.enqueue();
    },
    close() {
      closed = true;
    },
    get active() {
      return active;
    },
  };
}
