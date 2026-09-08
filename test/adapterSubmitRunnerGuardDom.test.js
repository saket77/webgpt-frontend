const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { JSDOM } = require("jsdom");

const ACTIONS_SOURCE = fs.readFileSync(
  path.join(
    __dirname,
    "../packages/page-runtime/src/content-scripts/runner/actions.js",
  ),
  "utf8",
);

test("generic targeted click and press cannot activate an adapter submit control", async (t) => {
  const dom = new JSDOM(
    `<!doctype html><body>
      <button id="ordinary" type="button">Continue</button>
      <button id="submit" type="submit">Submit Application</button>
    </body>`,
    { pretendToBeVisual: true, runScripts: "outside-only", url: "https://example.test/" },
  );
  t.after(() => dom.window.close());
  const { window } = dom;
  let clicked = "";
  let pressed = "";

  window.WebGPTRunnerModules = {
    domUtils: {
      lower(value) {
        return String(value || "").toLowerCase();
      },
    },
    resolver: {
      getControlById(state, targetId) {
        return (state.controls || []).find(({ id }) => id === targetId) || null;
      },
      resolveElement(control) {
        return { el: window.document.querySelector(control.selector), strategyUsed: "selector" };
      },
    },
    scrollResolver: {
      isScrollable() { return false; },
      getScrollableContainerById() { return null; },
      findScrollableAncestor() { return null; },
      findBestScrollContainer() { return null; },
      resolveScrollableContainer() { return null; },
    },
    primitives: {
      async clickElement(element) {
        clicked = element.id;
      },
      async fillElement() {},
      async pressKeyOnElement(element) {
        pressed = element.id;
      },
    },
    trace: {
      buildReplayTarget() { return null; },
      buildResolvedControlTrace() { return {}; },
      buildScrollTrace() { return {}; },
      buildExtractTrace() { return {}; },
      buildGotoTrace() { return {}; },
    },
    collectionExtractor: {
      extractCollectionItems() { return { extractedCount: 0, items: [] }; },
    },
  };
  window.eval(ACTIONS_SOURCE);

  const state = {
    siteAdapter: { submitTargetId: "submit_control" },
    controls: [
      { id: "ordinary_control", selector: "#ordinary" },
      {
        id: "submit_control",
        selector: "#submit",
        adapterHints: {
          "example.adapter": { protectedEffect: "submit" },
        },
      },
    ],
  };
  const { runSingleAction } = window.WebGPTRunnerModules.actions;

  await assert.rejects(
    runSingleAction(state, { type: "click", targetId: "submit_control" }),
    /guarded adapter tool/u,
  );
  await assert.rejects(
    runSingleAction(state, {
      type: "press",
      targetId: "submit_control",
      key: "Enter",
    }),
    /guarded adapter tool/u,
  );
  window.document.querySelector("#submit").focus();
  await assert.rejects(
    runSingleAction(state, { type: "press", key: "Enter" }),
    /guarded adapter tool/u,
  );
  assert.equal(clicked, "");
  assert.equal(pressed, "");

  const clickResult = await runSingleAction(state, {
    type: "click",
    targetId: "ordinary_control",
  });
  const pressResult = await runSingleAction(state, {
    type: "press",
    targetId: "ordinary_control",
    key: "Enter",
  });
  assert.equal(clickResult.ok, true);
  assert.equal(pressResult.ok, true);
  assert.equal(clicked, "ordinary");
  assert.equal(pressed, "ordinary");
});
