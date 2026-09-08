import assert from "node:assert/strict";
import test from "node:test";

import {
  createWebGptApiClient,
  PLANNER_CONTEXT_ERROR_CODES,
  PLANNER_CONTEXT_SCHEMA_VERSION,
  WebGptPlannerContextError,
} from "../src/index.js";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function validPlannerContextRequest(overrides = {}) {
  return {
    schemaVersion: PLANNER_CONTEXT_SCHEMA_VERSION,
    goal: "Inspect the page",
    currentState: {},
    history: [],
    lastOutcome: null,
    transition: null,
    options: { externalPlanner: true },
    ...overrides,
  };
}

function validTransition(overrides = {}) {
  return {
    eventId: "event-1",
    step: 1,
    beforeState: {},
    actions: [{ type: "click" }],
    execution: { ok: true },
    ...overrides,
  };
}

function withoutKey(value, key) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function validPlannerInput(overrides = {}) {
  return {
    state: {},
    history: [],
    lastOutcome: null,
    workflowHints: {},
    workflowState: {},
    surfaceTargets: {},
    ...overrides,
  };
}

function validPlannerContextResponse(overrides = {}) {
  return {
    ok: true,
    schemaVersion: PLANNER_CONTEXT_SCHEMA_VERSION,
    plannerInput: validPlannerInput(),
    historyEntry: null,
    ...overrides,
  };
}

test("preparePlannerContext posts the versioned payload to only the prepare route", async () => {
  const calls = [];
  const controller = new AbortController();
  const payload = validPlannerContextRequest({
    goal: "Submit the form",
    currentState: { url: "https://example.test/form" },
    transition: validTransition({
      beforeState: { url: "https://example.test/form" },
      actions: [{ type: "click", elementId: 7 }],
    }),
  });
  const expected = validPlannerContextResponse({
    historyEntry: { eventId: "event-1", step: 1 },
  });
  const client = createWebGptApiClient({
    baseUrl: "https://backend.example.test/",
    fetchImpl: async (...args) => {
      calls.push(args);
      return response(expected);
    },
  });

  const actual = await client.preparePlannerContext(payload, {
    signal: controller.signal,
  });

  assert.equal(actual, expected);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0][0],
    "https://backend.example.test/planner-context/prepare",
  );
  assert.deepEqual(calls[0][1], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
});

test("preparePlannerContext resolves bearer auth and merges caller headers", async () => {
  const calls = [];
  const resolverCalls = [];
  const client = createWebGptApiClient({
    baseUrl: "unused",
    resolveBaseUrl: async ({ baseUrl }) => {
      assert.equal(baseUrl, "unused");
      return "https://resolved.example.test///";
    },
    accessToken: "stale-token",
    resolveAccessToken: async (context) => {
      resolverCalls.push(context);
      return "fresh-token";
    },
    headers: { "X-WebGPT-Client": "codex-plugin" },
    fetchImpl: async (...args) => {
      calls.push(args);
      return response(validPlannerContextResponse());
    },
  });

  await client.preparePlannerContext(
    validPlannerContextRequest({
      goal: "Inspect",
      currentState: {},
    }),
  );

  assert.deepEqual(resolverCalls, [
    {
      accessToken: "stale-token",
      baseUrl: "https://resolved.example.test",
      path: "/planner-context/prepare",
      method: "POST",
    },
  ]);
  assert.deepEqual(calls[0][1].headers, {
    "X-WebGPT-Client": "codex-plugin",
    Authorization: "Bearer fresh-token",
    "Content-Type": "application/json",
  });
});

test("an explicit Authorization header takes precedence over accessToken", async () => {
  let request;
  const client = createWebGptApiClient({
    baseUrl: "https://backend.example.test",
    accessToken: "unused-token",
    headers: { authorization: "Bearer explicit-token" },
    fetchImpl: async (...args) => {
      request = args[1];
      return response(validPlannerContextResponse());
    },
  });

  await client.preparePlannerContext(validPlannerContextRequest());

  assert.equal(request.headers.authorization, "Bearer explicit-token");
  assert.equal(request.headers.Authorization, undefined);
});

test("legacy calls keep their existing route, body, response, and default headers", async () => {
  const calls = [];
  const client = createWebGptApiClient({
    baseUrl: "https://backend.example.test/",
    accessToken: "planner-context-token",
    resolveAccessToken: async () => {
      throw new Error("planner-context auth must not run for legacy calls");
    },
    headers: { "X-Planner-Context": "configured" },
    fetchImpl: async (...args) => {
      calls.push(args);
      return response({ ok: true, runId: "run-1", command: { type: "read" } });
    },
  });

  const result = await client.startCommandRun({ goal: "Read the page" });

  assert.deepEqual(result, {
    runId: "run-1",
    run: null,
    command: { type: "read" },
  });
  assert.equal(calls[0][0], "https://backend.example.test/runs/start-command");
  assert.deepEqual(calls[0][1].headers, {
    "Content-Type": "application/json",
  });
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    goal: "Read the page",
    inputValues: {},
    isTemplateRun: false,
    state: null,
    userHint: "",
    browserContext: {},
    artifactFileName: "",
    surface: "",
    myInfo: null,
    attachments: [],
    profileAttachments: [],
  });
});

for (const [label, invalidRequest] of [
  ["non-object payload", null],
  ["missing goal", withoutKey(validPlannerContextRequest(), "goal")],
  ["empty goal", validPlannerContextRequest({ goal: "   " })],
  ["non-object state", validPlannerContextRequest({ currentState: [] })],
  ["non-array history", validPlannerContextRequest({ history: {} })],
  ["invalid last outcome", validPlannerContextRequest({ lastOutcome: [] })],
  ["incomplete transition", validPlannerContextRequest({ transition: {} })],
  [
    "empty transition event id",
    validPlannerContextRequest({ transition: validTransition({ eventId: " " }) }),
  ],
  [
    "non-positive transition step",
    validPlannerContextRequest({ transition: validTransition({ step: 0 }) }),
  ],
  [
    "non-integer transition step",
    validPlannerContextRequest({ transition: validTransition({ step: 1.5 }) }),
  ],
  [
    "invalid transition before state",
    validPlannerContextRequest({
      transition: validTransition({ beforeState: [] }),
    }),
  ],
  [
    "empty transition actions",
    validPlannerContextRequest({ transition: validTransition({ actions: [] }) }),
  ],
  [
    "invalid transition execution",
    validPlannerContextRequest({
      transition: validTransition({ execution: null }),
    }),
  ],
  [
    "unknown transition field",
    validPlannerContextRequest({
      transition: validTransition({ command: { type: "read" } }),
    }),
  ],
  ["invalid options", validPlannerContextRequest({ options: null })],
  [
    "missing external planner option",
    validPlannerContextRequest({ options: {} }),
  ],
  [
    "non-boolean external planner option",
    validPlannerContextRequest({ options: { externalPlanner: "true" } }),
  ],
  [
    "disabled external planner option",
    validPlannerContextRequest({ options: { externalPlanner: false } }),
  ],
  [
    "unknown option",
    validPlannerContextRequest({
      options: { externalPlanner: true, replay: true },
    }),
  ],
  ["run id", validPlannerContextRequest({ runId: "run-1" })],
  ["command", validPlannerContextRequest({ command: { type: "read" } })],
  ["replay state", validPlannerContextRequest({ replay: {} })],
  ["artifact state", validPlannerContextRequest({ artifact: {} })],
  ["unknown top-level field", validPlannerContextRequest({ surprise: true })],
]) {
  test(`preparePlannerContext rejects request ${label} before fetch`, async () => {
    let fetchCalled = false;
    const client = createWebGptApiClient({
      baseUrl: "https://backend.example.test",
      fetchImpl: async () => {
        fetchCalled = true;
        return response(validPlannerContextResponse());
      },
    });

    await assert.rejects(
      client.preparePlannerContext(invalidRequest),
      (error) => {
        assert.ok(error instanceof WebGptPlannerContextError);
        assert.equal(error.code, PLANNER_CONTEXT_ERROR_CODES.SCHEMA);
        assert.equal(error.phase, "request");
        return true;
      },
    );
    assert.equal(fetchCalled, false);
  });
}

test("preparePlannerContext rejects a mismatched request version before fetch", async () => {
  let fetchCalled = false;
  const client = createWebGptApiClient({
    baseUrl: "https://backend.example.test",
    fetchImpl: async () => {
      fetchCalled = true;
      return response(validPlannerContextResponse());
    },
  });

  await assert.rejects(
    client.preparePlannerContext(
      validPlannerContextRequest({ schemaVersion: "future-version" }),
    ),
    (error) => {
      assert.ok(error instanceof WebGptPlannerContextError);
      assert.equal(error.code, PLANNER_CONTEXT_ERROR_CODES.SCHEMA);
      assert.equal(error.phase, "request");
      return true;
    },
  );
  assert.equal(fetchCalled, false);
});

for (const [label, invalidResponse] of [
  [
    "response version",
    validPlannerContextResponse({ schemaVersion: "future-version" }),
  ],
  ["planner input", validPlannerContextResponse({ plannerInput: null })],
  [
    "planner state",
    validPlannerContextResponse({
      plannerInput: validPlannerInput({ state: null }),
    }),
  ],
  [
    "planner history",
    validPlannerContextResponse({
      plannerInput: validPlannerInput({ history: null }),
    }),
  ],
  [
    "planner last outcome",
    validPlannerContextResponse({
      plannerInput: validPlannerInput({ lastOutcome: [] }),
    }),
  ],
  [
    "workflow hints",
    validPlannerContextResponse({
      plannerInput: validPlannerInput({ workflowHints: [] }),
    }),
  ],
  [
    "workflow state",
    validPlannerContextResponse({
      plannerInput: validPlannerInput({ workflowState: null }),
    }),
  ],
  [
    "surface targets",
    validPlannerContextResponse({
      plannerInput: validPlannerInput({ surfaceTargets: [] }),
    }),
  ],
  [
    "missing planner input field",
    validPlannerContextResponse({
      plannerInput: withoutKey(validPlannerInput(), "workflowHints"),
    }),
  ],
  [
    "unknown planner input field",
    validPlannerContextResponse({
      plannerInput: validPlannerInput({ command: { type: "read" } }),
    }),
  ],
  [
    "history entry",
    validPlannerContextResponse({ historyEntry: [] }),
  ],
  [
    "missing top-level field",
    withoutKey(validPlannerContextResponse(), "historyEntry"),
  ],
]) {
  test(`preparePlannerContext rejects an invalid ${label}`, async () => {
    const client = createWebGptApiClient({
      baseUrl: "https://backend.example.test",
      fetchImpl: async () => response(invalidResponse),
    });

    await assert.rejects(
      client.preparePlannerContext({
        ...validPlannerContextRequest(),
      }),
      (error) => {
        assert.ok(error instanceof WebGptPlannerContextError);
        assert.equal(error.code, PLANNER_CONTEXT_ERROR_CODES.SCHEMA);
        assert.equal(error.phase, "response");
        return true;
      },
    );
  });
}

for (const forbiddenField of [
  "runId",
  "command",
  "actions",
  "replay",
  "artifact",
]) {
  test(`preparePlannerContext rejects response field ${forbiddenField}`, async () => {
    const client = createWebGptApiClient({
      baseUrl: "https://backend.example.test",
      fetchImpl: async () =>
        response(
          validPlannerContextResponse({ [forbiddenField]: {} }),
        ),
    });

    await assert.rejects(
      client.preparePlannerContext(validPlannerContextRequest()),
      (error) => {
        assert.ok(error instanceof WebGptPlannerContextError);
        assert.equal(error.code, PLANNER_CONTEXT_ERROR_CODES.SCHEMA);
        assert.equal(error.phase, "response");
        return true;
      },
    );
  });
}

test("preparePlannerContext exposes stable HTTP error fields", async () => {
  const client = createWebGptApiClient({
    baseUrl: "https://backend.example.test",
    fetchImpl: async () =>
      response(
        {
          ok: false,
          code: "PLANNER_CONTEXT_UNAUTHORIZED",
          error: "Unauthorized.",
        },
        401,
      ),
  });

  await assert.rejects(
    client.preparePlannerContext(validPlannerContextRequest()),
    (error) => {
      assert.ok(error instanceof WebGptPlannerContextError);
      assert.equal(error.code, PLANNER_CONTEXT_ERROR_CODES.HTTP);
      assert.equal(error.phase, "response");
      assert.equal(error.status, 401);
      assert.equal(error.backendCode, "PLANNER_CONTEXT_UNAUTHORIZED");
      assert.equal(error.message, "Unauthorized.");
      return true;
    },
  );
});

test("preparePlannerContext normalizes AbortError failures", async () => {
  const cause = new Error("fetch aborted");
  cause.name = "AbortError";
  const client = createWebGptApiClient({
    baseUrl: "https://backend.example.test",
    fetchImpl: async () => {
      throw cause;
    },
  });

  await assert.rejects(
    client.preparePlannerContext(validPlannerContextRequest()),
    (error) => {
      assert.ok(error instanceof WebGptPlannerContextError);
      assert.equal(error.code, PLANNER_CONTEXT_ERROR_CODES.ABORTED);
      assert.equal(error.phase, "request");
      assert.equal(error.cause, cause);
      return true;
    },
  );
});

test("preparePlannerContext rejects a pre-aborted signal without fetching", async () => {
  const controller = new AbortController();
  const reason = new Error("deadline reached");
  controller.abort(reason);
  let fetchCalled = false;
  const client = createWebGptApiClient({
    baseUrl: "https://backend.example.test",
    fetchImpl: async () => {
      fetchCalled = true;
      return response(validPlannerContextResponse());
    },
  });

  await assert.rejects(
    client.preparePlannerContext(
      validPlannerContextRequest(),
      { signal: controller.signal },
    ),
    (error) => {
      assert.ok(error instanceof WebGptPlannerContextError);
      assert.equal(error.code, PLANNER_CONTEXT_ERROR_CODES.ABORTED);
      assert.equal(error.cause, reason);
      return true;
    },
  );
  assert.equal(fetchCalled, false);
});

test("preparePlannerContext normalizes non-HTTP transport failures", async () => {
  const cause = new Error("socket unavailable");
  const client = createWebGptApiClient({
    baseUrl: "https://backend.example.test",
    fetchImpl: async () => {
      throw cause;
    },
  });

  await assert.rejects(
    client.preparePlannerContext(validPlannerContextRequest()),
    (error) => {
      assert.ok(error instanceof WebGptPlannerContextError);
      assert.equal(error.code, PLANNER_CONTEXT_ERROR_CODES.NETWORK);
      assert.equal(error.cause, cause);
      return true;
    },
  );
});
