const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Greenhouse adapter is injected before state extraction", () => {
  const source = readSource("background/runtime/browser.js");

  assert.match(source, /content-scripts\/adapters\/greenhouse\.js/);
  assert.match(
    source,
    /content-scripts\/adapters\/greenhouse\.js",\n\s+"content-scripts\/extractState\.js"/,
  );
});

test("Greenhouse adapter scopes itself to the application form regions", () => {
  const source = readSource("content-scripts/adapters/greenhouse.js");

  assert.match(source, /const ADAPTER_ID = "greenhouse\.application"/);
  assert.match(source, /form#application-form/);
  assert.match(source, /form\.application--form/);
  assert.match(source, /\.application--questions/);
  assert.match(source, /\.field-wrapper/);
  assert.match(source, /fieldset\.phone-input/);
  assert.match(source, /\.phone-input__country \.select__container/);
  assert.match(
    source,
    /\.phone-input__phone > \.text-input-wrapper > \.input-wrapper/,
  );
  assert.match(source, /\.eeoc__container/);
  assert.match(source, /\.eeoc__question__wrapper/);
  assert.match(source, /\.application--submit button\[type='submit'\]/);
});

test("Greenhouse adapter reports field state and policy buckets", () => {
  const source = readSource("content-scripts/adapters/greenhouse.js");

  assert.match(source, /Greenhouse application state/);
  assert.match(source, /currentValue: blank/);
  assert.match(source, /typed search text is not a committed selection/);
  assert.match(source, /answered: \$\{answered \? "true" : "false"\}/);
  assert.match(source, /required fields still missing/);
  assert.match(source, /safe profile\/contact field; fill from My Info when available/);
  assert.match(source, /sensitive optional EEOC field; answer from explicit runContext\.myInfo value/);
  assert.match(source, /upload\/file boundary; do not upload unless requested/);
});

test("Greenhouse adapter treats manual cover-letter textarea as text, not upload", () => {
  const source = readSource("content-scripts/adapters/greenhouse.js");

  assert.match(source, /function visibleNonFileInput/);
  assert.match(source, /if \(visibleTextInput\) return visibleTextInput/);
  assert.match(source, /function fieldLevelLabel/);
  assert.match(source, /isGenericUploadControlLabel/);
  assert.match(source, /if \(visibleNonFileInput\(root\)\) return false/);
  assert.match(source, /const uploadBoundary = kind === "file"/);
  assert.doesNotMatch(
    source,
    /const uploadBoundary = kind === "file" \|\| isUploadBoundaryField\(question\)/,
  );
  assert.doesNotMatch(
    source,
    /\\b\\(upload\\|attach\\|resume\\|cv\\|cover letter\\)\\b/,
  );
});

test("Greenhouse adapter keeps comboboxes and options deterministic inside the field", () => {
  const source = readSource("content-scripts/adapters/greenhouse.js");

  assert.match(source, /function labeledInputForRoot/);
  assert.match(source, /root\.querySelector\(`#\$\{cssEscape\(id\)\}`\)/);
  assert.doesNotMatch(
    source,
    /reactSelectValueForField\(root\) \|\| textValueForField\(input\)/,
  );
  assert.match(source, /function linkedListboxes/);
  assert.match(source, /root\.contains\(el\)/);
  assert.match(source, /getVisibleElements\("\[role='option'\]", listbox\)/);
  assert.match(source, /return options\.slice\(0, 8\)/);
  assert.match(source, /Greenhouse React select\/combobox field/);
  assert.match(source, /observe the in-field listbox/);
  assert.match(source, /Do not treat typed search text or a focused option as selected/);
  assert.match(source, /Do not treat typed search text as a committed Greenhouse selection/);
});

test("Greenhouse adapter nudges batching before combobox observe turns", () => {
  const source = readSource("content-scripts/adapters/greenhouse.js");

  assert.match(source, /function isBatchableTextField/);
  assert.match(source, /Batch all visible non-combobox safeFillTarget/);
  assert.match(source, /before opening another React select/);
  assert.match(source, /const shouldOpenCombobox/);
  assert.match(source, /function comboboxOpenElements/);
  assert.match(source, /function findComboboxOpenControl/);
  assert.match(source, /\.select__indicators button\[aria-label='Toggle flyout'\]/);
  assert.match(source, /root\.querySelector\("\.select__control"\)/);
  assert.match(source, /openTargetId/);
  assert.match(source, /greenhouse_combobox_control_opener/);
  assert.match(source, /preferredAction: "click"/);
  assert.match(source, /Click the Toggle flyout button or inner \.select__control area/);
  assert.match(source, /Do not click the outer field wrapper/);
  assert.match(source, /do not fill search text before opening this menu/);
  assert.match(source, /after_batchable_plain_fields_click_then_observe/);
  assert.match(source, /after_batchable_plain_fields_fill_then_observe/);
});

test("Greenhouse adapter pins combobox openers/options to unique field-scoped selectors", () => {
  const source = readSource("content-scripts/adapters/greenhouse.js");

  // Helpers that build a unique, deterministic selector for a combobox control.
  assert.match(source, /function isUniqueSelector/);
  assert.match(source, /function anchoredComboboxSelector/);
  assert.match(source, /function uniqueComboboxSelector/);
  // Anchor the opener on the field's stable input id rather than a shared
  // `button[aria-label="Toggle flyout"]`.
  assert.match(source, /\.select__control:has\(\$\{idSel\}\)/);
  // findComboboxOpenControl exposes the matched element so its selector can be computed.
  assert.match(source, /return \{ control, element: el \}/);
  assert.match(source, /openTargetSelector/);
  // The override is threaded into enhanceControls but kept off the planner payload.
  assert.match(source, /const selectorOverrides = \{\}/);
  assert.match(source, /enhanced\.selector = overrideSelector/);
  assert.match(
    source,
    /siteAdapter\.selectorOverrides \|\| \{\}/,
  );
});

test("Greenhouse adapter marks submit boundaries and uses explicit My Info for EEOC", () => {
  const source = readSource("content-scripts/adapters/greenhouse.js");

  assert.match(source, /greenhouse_submit_application_boundary/);
  assert.match(source, /Do not click when USER_GOAL says not to submit/);
  assert.match(source, /Greenhouse EEOC fields are sensitive optional fields/);
  assert.match(source, /explicit values in runContext\.myInfo are user-provided answers/);
  assert.match(source, /If My Info lacks a matching value/);
  assert.match(source, /decline\/prefer-not-to-answer/);
  assert.match(source, /mention blanks in done summaries/);
});
