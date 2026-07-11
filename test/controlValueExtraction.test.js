const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function buildContext() {
  class Element {
    constructor({ tagName = "DIV", type = "", value = "" } = {}) {
      this.tagName = tagName;
      this.type = type;
      this.value = value;
      this.innerText = "";
      this.textContent = "";
    }

    getAttribute(name) {
      if (name === "type") return this.type;
      return "";
    }
  }

  class HTMLInputElement extends Element {
    constructor(options = {}) {
      super({ ...options, tagName: "INPUT" });
    }
  }

  class HTMLTextAreaElement extends Element {
    constructor(options = {}) {
      super({ ...options, tagName: "TEXTAREA" });
    }
  }

  class HTMLSelectElement extends Element {
    constructor(options = {}) {
      super({ ...options, tagName: "SELECT" });
      this.selectedOptions = options.selectedOptions || [];
    }
  }

  const context = vm.createContext({
    Element,
    HTMLInputElement,
    HTMLTextAreaElement,
    HTMLSelectElement,
    globalThis: null,
    window: { getComputedStyle() {}, CSS: null },
    document: {},
  });
  context.globalThis = context;
  vm.runInContext(
    source("packages/page-runtime/src/content-scripts/extract-state/domUtils.js"),
    context,
  );
  context.WebGPTExtractStateModules.elementMetadata = {};
  vm.runInContext(
    source(
      "packages/page-runtime/src/content-scripts/extract-state/controlBuilders.js",
    ),
    context,
  );
  return context;
}

test("generic control state exposes bounded ordinary values", () => {
  const context = buildContext();
  const input = new context.HTMLInputElement({
    type: "text",
    value: `hello ${"x".repeat(400)}`,
  });
  const textarea = new context.HTMLTextAreaElement({ value: "multi\nline" });

  assert.equal(
    context.WebGPTExtractStateModules.controlBuilders.valuesForControl(input)
      .currentValue.length,
    300,
  );
  assert.equal(
    context.WebGPTExtractStateModules.controlBuilders.valuesForControl(textarea)
      .currentValue,
    "multi line",
  );
});

test("generic control state excludes password, file, and hidden values", () => {
  const context = buildContext();
  const modules = context.WebGPTExtractStateModules;

  for (const type of ["password", "file", "hidden"]) {
    const input = new context.HTMLInputElement({
      type,
      value: "must-not-enter-state",
    });
    assert.deepEqual(
      Object.keys(modules.controlBuilders.valuesForControl(input)),
      [],
    );
    assert.equal(modules.domUtils.textContent(input), "");
  }
});

test("generic select state records bounded selected option labels", () => {
  const context = buildContext();
  const selectedOptions = Array.from({ length: 25 }, (_, index) => ({
    textContent: `Option ${index}`,
    value: String(index),
  }));
  const select = new context.HTMLSelectElement({
    value: "0",
    selectedOptions,
  });

  const values =
    context.WebGPTExtractStateModules.controlBuilders.valuesForControl(select);
  assert.equal(values.currentValue, "Option 0");
  assert.equal(values.selectedValues.length, 20);
  assert.equal(values.selectedValues[19], "Option 19");
});
