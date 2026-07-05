import test from "node:test";
import assert from "node:assert/strict";

import { createControllerCore } from "../packages/controller-core/src/index.js";
import { getEmptySession } from "../packages/controller-core/src/state/sessionStore.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createMemorySessionStore() {
  const sessions = new Map();
  const key = (id) => String(id);

  return {
    sessions,
    async ensureHydrated() {},
    async getSession(id) {
      if (!sessions.has(key(id))) {
        sessions.set(key(id), getEmptySession(id));
      }
      return sessions.get(key(id));
    },
    async saveSession(id, session) {
      sessions.set(key(id), session);
    },
    async replaceSession(id, session) {
      sessions.set(key(id), session);
    },
    async moveSession(fromId, toId, nextSession) {
      const fromStub = getEmptySession(fromId);
      fromStub.movedToTabId = toId;
      sessions.set(key(fromId), fromStub);
      sessions.set(key(toId), {
        ...nextSession,
        tabId: toId,
        attachedTabId: toId,
        movedToTabId: null,
      });
    },
    async getSessionIfExists(id) {
      return sessions.get(key(id)) || null;
    },
  };
}

function createEventSink(store) {
  return {
    events: [],
    async addEvent(tabId, event) {
      const entry = {
        timestamp: new Date().toISOString(),
        ...clone(event),
      };
      this.events.push({ tabId, event: entry });
      const session = await store.getSession(tabId);
      session.events.push(entry);
      await store.saveSession(tabId, session);
      return entry;
    },
  };
}

function createRuntime(overrides = {}) {
  return {
    extractCalls: [],
    actionCalls: [],
    replayCalls: [],
    async detectSurfaceForTab() {
      return { surface: "browser_dom", url: "https://example.test", title: "" };
    },
    async extractStateFromTab(tabId, options = {}) {
      this.extractCalls.push({ tabId, options });
      return {
        surface: options.surface || "browser_dom",
        frames: {
          0: {
            url: "https://example.test",
            title: "Example",
            controls: [{ id: "el_1", label: "Search" }],
            scrollableContainers: [],
            headings: [],
            visibleTextSummary: [],
            overlays: [],
          },
        },
      };
    },
    async runActionsInTab(tabId, state, actions) {
      this.actionCalls.push({ tabId, state, actions });
      return {
        ok: true,
        summary: "actions ok",
        results: actions.map((action) => ({ action, result: { ok: true } })),
        tabId,
      };
    },
    async runReplayActionsInTab(tabId, steps) {
      this.replayCalls.push({ tabId, steps });
      return {
        ok: true,
        summary: "replay ok",
        results: steps.map((step) => ({ step, result: { ok: true } })),
      };
    },
    actionsMayCauseNavigation(actions) {
      return actions.some((action) => action.type === "goto");
    },
    async ensureContentScriptReady() {
      return true;
    },
    async getGoogleSheetsAuthStatus() {
      return { authenticated: true };
    },
    async getMicrosoftExcelAuthStatus() {
      return { authenticated: true };
    },
    ...overrides,
  };
}

function createPlannerAdapter({ commandsByResultType = {}, startCommand } = {}) {
  const calls = [];
  const stops = [];
  const adapter = {
    calls,
    stops,
    async startCommandRun() {
      return {
        runId: "run_1",
        run: { step: 0 },
        command:
          startCommand ||
          { type: "extract_state", runId: "run_1", step: 1, surface: "browser_dom" },
      };
    },
    async postCommandResult(args) {
      calls.push(clone(args));
      const command =
        typeof commandsByResultType === "function"
          ? commandsByResultType(args, calls)
          : commandsByResultType[args.type];
      return {
        runId: args.runId,
        run: { step: args.step || command?.step || calls.length },
        command:
          command ||
          { type: "done", runId: args.runId, step: calls.length, summary: "done" },
      };
    },
    async stopRun(args) {
      stops.push(clone(args));
      return { ok: true };
    },
    syncSessionWithRun(session, run) {
      return {
        ...session,
        step: Number.isInteger(run?.step) ? run.step : session.step,
        finalResult: run?.finalResult || session.finalResult,
      };
    },
    buildBrowserContext(tabId, session, observedUrl = "") {
      return {
        tabId,
        attachedTabId: session.attachedTabId || tabId,
        goal: session.goal,
        step: session.step,
        observedUrl,
        lastKnownUrl: session.lastKnownUrl || "",
      };
    },
    async tryRunReplayPreflight() {
      return { command: null, run: null, skipped: true };
    },
    async fetchArtifacts() {
      return [];
    },
  };
  return adapter;
}

function createHost(overrides = {}) {
  return {
    async hasBrowserHostAccess() {
      return true;
    },
    async getTab(tabId) {
      return {
        id: tabId,
        url: "https://example.test",
        status: "complete",
      };
    },
    async updateTab() {},
    onTabCreated() {
      return () => {};
    },
    onTabUpdated() {
      return () => {};
    },
    ...overrides,
  };
}

function createHarness({ plannerAdapter, runtime, host, config } = {}) {
  const store = createMemorySessionStore();
  const eventSink = createEventSink(store);
  const controller = createControllerCore({
    plannerAdapter: plannerAdapter || createPlannerAdapter(),
    runtime: runtime || createRuntime(),
    sessionStore: store,
    eventSink,
    host: host || createHost(),
    config,
  });
  return { controller, store, eventSink };
}

test("controller-core start run extracts state and pauses on planner done", async () => {
  const plannerAdapter = createPlannerAdapter();
  const runtime = createRuntime();
  const { controller, store } = createHarness({ plannerAdapter, runtime });

  const result = await controller.startAgent(1, "Find thing");

  assert.equal(result.ok, true);
  assert.equal(result.reason, "awaiting_success_confirmation");
  assert.equal(runtime.extractCalls.length, 1);
  assert.equal(plannerAdapter.calls[0].type, "state_extracted");
  assert.equal((await store.getSession(1)).pausedReason, "awaiting_success_confirmation");
});

test("controller-core executes planner actions and posts action results", async () => {
  const plannerAdapter = createPlannerAdapter({
    commandsByResultType(args) {
      if (args.type === "state_extracted") {
        return {
          type: "run_actions",
          runId: args.runId,
          step: 1,
          actions: [{ type: "click", targetId: "el_1", frameId: 0 }],
        };
      }
      return { type: "done", runId: args.runId, step: 2, summary: "clicked" };
    },
  });
  const runtime = createRuntime();
  const { controller } = createHarness({ plannerAdapter, runtime });

  const result = await controller.startAgent(1, "Click thing");

  assert.equal(result.reason, "awaiting_success_confirmation");
  assert.equal(runtime.actionCalls.length, 1);
  assert.deepEqual(runtime.actionCalls[0].actions, [
    { type: "click", targetId: "el_1", frameId: 0 },
  ]);
  assert.deepEqual(
    plannerAdapter.calls.map((call) => call.type),
    ["state_extracted", "actions_executed"],
  );
});

test("controller-core pauses for human hint after failed action result", async () => {
  const plannerAdapter = createPlannerAdapter({
    commandsByResultType(args) {
      if (args.type === "state_extracted") {
        return {
          type: "run_actions",
          runId: args.runId,
          step: 1,
          actions: [{ type: "click", targetId: "el_1", frameId: 0 }],
        };
      }
      return {
        type: "ask_human",
        runId: args.runId,
        step: 2,
        message: "Need help",
      };
    },
  });
  const runtime = createRuntime({
    async runActionsInTab() {
      return {
        ok: false,
        summary: "failed",
        error: "button missing",
        results: [],
      };
    },
  });
  const { controller, store } = createHarness({ plannerAdapter, runtime });

  const result = await controller.startAgent(1, "Click thing");

  assert.equal(result.reason, "awaiting_human_hint");
  assert.equal((await store.getSession(1)).pausedReason, "awaiting_human_hint");
});

test("controller-core runs replay preflight batches for template runs", async () => {
  const plannerAdapter = createPlannerAdapter();
  plannerAdapter.tryRunReplayPreflight = async ({ runId }) => ({
    skipped: false,
    command: {
      type: "run_replay_batch",
      runId,
      fileName: "saved.replay.json",
      batchIndex: 0,
      totalBatchCount: 1,
      batch: {
        steps: [{ action: { type: "click", targetId: "el_1", frameId: 0 } }],
      },
      isFirstBatch: true,
    },
    run: { step: 0 },
  });
  plannerAdapter.postCommandResult = async (args) => {
    plannerAdapter.calls.push(clone(args));
    return {
      runId: args.runId,
      run: { step: 1 },
      command: { type: "done", runId: args.runId, step: 1, summary: "replayed" },
    };
  };
  const runtime = createRuntime();
  const { controller } = createHarness({ plannerAdapter, runtime });

  const result = await controller.startAgent(
    1,
    "Replay thing",
    {},
    true,
    "saved.replay.json",
  );

  assert.equal(result.reason, "awaiting_success_confirmation");
  assert.equal(runtime.replayCalls.length, 1);
  assert.equal(plannerAdapter.calls[0].type, "replay_batch_executed");
});

test("controller-core max-step guard stops backend and clears local run", async () => {
  const plannerAdapter = createPlannerAdapter();
  const { controller, store } = createHarness({
    plannerAdapter,
    config: { MAX_STEPS: 1 },
  });
  const session = getEmptySession(1);
  session.goal = "Too many";
  session.runId = "run_1";
  session.step = 1;
  await store.saveSession(1, session);

  const result = await controller.continueRun(1, {
    type: "extract_state",
    runId: "run_1",
    step: 2,
  });

  assert.equal(result.reason, "max_steps_reached");
  assert.equal(plannerAdapter.stops[0].reason, "max_steps_reached");
  assert.equal((await store.getSession(1)).runId, "");
});

test("controller-core attach moves session through host tab adapter", async () => {
  const { controller, store } = createHarness({
    runtime: createRuntime({
      async detectSurfaceForTab() {
        return { surface: "browser_dom" };
      },
    }),
    host: createHost({
      async getTab(tabId) {
        return { id: tabId, url: `https://example.test/${tabId}`, status: "complete" };
      },
    }),
  });
  const session = getEmptySession(1);
  session.goal = "Move me";
  session.runId = "run_1";
  await store.saveSession(1, session);

  const result = await controller.attachSessionToTab(1, 2);

  assert.equal(result.ok, true);
  assert.equal((await store.getSession(1)).movedToTabId, 2);
  assert.equal((await store.getSession(2)).attachedTabId, 2);
});
