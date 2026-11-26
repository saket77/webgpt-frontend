import test from "node:test";
import assert from "node:assert/strict";

import { createControllerCore } from "../packages/controller-core/src/index.js";
import { getEmptySession } from "../packages/controller-core/src/state/sessionStore.js";
import { buildBrowserContext, syncSessionWithRun } from "../packages/planner-http-adapter/src/runContext.js";

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
    sourceProviderCalls: [],
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
    async runSourceProviderCommands(provider, commands, context = {}) {
      this.sourceProviderCalls.push({ provider, commands, context });
      return {
        ok: true,
        provider,
        summary: "source provider ok",
        results: commands.map((command) => ({ ok: true, command })),
        snapshots: [
          {
            provider,
            workflowKind: "zoho_books_audit",
            sheets: [{ kind: "trialBalance", title: "Trial Balance", values: [] }],
          },
        ],
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

test("normal Start uses the same run through mint poll, hint and checked action receipt", async () => {
  const url = "https://example.test";
  const initial = { tabId: 1, documentId: "document-1", url };
  const actions = [{ type: "fill", targetId: "el_1", value: "Minter-chosen text" }];
  const binding = observationId => ({ ...initial, observationId });
  const outcome = { status: "waiting_for_adapter", draft: { fileName: "site.js" } };
  let captures = 0;
  let receipts = 0;
  let polls = 0;
  let resumePrompt;
  const runtime = createRuntime({
    mint: {
      async startContext() { return initial; },
      async capture(tabId, expected) {
        assert.equal(tabId, 1);
        assert.equal(expected.documentId, initial.documentId);
        const observationId = "observation-" + ++captures;
        return {
          binding: binding(observationId),
          observation: { observationId, page: { url }, discoveryOk: true, activeAdapterIds: [], state: { controls: [] } },
        };
      },
      async runActions(tabId, bound, received) {
        assert.equal(tabId, 1);
        assert.deepEqual(bound, binding("observation-2"));
        assert.deepEqual(received, actions);
        receipts++;
        return { ok: true, results: [{ action: { type: "fill", targetId: "el_1" }, result: { ok: true, verified: true } }] };
      },
    },
  });
  const plannerAdapter = createPlannerAdapter();
  const classicStart = plannerAdapter.startCommandRun;
  Object.assign(plannerAdapter, {
    buildBrowserContext,
    syncSessionWithRun,
    async startCommandRun(args) {
      assert.equal(args.browserContext.mintProtocol, 1);
      assert.equal(args.browserContext.tabId, 1);
      return classicStart();
    },
    async postCommandResult(args) {
      assert.equal(args.runId, "run_1");
      assert.equal(args.browserContext.mintProtocol, 1);
      let command;
      let phase = "exploring";
      if (args.type === "mint_requested") {
        assert.equal(captures, 1);
        assert.equal(args.state, undefined);
        assert.equal(args.mintObservation.observationId, "observation-1");
        command = { type: "wait_for_command", retryAfterMs: 1 };
      } else if (args.type === "poll") {
        polls++;
        if (polls === 2) {
          command = { type: "ask_human", promptId: "prompt-1", message: "Is this the right field?" };
          phase = "awaiting_hint";
        } else if (polls === 5) {
          command = { type: "adapter_mint_outcome", outcome };
          phase = "waiting_for_adapter";
        } else {
          command = { type: "wait_for_command", retryAfterMs: 1 };
          if (polls > 2) phase = "reviewing_draft";
        }
      } else if (args.type === "state_extracted") {
        assert.equal(args.state, undefined);
        assert.equal(args.command.teachingOperationId, "observe-2");
        command = { type: "run_actions", teachingOperationId: "action-1", binding: binding("observation-2"), actions };
      } else {
        assert.equal(args.type, "actions_executed");
        assert.equal(args.command.teachingOperationId, "action-1");
        assert.equal(args.postState.observationId, "observation-3");
        assert.equal(args.execution.results[0].result.verified, true);
        assert.equal(args.command.actions, undefined);
        assert.doesNotMatch(JSON.stringify(args), /Minter-chosen text/);
        command = { type: "wait_for_command", retryAfterMs: 1 };
        phase = "drafting";
      }
      return { run: { step: 1, chromeStepLifecycle: 1, activePlanner: command.type === "adapter_mint_outcome" ? "classic" : "pomerado", teaching: { phase } },
        command: { ...command, runId: "run_1", step: 1 } };
    },
    async provideHumanHint(args) {
      resumePrompt = args.promptId;
      return { run: { activePlanner: "pomerado", step: 1 },
        command: { type: "extract_state", runId: "run_1", step: 1, teachingOperationId: "observe-2",
          binding: binding("observation-1") } };
    },
  });
  const { controller, eventSink, store } = createHarness({ plannerAdapter, runtime });
  const paused = await controller.startAgent(1, "Find thing");
  assert.equal(paused.reason, "awaiting_human_hint");
  assert.equal((await store.getSession(1)).mintPhase, "exploring");
  const finished = await controller.provideHintAndResume(1, "Yes");
  assert.equal(resumePrompt, "prompt-1");
  assert.equal(receipts, 1);
  assert.equal(runtime.extractCalls.length, 0);
  assert.deepEqual(finished.adapterMintOutcome, outcome);
  const session = await store.getSession(1);
  assert.equal(session.activePlanner, "classic");
  assert.equal(session.mintPhase, undefined);
  const events = eventSink.events.map(({ event }) => event);
  const mintEvents = events.filter(event => event.kind.startsWith("adapter_mint_"));
  assert.deepEqual(mintEvents.map(({ kind, activePlanner, mintPhase, step }) => [kind, activePlanner, mintPhase, step]), [
    ["adapter_mint_progress", "pomerado", "exploring", 1],
    ["adapter_mint_progress", "pomerado", "drafting", 1],
    ["adapter_mint_progress", "pomerado", "reviewing_draft", 1],
    ["adapter_mint_handoff", "classic", undefined, 1],
    ["adapter_mint_outcome", "classic", undefined, 1],
  ]);
  assert.deepEqual(events.filter(event => event.kind === "step_started").map(({ step }) => step), [1]);
  assert.deepEqual(events.filter(event => event.kind === "human_hint" || event.kind === "paused").map(({ step }) => step), [1, 1]);
  assert.ok(!events.some(event => ["planner_output", "success_confirmed"].includes(event.kind)));
});

async function testClassicMintHandoff(reuse) {
  const url = "https://example.test";
  const binding = observation => ({ tabId: 1, documentId: "document-1", url, observationId: `mint-${observation}` });
  const actions = [{ type: "click", targetId: "el_1" }];
  const mintActions = [{ type: "fill", targetId: "el_2", value: "Minter-chosen text" }];
  const classicStep = reuse ? 2 : 3;
  let observations = 0;
  const runtime = createRuntime({
    mint: {
      async startContext() { return { tabId: 1, documentId: "document-1", url }; },
      async capture() {
        const current = binding(++observations);
        return {
          binding: current,
          observation: { observationId: current.observationId, page: { url },
            discoveryOk: true, activeAdapterIds: [], state: { controls: [] } },
        };
      },
      async runActions(tabId, current, received) {
        assert.equal(tabId, 1);
        assert.deepEqual(current, binding(observations));
        assert.deepEqual(received, mintActions);
        return { ok: true, results: [{ action: { type: "fill", targetId: "el_2" }, result: { ok: true, verified: true } }] };
      },
    },
  });
  const plannerAdapter = createPlannerAdapter();
  const calls = [];
  const handoff = {
    run: { step: classicStep - 1, activePlanner: "classic", chromeStepLifecycle: 1, teaching: {
      draft: { fileName: "site.js", runtimeVerification: "pending", reused: reuse },
    } },
    command: { type: "extract_state", reason: "classic_mint_handoff", activePlanner: "classic", step: classicStep },
  };
  const mintAction = step => ({
    run: { step, activePlanner: "pomerado", chromeStepLifecycle: 1, teaching: { phase: "exploring" } },
    command: { type: "run_actions", step, actions: mintActions, teachingOperationId: `write-${step}`, binding: binding(step) },
  });
  Object.assign(plannerAdapter, {
    buildBrowserContext,
    syncSessionWithRun,
    async postCommandResult(args) {
      calls.push(args.type);
      assert.equal(args.runId, "run_1");
      assert.equal(args.browserContext.mintProtocol, 1);
      if (args.type === "mint_requested") {
        assert.equal(args.browserContext.mintHandoffProtocol, 1);
        assert.ok(eventSink.events.some(({ event }) => event.kind === "adapter_mint_progress" &&
          event.activePlanner === "pomerado" && event.step === 1));
        if (reuse) return handoff;
        return mintAction(1);
      }
      assert.equal(args.browserContext.mintHandoffProtocol, undefined);
      if (args.type === "poll") return handoff;
      if (args.command?.teachingOperationId) {
        const step = args.command.step;
        assert.equal(args.type, "actions_executed");
        assert.equal(args.browserContext.step, step);
        assert.equal(args.command.teachingOperationId, `write-${step}`);
        assert.equal(args.postState.observationId, binding(step + 1).observationId);
        assert.equal(args.execution.results[0].result.verified, true);
        if (step === 1) return mintAction(2);
        return { run: { step: 2, activePlanner: "pomerado", teaching: { phase: "drafting" } },
          command: { type: "wait_for_command", step: 2, retryAfterMs: 1 } };
      }
      if (args.type === "state_extracted") {
        assert.equal(args.step, classicStep);
        assert.equal(args.command.reason, "classic_mint_handoff");
        assert.equal(args.command.runId, "run_1");
        assert.equal(args.state.frames[0].url, url);
        assert.equal(args.mintObservation, undefined);
        assert.equal(args.browserContext.documentId, undefined);
        return { run: { step: classicStep, activePlanner: "classic" },
          command: { type: "run_actions", step: classicStep, actions, plan: { status: "continue", actions } } };
      }
      assert.equal(args.type, "actions_executed");
      assert.equal(args.command.step, classicStep);
      return { run: { step: classicStep, activePlanner: "classic" }, command: { type: "done", step: classicStep } };
    },
  });
  const { controller, eventSink, store } = createHarness({ plannerAdapter, runtime });

  const result = await controller.startAgent(1, "Find thing");

  assert.deepEqual(calls, ["mint_requested", ...(reuse ? [] : ["actions_executed", "actions_executed", "poll"]), "state_extracted", "actions_executed"]);
  assert.equal(result.reason, "awaiting_success_confirmation");
  assert.deepEqual(runtime.actionCalls[0].actions, actions);
  assert.equal((await store.getSession(1)).runId, "run_1");
  assert.equal((await store.getSession(1)).activePlanner, "classic");
  const events = eventSink.events.map(({ event }) => event);
  assert.deepEqual(events.filter(event => event.kind === "step_started").map(({ step }) => step), reuse ? [1, 2] : [1, 2, 3]);
  assert.deepEqual(events.filter(event => event.kind === "action_planned").map(({ step, action }) => [step, action.type]),
    reuse ? [[2, "click"]] : [[1, "fill"], [2, "fill"], [3, "click"]]);
  assert.doesNotMatch(JSON.stringify(events), /Minter-chosen text/);
  assert.deepEqual(events.filter(event => event.kind === "execution_result").map(({ step }) => step),
    reuse ? [2] : [1, 2, 3]);
  const handoffs = events.filter(event => event.kind === "adapter_mint_handoff");
  assert.deepEqual(handoffs.map(({ step, nextStep, activePlanner }) => [step, nextStep, activePlanner]),
    [[classicStep - 1, classicStep, "classic"]]);
  assert.match(handoffs[0].message, reuse ? /^A saved adapter draft/ : /^Pomerado saved the draft/);
  assert.ok(events.some(event => event.kind === "planner_output" && event.step === classicStep && event.activePlanner === "classic"));
  assert.ok(!events.some(event => event.kind === "adapter_mint_outcome"));
}

test("two teaching action batches and Classic share consecutive steps on the same run", () => testClassicMintHandoff(false));

test("a reused draft hands the same run directly to Classic Step 2", () => testClassicMintHandoff(true));

test("a Chrome Classic hint refreshes the paused step even at the step limit", async () => {
  const plannerAdapter = createPlannerAdapter();
  const seen = [];
  Object.assign(plannerAdapter, {
    syncSessionWithRun,
    async startCommandRun() {
      return {
        runId: "run_1", run: { step: 0, chromeStepLifecycle: 1 },
        command: { type: "extract_state", step: 1, surface: "browser_dom" },
      };
    },
    async postCommandResult(args) {
      seen.push(args);
      return {
        run: { step: 1, activePlanner: "classic" },
        command: seen.length === 1
          ? { type: "ask_human", step: 1, message: "Which role should I open?" }
          : { type: "done", step: 1 },
      };
    },
    async provideHumanHint() {
      return {
        run: { step: 1, activePlanner: "classic" },
        command: { type: "extract_state", step: 1, reason: "human_hint", operationId: "refresh-1", surface: "browser_dom" },
      };
    },
  });
  const { controller, eventSink } = createHarness({ plannerAdapter, config: { MAX_STEPS: 1 } });
  assert.equal((await controller.startAgent(1, "Open a role")).step, 1);
  assert.equal((await controller.provideHintAndResume(1, "Open the intake form")).reason, "awaiting_success_confirmation");
  assert.equal(seen[0].command, undefined);
  assert.deepEqual(seen[1].command, {
    type: "extract_state", runId: "run_1", step: 1, reason: "human_hint", operationId: "refresh-1",
  });
  const events = eventSink.events.map(({ event }) => event);
  assert.deepEqual(events.filter(({ kind }) => kind === "step_started").map(({ step }) => step), [1]);
  assert.deepEqual(events.filter(({ kind }) => kind === "state_extracted").map(({ step }) => step), [1, 1]);
});

test("an unavailable optional mint observation still completes the authenticated Classic flow", async () => {
  const runtime = createRuntime({ mint: {
    async startContext() {
      return { tabId: 1, documentId: "document-1", url: "https://example.test" };
    },
    async capture() { throw new Error("Optional top-frame observation unavailable"); },
  } });
  const plannerAdapter = createPlannerAdapter();
  const classicPost = plannerAdapter.postCommandResult;
  Object.assign(plannerAdapter, {
    buildBrowserContext,
    syncSessionWithRun,
    async postCommandResult(args) {
      assert.equal(args.browserContext.mintProtocol, 1);
      assert.equal(args.browserContext.documentId, undefined);
      assert.equal(args.mintObservation, undefined);
      return classicPost(args);
    },
    async confirmRunSuccess(args) {
      assert.equal(args.browserContext.mintProtocol, 1);
      return {};
    },
    async saveSuccessfulArtifacts() { return {}; },
  });
  const { controller } = createHarness({ plannerAdapter, runtime });
  const result = await controller.startAgent(1, "Read a page");
  assert.equal(result.reason, "awaiting_success_confirmation");
  assert.equal((await controller.confirmSuccess(1)).completed, true);
  assert.equal(plannerAdapter.stops[0].browserContext.mintProtocol, 1);
});

test("a matched adapter or failed discovery uses the ordinary Classic observation", async () => {
  const url = "https://example.test";
  const initial = { tabId: 1, documentId: "document-1", url };
  for (const discovery of [
    { discoveryOk: true, activeAdapterIds: ["example.adapter"] },
    { discoveryOk: false, activeAdapterIds: [] },
    { discoveryOk: true },
  ]) {
    const binding = { ...initial, observationId: "observation-1" };
    const runtime = createRuntime({ mint: {
      async startContext() { return initial; },
      async capture() {
        return {
          binding,
          observation: { observationId: binding.observationId, page: { url }, ...discovery },
        };
      },
    } });
    const plannerAdapter = createPlannerAdapter();
    Object.assign(plannerAdapter, { buildBrowserContext, syncSessionWithRun });
    const { controller } = createHarness({ plannerAdapter, runtime });
    const result = await controller.startAgent(1, "Fill the form");
    assert.equal(result.reason, "awaiting_success_confirmation");
    assert.equal(runtime.extractCalls.length, 1);
    assert.equal(plannerAdapter.calls[0].type, "state_extracted");
    assert.equal(plannerAdapter.calls[0].mintObservation, undefined);
    assert.equal(plannerAdapter.calls[0].browserContext.documentId, undefined);
  }
});

test("Chrome refuses a Classic command in response to its directed mint request", async () => {
  const url = "https://example.test";
  const initial = { tabId: 1, documentId: "document-1", url };
  const runtime = createRuntime({ mint: {
    async startContext() { return initial; },
    async capture() {
      return {
        binding: { ...initial, observationId: "observation-1" },
        observation: { observationId: "observation-1", page: { url }, discoveryOk: true, activeAdapterIds: [] },
      };
    },
  } });
  const plannerAdapter = createPlannerAdapter({ commandsByResultType: {
    mint_requested: { type: "run_actions", runId: "run_1", step: 1, actions: [{ type: "click", targetId: "el_1" }] },
  } });
  Object.assign(plannerAdapter, { buildBrowserContext, syncSessionWithRun });
  const { controller } = createHarness({ plannerAdapter, runtime });
  await assert.rejects(controller.startAgent(1, "Fill the form"), /did not start the site adapter planner/);
  assert.equal(runtime.actionCalls.length, 0);
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

test("controller-core runs read-only WebMCP tools under run-start consent", async () => {
  const action = {
    type: "webmcp_0_get_availability",
    executor: "webmcp",
    frameId: 0,
    webMcp: {
      name: "getAvailability",
      origin: "https://example.test",
      schemaHash: "0123456789abcdef",
      readOnlyHint: true,
      untrustedContentHint: true,
    },
    arguments: { date: "2026-07-12" },
  };
  const plannerAdapter = createPlannerAdapter({
    commandsByResultType(args) {
      if (args.type === "state_extracted") {
        return {
          type: "run_actions",
          runId: args.runId,
          step: 1,
          actions: [action],
        };
      }
      return { type: "done", runId: args.runId, step: 2, summary: "read" };
    },
  });
  const runtime = createRuntime();
  const { controller } = createHarness({ plannerAdapter, runtime });

  const result = await controller.startAgent(1, "Read availability");

  assert.equal(result.reason, "awaiting_success_confirmation");
  assert.equal(runtime.actionCalls.length, 1);
  assert.deepEqual(runtime.actionCalls[0].actions, [action]);
});

test("controller-core runs a batch of read-only WebMCP tools under run-start consent", async () => {
  const actions = ["availability", "timezone"].map((name, index) => ({
    type: `webmcp_0_get_${name}`,
    executor: "webmcp",
    frameId: 0,
    webMcp: {
      name: `get_${name}`,
      origin: "https://example.test",
      schemaHash: `read_schema_${index}`,
      readOnlyHint: true,
      untrustedContentHint: true,
    },
    arguments: { index },
  }));
  const plannerAdapter = createPlannerAdapter({
    commandsByResultType(args) {
      return args.type === "state_extracted"
        ? {
            type: "run_actions",
            runId: args.runId,
            step: 1,
            actions,
          }
        : { type: "done", runId: args.runId, step: 2, summary: "read" };
    },
  });
  const runtime = createRuntime();
  const { controller } = createHarness({ plannerAdapter, runtime });

  const result = await controller.startAgent(1, "Read two semantic sources");

  assert.equal(result.reason, "awaiting_success_confirmation");
  assert.equal(runtime.actionCalls.length, 1);
  assert.deepEqual(runtime.actionCalls[0].actions, actions);
});

test("controller-core executes mutating WebMCP under run-start website consent", async () => {
  const action = {
    type: "webmcp_0_book_slot",
    executor: "webmcp",
    frameId: 0,
    webMcp: {
      name: "bookSlot",
      origin: "https://example.test",
      schemaHash: "fedcba9876543210",
      readOnlyHint: false,
      untrustedContentHint: true,
    },
    arguments: { slotId: "slot-7", attendee: "Saket" },
  };
  const plannerAdapter = createPlannerAdapter({
    commandsByResultType(args) {
      if (args.type === "state_extracted") {
        return {
          type: "run_actions",
          runId: args.runId,
          step: 1,
          actions: [action],
        };
      }
      return { type: "done", runId: args.runId, step: 2, summary: "booked" };
    },
  });
  const runtime = createRuntime();
  const { controller } = createHarness({ plannerAdapter, runtime });

  const result = await controller.startAgent(1, "Book slot 7");

  assert.equal(result.reason, "awaiting_success_confirmation");
  assert.equal(runtime.actionCalls.length, 1);
  assert.deepEqual(runtime.actionCalls[0].actions[0].arguments, {
    slotId: "slot-7",
    attendee: "Saket",
  });
});

test("controller-core executes an ordered mixed WebMCP batch under run-start consent", async () => {
  const genericAction = {
    type: "fill",
    targetId: "el_1",
    frameId: 0,
    value: "before semantic tools",
  };
  const mutationActions = Array.from({ length: 5 }, (_, index) => ({
    type: `webmcp_0_mutate_${index + 1}`,
    executor: "webmcp",
    frameId: 0,
    webMcp: {
      name: `mutate_${index + 1}`,
      origin: "https://example.test",
      schemaHash: `schema_${index + 1}`,
      readOnlyHint: false,
      untrustedContentHint: true,
    },
    arguments: { index: index + 1 },
  }));
  const readOnlyAction = {
    type: "webmcp_0_read_after_mutations",
    executor: "webmcp",
    frameId: 0,
    webMcp: {
      name: "read_after_mutations",
      origin: "https://example.test",
      schemaHash: "read_schema",
      readOnlyHint: true,
      untrustedContentHint: true,
    },
    arguments: { include: "summary" },
  };
  const actions = [genericAction, ...mutationActions, readOnlyAction];
  const command = {
    type: "run_actions",
    runId: "run_1",
    step: 1,
    actions,
  };

  const plannerAdapter = createPlannerAdapter({
    commandsByResultType(args) {
      return args.type === "state_extracted"
        ? command
        : { type: "done", runId: args.runId, step: 2, summary: "batched" };
    },
  });
  const runtime = createRuntime();
  const { controller } = createHarness({ plannerAdapter, runtime });

  const result = await controller.startAgent(1, "Run the mixed batch");

  assert.equal(result.reason, "awaiting_success_confirmation");
  assert.equal(runtime.actionCalls.length, 1);
  assert.deepEqual(runtime.actionCalls[0].actions, actions);
});

test("controller-core executes source provider commands and posts provider results", async () => {
  const plannerAdapter = createPlannerAdapter({
    startCommand: {
      type: "extract_state",
      runId: "run_1",
      step: 1,
      surface: "google_sheets",
    },
    commandsByResultType(args) {
      if (args.type === "state_extracted") {
        return {
          type: "run_source_provider_commands",
          runId: args.runId,
          step: 1,
          surface: "google_sheets",
          provider: "zoho_books",
          commands: [
            {
              name: "fetch_audit_source_snapshot",
              workflowKind: "zoho_books_audit",
              period: { startDate: "2025-04-01", endDate: "2026-03-31" },
            },
          ],
        };
      }
      return { type: "done", runId: args.runId, step: 2, summary: "fetched" };
    },
  });
  const runtime = createRuntime();
  const { controller } = createHarness({ plannerAdapter, runtime });

  const result = await controller.startAgent(1, "Run Zoho audit");

  assert.equal(result.reason, "awaiting_success_confirmation");
  assert.equal(runtime.sourceProviderCalls.length, 1);
  assert.equal(runtime.sourceProviderCalls[0].provider, "zoho_books");
  assert.deepEqual(
    plannerAdapter.calls.map((call) => call.type),
    ["state_extracted", "source_provider_commands_executed"],
  );
  assert.equal(plannerAdapter.calls[1].execution.snapshots[0].provider, "zoho_books");
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
