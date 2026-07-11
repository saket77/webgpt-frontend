const http = require("http");

const {
  MUTATION_PROFILE_NAME,
  MUTATION_STATUS,
  MUTATION_TOOL_NAME,
  READ_ONLY_ARGUMENTS,
  READ_ONLY_EXPECTATION,
  READ_ONLY_TOOL_NAME,
  WEB_MCP_MODE,
  buildWebMcpAction,
  renderWebMcpFixturePage,
  validateMutationExecution,
  validateReadOnlyExecution,
} = require("./webmcp-fixture.js");

function readConfig(env = process.env) {
  const requestedMode = String(env.WEBGPT_SIMPLE_MODE || "")
    .trim()
    .toLowerCase();

  return {
    port: Number(env.PORT || 8787),
    host: env.HOST || "127.0.0.1",
    mode: requestedMode === WEB_MCP_MODE ? WEB_MCP_MODE : "hardcoded",
    targetId: env.WEBGPT_SIMPLE_TARGET_ID || "el_45",
    fillText: env.WEBGPT_SIMPLE_FILL_TEXT || "example search text",
    actionDelayMs: Number(env.WEBGPT_SIMPLE_DELAY_MS || 10000),
  };
}

const defaultRuns = new Map();
const defaultConfig = readConfig();

function buildHardcodedActions(config) {
  return [
    {
      type: "wait",
      targetId: "",
      frameId: 0,
      key: "",
      direction: "",
      ms: config.actionDelayMs,
    },
    {
      type: "fill",
      targetId: config.targetId,
      frameId: 0,
      value: config.fillText,
      key: "",
      direction: "",
    },
    {
      type: "press",
      targetId: "",
      frameId: 0,
      key: "Enter",
      direction: "",
    },
  ];
}

function json(res, status, body) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify(body));
}

function html(res, status, body) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function createRun(goal = "", { config, runs, now }) {
  const runId = `simple_run_${now()}`;
  const run = {
    runId,
    goal: String(goal || ""),
    step: 0,
    finalResult: null,
    ...(config.mode === WEB_MCP_MODE
      ? { mode: WEB_MCP_MODE, stage: "created" }
      : {}),
  };
  runs.set(runId, run);
  return run;
}

function actionCommand(run, config) {
  const actions = buildHardcodedActions(config);
  const step = Number(run.step || 0) + 1;

  return {
    type: "run_actions",
    runId: run.runId,
    run,
    step,
    actions,
    reasoning:
      "Hardcoded demo backend: fill the configured target control and press Enter.",
    summary: `Fill "${config.fillText}" into ${config.targetId} and press Enter.`,
    plan: {
      status: "act",
      reasoning: "No planner was used. This backend always returns the same actions.",
      summary: `Fill "${config.fillText}" into ${config.targetId} and press Enter.`,
      actions,
    },
  };
}

function doneCommand(run, config) {
  run.step = 1;
  run.finalResult = {
    summary: `Simple backend filled "${config.fillText}" into ${config.targetId} and pressed Enter.`,
  };

  return {
    type: "done",
    runId: run.runId,
    step: run.step,
    summary: run.finalResult.summary,
    plannerSummary: "Hardcoded simple backend completed.",
    finalResult: run.finalResult,
    plan: {
      status: "done",
      summary: run.finalResult.summary,
      reasoning: "No planner was used. This backend always runs one hardcoded action batch.",
      actions: [],
    },
    run,
  };
}

function webMcpExtractionCommand(run, reason = "webmcp_fixture_discovery") {
  run.stage = "awaiting_discovery";
  return {
    type: "extract_state",
    surface: "browser_dom",
    runId: run.runId,
    step: Number(run.step || 0) + 1,
    reason,
    run,
  };
}

function webMcpActionCommand(run, actionOrActions, { step, summary, reasoning, stage }) {
  run.step = step;
  run.stage = stage;
  const actions = Array.isArray(actionOrActions)
    ? actionOrActions
    : [actionOrActions];

  return {
    type: "run_actions",
    surface: "browser_dom",
    runId: run.runId,
    run,
    step,
    actions,
    reasoning,
    summary,
    plan: {
      status: "act",
      surface: "browser_dom",
      reasoning,
      summary,
      actions,
    },
  };
}

function webMcpDoneCommand(run, { passed, summary, evidence = null }) {
  run.step = 2;
  run.stage = passed ? "completed" : "failed";
  run.finalResult = {
    summary,
    webMcpFixture: {
      passed,
      expectedReadOnly: READ_ONLY_EXPECTATION,
      evidence,
    },
  };

  return {
    type: "done",
    runId: run.runId,
    step: run.step,
    summary,
    plannerSummary: passed
      ? "Deterministic WebMCP fixture completed."
      : "Deterministic WebMCP fixture failed its oracle checks.",
    finalResult: run.finalResult,
    plan: {
      status: "done",
      surface: "browser_dom",
      summary,
      reasoning: passed
        ? "The exact-payload oracle, ordinary input value, and live tool swap all matched."
        : summary,
      actions: [],
    },
    run,
  };
}

function webMcpFailureCommand(run, error, evidence = null) {
  const message = error?.message || String(error || "Unknown fixture failure.");
  return webMcpDoneCommand(run, {
    passed: false,
    summary: `WebMCP fixture failed: ${message}`,
    evidence,
  });
}

function nextWebMcpCommand(run, body) {
  if (
    (body.type === "state_extracted" ||
      body.type === "navigation_completed") &&
    run.stage === "awaiting_discovery"
  ) {
    try {
      const readOnlyAction = buildWebMcpAction(
        body.state,
        READ_ONLY_TOOL_NAME,
        READ_ONLY_ARGUMENTS,
        { type: "simple_webmcp_exact_payload" },
      );
      const mutationAction = buildWebMcpAction(
        body.state,
        MUTATION_TOOL_NAME,
        {
          profileName: MUTATION_PROFILE_NAME,
          status: MUTATION_STATUS,
        },
        { type: "simple_webmcp_mutate_profile" },
      );
      return webMcpActionCommand(run, [readOnlyAction, mutationAction], {
        step: 1,
        stage: "awaiting_batch_result",
        summary:
          "Run the exact-payload read and profile mutation as one ordered WebMCP batch.",
        reasoning:
          "Both calls are independent from the extracted state. Preserve their exact arguments and keep the navigation-capable mutation last.",
      });
    } catch (error) {
      return webMcpFailureCommand(run, error);
    }
  }

  if (
    body.type === "actions_executed" &&
    run.stage === "awaiting_batch_result"
  ) {
    const readOnlyCheck = validateReadOnlyExecution(body.execution);
    if (!readOnlyCheck.ok) {
      return webMcpFailureCommand(run, readOnlyCheck.error, {
        readOnly: readOnlyCheck.output || null,
      });
    }

    const mutationCheck = validateMutationExecution(
      body.execution,
      body.postState,
    );
    if (!mutationCheck.ok) {
      return webMcpFailureCommand(run, mutationCheck.error, {
        mutation: mutationCheck.output || null,
        toolNames: mutationCheck.toolNames || [],
      });
    }

    return webMcpDoneCommand(run, {
      passed: true,
      summary:
        "WebMCP fixture passed: exact long/nested arguments, ordinary input mutation, and dynamic tool registration were all observed.",
      evidence: {
        readOnly: readOnlyCheck.output,
        mutation: mutationCheck.output,
        toolNames: mutationCheck.toolNames,
      },
    });
  }

  return webMcpFailureCommand(
    run,
    `Unexpected command result ${body.type || "unknown"} during stage ${run.stage}.`,
  );
}

async function handle(
  req,
  res,
  { config = defaultConfig, runs = defaultRuns, now = Date.now } = {},
) {
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (
    req.method === "GET" &&
    path === "/webmcp-fixture" &&
    config.mode === WEB_MCP_MODE
  ) {
    html(res, 200, renderWebMcpFixturePage());
    return;
  }

  if (req.method === "GET" && path === "/health") {
    const health = {
      ok: true,
      backend: "webgpt-simple-backend",
      targetId: config.targetId,
    };
    if (config.mode === WEB_MCP_MODE) {
      health.mode = WEB_MCP_MODE;
      health.fixturePath = "/webmcp-fixture";
    }
    json(res, 200, health);
    return;
  }

  if (req.method === "POST" && path === "/runs/start-command") {
    const body = await readJson(req);
    const run = createRun(body.goal || "", { config, runs, now });
    json(res, 200, {
      ok: true,
      runId: run.runId,
      run,
      command:
        config.mode === WEB_MCP_MODE
          ? webMcpExtractionCommand(run)
          : actionCommand(run, config),
    });
    return;
  }

  const commandResultMatch = path.match(/^\/runs\/([^/]+)\/command-result$/);
  if (req.method === "POST" && commandResultMatch) {
    const runId = commandResultMatch[1];
    const run = runs.get(runId);
    if (!run) {
      json(res, 404, { ok: false, error: "Run not found." });
      return;
    }

    const body = await readJson(req);

    if (body.type === "replay_preflight_requested") {
      if (config.mode === WEB_MCP_MODE) {
        const command = webMcpExtractionCommand(run, "replay_skipped");
        command.replay = { status: "skipped", fileName: "" };
        json(res, 200, { ok: true, runId, run, command });
        return;
      }

      json(res, 200, {
        ok: true,
        runId,
        run,
        command: {
          type: "extract_state",
          runId,
          step: run.step + 1,
          reason: "replay_skipped",
          replay: {
            status: "skipped",
            fileName: "",
          },
          run,
        },
      });
      return;
    }

    if (config.mode === WEB_MCP_MODE) {
      json(res, 200, {
        ok: true,
        runId,
        run,
        command: nextWebMcpCommand(run, body),
      });
      return;
    }

    if (
      body.type === "actions_executed" ||
      body.type === "navigation_completed" ||
      body.type === "state_extracted"
    ) {
      json(res, 200, {
        ok: true,
        runId,
        run,
        command: doneCommand(run, config),
      });
      return;
    }

    if (body.type === "navigation_detected") {
      json(res, 200, {
        ok: true,
        runId,
        run,
        command: {
          type: "wait_for_navigation",
          runId,
          step: run.step,
          observedUrl: body.navigationInfo?.observedUrl || "",
          source: body.navigationInfo?.source || "simple_backend",
          run,
        },
      });
      return;
    }

    json(res, 200, {
      ok: true,
      runId,
      run,
      command: doneCommand(run, config),
    });
    return;
  }

  const runMatch = path.match(/^\/runs\/([^/]+)$/);
  if (req.method === "GET" && runMatch) {
    const run = runs.get(runMatch[1]);
    json(res, run ? 200 : 404, run ? { ok: true, run } : { ok: false });
    return;
  }

  const successMatch = path.match(/^\/runs\/([^/]+)\/confirm-success$/);
  if (req.method === "POST" && successMatch) {
    const run = runs.get(successMatch[1]);
    json(res, 200, { ok: true, run: run || null });
    return;
  }

  const rejectMatch = path.match(/^\/runs\/([^/]+)\/reject-success$/);
  if (req.method === "POST" && rejectMatch) {
    const run = runs.get(rejectMatch[1]);
    let command = null;
    if (run) {
      if (config.mode === WEB_MCP_MODE) {
        run.step = 0;
        run.finalResult = null;
        command = webMcpExtractionCommand(run, "success_rejected");
      } else {
        command = actionCommand(run, config);
      }
    }
    json(res, 200, {
      ok: true,
      run: run || null,
      command,
    });
    return;
  }

  const stopMatch = path.match(/^\/runs\/([^/]+)\/stop$/);
  if (req.method === "POST" && stopMatch) {
    runs.delete(stopMatch[1]);
    json(res, 200, { ok: true });
    return;
  }

  const hintMatch = path.match(/^\/runs\/([^/]+)\/provide-hint$/);
  if (req.method === "POST" && hintMatch) {
    const run = runs.get(hintMatch[1]);
    json(res, 200, { ok: true, run: run || null });
    return;
  }

  if (req.method === "GET" && path === "/artifacts") {
    json(res, 200, { ok: true, artifacts: [] });
    return;
  }

  if (
    req.method === "POST" &&
    [
      "/save-successful-run",
      "/save-successful-execution-trace",
      "/save-successful-replay-artifacts",
    ].includes(path)
  ) {
    json(res, 200, { ok: true, skipped: true });
    return;
  }

  json(res, 404, { ok: false, error: `Unknown route: ${req.method} ${path}` });
}

function createSimpleBackend({ env = process.env, now = Date.now } = {}) {
  const config = readConfig(env);
  const runs = new Map();

  return {
    config,
    runs,
    handle(req, res) {
      return handle(req, res, { config, runs, now });
    },
  };
}

function startServer({ env = process.env } = {}) {
  const backend = createSimpleBackend({ env });
  const server = http.createServer((req, res) => {
    backend.handle(req, res).catch((error) => {
      json(res, 500, { ok: false, error: error.message || String(error) });
    });
  });

  server.listen(backend.config.port, backend.config.host, () => {
    const { host, port, mode, targetId, fillText } = backend.config;
    console.log(
      `Simple WebGPT-compatible backend listening at http://${host}:${port}`,
    );
    if (mode === WEB_MCP_MODE) {
      console.log(`WebMCP fixture: http://${host}:${port}/webmcp-fixture`);
    } else {
      console.log(`Hardcoded target ID: ${targetId}`);
      console.log(`Hardcoded fill text: ${fillText}`);
    }
  });

  return { backend, server };
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createSimpleBackend,
  readConfig,
  startServer,
};
