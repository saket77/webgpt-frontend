const DEFAULT_BACKEND_BASE_URL = "https://webgpt-backend-production.up.railway.app";
export const PLANNER_CONTEXT_SCHEMA_VERSION = "webgpt.planner-context.v1";

export const PLANNER_CONTEXT_ERROR_CODES = Object.freeze({
  ABORTED: "WEBGPT_PLANNER_CONTEXT_ABORTED",
  HTTP: "WEBGPT_PLANNER_CONTEXT_HTTP_ERROR",
  NETWORK: "WEBGPT_PLANNER_CONTEXT_NETWORK_ERROR",
  SCHEMA: "WEBGPT_PLANNER_CONTEXT_SCHEMA_ERROR",
});

export class WebGptPlannerContextError extends Error {
  constructor(message, { code, phase = "", status, backendCode, cause } = {}) {
    super(message);
    this.name = "WebGptPlannerContextError";
    this.code = code || PLANNER_CONTEXT_ERROR_CODES.SCHEMA;
    if (phase) this.phase = phase;
    if (Number.isInteger(status)) this.status = status;
    if (backendCode) this.backendCode = backendCode;
    if (cause !== undefined) this.cause = cause;
  }
}

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function copyHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.entries === "function") {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  if (typeof headers === "object") return { ...headers };
  throw new TypeError("headers must be an object, Headers, or entry array.");
}

function hasHeader(headers, name) {
  const normalizedName = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === normalizedName);
}

function buildJsonHeaders(headers) {
  const requestHeaders = copyHeaders(headers);
  if (!hasHeader(requestHeaders, "content-type")) {
    requestHeaders["Content-Type"] = "application/json";
  }
  return requestHeaders;
}

function resolveFetch(fetchImpl) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required.");
  }
  return fetchImpl;
}

async function postJson(
  url,
  body,
  { fetchImpl, headers, signal, plannerContext = false } = {},
) {
  const requestOptions = {
    method: "POST",
    headers: buildJsonHeaders(headers),
    body: JSON.stringify(body),
  };
  if (signal) requestOptions.signal = signal;

  const response = await resolveFetch(fetchImpl)(url, requestOptions);

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    if (plannerContext) {
      throw plannerContextError(
        json?.error || `Planner context request failed with status ${response.status}.`,
        {
          code: PLANNER_CONTEXT_ERROR_CODES.HTTP,
          phase: "response",
          status: response.status,
          backendCode: json?.code,
        },
      );
    }
    throw new Error(
      json?.error || `Request failed with status ${response.status}`,
    );
  }

  return json;
}

async function getJson(url, { fetchImpl, headers, signal } = {}) {
  const requestOptions = {
    method: "GET",
    headers: buildJsonHeaders(headers),
  };
  if (signal) requestOptions.signal = signal;

  const response = await resolveFetch(fetchImpl)(url, requestOptions);

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      json?.error || `Request failed with status ${response.status}`,
    );
  }

  return json;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const PLANNER_CONTEXT_REQUEST_KEYS = Object.freeze([
  "schemaVersion",
  "goal",
  "currentState",
  "history",
  "lastOutcome",
  "transition",
  "options",
]);
const PLANNER_CONTEXT_TRANSITION_KEYS = Object.freeze([
  "eventId",
  "step",
  "beforeState",
  "actions",
  "execution",
]);
const PLANNER_CONTEXT_OPTIONS_KEYS = Object.freeze(["externalPlanner"]);
const PLANNER_CONTEXT_RESPONSE_KEYS = Object.freeze([
  "ok",
  "schemaVersion",
  "plannerInput",
  "historyEntry",
]);
const PLANNER_INPUT_KEYS = Object.freeze([
  "state",
  "history",
  "lastOutcome",
  "workflowHints",
  "workflowState",
  "surfaceTargets",
]);

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

function isNullableRecord(value) {
  return value === null || isRecord(value);
}

function isValidPlannerContextTransition(transition) {
  return (
    transition === null ||
    (hasExactKeys(transition, PLANNER_CONTEXT_TRANSITION_KEYS) &&
      typeof transition.eventId === "string" &&
      Boolean(transition.eventId.trim()) &&
      Number.isInteger(transition.step) &&
      transition.step > 0 &&
      isRecord(transition.beforeState) &&
      Array.isArray(transition.actions) &&
      transition.actions.length > 0 &&
      isRecord(transition.execution))
  );
}

function isAbort(error, signal) {
  return Boolean(
    signal?.aborted ||
      error?.name === "AbortError" ||
      error?.name === "TimeoutError",
  );
}

function plannerContextError(message, details) {
  return new WebGptPlannerContextError(message, details);
}

function assertPlannerContextRequest(payload) {
  if (
    !hasExactKeys(payload, PLANNER_CONTEXT_REQUEST_KEYS) ||
    payload.schemaVersion !== PLANNER_CONTEXT_SCHEMA_VERSION ||
    typeof payload.goal !== "string" ||
    !payload.goal.trim() ||
    !isRecord(payload.currentState) ||
    !Array.isArray(payload.history) ||
    !isNullableRecord(payload.lastOutcome) ||
    !isValidPlannerContextTransition(payload.transition) ||
    !hasExactKeys(payload.options, PLANNER_CONTEXT_OPTIONS_KEYS) ||
    payload.options.externalPlanner !== true
  ) {
    throw plannerContextError(
      `Planner context request did not match ${PLANNER_CONTEXT_SCHEMA_VERSION}.`,
      {
        code: PLANNER_CONTEXT_ERROR_CODES.SCHEMA,
        phase: "request",
      },
    );
  }
}

function assertPlannerContextResponse(json) {
  if (
    !hasExactKeys(json, PLANNER_CONTEXT_RESPONSE_KEYS) ||
    json.ok !== true ||
    json.schemaVersion !== PLANNER_CONTEXT_SCHEMA_VERSION ||
    !hasExactKeys(json.plannerInput, PLANNER_INPUT_KEYS) ||
    !isRecord(json.plannerInput.state) ||
    !Array.isArray(json.plannerInput.history) ||
    !isNullableRecord(json.plannerInput.lastOutcome) ||
    !isRecord(json.plannerInput.workflowHints) ||
    !isRecord(json.plannerInput.workflowState) ||
    !isRecord(json.plannerInput.surfaceTargets) ||
    !isNullableRecord(json.historyEntry)
  ) {
    throw plannerContextError(
      "Planner context response did not match webgpt.planner-context.v1.",
      {
        code: PLANNER_CONTEXT_ERROR_CODES.SCHEMA,
        phase: "response",
      },
    );
  }
}

export function createWebGptApiClient({
  baseUrl = "",
  resolveBaseUrl,
  accessToken = "",
  resolveAccessToken,
  headers = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  async function resolveApiBaseUrl() {
    const resolved =
      typeof resolveBaseUrl === "function"
        ? await resolveBaseUrl({ baseUrl })
      : baseUrl ||
        (typeof process !== "undefined"
          ? process.env?.WEBGPT_BACKEND_URL
          : "") ||
        DEFAULT_BACKEND_BASE_URL;

    return trimTrailingSlash(resolved || DEFAULT_BACKEND_BASE_URL);
  }

  async function resolveRequestHeaders({
    baseUrl: requestBaseUrl,
    path,
    method,
  }) {
    const requestHeaders = copyHeaders(headers);
    const token =
      typeof resolveAccessToken === "function"
        ? await resolveAccessToken({
            accessToken,
            baseUrl: requestBaseUrl,
            path,
            method,
          })
        : accessToken;

    if (
      String(token || "").trim() &&
      !hasHeader(requestHeaders, "authorization")
    ) {
      requestHeaders.Authorization = `Bearer ${String(token).trim()}`;
    }

    return requestHeaders;
  }

  async function getJsonFromApi(path) {
    const resolvedBaseUrl = await resolveApiBaseUrl();
    return getJson(`${resolvedBaseUrl}${path}`, {
      fetchImpl,
    });
  }

  async function postJsonToApi(
    path,
    body,
    { signal, plannerContext = false } = {},
  ) {
    const resolvedBaseUrl = await resolveApiBaseUrl();
    const requestHeaders = plannerContext
      ? await resolveRequestHeaders({
          baseUrl: resolvedBaseUrl,
          path,
          method: "POST",
        })
      : undefined;
    return postJson(`${resolvedBaseUrl}${path}`, body, {
      fetchImpl,
      headers: requestHeaders,
      signal,
      plannerContext,
    });
  }

  async function postPlannerContext(payload, { signal } = {}) {
    if (signal?.aborted) {
      throw plannerContextError("Planner context request was aborted.", {
        code: PLANNER_CONTEXT_ERROR_CODES.ABORTED,
        phase: "request",
        cause: signal.reason,
      });
    }

    let json;
    try {
      json = await postJsonToApi("/planner-context/prepare", payload, {
        signal,
        plannerContext: true,
      });
    } catch (error) {
      if (error instanceof WebGptPlannerContextError) throw error;
      if (isAbort(error, signal)) {
        throw plannerContextError("Planner context request was aborted.", {
          code: PLANNER_CONTEXT_ERROR_CODES.ABORTED,
          phase: "request",
          cause: error,
        });
      }
      throw plannerContextError("Planner context request failed.", {
        code: PLANNER_CONTEXT_ERROR_CODES.NETWORK,
        phase: "request",
        cause: error,
      });
    }

    return json;
  }

  return {
    async preparePlannerContext(payload, { signal } = {}) {
      assertPlannerContextRequest(payload);
      const json = await postPlannerContext(payload, { signal });
      assertPlannerContextResponse(json);
      return json;
    },

    async startCommandRun({
      goal,
      inputValues = {},
      isTemplateRun = false,
      state = null,
      userHint = "",
      browserContext = {},
      artifactFileName = "",
      surface = "",
      myInfo = null,
      attachments = [],
      profileAttachments = [],
    }) {
      const json = await postJsonToApi(`/runs/start-command`, {
        goal,
        inputValues,
        isTemplateRun,
        state,
        userHint,
        browserContext,
        artifactFileName,
        surface,
        myInfo,
        attachments,
        profileAttachments,
      });

      if (!json?.ok || !json?.runId || !json?.command) {
        throw new Error(json?.error || "Start command returned no command.");
      }

      return {
        runId: json.runId,
        run: json.run || null,
        command: json.command,
      };
    },

    async startTemplateQueueCommand({
      goalTemplate,
      inputSchema = [],
      inputValues = {},
      artifactFileName = "",
      surface = "",
      myInfo = null,
    }) {
      const json = await postJsonToApi(`/template-runs/start-command`, {
        goalTemplate,
        inputSchema,
        inputValues,
        artifactFileName,
        surface,
        myInfo,
      });

      if (!json?.ok || !json?.templateRunId || !json?.runId || !json?.command) {
        throw new Error(
          json?.error || "Start template queue returned no command.",
        );
      }

      return {
        templateRunId: json.templateRunId,
        queue: json.queue || null,
        item: json.item || null,
        runId: json.runId,
        run: json.run || null,
        command: json.command,
      };
    },

    async completeTemplateQueueItem({
      templateRunId,
      runId,
      summary = "",
      finalResult = null,
    }) {
      const json = await postJsonToApi(
        `/template-runs/${templateRunId}/complete-current-command`,
        {
          runId,
          summary,
          finalResult,
        },
      );

      if (!json?.ok || !json?.status) {
        throw new Error(json?.error || "Template queue completion failed.");
      }

      return {
        templateRunId: json.templateRunId || templateRunId,
        status: json.status,
        queue: json.queue || null,
        completedItem: json.completedItem || null,
        results: Array.isArray(json.results) ? json.results : [],
        item: json.item || null,
        runId: json.runId || "",
        run: json.run || null,
        command: json.command || null,
      };
    },

    async getRun({ runId }) {
      const json = await getJsonFromApi(`/runs/${runId}`);

      if (!json?.ok || !json?.run) {
        throw new Error(json?.error || "Get run returned no run.");
      }

      return json;
    },

    async postCommandResult({
      runId,
      type,
      step = null,
      command = {},
      state = null,
      execution = null,
      postState = null,
      userHint = "",
      browserContext = {},
      artifactFileName = "",
      surface = "",
      navigationInfo = {},
      batchResult = null,
      navigationInterrupted = false,
    }) {
      const json = await postJsonToApi(`/runs/${runId}/command-result`, {
        type,
        step,
        command,
        state,
        execution,
        postState,
        userHint,
        browserContext,
        artifactFileName,
        surface,
        navigationInfo,
        batchResult,
        navigationInterrupted,
      });

      if (!json?.ok || !json?.command) {
        throw new Error(json?.error || "command-result returned no command.");
      }

      return {
        runId: json.runId || runId,
        run: json.run || null,
        command: json.command,
        extractedData: json.extractedData || null,
      };
    },

    async provideHumanHint({
      runId,
      hint = "",
      browserContext = {},
    }) {
      const json = await postJsonToApi(`/runs/${runId}/provide-hint`, {
        hint,
        browserContext,
      });

      if (!json?.ok) {
        throw new Error(json?.error || "provide-hint failed.");
      }

      return json;
    },

    async confirmRunSuccess({ runId }) {
      const json = await postJsonToApi(`/runs/${runId}/confirm-success`, {});

      if (!json?.ok) {
        throw new Error(json?.error || "confirm-success failed.");
      }

      return json;
    },

    async rejectRunSuccess({ runId, hint = "" }) {
      const json = await postJsonToApi(`/runs/${runId}/reject-success`, {
        hint,
      });

      if (!json?.ok) {
        throw new Error(json?.error || "reject-success failed.");
      }

      return json;
    },

    async saveSuccessfulArtifacts({ runId }) {
      const [runResult, execResult, replayResult] = await Promise.all([
        postJsonToApi(`/save-successful-run`, { runId }),
        postJsonToApi(`/save-successful-execution-trace`, { runId }),
        postJsonToApi(`/save-successful-replay-artifacts`, { runId }),
      ]);

      return {
        runResult,
        execResult,
        replayResult,
      };
    },

    async fetchArtifacts() {
      const json = await getJsonFromApi(`/artifacts`);

      if (!json?.ok || !Array.isArray(json?.artifacts)) {
        throw new Error(json?.error || "Failed to fetch artifacts.");
      }

      return json.artifacts;
    },

    async stopRun({
      runId,
      reason = "stopped_by_user",
      message = "",
      deleteRun = false,
    }) {
      const json = await postJsonToApi(`/runs/${runId}/stop`, {
        reason,
        message,
        deleteRun,
      });

      if (!json?.ok) {
        throw new Error(json?.error || "stop failed.");
      }

      return json;
    },
  };
}
