const assert = require("node:assert/strict");
const test = require("node:test");
const { Readable } = require("node:stream");

const { createSimpleBackend } = require("./server.js");
const {
  AFTER_MUTATION_TOOL_NAME,
  BEFORE_MUTATION_TOOL_NAME,
  MUTATION_PROFILE_NAME,
  MUTATION_STATUS,
  MUTATION_TOOL_NAME,
  READ_ONLY_ARGUMENTS,
  READ_ONLY_EXPECTATION,
  READ_ONLY_TOOL_NAME,
} = require("./webmcp-fixture.js");

function fixtureTool(name, { readOnlyHint, schemaHash }) {
  return {
    source: "webmcp",
    name,
    title: name,
    description: `${name} fixture tool`,
    origin: "http://127.0.0.1:8787",
    parameters: { type: "object" },
    annotations: {
      readOnlyHint,
      untrustedContentHint: true,
    },
    schemaHash,
  };
}

const TOOLS = {
  readOnly: fixtureTool(READ_ONLY_TOOL_NAME, {
    readOnlyHint: true,
    schemaHash: "1111111111111111",
  }),
  mutation: fixtureTool(MUTATION_TOOL_NAME, {
    readOnlyHint: false,
    schemaHash: "2222222222222222",
  }),
  before: fixtureTool(BEFORE_MUTATION_TOOL_NAME, {
    readOnlyHint: true,
    schemaHash: "3333333333333333",
  }),
  after: fixtureTool(AFTER_MUTATION_TOOL_NAME, {
    readOnlyHint: true,
    schemaHash: "4444444444444444",
  }),
};

function fixtureState({ afterMutation = false } = {}) {
  return {
    surface: "browser_dom",
    url: "http://127.0.0.1:8787/webmcp-fixture",
    frames: {
      0: {
        frameId: 0,
        url: "http://127.0.0.1:8787/webmcp-fixture",
        controls: [
          {
            id: "el_profile",
            label: "Fixture profile name",
            currentValue: afterMutation
              ? MUTATION_PROFILE_NAME
              : "Before WebMCP mutation",
          },
        ],
        webMcp: {
          supported: true,
          tools: afterMutation
            ? [TOOLS.readOnly, TOOLS.mutation, TOOLS.after]
            : [TOOLS.readOnly, TOOLS.mutation, TOOLS.before],
          errors: [],
        },
      },
    },
  };
}

function webMcpExecution(actionOrActions, outputOrOutputs) {
  const actions = Array.isArray(actionOrActions)
    ? actionOrActions
    : [actionOrActions];
  const outputs = Array.isArray(outputOrOutputs)
    ? outputOrOutputs
    : [outputOrOutputs];
  return {
    ok: true,
    summary: "All actions executed.",
    results: actions.map((action, index) => ({
        action,
        result: {
          ok: true,
          webMcp: action.webMcp,
          webMcpOutput: outputs[index],
          webMcpOutputMeta: { truncated: false },
        },
      })),
  };
}

function invoke(backend, { method = "GET", path = "/", body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = Readable.from(payload ? [payload] : []);
    req.method = method;
    req.url = path;
    req.headers = {
      host: "127.0.0.1:8787",
      ...(payload
        ? {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          }
        : {}),
    };

    const res = {
      statusCode: 0,
      headers: {},
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers || {};
      },
      end(chunk = "") {
        const raw = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        const contentType = String(
          this.headers["Content-Type"] || this.headers["content-type"] || "",
        );
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          raw,
          body:
            contentType.includes("application/json") && raw
              ? JSON.parse(raw)
              : raw,
        });
      },
    };

    Promise.resolve(backend.handle(req, res)).catch(reject);
  });
}

test("default mode preserves the existing hardcoded action batch", async () => {
  const backend = createSimpleBackend({
    env: {
      WEBGPT_SIMPLE_TARGET_ID: "el_test",
      WEBGPT_SIMPLE_FILL_TEXT: "unchanged demo",
      WEBGPT_SIMPLE_DELAY_MS: "25",
    },
    now: () => 101,
  });

  const response = await invoke(backend, {
    method: "POST",
    path: "/runs/start-command",
    body: { goal: "Use the original demo" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.runId, "simple_run_101");
  assert.equal(response.body.command.type, "run_actions");
  assert.deepEqual(response.body.command.actions, [
    {
      type: "wait",
      targetId: "",
      frameId: 0,
      key: "",
      direction: "",
      ms: 25,
    },
    {
      type: "fill",
      targetId: "el_test",
      frameId: 0,
      value: "unchanged demo",
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
  ]);
});

test("webmcp mode serves a dependency-free page with visible payload oracles", async () => {
  const backend = createSimpleBackend({
    env: { WEBGPT_SIMPLE_MODE: "webmcp" },
  });

  const response = await invoke(backend, { path: "/webmcp-fixture" });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["Content-Type"], /text\/html/);
  assert.match(response.body, /document\.modelContext/);
  assert.match(response.body, /registerTool/);
  assert.match(response.body, new RegExp(READ_ONLY_TOOL_NAME));
  assert.match(response.body, new RegExp(MUTATION_TOOL_NAME));
  assert.match(response.body, new RegExp(READ_ONLY_EXPECTATION.digest));
  assert.match(
    response.body,
    new RegExp(String(READ_ONLY_EXPECTATION.serializedBytes)),
  );
  assert.match(response.body, /id="profile-name"/);
  assert.equal(response.body.includes("<script src="), false);
  const inlineScript = response.body.match(/<script>([\s\S]+)<\/script>/)?.[1];
  assert.ok(inlineScript);
  assert.doesNotThrow(() => new Function(inlineScript));
});

test("webmcp mode runs exact read and mutation in one ordered batch", async () => {
  const backend = createSimpleBackend({
    env: { WEBGPT_SIMPLE_MODE: "webmcp" },
    now: () => 202,
  });

  const start = await invoke(backend, {
    method: "POST",
    path: "/runs/start-command",
    body: { goal: "Run the deterministic WebMCP fixture" },
  });
  const runId = start.body.runId;

  assert.equal(runId, "simple_run_202");
  assert.equal(start.body.command.type, "extract_state");
  assert.equal(start.body.command.surface, "browser_dom");

  const discovery = await invoke(backend, {
    method: "POST",
    path: `/runs/${runId}/command-result`,
    body: {
      type: "state_extracted",
      state: fixtureState(),
    },
  });

  const [readOnlyAction, mutationAction] = discovery.body.command.actions;
  assert.equal(discovery.body.command.type, "run_actions");
  assert.equal(discovery.body.command.actions.length, 2);
  assert.equal(readOnlyAction.executor, "webmcp");
  assert.equal(readOnlyAction.frameId, 0);
  assert.equal(readOnlyAction.webMcp.name, READ_ONLY_TOOL_NAME);
  assert.equal(readOnlyAction.webMcp.schemaHash, TOOLS.readOnly.schemaHash);
  assert.equal(readOnlyAction.webMcp.readOnlyHint, true);
  assert.equal(readOnlyAction.mayCauseNavigation, false);
  assert.deepEqual(readOnlyAction.arguments, READ_ONLY_ARGUMENTS);
  assert.ok(readOnlyAction.arguments.longText.length > 500);
  assert.ok(readOnlyAction.arguments.items.length > 20);
  assert.equal(
    Buffer.byteLength(JSON.stringify(readOnlyAction.arguments)),
    READ_ONLY_EXPECTATION.serializedBytes,
  );
  assert.equal(mutationAction.executor, "webmcp");
  assert.equal(mutationAction.webMcp.name, MUTATION_TOOL_NAME);
  assert.equal(mutationAction.webMcp.schemaHash, TOOLS.mutation.schemaHash);
  assert.equal(mutationAction.webMcp.readOnlyHint, false);
  assert.equal(mutationAction.mayCauseNavigation, true);
  assert.deepEqual(mutationAction.arguments, {
    profileName: MUTATION_PROFILE_NAME,
    status: MUTATION_STATUS,
  });

  const batchResult = await invoke(backend, {
    method: "POST",
    path: `/runs/${runId}/command-result`,
    body: {
      type: "actions_executed",
      execution: webMcpExecution(
        [readOnlyAction, mutationAction],
        [
          { ...READ_ONLY_EXPECTATION },
          {
            profileName: MUTATION_PROFILE_NAME,
            status: MUTATION_STATUS,
            activeTool: AFTER_MUTATION_TOOL_NAME,
          },
        ],
      ),
      postState: fixtureState({ afterMutation: true }),
    },
  });

  assert.equal(batchResult.body.command.type, "done");
  assert.equal(
    batchResult.body.command.finalResult.webMcpFixture.passed,
    true,
  );
  assert.match(batchResult.body.command.summary, /exact long\/nested arguments/);
  assert.deepEqual(
    batchResult.body.command.finalResult.webMcpFixture.evidence.toolNames,
    [READ_ONLY_TOOL_NAME, MUTATION_TOOL_NAME, AFTER_MUTATION_TOOL_NAME],
  );
});

test("webmcp mode fails closed when the exact-payload oracle mismatches", async () => {
  const backend = createSimpleBackend({
    env: { WEBGPT_SIMPLE_MODE: "webmcp" },
    now: () => 303,
  });
  const start = await invoke(backend, {
    method: "POST",
    path: "/runs/start-command",
    body: { goal: "Detect truncation" },
  });
  const runId = start.body.runId;
  const discovery = await invoke(backend, {
    method: "POST",
    path: `/runs/${runId}/command-result`,
    body: { type: "state_extracted", state: fixtureState() },
  });
  const [readOnlyAction, mutationAction] = discovery.body.command.actions;

  const result = await invoke(backend, {
    method: "POST",
    path: `/runs/${runId}/command-result`,
    body: {
      type: "actions_executed",
      execution: webMcpExecution(
        [readOnlyAction, mutationAction],
        [
          {
            ...READ_ONLY_EXPECTATION,
            digest: "truncated-or-changed",
          },
          {
            profileName: MUTATION_PROFILE_NAME,
            status: MUTATION_STATUS,
            activeTool: AFTER_MUTATION_TOOL_NAME,
          },
        ],
      ),
      postState: fixtureState({ afterMutation: true }),
    },
  });

  assert.equal(result.body.command.type, "done");
  assert.equal(result.body.command.finalResult.webMcpFixture.passed, false);
  assert.match(result.body.command.summary, /oracle mismatch for digest/);
});
