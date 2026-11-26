import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createWebGptPlannerAdapter } from "../apps/extension-host/src/background/adapters/webgpt/plannerAdapter.js";
import { registerMessageHandlers } from "../apps/extension-host/src/background/messages.js";
import { browserRuntime } from "../apps/extension-host/src/background/runtime/browser.js";
import { MINT_ACCESS_STORAGE_KEY, getMintAccess } from "../apps/extension-host/src/background/settings/mintAccess.js";
import { PAGE_RUNTIME_SCRIPT_FILES } from "../packages/page-runtime/src/manifest.js";

const url = "https://example.test/form";
const baseUrl = "http://127.0.0.1:3000";

test("Chrome negotiates the shared step lifecycle for browser runs only", async t => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({ ok: true, runId: "run-1", command: { type: "extract_state" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const planner = createWebGptPlannerAdapter({ baseUrl: "https://example.test" });
  const browserContext = { tabId: 7, documentId: "document-1" };
  await planner.startCommandRun({ goal: "Inspect the form", surface: "browser_dom", browserContext });
  await planner.startCommandRun({ goal: "Read the sheet", surface: "google_sheets", browserContext });
  assert.deepEqual(requests.map(request => request.browserContext),
    [{ ...browserContext, chromeStepLifecycle: 1 }, browserContext]);
});

test("Backend Settings saves a private mint token for the selected local origin", async t => {
  function storage(entries) {
    return {
      async get(key) { return Object.hasOwn(entries, key) ? { [key]: structuredClone(entries[key]) } : {}; },
      async set(update) { Object.assign(entries, structuredClone(update)); },
      async remove(key) { delete entries[key]; },
    };
  }

  const local = {};
  const session = { [MINT_ACCESS_STORAGE_KEY]: { baseUrl, token: "previous-token" } };
  const sidepanel = "chrome-extension://fixture/sidepanel.html";
  let listener;
  const oldChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: { local: storage(local), session: storage(session) },
    runtime: {
      id: "fixture",
      getURL: file => `chrome-extension://fixture/${file}`,
      onMessage: { addListener: callback => { listener = callback; } },
    },
  };
  t.after(() => {
    if (oldChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = oldChrome;
  });

  registerMessageHandlers();
  function message(type, fields = {}, sender = { id: "fixture", url: sidepanel }) {
    return new Promise(resolve => {
      assert.equal(listener({ type, ...fields }, sender, resolve), true);
    });
  }
  const saveToken = (token, target = baseUrl, sender) =>
    message("WEBGPT_SET_LOCAL_MINT_TOKEN", { baseUrl: target, token }, sender);
  const saveBackend = target => message("WEBGPT_SET_BACKEND_CONFIG", { baseUrl: target });

  assert.equal((await message("WEBGPT_GET_BACKEND_CONFIG")).config.mintTokenConfigured, false);
  assert.equal((await saveBackend(baseUrl)).config.mintTokenConfigured, true);
  assert.equal((await saveToken("new-token", baseUrl, { id: "fixture", url })).ok, false);
  assert.equal((await saveToken("new-token", baseUrl, { id: "other", url: sidepanel })).ok, false);
  assert.equal((await saveToken("new-token", "http://127.0.0.1:3001")).ok, false);
  assert.equal((await saveToken("not valid")).ok, false);
  assert.equal((await getMintAccess(baseUrl)).token, "previous-token");

  const saved = await saveToken("new-token");
  assert.equal(saved.ok, true);
  assert.equal(saved.config.mintTokenConfigured, true);
  assert.doesNotMatch(JSON.stringify(saved), /new-token|previous-token/);
  const access = await getMintAccess(baseUrl);
  assert.deepEqual(access, { token: "new-token" });
  assert.doesNotMatch(JSON.stringify(local), /new-token|previous-token/);
  assert.equal((await getMintAccess("http://127.0.0.1:3001")), null);

  const remote = "https://example.test";
  assert.equal((await saveBackend(remote)).config.mintTokenConfigured, false);
  assert.equal((await saveToken("wrong-target", remote)).ok, false);
  assert.equal((await message("WEBGPT_RESET_BACKEND_CONFIG")).config.mintTokenConfigured, false);
  assert.equal((await saveBackend(baseUrl)).config.mintTokenConfigured, true);
  assert.equal((await saveToken("")).config.mintTokenConfigured, false);
  assert.equal(await getMintAccess(baseUrl), null);
});

test("Chrome mint types its literal on the bound document and projects a fresh observation", async t => {
  const scripts = await Promise.all([
    ...PAGE_RUNTIME_SCRIPT_FILES.map(file => "../packages/page-runtime/src/" + file),
    "../apps/extension-host/src/content-scripts/agent.js",
  ].map(file => readFile(new URL(file, import.meta.url), "utf8")));

  const window = new JSDOM(`<!doctype html><title>Form</title>
    <form><label for="city">City</label><input id="city" type="text">
    <label for="name">Name</label><input id="name" value="Private Person">
    <label for="code">Code</label><input id="code" type="text" autocomplete="one-time-code">
    <label for="attachment">Upload attachment</label><input id="attachment" type="file">
    <div id="suggestions"></div>
    <button id="send" type="submit">Send</button></form>`, { url, runScripts: "outside-only" }).window;
  t.after(() => window.close());
  window.console.log = () => {};
  window.Element.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 30, width: 100, height: 30,
  });
  window.Element.prototype.scrollIntoView = () => {};
  window.PointerEvent ??= window.MouseEvent;
  let listener;
  window.chrome = { runtime: { onMessage: { addListener(callback) { listener = callback; } } } };
  scripts.forEach(source => window.eval(source));
  const city = window.document.querySelector("#city");
  city.addEventListener("input", () => {
    const option = window.document.createElement("div");
    option.id = "city-option";
    option.setAttribute("role", "option");
    option.textContent = "Matching city";
    window.document.querySelector("#suggestions").replaceChildren(option);
  });

  const originalChrome = globalThis.chrome;
  t.after(() => {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  });
  let documentId = "fixture-document";
  globalThis.chrome = {
    tabs: {
      async sendMessage(tabId, message, options) {
        assert.equal(tabId, 7);
        if (message.mintProtocol) assert.deepEqual(options, { documentId });
        return new Promise(resolve => {
          listener(structuredClone(message), {}, value => resolve(structuredClone(value)));
        });
      },
    },
    scripting: { async executeScript() { return [{ result: { href: url, isTop: true } }]; } },
    webNavigation: {
      async getAllFrames() { return [{ frameId: 0, parentFrameId: -1, url }]; },
      async getFrame({ tabId, frameId }) {
        assert.equal(tabId, 7);
        assert.equal(frameId, 0);
        return { documentId, url };
      },
    },
    storage: {
      local: { async get(key) { return { [key]: baseUrl }; } },
      session: {
        async get(key) {
          if (key !== MINT_ACCESS_STORAGE_KEY) return {};
          return { [key]: { baseUrl, token: "private-token" } };
        },
      },
    },
  };
  assert.equal(await getMintAccess("https://localhost:3000"), null);
  assert.equal(await getMintAccess("http://127.0.0.1:3001"), null);

  const start = await browserRuntime.mint.startContext(7);
  const first = await browserRuntime.mint.capture(7, start);
  assert.ok(first.observation.discoveryOk);
  assert.deepEqual(first.observation.activeAdapterIds, []);
  assert.doesNotMatch(JSON.stringify(first), /Private Person|private-token/);
  assert.deepEqual(Object.keys(first).sort(), ["binding", "observation"]);
  const controlFor = (state, selector) => state.observation.state.controls.find(control => control.selector === selector);
  assert.equal(controlFor(first, "#city-option"), undefined);
  const id = controlFor(first, "#city").id;
  const fillLiteral = { type: "fill", targetId: id, value: "Minter-chosen city" };
  const receipt = await browserRuntime.mint.runActions(7, first.binding, [fillLiteral]);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.results[0].result.verified, true);
  assert.doesNotMatch(JSON.stringify(receipt), /Minter-chosen city/);
  assert.equal(city.value, "Minter-chosen city");

  const repeated = await browserRuntime.mint.runActions(7, first.binding, [fillLiteral]);
  assert.equal(repeated.results[0].result.code, "MINT_OBSERVATION_STALE");
  let next = await browserRuntime.mint.capture(7, first.binding);
  assert.notEqual(next.binding.observationId, first.binding.observationId);
  assert.equal(controlFor(next, "#city").valueStatus, "populated_redacted");
  assert.ok(controlFor(next, "#city-option"));
  assert.doesNotMatch(JSON.stringify(next), /Minter-chosen city|Private Person|private-token/);

  for (const [selector, type] of [["#city", "fill"], ["#code", "fill"], ["#attachment", "fill"], ["#send", "click"]]) {
    const { id: targetId } = controlFor(next, selector);
    const action = type === "fill" ? { type, targetId, value: "Other text" } : { type, targetId };
    const result = await browserRuntime.mint.runActions(7, next.binding, [action]);
    assert.equal(result.results[0].result.code, "MINT_ACTION_NOT_APPROVED");
    next = await browserRuntime.mint.capture(7, next.binding);
  }
  assert.equal(city.value, "Minter-chosen city");
  assert.equal(window.document.querySelector("#code").value, "");

  city.value = "";
  next = await browserRuntime.mint.capture(7, next.binding);
  const tooLong = await browserRuntime.mint.runActions(7, next.binding, [
    { type: "fill", targetId: controlFor(next, "#city").id, value: "V".repeat(2501) },
  ]);
  assert.equal(tooLong.results[0].result.code, "MINT_ACTION_NOT_APPROVED");
  assert.equal(city.value, "");
  window.WebGPTContentAdapters.register({ id: "fixture.adapter", match: () => true });
  const matched = await browserRuntime.mint.capture(7, next.binding);
  assert.equal(matched.observation.discoveryOk, true);
  assert.deepEqual(matched.observation.activeAdapterIds, ["fixture.adapter"]);
  delete window.WebGPTContentAdapters;
  const failed = await browserRuntime.mint.capture(7, matched.binding);
  assert.equal(failed.observation.discoveryOk, false);
  documentId = "replacement-document";
  await assert.rejects(browserRuntime.mint.capture(7, failed.binding), /document changed/i);
});
