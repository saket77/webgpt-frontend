import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";

import { readCloudServiceConfig } from "../apps/webgpt-cloud-service/src/config.js";
import { createCloudRunHttpHandler } from "../apps/webgpt-cloud-service/src/http.js";
import { createCloudRunQueue } from "../apps/webgpt-cloud-service/src/queue.js";
import { createRoutineScheduler } from "../apps/webgpt-cloud-service/src/routineScheduler.js";
import { createNotificationDispatcher } from "../apps/webgpt-cloud-service/src/notificationDispatcher.js";
import { runIpoGmpDailyDeterministic } from "../apps/webgpt-cloud-service/src/deterministic/ipoGmpDaily.js";
import {
  CloudRunStore,
  rowToCloudRun,
} from "../apps/webgpt-cloud-service/src/store.js";
import { validateCreateCloudRunRequest } from "../apps/webgpt-cloud-service/src/validation.js";

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "webgpt-cloud-service-"));
}

function createTempStore() {
  const dir = createTempDir();
  const store = new CloudRunStore({
    dbPath: path.join(dir, "cloud-runs.sqlite"),
  });

  return {
    dir,
    store,
    cleanup() {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createRoutinePayload(overrides = {}) {
  return {
    name: "Test routine",
    enabled: true,
    schedule: {
      type: "daily",
      time: "09:00",
      timezone: "Asia/Kolkata",
    },
    workflow: {
      type: "cloud_run",
      url: "https://example.com",
      goal: "Extract title",
      mode: "webgpt",
      execution: "browserbase",
    },
    notification: null,
    ...overrides,
  };
}

function investorGainRow(overrides = {}) {
  return {
    Name: '<a href="/gmp/kratikal-tech-ipo/2096/" title="Kratikal Tech" target="_parent">Kratikal Tech</a> <span class="badge rounded-pill bg-secondary d-inline ms-2">IPO</span><span class="badge rounded-pill bg-success d-inline ms-2">O</span>',
    GMP: "&#8377;<b>70</b> (51.85%)<br><small><b>13 ↓ / 75 ↑</b></small>",
    Sub: "220.71x",
    "Price (₹)": "135",
    "IPO Size": "₹100.00 cr",
    Lot: "1000",
    Open: "30-Jun",
    Close: "2-Jul",
    "BoA Dt": "3-Jul",
    Listing: "7-Jul",
    "Updated-On": "<small><b>6-Jul 19:30</b></small>",
    "~id": 2096,
    "~urlrewrite_folder_name": "/gmp/kratikal-tech-ipo/2096/",
    "~IPO_Category": "IPO",
    "~gmp_percent_calc": "51.85",
    "~ipo_name": "Kratikal Tech",
    ...overrides,
  };
}

async function waitFor(predicate, { timeoutMs = 1000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("Timed out waiting for condition.");
}

function invokeJson(handler, { method = "GET", pathname = "/", token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const headers = {
      host: "127.0.0.1",
    };
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    if (token) headers.authorization = `Bearer ${token}`;

    const req = Readable.from(payload ? [payload] : []);
    req.method = method;
    req.url = pathname;
    req.headers = headers;

    const res = {
      headersSent: false,
      statusCode: 0,
      headers: {},
      writeHead(statusCode, responseHeaders) {
        this.statusCode = statusCode;
        this.headers = responseHeaders;
        this.headersSent = true;
      },
      end(chunk = "") {
        const raw = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: raw ? JSON.parse(raw) : null,
        });
      },
    };

    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test("cloud service config keeps tokenless local dev on loopback and requires token in production", () => {
  const local = readCloudServiceConfig({});
  assert.equal(local.host, "127.0.0.1");
  assert.equal(local.port, 3100);
  assert.equal(local.emailProvider, "console");

  const tokened = readCloudServiceConfig({
    WEBGPT_CLOUD_ADMIN_TOKEN: "secret",
  });
  assert.equal(tokened.host, "0.0.0.0");
  assert.equal(tokened.adminToken, "secret");

  const railwayPort = readCloudServiceConfig({
    PORT: "8080",
  });
  assert.equal(railwayPort.port, 8080);

  const gmailLocal = readCloudServiceConfig({
    WEBGPT_EMAIL_PROVIDER: "gmail_api",
    GMAIL_CLIENT_ID: "gmail-client-id",
    GMAIL_CLIENT_SECRET: "gmail-client-secret",
    GMAIL_REFRESH_TOKEN: "gmail-refresh-token",
    GMAIL_TOKEN_URL: "https://oauth2.example.test/token",
    GMAIL_SEND_URL: "https://gmail.example.test/send",
    GMAIL_TIMEOUT_MS: "5000",
    WEBGPT_EMAIL_FROM: "Saket Mundhada <saketmundhada7@gmail.com>",
  });
  assert.equal(gmailLocal.emailProvider, "gmail_api");
  assert.equal(gmailLocal.gmailClientId, "gmail-client-id");
  assert.equal(gmailLocal.gmailClientSecret, "gmail-client-secret");
  assert.equal(gmailLocal.gmailRefreshToken, "gmail-refresh-token");
  assert.equal(gmailLocal.gmailTokenUrl, "https://oauth2.example.test/token");
  assert.equal(gmailLocal.gmailSendUrl, "https://gmail.example.test/send");
  assert.equal(gmailLocal.gmailTimeoutMs, 5000);
  assert.equal(gmailLocal.emailFrom, "Saket Mundhada <saketmundhada7@gmail.com>");

  const gmailAutoSelected = readCloudServiceConfig({
    GMAIL_CLIENT_ID: "gmail-client-id",
    GMAIL_CLIENT_SECRET: "gmail-client-secret",
    GMAIL_REFRESH_TOKEN: "gmail-refresh-token",
    GMAIL_FROM: "saketmundhada7@gmail.com",
  });
  assert.equal(gmailAutoSelected.emailProvider, "gmail_api");
  assert.equal(gmailAutoSelected.emailFrom, "saketmundhada7@gmail.com");
  assert.equal(gmailAutoSelected.gmailTimeoutMs, 15000);

  assert.throws(
    () => readCloudServiceConfig({ NODE_ENV: "production" }),
    /WEBGPT_CLOUD_ADMIN_TOKEN is required/,
  );
});

test("cloud run request validation accepts only v0 mode and execution", () => {
  assert.equal(validateCreateCloudRunRequest({}).error, "Missing required field: url.");

  assert.equal(
    validateCreateCloudRunRequest({
      url: "https://example.com",
      goal: "Extract title",
      execution: "local-playwright",
    }).error,
    "Unsupported execution: local-playwright.",
  );

  assert.equal(
    validateCreateCloudRunRequest({
      url: "https://example.com",
      goal: "Extract title",
      mode: "bench",
    }).error,
    "Unsupported mode: bench.",
  );

  assert.equal(
    validateCreateCloudRunRequest({
      url: "https://example.com",
      goal: "Extract title",
      timeoutMs: -1,
    }).error,
    "timeoutMs must be a positive number.",
  );

  const valid = validateCreateCloudRunRequest({
    url: "https://example.com",
    goal: "Extract title",
  });

  assert.equal(valid.ok, true);
  assert.equal(valid.value.mode, "webgpt");
  assert.equal(valid.value.execution, "browserbase");
  assert.equal(valid.value.autoConfirm, true);
});

test("cloud run store persists lifecycle state and recovers interrupted runs", () => {
  const { store, cleanup } = createTempStore();
  try {
    const queued = store.createRun({
      url: "https://example.com",
      goal: "Extract title",
      mode: "webgpt",
      execution: "browserbase",
      timeoutMs: 1000,
      autoConfirm: true,
    });

    assert.equal(queued.status, "queued");
    assert.equal(queued.execution, "browserbase");

    store.markRunning(queued.id);
    store.markSessionReady(queued.id, {
      browserbaseSessionId: "session_123",
      liveViewUrl: "https://browserbase.test/live",
      sessionUrl: "https://browserbase.test/session",
    });
    const completed = store.markCompleted(queued.id, {
      ok: true,
      browserbaseSessionId: "session_123",
      liveViewUrl: "https://browserbase.test/live",
      sessionUrl: "https://browserbase.test/session",
      plannerRunId: "run_123",
      eventLogPath: "/tmp/events.jsonl",
      summary: "Done",
      finalResult: { title: "Example" },
    });

    assert.equal(completed.status, "completed");
    const apiRun = store.getRunForApi(queued.id);
    assert.equal(apiRun.status, "completed");
    assert.equal(apiRun.liveViewUrl, "https://browserbase.test/live");
    assert.equal(apiRun.plannerRunId, "run_123");
    assert.deepEqual(apiRun.finalResult, { title: "Example" });
    assert.match(apiRun.progress.message, /Done|completed/i);
    assert.ok(apiRun.progress.events.some((event) => event.kind === "completed"));

    const interrupted = store.createRun({
      url: "https://example.org",
      goal: "Extract heading",
      mode: "webgpt",
      execution: "browserbase",
      timeoutMs: 1000,
      autoConfirm: true,
    });
    store.markRunning(interrupted.id);

    assert.equal(store.recoverInterruptedRuns(), 1);
    const recovered = rowToCloudRun(store.getRun(interrupted.id));
    assert.equal(recovered.status, "failed");
    assert.match(recovered.error.message, /interrupted by service restart/);
  } finally {
    cleanup();
  }
});

test("cloud run store migrates an existing v0 database for progress fields", () => {
  const dir = createTempDir();
  const dbPath = path.join(dir, "cloud-runs.sqlite");
  const oldDb = new DatabaseSync(dbPath);
  oldDb.exec(`
    CREATE TABLE cloud_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      execution TEXT NOT NULL,
      url TEXT NOT NULL,
      goal TEXT NOT NULL,
      request_json TEXT NOT NULL,
      result_json TEXT,
      error_message TEXT,
      browserbase_session_id TEXT,
      live_view_url TEXT,
      session_url TEXT,
      planner_run_id TEXT,
      event_log_path TEXT,
      summary TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      session_ready_at TEXT,
      completed_at TEXT
    );
    INSERT INTO cloud_runs (
      id,
      status,
      mode,
      execution,
      url,
      goal,
      request_json,
      created_at
    ) VALUES (
      'cloud_run_old',
      'running',
      'webgpt',
      'browserbase',
      'https://example.com',
      'Extract title',
      '{"url":"https://example.com","goal":"Extract title"}',
      '2026-01-01T00:00:00.000Z'
    );
  `);
  oldDb.close();

  const store = new CloudRunStore({ dbPath });
  try {
    store.recordProgressEvent("cloud_run_old", {
      kind: "planner_step",
      message: "Planner selected extract.",
    });
    const run = store.getRunForApi("cloud_run_old");
    assert.equal(run.progress.message, "Planner selected extract.");
    assert.equal(run.progress.events[0].kind, "planner_step");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cloud run queue executes jobs serially and preserves session URLs on thrown failures", async () => {
  const { store, cleanup } = createTempStore();
  const calls = [];
  const pending = [];

  const runner = async (args) => {
    calls.push(args);
    args.onSessionReady({
      browserbaseSessionId: `session_${calls.length}`,
      liveViewUrl: `https://browserbase.test/live/${calls.length}`,
      sessionUrl: `https://browserbase.test/session/${calls.length}`,
    });
    args.onEventLogReady({
      eventLogPath: `/tmp/browserbase-${calls.length}.jsonl`,
    });
    args.onEvent({
      timestamp: `2026-01-01T00:00:0${calls.length}.000Z`,
      kind: "planner_step",
      message: `planner step ${calls.length}`,
    });
    const deferred = createDeferred();
    pending.push(deferred);
    return deferred.promise;
  };

  try {
    const first = store.createRun(
      {
        url: "https://example.com/first",
        goal: "First",
        mode: "webgpt",
        execution: "browserbase",
        timeoutMs: 1000,
        autoConfirm: true,
      },
      { createdAt: "2026-01-01T00:00:00.000Z" },
    );
    const second = store.createRun(
      {
        url: "https://example.com/second",
        goal: "Second",
        mode: "webgpt",
        execution: "browserbase",
        timeoutMs: 1000,
        autoConfirm: true,
      },
      { createdAt: "2026-01-01T00:00:01.000Z" },
    );

    const queue = createCloudRunQueue({
      store,
      runner,
      config: {
        backend: "http://localhost:3000",
        logsDir: "",
        projectId: "project_123",
        timeoutMs: 120000,
      },
      logStream: { write() {} },
    });

    queue.start();
    await waitFor(() => calls.length === 1);
    assert.equal(rowToCloudRun(store.getRun(first.id)).status, "running");
    assert.equal(rowToCloudRun(store.getRun(second.id)).status, "queued");
    assert.equal(
      store.getRunForApi(first.id).progress.events.some(
        (event) => event.message === "planner step 1",
      ),
      true,
    );

    pending[0].resolve({
      ok: true,
      plannerRunId: "planner_1",
      summary: "first done",
      finalResult: { ok: true },
    });

    await waitFor(() => calls.length === 2);
    assert.equal(rowToCloudRun(store.getRun(first.id)).status, "completed");
    assert.equal(rowToCloudRun(store.getRun(second.id)).status, "running");

    pending[1].reject(new Error("Browser crashed"));
    await waitFor(() => rowToCloudRun(store.getRun(second.id)).status === "failed");

    const failed = rowToCloudRun(store.getRun(second.id));
    assert.equal(failed.liveViewUrl, "https://browserbase.test/live/2");
    assert.match(failed.error.message, /Browser crashed/);
    const failedWithProgress = store.getRunForApi(second.id);
    assert.equal(failedWithProgress.eventLogPath, "/tmp/browserbase-2.jsonl");
    assert.equal(
      failedWithProgress.progress.events.some(
        (event) => event.kind === "planner_step" && event.message === "planner step 2",
      ),
      true,
    );

    queue.close();
  } finally {
    cleanup();
  }
});

test("IPO deterministic workflow reads InvestorGain API rows and applies mom's thresholds", async () => {
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          reportTableData: [
            investorGainRow(),
            investorGainRow({
              "~id": 1596,
              "~ipo_name": "IC Electricals",
              Name: '<a href="/gmp/ic-electricals-ipo/1596/">IC Electricals</a> <span class="badge rounded-pill bg-secondary d-inline ms-2">IPO</span><span class="badge rounded-pill bg-success d-inline ms-2">O</span>',
              GMP: "&#8377;<b>42</b> (42.42%)",
              "~gmp_percent_calc": "42.42",
              Sub: "67.42x",
            }),
            investorGainRow({
              "~id": 3000,
              "~ipo_name": "Closed Winner",
              Name: '<a href="/gmp/closed-winner-ipo/3000/">Closed Winner</a> <span class="badge rounded-pill bg-secondary d-inline ms-2">IPO</span><span class="badge rounded-pill bg-primary d-inline ms-2">C</span>',
            }),
            investorGainRow({
              "~id": 4000,
              "~IPO_Category": "SME",
              "~ipo_name": "SME Winner",
              Name: '<a href="/gmp/sme-winner-ipo/4000/">SME Winner</a> <span class="badge rounded-pill bg-secondary d-inline ms-2">SME</span><span class="badge rounded-pill bg-success d-inline ms-2">O</span>',
            }),
          ],
          totalPages: 1,
        };
      },
    };
  };

  const result = await runIpoGmpDailyDeterministic({
    fetchImpl,
    now: new Date("2026-07-06T09:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.match(requestedUrls[0], /\/data-read\/331\/1\/7\/2026\/2026-27\/0\/ipo/);
  assert.equal(result.finalResult.totalRowsRead, 4);
  assert.equal(result.finalResult.matchedRows, 1);
  assert.equal(result.finalResult.rows[0].name, "Kratikal Tech");
  assert.equal(result.finalResult.rows[0].subscription, "220.71x");
  assert.equal(result.finalResult.rows[0].gmpPercent, "51.85%");
  assert.match(result.summary, /Found 1 open Mainboard IPO/);
});

test("cloud run queue completes IPO supported workflow deterministically before Browserbase", async () => {
  const { store, cleanup } = createTempStore();
  let browserbaseCalls = 0;

  try {
    const run = store.createRun({
      type: "supported_workflow",
      templateId: "ipo_gmp_daily",
      strategy: "deterministic_then_browserbase",
      url: "https://www.investorgain.com/report/ipo-gmp-live/331/ipo/",
      goal: "Find IPO candidates",
      mode: "webgpt",
      execution: "browserbase",
      timeoutMs: 1000,
      autoConfirm: true,
      filters: {
        minGmpPercent: 50,
        minSubscriptionTimes: 10,
      },
    });

    const queue = createCloudRunQueue({
      store,
      runner: async () => {
        browserbaseCalls += 1;
        return { ok: true, summary: "browserbase fallback" };
      },
      config: {
        backend: "http://localhost:3000",
        logsDir: "",
        projectId: "project_123",
        timeoutMs: 120000,
      },
      deterministicRunners: {
        ipo_gmp_daily: async () => ({
          ok: true,
          summary: "deterministic done",
          finalResult: {
            summary: "deterministic done",
            matchedRows: 1,
            totalRowsRead: 3,
            rows: [{ name: "Kratikal Tech", subscription: "220.71x" }],
          },
        }),
      },
      logStream: { write() {} },
    });

    queue.start();
    await waitFor(() => rowToCloudRun(store.getRun(run.id)).status === "completed");

    const completed = store.getRunForApi(run.id);
    assert.equal(browserbaseCalls, 0);
    assert.equal(completed.summary, "deterministic done");
    assert.equal(completed.finalResult.rows[0].name, "Kratikal Tech");
    assert.equal(
      completed.progress.events.some((event) => event.kind === "deterministic_completed"),
      true,
    );
    queue.close();
  } finally {
    cleanup();
  }
});

test("cloud run queue falls back to Browserbase when IPO deterministic workflow fails", async () => {
  const { store, cleanup } = createTempStore();
  let browserbaseCalls = 0;

  try {
    const run = store.createRun({
      type: "supported_workflow",
      templateId: "ipo_gmp_daily",
      strategy: "deterministic_then_browserbase",
      url: "https://www.investorgain.com/report/ipo-gmp-live/331/ipo/",
      goal: "Find IPO candidates",
      mode: "webgpt",
      execution: "browserbase",
      timeoutMs: 1000,
      autoConfirm: true,
    });

    const queue = createCloudRunQueue({
      store,
      runner: async () => {
        browserbaseCalls += 1;
        return {
          ok: true,
          summary: "browserbase fallback",
          finalResult: { summary: "browserbase fallback" },
        };
      },
      config: {
        backend: "http://localhost:3000",
        logsDir: "",
        projectId: "project_123",
        timeoutMs: 120000,
      },
      deterministicRunners: {
        ipo_gmp_daily: async () => {
          throw new Error("API unavailable");
        },
      },
      logStream: { write() {} },
    });

    queue.start();
    await waitFor(() => rowToCloudRun(store.getRun(run.id)).status === "completed");

    const completed = store.getRunForApi(run.id);
    assert.equal(browserbaseCalls, 1);
    assert.equal(completed.summary, "browserbase fallback");
    assert.equal(
      completed.progress.events.some(
        (event) => event.kind === "deterministic_failed_browserbase_fallback",
      ),
      true,
    );
    assert.equal(
      completed.progress.events.some((event) => event.kind === "browserbase_starting"),
      true,
    );
    queue.close();
  } finally {
    cleanup();
  }
});

test("cloud run HTTP API supports auth, creation, lookup, and validation errors", async () => {
  const { store, cleanup } = createTempStore();
  const queue = {
    enqueueCalls: 0,
    enqueue() {
      this.enqueueCalls += 1;
    },
  };
  const handler = createCloudRunHttpHandler({
    store,
    queue,
    config: { adminToken: "secret" },
  });

  try {
    const unauthorized = await invokeJson(handler, { pathname: "/health" });
    assert.equal(unauthorized.statusCode, 401);

    const health = await invokeJson(handler, {
      pathname: "/health",
      token: "secret",
    });
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.service, "webgpt-cloud-service");

    const bad = await invokeJson(handler, {
      method: "POST",
      pathname: "/cloud-runs",
      token: "secret",
      body: { url: "https://example.com" },
    });
    assert.equal(bad.statusCode, 400);
    assert.match(bad.body.error, /goal/);

    const created = await invokeJson(handler, {
      method: "POST",
      pathname: "/cloud-runs",
      token: "secret",
      body: {
        url: "https://example.com",
        goal: "Extract title",
        execution: "browserbase",
      },
    });
    assert.equal(created.statusCode, 202);
    assert.equal(created.body.status, "queued");
    assert.equal(created.body.execution, "browserbase");
    assert.equal(created.body.progress.message, "Cloud run queued.");
    assert.equal(created.body.progress.eventsMode, "compact");
    assert.equal(created.body.progress.events[0].kind, "queued");
    assert.equal(created.body.progress.events[0].event, undefined);
    assert.match(created.body.links.self, /^\/cloud-runs\/cloud_run_/);
    assert.equal(queue.enqueueCalls, 1);

    store.recordProgressEvent(created.body.id, {
      kind: "success_confirmed",
      message: "Success confirmed and artifacts saved.",
      event: {
        timestamp: "2026-01-01T00:00:01.000Z",
        kind: "success_confirmed",
        step: 3,
        summary: "A compact summary.",
        saveResult: {
          runResult: {
            artifact: {
              massiveDebugPayload: true,
            },
          },
        },
      },
    });

    const fetched = await invokeJson(handler, {
      pathname: created.body.links.self,
      token: "secret",
    });
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.body.id, created.body.id);
    assert.equal(fetched.body.goal, "Extract title");
    assert.equal(fetched.body.progress.events[0].message, "Cloud run queued.");
    const compactEvent = fetched.body.progress.events[fetched.body.progress.events.length - 1];
    assert.equal(compactEvent.kind, "success_confirmed");
    assert.equal(compactEvent.event, undefined);
    assert.equal(compactEvent.eventPreview.summary, "A compact summary.");
    assert.equal(compactEvent.eventPreview.artifactsSaved, true);

    const fullEvents = await invokeJson(handler, {
      pathname: `${created.body.links.self}?events=full`,
      token: "secret",
    });
    const fullEvent = fullEvents.body.progress.events[fullEvents.body.progress.events.length - 1];
    assert.equal(fullEvents.body.progress.eventsMode, "full");
    assert.equal(fullEvent.event.saveResult.runResult.artifact.massiveDebugPayload, true);

    const noEvents = await invokeJson(handler, {
      pathname: `${created.body.links.self}?events=none`,
      token: "secret",
    });
    assert.deepEqual(noEvents.body.progress.events, []);
  } finally {
    cleanup();
  }
});

test("routine API exposes templates and creates routines from templates or custom workflows", async () => {
  const { store, cleanup } = createTempStore();
  const queue = { enqueue() {} };
  const handler = createCloudRunHttpHandler({
    store,
    queue,
    config: { adminToken: "secret" },
  });

  try {
    const templates = await invokeJson(handler, {
      pathname: "/routine-templates",
      token: "secret",
    });
    assert.equal(templates.statusCode, 200);
    assert.equal(templates.body.templates[0].id, "ipo_gmp_daily");

    const fromTemplate = await invokeJson(handler, {
      method: "POST",
      pathname: "/routines",
      token: "secret",
      body: {
        templateId: "ipo_gmp_daily",
        name: "Mom IPO tracker",
        schedule: {
          type: "daily",
          time: "09:00",
          timezone: "Asia/Kolkata",
        },
        notification: {
          type: "email",
          to: ["mom@example.com"],
        },
      },
    });
    assert.equal(fromTemplate.statusCode, 201);
    assert.equal(fromTemplate.body.routine.templateId, "ipo_gmp_daily");
    assert.equal(fromTemplate.body.routine.workflow.type, "supported_workflow");
    assert.equal(
      fromTemplate.body.routine.workflow.strategy,
      "deterministic_then_browserbase",
    );
    assert.equal(fromTemplate.body.routine.workflow.execution, "browserbase");
    assert.equal(fromTemplate.body.routine.workflow.filters.minGmpPercent, 50);
    assert.equal(fromTemplate.body.routine.notification.to[0], "mom@example.com");
    assert.ok(fromTemplate.body.routine.nextRunAt);

    const custom = await invokeJson(handler, {
      method: "POST",
      pathname: "/routines",
      token: "secret",
      body: createRoutinePayload({
        name: "Custom watcher",
        schedule: null,
      }),
    });
    assert.equal(custom.statusCode, 201);
    assert.equal(custom.body.routine.templateId, "");
    assert.equal(custom.body.routine.name, "Custom watcher");
    assert.equal(custom.body.routine.nextRunAt, null);

    const invalid = await invokeJson(handler, {
      method: "POST",
      pathname: "/routines",
      token: "secret",
      body: createRoutinePayload({
        schedule: {
          type: "daily",
          time: "25:00",
          timezone: "Asia/Kolkata",
        },
      }),
    });
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.body.error, /HH:mm/);
  } finally {
    cleanup();
  }
});

test("routine API patches routine state and manually triggers queued CloudRuns", async () => {
  const { store, cleanup } = createTempStore();
  const queue = {
    enqueueCalls: 0,
    enqueue() {
      this.enqueueCalls += 1;
    },
  };
  const handler = createCloudRunHttpHandler({
    store,
    queue,
    config: { adminToken: "secret" },
  });

  try {
    const created = await invokeJson(handler, {
      method: "POST",
      pathname: "/routines",
      token: "secret",
      body: createRoutinePayload({
        notification: {
          type: "email",
          to: ["mom@example.com"],
        },
      }),
    });
    const routineId = created.body.routine.id;

    const patched = await invokeJson(handler, {
      method: "PATCH",
      pathname: `/routines/${routineId}`,
      token: "secret",
      body: {
        enabled: false,
        schedule: {
          type: "daily",
          time: "10:30",
          timezone: "Asia/Kolkata",
        },
      },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal(patched.body.routine.enabled, false);
    assert.equal(patched.body.routine.nextRunAt, null);

    const triggered = await invokeJson(handler, {
      method: "POST",
      pathname: `/routines/${routineId}/trigger`,
      token: "secret",
    });
    assert.equal(triggered.statusCode, 202);
    assert.equal(triggered.body.trigger.triggeredBy, "manual");
    assert.equal(triggered.body.cloudRun.status, "queued");
    assert.equal(triggered.body.cloudRun.source.type, "routine");
    assert.equal(triggered.body.notification.status, "waiting_for_run");
    assert.equal(queue.enqueueCalls, 1);

    const triggers = await invokeJson(handler, {
      pathname: `/routines/${routineId}/triggers`,
      token: "secret",
    });
    assert.equal(triggers.statusCode, 200);
    assert.equal(triggers.body.triggers.length, 1);
    assert.equal(triggers.body.triggers[0].cloudRunId, triggered.body.cloudRun.id);
  } finally {
    cleanup();
  }
});

test("routine scheduler fires due enabled routines once and skips disabled routines", async () => {
  const { store, cleanup } = createTempStore();
  const queue = {
    enqueueCalls: 0,
    enqueue() {
      this.enqueueCalls += 1;
    },
  };
  const now = new Date("2026-01-01T00:00:01.000Z");

  try {
    const due = store.createRoutine({
      ...createRoutinePayload({
        name: "Due routine",
        schedule: {
          type: "daily",
          time: "09:00",
          timezone: "Asia/Kolkata",
        },
      }),
      nextRunAt: "2026-01-01T00:00:00.000Z",
    });
    const disabled = store.createRoutine({
      ...createRoutinePayload({
        name: "Disabled routine",
        enabled: false,
      }),
      nextRunAt: "2026-01-01T00:00:00.000Z",
    });

    const scheduler = createRoutineScheduler({
      store,
      queue,
      now: () => now,
      logStream: { write() {} },
    });

    const fired = await scheduler.tick();
    assert.equal(fired.length, 1);
    assert.equal(queue.enqueueCalls, 1);

    const dueTriggers = store.listRoutineTriggers(due.id);
    assert.equal(dueTriggers.length, 1);
    assert.equal(dueTriggers[0].triggeredBy, "schedule");
    assert.equal(store.listRoutineTriggers(disabled.id).length, 0);
    assert.ok(store.getRoutine(due.id).nextRunAt > now.toISOString());

    const secondTick = await scheduler.tick();
    assert.equal(secondTick.length, 0);
  } finally {
    cleanup();
  }
});

test("notification dispatcher waits for running runs and sends console email after completion", async () => {
  const { store, cleanup } = createTempStore();
  const sent = [];

  try {
    const routine = store.createRoutine(
      createRoutinePayload({
        notification: {
          type: "email",
          to: ["mom@example.com"],
        },
      }),
    );
    const triggered = store.triggerRoutine(routine.id);
    const dispatcher = createNotificationDispatcher({
      store,
      config: { emailProvider: "console" },
      sendEmail(email) {
        sent.push(email);
      },
      logStream: { write() {} },
    });

    await dispatcher.tick();
    assert.equal(sent.length, 0);
    assert.equal(store.listPendingNotifications().length, 1);

    store.markCompleted(triggered.cloudRun.id, {
      ok: true,
      summary: "IPO summary",
      finalResult: {
        rows: [
          {
            name: "Kratikal Tech",
            subscription: "220.71x",
            gmp: "₹70",
            gmpPercent: "51.85%",
          },
        ],
      },
      plannerRunId: "planner_123",
      eventLogPath: "/tmp/events.jsonl",
    });

    await dispatcher.tick();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to[0], "mom@example.com");
    assert.match(sent[0].bodyText, /IPO summary/);
    assert.match(sent[0].bodyText, /Rows:/);
    assert.match(sent[0].bodyText, /Kratikal Tech/);
    assert.match(sent[0].html, /IPO summary/);
    assert.match(sent[0].html, /<table/);
    assert.equal(store.listPendingNotifications().length, 0);
    assert.equal(
      store
        .getRunForApi(triggered.cloudRun.id)
        .progress.events.some((event) => event.kind === "notification_sent"),
      true,
    );
  } finally {
    cleanup();
  }
});

test("notification dispatcher sends email through mocked Gmail API", async () => {
  const { store, cleanup } = createTempStore();
  const gmailRequests = [];

  try {
    const routine = store.createRoutine(
      createRoutinePayload({
        notification: {
          type: "email",
          to: ["mom@example.com"],
        },
      }),
    );
    const triggered = store.triggerRoutine(routine.id);
    store.markCompleted(triggered.cloudRun.id, {
      ok: true,
      summary: "IPO summary",
      finalResult: {},
    });

    const dispatcher = createNotificationDispatcher({
      store,
      config: {
        emailProvider: "gmail_api",
        emailFrom: "Saket Mundhada <saketmundhada7@gmail.com>",
        gmailClientId: "gmail-client-id",
        gmailClientSecret: "gmail-client-secret",
        gmailRefreshToken: "gmail-refresh-token",
        gmailTokenUrl: "https://oauth2.example.test/token",
        gmailSendUrl: "https://gmail.example.test/send",
        gmailTimeoutMs: 15000,
      },
      async fetchImpl(url, request) {
        gmailRequests.push({ url, request });
        if (url === "https://oauth2.example.test/token") {
          assert.equal(request.method, "POST");
          assert.equal(request.headers["Content-Type"], "application/x-www-form-urlencoded");
          assert.equal(request.body.get("client_id"), "gmail-client-id");
          assert.equal(request.body.get("client_secret"), "gmail-client-secret");
          assert.equal(request.body.get("refresh_token"), "gmail-refresh-token");
          assert.equal(request.body.get("grant_type"), "refresh_token");
          return {
            ok: true,
            status: 200,
            async json() {
              return { access_token: "gmail-access-token" };
            },
          };
        }

        assert.equal(url, "https://gmail.example.test/send");
        assert.equal(request.method, "POST");
        assert.equal(request.headers.Authorization, "Bearer gmail-access-token");
        assert.equal(request.headers["Content-Type"], "application/json");
        return {
          ok: true,
          status: 200,
          async json() {
            return { id: "gmail-message-1" };
          },
        };
      },
      logStream: { write() {} },
    });

    await dispatcher.tick();

    assert.equal(gmailRequests.length, 2);
    const raw = JSON.parse(gmailRequests[1].request.body).raw;
    const paddedRaw = `${raw}${"=".repeat((4 - (raw.length % 4)) % 4)}`;
    const mime = Buffer.from(
      paddedRaw.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    assert.match(mime, /From: Saket Mundhada <saketmundhada7@gmail\.com>/);
    assert.match(mime, /To: mom@example\.com/);
    assert.match(mime, /Subject: \[WebGPT\] Test routine completed/);
    assert.match(mime, /IPO summary/);
    assert.equal(store.listPendingNotifications().length, 0);
    assert.equal(
      store
        .getRunForApi(triggered.cloudRun.id)
        .progress.events.some((event) => event.kind === "notification_sent"),
      true,
    );
  } finally {
    cleanup();
  }
});

test("notification dispatcher sends failure email body and marks missing provider config failed", async () => {
  const { store, cleanup } = createTempStore();
  const sent = [];

  try {
    const routine = store.createRoutine(
      createRoutinePayload({
        notification: {
          type: "email",
          to: ["mom@example.com"],
        },
      }),
    );
    const failedTrigger = store.triggerRoutine(routine.id);
    store.markFailed(failedTrigger.cloudRun.id, new Error("Browser crashed"));

    const dispatcher = createNotificationDispatcher({
      store,
      config: { emailProvider: "console" },
      sendEmail(email) {
        sent.push(email);
      },
      logStream: { write() {} },
    });
    await dispatcher.tick();
    assert.equal(sent.length, 1);
    assert.match(sent[0].bodyText, /Browser crashed/);

    const gmailTrigger = store.triggerRoutine(routine.id);
    store.markCompleted(gmailTrigger.cloudRun.id, {
      ok: true,
      summary: "Done",
      finalResult: {},
    });
    const brokenGmail = createNotificationDispatcher({
      store,
      config: {
        emailProvider: "gmail_api",
        gmailClientId: "",
        gmailClientSecret: "",
        gmailRefreshToken: "",
        emailFrom: "",
      },
      logStream: { write() {} },
    });
    await brokenGmail.tick();

    const failedNotification = store
      .listPendingNotifications()
      .find((notification) => notification.cloudRunId === gmailTrigger.cloudRun.id);
    assert.equal(failedNotification, undefined);
    assert.equal(
      store
        .getRunForApi(gmailTrigger.cloudRun.id)
        .progress.events.some((event) => event.kind === "notification_failed"),
      true,
    );
  } finally {
    cleanup();
  }
});
