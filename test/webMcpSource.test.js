const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const WEB_MCP_SOURCE = fs.readFileSync(
  path.join(
    ROOT,
    "packages/page-runtime/src/content-scripts/webMcp.js",
  ),
  "utf8",
);
const RUNNER_ACTIONS_SOURCE = fs.readFileSync(
  path.join(
    ROOT,
    "packages/page-runtime/src/content-scripts/runner/actions.js",
  ),
  "utf8",
);

function createContext(tools = null, { executeTool } = {}) {
  const modelContext = tools
    ? {
        async getTools() {
          return tools;
        },
        ...(executeTool ? { executeTool } : {}),
      }
    : null;
  const document = modelContext ? { modelContext } : {};
  const context = vm.createContext({
    document,
    globalThis: null,
    location: { origin: "https://example.test" },
    navigator: {},
    TextEncoder,
    setTimeout,
    clearTimeout,
  });
  context.globalThis = context;
  context.window = context;
  document.defaultView = context;
  vm.runInContext(WEB_MCP_SOURCE, context);
  return context;
}

function createRunnerContext({ runConnector, runWebMcp } = {}) {
  const context = vm.createContext({
    document: {},
    globalThis: null,
    setTimeout(callback) {
      callback();
      return 0;
    },
    clearTimeout() {},
  });
  context.globalThis = context;
  context.window = context;
  context.WebGPTRunnerModules = {
    domUtils: { lower: (value) => String(value || "").toLowerCase() },
    resolver: {
      getControlById() {
        return null;
      },
      resolveElement() {
        return { el: null };
      },
    },
    scrollResolver: {
      isScrollable() {
        return false;
      },
      getScrollableContainerById() {
        return null;
      },
      findScrollableAncestor() {
        return null;
      },
      findBestScrollContainer() {
        return null;
      },
      resolveScrollableContainer() {
        return { el: null };
      },
    },
    primitives: {},
    trace: {
      buildReplayTarget() {},
      buildResolvedControlTrace() {},
      buildScrollTrace() {},
      buildExtractTrace() {},
      buildGotoTrace() {},
    },
    collectionExtractor: {
      extractCollectionItems() {
        return { extractedCount: 0, items: [] };
      },
    },
  };
  context.WebGPTConnectorTools = {
    has(name) {
      return String(name).startsWith("connector_");
    },
    async run(name, action, options) {
      return runConnector
        ? runConnector(name, action, options)
        : { ok: true, detail: `${name} completed` };
    },
  };
  context.WebGPTWebMCP = {
    async executeAction(action, document, options) {
      return runWebMcp
        ? runWebMcp(action, document, options)
        : { ok: true, detail: `${action.type} completed` };
    },
  };
  vm.runInContext(RUNNER_ACTIONS_SOURCE, context);
  return context;
}

async function routedAction(context, args = {}) {
  const discovery = await context.WebGPTWebMCP.discoverTools(context.document);
  assert.equal(discovery.tools.length, 1);
  context.__webMcpRoute = discovery.tools[0];
  context.__webMcpArgsJson = JSON.stringify(args);
  return vm.runInContext(
    `({
      type: "webmcp_planner_alias",
      executor: "webmcp",
      webMcp: {
        name: __webMcpRoute.name,
        origin: __webMcpRoute.origin,
        schemaHash: __webMcpRoute.schemaHash,
        readOnlyHint: __webMcpRoute.annotations.readOnlyHint,
        untrustedContentHint: __webMcpRoute.annotations.untrustedContentHint,
      },
      arguments: JSON.parse(__webMcpArgsJson),
    })`,
    context,
  );
}

test("WebMCP bridge reports unsupported browsers without failing extraction", async () => {
  const context = createContext();
  const result = await context.WebGPTWebMCP.discoverTools(context.document);

  assert.equal(result.supported, false);
  assert.deepEqual(Array.from(result.tools), []);
  assert.deepEqual(Array.from(result.errors), []);
});

test("WebMCP bridge serializes live tool schemas and annotations", async () => {
  const context = createContext([
    {
      name: "getAvailability",
      title: "Get availability",
      description: "List available slots",
      inputSchema: JSON.stringify({
        type: "object",
        properties: { startDate: { type: "string" } },
        required: ["startDate"],
      }),
      origin: "https://calendar.test",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
    },
  ]);

  const result = await context.WebGPTWebMCP.discoverTools(context.document);

  assert.equal(result.supported, true);
  assert.equal(result.tools.length, 1);
  assert.equal(result.tools[0].source, "webmcp");
  assert.equal(result.tools[0].name, "getAvailability");
  assert.equal(result.tools[0].origin, "https://calendar.test");
  assert.equal(result.tools[0].parameters.type, "object");
  assert.equal(result.tools[0].annotations.readOnlyHint, true);
  assert.equal(result.tools[0].annotations.untrustedContentHint, true);
  assert.match(result.tools[0].schemaHash, /^[a-f0-9]{16}$/);
  assert.equal("window" in result.tools[0], false);
});

test("WebMCP bridge keeps only tools owned by the current frame", async () => {
  const context = createContext([]);
  context.document.modelContext.getTools = async () => [
    {
      name: "local_tool",
      description: "Local",
      inputSchema: '{"type":"object"}',
      origin: "https://example.test",
      window: context,
    },
    {
      name: "foreign_tool",
      description: "Foreign same-origin child",
      inputSchema: '{"type":"object"}',
      origin: "https://example.test",
      window: {},
    },
  ];

  const result = await context.WebGPTWebMCP.discoverTools(context.document);

  assert.deepEqual(
    Array.from(result.tools, (tool) => tool.name),
    ["local_tool"],
  );
});

test("WebMCP bridge drops malformed tool schemas and records discovery errors", async () => {
  const context = createContext([
    {
      name: "broken",
      description: "Broken schema",
      inputSchema: "{not-json",
      origin: "https://example.test",
    },
  ]);

  const result = await context.WebGPTWebMCP.discoverTools(context.document);

  assert.equal(result.supported, true);
  assert.equal(result.tools.length, 0);
  assert.equal(result.errors.length, 1);
});

test("WebMCP discovery bounds malformed page tools and error text", async () => {
  const context = createContext(
    Array.from({ length: 200 }, (_, index) => ({
      name: `broken_${index}`,
      description: "x".repeat(2_000),
      inputSchema: "{not-json",
      origin: "https://example.test",
    })),
  );

  const result = await context.WebGPTWebMCP.discoverTools(context.document);

  assert.equal(result.tools.length, 0);
  assert.equal(result.errors.length, context.WebGPTWebMCP.MAX_DISCOVERY_ERRORS);
  assert.ok(result.errors.every((error) => error.length <= 500));
});

test("WebMCP execution passes only exact nested arguments to the re-discovered live tool", async () => {
  const calls = [];
  const tool = {
    name: "bookSlot",
    title: "Book slot",
    description: "Books a calendar slot",
    inputSchema: JSON.stringify({
      type: "object",
      properties: {
        attendee: { type: "object" },
        note: { type: "string" },
      },
    }),
    origin: "https://calendar.test",
    annotations: { readOnlyHint: false },
  };
  const context = createContext([tool], {
    async executeTool(liveTool, serializedArguments) {
      calls.push({ liveTool, serializedArguments });
      return { confirmationId: "booking_123", status: "confirmed" };
    },
  });
  const args = {
    attendee: { name: "Ada", tags: ["VIP", "returning"] },
    note: "  preserve these spaces exactly  ",
  };
  const action = await routedAction(context, args);
  action.note = "flat routing metadata must not be executed";

  const result = await context.WebGPTWebMCP.executeAction(
    action,
    context.document,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].liveTool, tool);
  assert.equal(calls[0].serializedArguments, JSON.stringify(args));
  assert.equal(
    JSON.parse(calls[0].serializedArguments).note,
    "  preserve these spaces exactly  ",
  );
  assert.equal(result.ok, true);
  assert.equal(result.webMcpOutput.confirmationId, "booking_123");
  assert.equal(result.webMcpOutputMeta.truncated, false);
  assert.equal("extractionBatch" in result, false);
});

test("WebMCP read-only execution emits a bounded extraction batch and preserves output", async () => {
  const context = createContext(
    [
      {
        name: "getAvailability",
        title: "Get availability",
        description: "Lists available slots",
        inputSchema: '{"type":"object"}',
        origin: "https://calendar.test",
        annotations: {
          readOnlyHint: true,
          untrustedContentHint: true,
        },
      },
    ],
    {
      async executeTool() {
        return {
          slots: ["2026-07-11T10:00:00Z", "2026-07-11T11:00:00Z"],
        };
      },
    },
  );
  const action = await routedAction(context, {});

  const result = await context.WebGPTWebMCP.executeAction(
    action,
    context.document,
    { frameId: 7 },
  );

  assert.equal(result.webMcp.readOnlyHint, true);
  assert.equal(result.webMcp.untrustedContentHint, true);
  assert.equal(result.webMcpOutput.slots.length, 2);
  assert.equal(result.extractionBatch.extractedCount, 1);
  assert.equal(result.extractionBatch.frameId, 7);
  assert.equal(result.extractionBatch.context.source, "webmcp");
  assert.equal(result.extractionBatch.context.untrustedContent, true);
  assert.equal(result.extractionBatch.items[0].kind, "webmcp_tool_result");
  assert.equal(result.extractionBatch.items[0].untrustedContent, true);
  assert.match(result.extractionBatch.items[0].text, /2026-07-11T10:00:00Z/);
  assert.ok(
    Buffer.byteLength(result.extractionBatch.items[0].text, "utf8") <=
      16 * 1024,
  );
});

test("WebMCP execution rejects oversized arguments instead of truncating them", async () => {
  let executionCalls = 0;
  const context = createContext(
    [
      {
        name: "submit",
        description: "Submit text",
        inputSchema: '{"type":"object"}',
        origin: "https://example.test",
      },
    ],
    {
      async executeTool() {
        executionCalls += 1;
        return { ok: true };
      },
    },
  );
  const action = await routedAction(context, { text: "x".repeat(70 * 1024) });

  await assert.rejects(
    () => context.WebGPTWebMCP.executeAction(action, context.document),
    /execution arguments exceed 65536 bytes/,
  );
  assert.equal(executionCalls, 0);
});

test("WebMCP execution fails closed when the live schema no longer matches", async () => {
  let executionCalls = 0;
  const context = createContext(
    [
      {
        name: "get_status",
        description: "Get status",
        inputSchema: '{"type":"object"}',
        origin: "https://example.test",
      },
    ],
    {
      async executeTool() {
        executionCalls += 1;
        return { status: "ok" };
      },
    },
  );
  const action = await routedAction(context, {});
  action.webMcp.schemaHash = "0000000000000000";

  await assert.rejects(
    () => context.WebGPTWebMCP.executeAction(action, context.document),
    /no longer available with the planned schema/,
  );
  assert.equal(executionCalls, 0);
});

test("WebMCP execution fails closed when live safety annotations change", async () => {
  let executionCalls = 0;
  const tool = {
    name: "reserve",
    description: "Reserve a slot",
    inputSchema: '{"type":"object"}',
    origin: "https://calendar.test",
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: false,
    },
  };
  const context = createContext([tool], {
    async executeTool() {
      executionCalls += 1;
      return { confirmationId: "reservation_1" };
    },
  });
  const action = await routedAction(context, {});
  tool.annotations.readOnlyHint = false;

  await assert.rejects(
    () => context.WebGPTWebMCP.executeAction(action, context.document),
    /annotations changed since planning/,
  );
  assert.equal(executionCalls, 0);
});

test("WebMCP execution treats a null tool result as navigation", async () => {
  const context = createContext(
    [
      {
        name: "open_checkout",
        description: "Open checkout",
        inputSchema: '{"type":"object"}',
        origin: "https://shop.test",
      },
    ],
    { async executeTool() { return null; } },
  );
  const action = await routedAction(context, {});

  const result = await context.WebGPTWebMCP.executeAction(
    action,
    context.document,
  );

  assert.equal(result.ok, true);
  assert.equal(result.navigationStarted, true);
  assert.equal(result.webMcpOutput, null);
});

test("WebMCP execution safely bounds cyclic and oversized untrusted output", async () => {
  const output = { confirmationId: "booking_456" };
  output.circular = output;
  output.payload = "y".repeat(90 * 1024);
  const context = createContext(
    [
      {
        name: "book",
        description: "Book",
        inputSchema: '{"type":"object"}',
        origin: "https://calendar.test",
      },
    ],
    { async executeTool() { return output; } },
  );
  const action = await routedAction(context, {});

  const result = await context.WebGPTWebMCP.executeAction(
    action,
    context.document,
  );

  assert.equal(result.webMcpOutputMeta.truncated, true);
  assert.ok(
    Buffer.byteLength(JSON.stringify(result.webMcpOutput), "utf8") <= 64 * 1024,
  );
});

test("runner routes WebMCP actions before connector fallback and replay rejects them", () => {
  const actionsSource = fs.readFileSync(
    path.join(
      ROOT,
      "packages/page-runtime/src/content-scripts/runner/actions.js",
    ),
    "utf8",
  );
  const replaySource = fs.readFileSync(
    path.join(
      ROOT,
      "packages/page-runtime/src/content-scripts/runner/replayRunner.js",
    ),
    "utf8",
  );
  const webMcpRouteIndex = actionsSource.indexOf(
    'action.executor === "webmcp"',
  );
  const connectorFallbackIndex = actionsSource.indexOf(
    "globalThis.WebGPTConnectorTools",
  );

  assert.ok(webMcpRouteIndex >= 0);
  assert.ok(webMcpRouteIndex < connectorFallbackIndex);
  assert.match(replaySource, /WebMCP actions cannot be replayed/);
});

test("runner executes mixed connector and WebMCP actions in planner order", async () => {
  const calls = [];
  const context = createRunnerContext({
    async runConnector(name) {
      calls.push(name);
      return { ok: true, detail: `${name} completed` };
    },
    async runWebMcp(action) {
      calls.push(action.type);
      return { ok: true, detail: `${action.type} completed` };
    },
  });
  const actions = [
    { type: "webmcp_read_one", executor: "webmcp" },
    { type: "connector_fill" },
    { type: "webmcp_read_two", executor: "webmcp" },
  ];

  const execution = await context.WebGPTRunnerModules.actions.runActions(
    { frameId: 0 },
    actions,
  );

  assert.equal(execution.ok, true);
  assert.deepEqual(calls, actions.map((action) => action.type));
  assert.equal(execution.results.length, 3);
  assert.deepEqual(
    Array.from(execution.results, (entry) => entry.action.type),
    actions.map((action) => action.type),
  );
});

test("runner stops a mixed batch at navigation and reports the skipped tail", async () => {
  const calls = [];
  const context = createRunnerContext({
    async runConnector(name) {
      calls.push(name);
      return { ok: true, detail: `${name} completed` };
    },
    async runWebMcp(action) {
      calls.push(action.type);
      return {
        ok: true,
        detail: `${action.type} started navigation`,
        navigationStarted: true,
      };
    },
  });
  const actions = [
    { type: "connector_before" },
    { type: "webmcp_navigate", executor: "webmcp" },
    { type: "connector_after" },
  ];

  const execution = await context.WebGPTRunnerModules.actions.runActions(
    { frameId: 0 },
    actions,
  );

  assert.equal(execution.ok, true);
  assert.equal(execution.navigationStarted, true);
  assert.equal(execution.interruptedByNavigation, true);
  assert.equal(execution.results.length, 2);
  assert.deepEqual(calls, ["connector_before", "webmcp_navigate"]);
  assert.equal(execution.skippedActionCount, 1);
  assert.deepEqual(
    Array.from(execution.skippedActions, (action) => action.type),
    ["connector_after"],
  );
});

test("runner records the throwing action and leaves the remaining mixed tail unexecuted", async () => {
  const calls = [];
  const context = createRunnerContext({
    async runConnector(name) {
      calls.push(name);
      return { ok: true, detail: `${name} completed` };
    },
    async runWebMcp(action) {
      calls.push(action.type);
      throw new Error("live WebMCP schema changed");
    },
  });
  const actions = [
    { type: "connector_before" },
    { type: "webmcp_fails", executor: "webmcp" },
    { type: "connector_after" },
  ];

  const execution = await context.WebGPTRunnerModules.actions.runActions(
    { frameId: 0 },
    actions,
  );

  assert.equal(execution.ok, false);
  assert.match(execution.error, /schema changed/);
  assert.deepEqual(calls, ["connector_before", "webmcp_fails"]);
  assert.equal(execution.results.length, 2);
  assert.equal(execution.results[1].action.type, "webmcp_fails");
  assert.equal(execution.results[1].result.ok, false);
  assert.match(execution.results[1].result.error, /schema changed/);
});

test("extension host strips only frame routing before sending WebMCP actions", () => {
  const source = fs.readFileSync(
    path.join(
      ROOT,
      "apps/extension-host/src/background/runtime/browser.js",
    ),
    "utf8",
  );
  const sanitizer = source.slice(
    source.indexOf("function sanitizeActionsForRunner"),
    source.indexOf("function resolveExecutionFrameId"),
  );

  assert.match(sanitizer, /const \{ frameId, \.\.\.rest \} = action/);
  assert.doesNotMatch(sanitizer, /executor:/);
  assert.doesNotMatch(sanitizer, /webMcp:/);
  assert.doesNotMatch(sanitizer, /arguments:/);
});

test("webMcp.js is injected before state extraction in every runtime host", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "packages/page-runtime/src/manifest.js"),
    "utf8",
  );
  const bridgeIndex = source.indexOf("content-scripts/webMcp.js");
  const extractIndex = source.indexOf("content-scripts/extractState.js");

  assert.ok(bridgeIndex >= 0);
  assert.ok(extractIndex >= 0);
  assert.ok(bridgeIndex < extractIndex);
});
