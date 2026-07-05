const DEFAULT_BACKEND_BASE_URL = "https://webgpt-backend-production.up.railway.app";

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      json?.error || `Request failed with status ${response.status}`,
    );
  }

  return json;
}

async function getJson(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      json?.error || `Request failed with status ${response.status}`,
    );
  }

  return json;
}

export function createWebGptApiClient({
  baseUrl = "",
  resolveBaseUrl,
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

  async function getJsonFromApi(path) {
    const resolvedBaseUrl = await resolveApiBaseUrl();
    return getJson(`${resolvedBaseUrl}${path}`);
  }

  async function postJsonToApi(path, body) {
    const resolvedBaseUrl = await resolveApiBaseUrl();
    return postJson(`${resolvedBaseUrl}${path}`, body);
  }

  return {
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
