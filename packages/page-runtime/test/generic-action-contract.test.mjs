import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { GENERIC_ACTION_CONTRACT } from "../src/node.js";
import { pageRuntimeScriptFilesFor } from "../src/layers.js";

test("node subpath exports a deeply frozen, serializable local action contract", async () => {
  const installed = await import("@webgpt-mundhada/page-runtime/node");
  assert.equal(installed.GENERIC_ACTION_CONTRACT, GENERIC_ACTION_CONTRACT);
  assert.equal(GENERIC_ACTION_CONTRACT.schemaVersion, "webgpt.generic-actions.v1");
  assert.deepEqual(JSON.parse(JSON.stringify(GENERIC_ACTION_CONTRACT)), GENERIC_ACTION_CONTRACT);
  function assertFrozen(value) {
    if (!value || typeof value !== "object") return;
    assert.ok(Object.isFrozen(value));
    Object.values(value).forEach(assertFrozen);
  }
  assertFrozen(GENERIC_ACTION_CONTRACT);
});

test("generic schemas describe exactly the existing local runner vocabulary", async () => {
  const actions = Object.fromEntries(GENERIC_ACTION_CONTRACT.actions.map((item) => [item.name, item]));
  const runner = await readFile(new URL("../src/content-scripts/runner/actions.js", import.meta.url), "utf8");
  const runnerNames = [...runner.matchAll(/case "([a-z]+)":/g)].map((match) => match[1]);
  assert.deepEqual(Object.keys(actions).sort(), runnerNames.sort());
  const fields = {
    click: ["targetId"],
    fill: ["targetId", "value"],
    press: ["key", "targetId"],
    scroll: ["amount", "direction", "targetId"],
    wait: ["ms"],
    goto: ["url"],
    extract: ["context", "controlIds", "frameId", "targetId"],
  };
  for (const [name, expectedFields] of Object.entries(fields)) {
    assert.deepEqual(Object.keys(actions[name].parameters.properties).sort(), expectedFields.sort());
    assert.equal(actions[name].parameters.additionalProperties, false);
    assert.ok(actions[name].description.length > 20);
  }
  assert.deepEqual(actions.click.parameters.required, ["targetId"]);
  assert.deepEqual(actions.fill.parameters.required, ["targetId"]);
  assert.deepEqual(actions.goto.parameters.required, ["url"]);
  for (const name of ["press", "scroll", "wait", "extract"]) {
    assert.deepEqual(actions[name].parameters.required, []);
  }
  assert.deepEqual(actions.scroll.parameters.properties.direction.enum, ["up", "down"]);
  assert.equal(actions.fill.parameters.properties.value.default, "");
  assert.equal(actions.press.parameters.properties.key.default, "Enter");
  assert.equal(actions.wait.parameters.properties.ms.default, 1000);
  assert.equal(actions.scroll.parameters.properties.amount.default, 800);
  assert.match(actions.extract.parameters.properties.frameId.description, /does not select or route/u);
  assert.match(GENERIC_ACTION_CONTRACT.executionGuidance.invocation, /session\.runActions/u);
  assert.match(GENERIC_ACTION_CONTRACT.executionGuidance.batching, /fresh returned observation/u);
  assert.match(GENERIC_ACTION_CONTRACT.executionGuidance.selection, /option click/u);
});

async function page(t, body) {
  const dom = new JSDOM(body, { url: "https://unknown.example/search", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.Element.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 30, width: 200, height: 30 };
  };
  dom.window.Element.prototype.scrollIntoView = function () {};
  for (const file of pageRuntimeScriptFilesFor()) {
    dom.window.eval(await readFile(new URL(`../src/${file}`, import.meta.url), "utf8"));
  }
  return dom.window;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("native select extraction includes exact full option catalogs and factual selection state", async (t) => {
  const manyOptions = Array.from({ length: 220 }, (_, index) => `<option value="code-${index}">Option ${index}</option>`).join("");
  const win = await page(t, `<label for="destination">Destination</label>
    <select id="destination">
      <option value="" disabled>Choose</option>
      <optgroup label="Available">
        <option value="  exact  value  " label="Display label" selected>Different text</option>
        <option value="blocked" disabled>Unavailable</option>
      </optgroup>
      <optgroup label="Disabled group" disabled><option value="group-blocked">Group choice</option></optgroup>
      ${manyOptions}
    </select>`);
  const state = win.WebGPTExtractState();
  const select = state.controls.find((item) => item.selector === "#destination");
  assert.equal(select.options.length, 224);
  assert.equal(select.multiple, false);
  assert.deepEqual(plain(select.options.slice(0, 4)), [
    { label: "Choose", value: "", selected: false, disabled: true, groupLabel: "" },
    { label: "Display label", value: "  exact  value  ", selected: true, disabled: false, groupLabel: "Available" },
    { label: "Unavailable", value: "blocked", selected: false, disabled: true, groupLabel: "Available" },
    { label: "Group choice", value: "group-blocked", selected: false, disabled: true, groupLabel: "Disabled group" },
  ]);
  assert.equal(select.options.at(-1).value, "code-219");
  assert.equal(select.selectedValues.length, 1);

  const result = await win.WebGPTRunner.runActions(state, [{ type: "fill", targetId: select.id, value: "code-219" }]);
  assert.equal(result.ok, true);
  assert.equal(result.results[0].result.ok, true);
  const refreshed = win.WebGPTExtractState().controls.find((item) => item.selector === "#destination");
  assert.equal(refreshed.options.at(-1).selected, true);
  assert.equal(refreshed.options[1].selected, false);
  assert.equal(refreshed.currentValue, "Option 219");
});

test("multiple and disabled selects retain every selected option beyond the legacy summary cap", async (t) => {
  const options = Array.from({ length: 25 }, (_, index) => `<option value="${index}" selected>Choice ${index}</option>`).join("");
  const win = await page(t, `<select id="choices" multiple disabled>${options}</select>`);
  const control = win.WebGPTExtractState().controls.find((item) => item.selector === "#choices");
  assert.equal(control.multiple, true);
  assert.equal(control.options.length, 25);
  assert.ok(control.options.every((option) => option.selected && option.disabled));
  assert.equal(control.selectedValues.length, 20);
});
