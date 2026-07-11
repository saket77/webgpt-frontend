const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("connector-tools registry exposes register/has/run on a content-script global", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/connectorTools.js");

  assert.match(source, /globalThis\.WebGPTConnectorTools\s*=/);
  assert.match(source, /function register/);
  assert.match(source, /function has/);
  assert.match(source, /async function run/);
});

test("connectorTools.js is injected before the site adapters", () => {
  const source = readSource("packages/page-runtime/src/manifest.js");

  assert.match(source, /content-scripts\/connectorTools\.js/);
  // Must load before greenhouse (which registers a connector executor at load time).
  const connectorIndex = source.indexOf("content-scripts/connectorTools.js");
  const greenhouseIndex = source.indexOf("content-scripts/adapters/greenhouse.js");
  assert.ok(connectorIndex !== -1 && greenhouseIndex !== -1);
  assert.ok(connectorIndex < greenhouseIndex, "connectorTools must load before greenhouse");
});

test("browser runtime uses revisioned content-script protocol before extraction and actions", () => {
  const browserSource = readSource("apps/extension-host/src/background/runtime/browser.js");
  const agentSource = readSource("apps/extension-host/src/content-scripts/agent.js");

  assert.match(browserSource, /const CONTENT_SCRIPT_PROTOCOL_REVISION = "webmcp-tools-2026-07-11"/);
  assert.match(agentSource, /const CONTENT_SCRIPT_PROTOCOL_REVISION = "webmcp-tools-2026-07-11"/);
  assert.match(browserSource, /type: PING_MESSAGE_TYPE/);
  assert.match(browserSource, /response\.protocolRevision === CONTENT_SCRIPT_PROTOCOL_REVISION/);
  assert.match(browserSource, /type: EXTRACT_STATE_MESSAGE_TYPE/);
  assert.match(browserSource, /type: RUN_ACTIONS_MESSAGE_TYPE/);
  assert.match(agentSource, /const PING_MESSAGE_TYPE = "PING_WEBGPT_CONTENT_SCRIPT"/);
  assert.match(agentSource, /const EXTRACT_STATE_MESSAGE_TYPE = "WEBGPT_EXTRACT_STATE_V2"/);
  assert.match(agentSource, /const RUN_ACTIONS_MESSAGE_TYPE = "WEBGPT_RUN_ACTIONS_V2"/);
  assert.match(agentSource, /function protocolMatches/);
  assert.match(agentSource, /connectorToolNames/);
});

test("adapter registry collects provideTools into state.connectorTools", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/registry.js");

  assert.match(source, /function collectConnectorTools/);
  assert.match(source, /adapter\.provideTools/);
  assert.match(source, /connectorTools\b/);
  assert.match(source, /nextState\s*=\s*\{\s*\.\.\.nextState,\s*connectorTools\s*\}/);
});

test("runner dispatches unknown action types to the connector-tool registry", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/runner/actions.js");

  assert.match(source, /globalThis\.WebGPTConnectorTools/);
  assert.match(source, /connectorTools\.has\(action\.type\)/);
  assert.match(source, /connectorTools\.run\(action\.type, action,/);
});

test("runner can continue after recoverable connector failures", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/runner/actions.js");

  assert.match(source, /result\.ok\s*===\s*false/);
  assert.match(source, /result\.recoverable \|\| result\.continueBatch/);
  assert.match(source, /recoverableFailures\.push/);
  assert.match(source, /recoverable connector failure/);
  assert.match(source, /Action \$\{action\.type\} reported failure/);
});
