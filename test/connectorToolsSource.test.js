const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("connector-tools registry exposes register/has/run on a content-script global", () => {
  const source = readSource("content-scripts/connectorTools.js");

  assert.match(source, /globalThis\.WebGPTConnectorTools\s*=/);
  assert.match(source, /function register/);
  assert.match(source, /function has/);
  assert.match(source, /async function run/);
});

test("connectorTools.js is injected before the site adapters", () => {
  const source = readSource("background/runtime/browser.js");

  assert.match(source, /content-scripts\/connectorTools\.js/);
  // Must load before greenhouse (which registers a connector executor at load time).
  const connectorIndex = source.indexOf("content-scripts/connectorTools.js");
  const greenhouseIndex = source.indexOf("content-scripts/adapters/greenhouse.js");
  assert.ok(connectorIndex !== -1 && greenhouseIndex !== -1);
  assert.ok(connectorIndex < greenhouseIndex, "connectorTools must load before greenhouse");
});

test("adapter registry collects provideTools into state.connectorTools", () => {
  const source = readSource("content-scripts/adapters/registry.js");

  assert.match(source, /function collectConnectorTools/);
  assert.match(source, /adapter\.provideTools/);
  assert.match(source, /connectorTools\b/);
  assert.match(source, /nextState\s*=\s*\{\s*\.\.\.nextState,\s*connectorTools\s*\}/);
});

test("runner dispatches unknown action types to the connector-tool registry", () => {
  const source = readSource("content-scripts/runner/actions.js");

  assert.match(source, /globalThis\.WebGPTConnectorTools/);
  assert.match(source, /connectorTools\.has\(action\.type\)/);
  assert.match(source, /connectorTools\.run\(action\.type, action,/);
});

test("runner can continue after recoverable connector failures", () => {
  const source = readSource("content-scripts/runner/actions.js");

  assert.match(source, /result\.ok\s*===\s*false/);
  assert.match(source, /result\.recoverable \|\| result\.continueBatch/);
  assert.match(source, /recoverableFailures\.push/);
  assert.match(source, /recoverable connector failure/);
  assert.match(source, /Action \$\{action\.type\} reported failure/);
});
