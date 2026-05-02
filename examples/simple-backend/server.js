const http = require("http");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const TARGET_ID = process.env.WEBGPT_SIMPLE_TARGET_ID || "el_45";
const FILL_TEXT = process.env.WEBGPT_SIMPLE_FILL_TEXT || "example search text";
const ACTION_DELAY_MS = Number(process.env.WEBGPT_SIMPLE_DELAY_MS || 10000);

const runs = new Map();

function buildHardcodedActions() {
  return [
    {
      type: "wait",
      targetId: "",
      frameId: 0,
      key: "",
      direction: "",
      ms: ACTION_DELAY_MS,
    },
    {
      type: "fill",
      targetId: TARGET_ID,
      frameId: 0,
      value: FILL_TEXT,
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

function createRun(goal = "") {
  const runId = `simple_run_${Date.now()}`;
  const run = {
    runId,
    goal: String(goal || ""),
    step: 0,
    finalResult: null,
  };
  runs.set(runId, run);
  return run;
}

function actionCommand(run) {
  const actions = buildHardcodedActions();
  const step = Number(run.step || 0) + 1;

  return {
    type: "run_actions",
    runId: run.runId,
    run,
    step,
    actions,
    reasoning:
      "Hardcoded demo backend: fill the configured target control and press Enter.",
    summary: `Fill "${FILL_TEXT}" into ${TARGET_ID} and press Enter.`,
    plan: {
      status: "act",
      reasoning: "No planner was used. This backend always returns the same actions.",
      summary: `Fill "${FILL_TEXT}" into ${TARGET_ID} and press Enter.`,
      actions,
    },
  };
}

function doneCommand(run) {
  run.step = 1;
  run.finalResult = {
    summary: `Simple backend filled "${FILL_TEXT}" into ${TARGET_ID} and pressed Enter.`,
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

async function handle(req, res) {
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/health") {
    json(res, 200, {
      ok: true,
      backend: "webgpt-simple-backend",
      targetId: TARGET_ID,
    });
    return;
  }

  if (req.method === "POST" && path === "/runs/start-command") {
    const body = await readJson(req);
    const run = createRun(body.goal || "");
    json(res, 200, {
      ok: true,
      runId: run.runId,
      run,
      command: actionCommand(run),
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

    if (
      body.type === "actions_executed" ||
      body.type === "navigation_completed" ||
      body.type === "state_extracted"
    ) {
      json(res, 200, {
        ok: true,
        runId,
        run,
        command: doneCommand(run),
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
      command: doneCommand(run),
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
    json(res, 200, {
      ok: true,
      run: run || null,
      command: run ? actionCommand(run) : null,
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

http
  .createServer((req, res) => {
    handle(req, res).catch((error) => {
      json(res, 500, { ok: false, error: error.message || String(error) });
    });
  })
  .listen(PORT, HOST, () => {
    console.log(`Simple WebGPT-compatible backend listening at http://${HOST}:${PORT}`);
    console.log(`Hardcoded target ID: ${TARGET_ID}`);
    console.log(`Hardcoded fill text: ${FILL_TEXT}`);
  });
