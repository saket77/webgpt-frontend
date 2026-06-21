const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const floatingUiComboboxFixture = String.raw`
<input
  placeholder="Start typing..."
  aria-autocomplete="list"
  aria-expanded="true"
  aria-haspopup="listbox"
  aria-controls=":r0:"
  role="combobox"
  value="Philadelphia, Pennsylvania, United States"
>
<div data-floating-ui-portal="">
  <div id=":r0:" role="listbox">
    <div role="option" id=":ri:">Philadelphia, Pennsylvania, United States</div>
    <div role="option" id=":rj:">Philadelphia, Mississippi, United States</div>
  </div>
</div>
`;

test("Ashby adapter treats portaled autocomplete options as uncommitted until closed", () => {
  const source = readSource("content-scripts/adapters/ashby.js");

  assert.match(floatingUiComboboxFixture, /data-floating-ui-portal/);
  assert.match(floatingUiComboboxFixture, /aria-controls=":r0:"/);

  assert.match(source, /function comboboxPopupIds/);
  assert.match(source, /aria-controls/);
  assert.match(source, /aria-owns/);
  assert.match(source, /document\.getElementById\(id\)/);
  assert.match(source, /function isComboboxLinkedListboxVisible/);
  assert.match(source, /isComboboxExpanded\(input\) \|\| isComboboxLinkedListboxVisible\(input\)/);
  assert.match(source, /isCombobox && textValue && autocompleteOpen/);
  assert.match(source, /const selectedValue = isCombobox \? "" : selectedValueFromOptions/);
  assert.doesNotMatch(source, /boundsNearCombobox/);
});

test("Ashby autocomplete option hints are clickable choices, not selected values", () => {
  const source = readSource("content-scripts/adapters/ashby.js");

  assert.match(source, /visible autocomplete option: \$\{option\.optionText\}/);
  assert.match(source, /available option: \$\{option\.optionText\}/);
  assert.match(source, /checked: isComboboxOption \? undefined : Boolean\(option\.selected\)/);
});

test("control extraction keeps real ARIA options instead of composite wrappers", () => {
  const source = readSource("content-scripts/extract-state/controlBuilders.js");

  assert.match(source, /role !== "option" && el\.querySelector\("\[role='option'\]"\)/);
  assert.match(source, /document\.querySelectorAll\('\[role="option"\]'\)/);
});

test("Ashby adapter scopes application fields and prioritizes actionable targets", () => {
  const source = readSource("content-scripts/adapters/ashby.js");

  assert.match(source, /function applicationScopes/);
  assert.match(source, /ashby-job-posting-right-pane/);
  assert.match(source, /ashby-survey-form-container/);
  assert.match(source, /function isActionableControl/);
  assert.match(source, /function fieldPrimaryControlIds/);
  assert.match(source, /actionableControlIds\(field\.controlIds, controlsById, 2\)/);
  assert.match(source, /actionableControlIds\(option\.controlIds, controlsById\)/);
  assert.match(source, /return options\.slice\(0, 5\)/);
});

test("Ashby guidance distinguishes profile blanks, sensitive optional fields, and 1-of-3 prompts", () => {
  const source = readSource("content-scripts/adapters/ashby.js");

  assert.match(source, /function isSensitiveOptionalField/);
  assert.match(source, /function isOptionalProfileField/);
  assert.match(source, /function isOneOfThreeAnswerField/);
  assert.match(source, /currentValue: blank/);
  assert.match(source, /answered: \$\{answered \? "true" : "false"\}/);
  assert.match(source, /safe optional profile field; fill from My Info when available/);
  assert.match(source, /sensitive optional field; leave blank unless explicitly requested/);
  assert.match(source, /1-of-3 answer choice; fill only if USER_GOAL selected this prompt/);
  assert.match(source, /Optional non-sensitive Ashby profile fields are blank/);
  assert.match(source, /Sensitive optional Ashby diversity fields are blank/);
  assert.match(source, /blank alternates are not blockers/);
  assert.match(source, /No required Ashby text\/choice field is visibly missing\. Check optional profile blanks/);
});
