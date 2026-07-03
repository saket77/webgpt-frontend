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
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

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
  assert.match(source, /function floatingPortalOptionElements/);
  assert.match(source, /\[data-floating-ui-portal\] \[role='option'\]/);
  assert.doesNotMatch(source, /boundsNearCombobox/);
});

test("Ashby autocomplete option hints are clickable choices, not selected values", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /visible autocomplete option: \$\{option\.optionText\}/);
  assert.match(source, /available option: \$\{option\.optionText\}/);
  assert.match(source, /checked: isComboboxOption \? undefined : Boolean\(option\.selected\)/);
});

test("control extraction keeps real ARIA options instead of composite wrappers", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/extract-state/controlBuilders.js");

  assert.match(source, /role !== "option" && el\.querySelector\("\[role='option'\]"\)/);
  assert.match(source, /document\.querySelectorAll\('\[role="option"\]'\)/);
});

test("Ashby adapter scopes application fields and prioritizes actionable targets", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

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
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

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

test("Ashby adapter exposes composite connector tools for application fields and EEOC", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /const APPLICATION_FIELDS_TOOL = "ashby_fill_application_fields"/);
  assert.match(source, /const EEOC_TOOL = "ashby_fill_eeoc"/);
  assert.match(source, /const EEOC_FIELD_SPECS/);
  assert.match(source, /fieldKey: "gender"/);
  assert.match(source, /fieldKey: "race"/);
  assert.match(source, /fieldKey: "veteran_status"/);
  assert.match(source, /fieldKey: "disability_status"/);
  assert.match(source, /function applicationFillGroups/);
  assert.match(source, /ashby_application_fill_batch/);
  assert.match(source, /function eeocSectionGroups/);
  assert.match(source, /ashby_eeoc_section/);
  assert.match(source, /preferredAction: APPLICATION_FIELDS_TOOL/);
  assert.match(source, /preferredAction: EEOC_TOOL/);
  assert.match(source, /connector action available: \$\{APPLICATION_FIELDS_TOOL\}/);
  assert.match(source, /connector action available: \$\{EEOC_TOOL\}/);
  assert.match(source, /ASHBY_APPLICATION_CONNECTOR_BATCH_HINT/);
  assert.match(source, /emit both connector actions in the same planner step/);
  assert.match(source, /pageKind === "application_form" \? ASHBY_APPLICATION_CONNECTOR_BATCH_HINT : ""/);
  assert.match(source, /Do not fill\/click this individual Ashby control directly while connector tools are expected/);
  assert.match(source, /avoidAction: true,\s+safeFillTarget: false,\s+observeAfterAction: false/);
  assert.match(source, /Ashby connector-managed fields are not normal fill\/click targets/);
  assert.doesNotMatch(source, /safeFillTarget: field\.connectorTool !== EEOC_TOOL/);
  assert.match(source, /provideTools,/);
});

test("Ashby connector executors fill non-file fields and EEOC through WebGPTConnectorTools", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /function provideTools/);
  assert.match(source, /name: APPLICATION_FIELDS_TOOL/);
  assert.match(source, /name: EEOC_TOOL/);
  assert.match(source, /function eeocFieldSchemaDescription/);
  assert.match(source, /ASHBY_RACE_INDIAN_HINT/);
  assert.match(source, /Indian\/India\/South Asian maps to Asian \(Not Hispanic or Latino\), not American Indian or Alaska Native/);
  assert.match(source, /If runContext\.myInfo says not a veteran, use I am not a protected veteran/);
  assert.match(source, /description: eeocFieldSchemaDescription\(field\)/);
  assert.match(source, /function connectorApplicationFields/);
  assert.match(source, /field\.sectionKind !== "eeoc" && field\.fieldKind !== "file"/);
  assert.match(source, /function connectorEeocFields/);
  assert.match(source, /const kind = fieldKind\(root, options\.length, hasCombobox\)/);
  assert.doesNotMatch(source, /const fieldKind = fieldKind\(/);
  assert.match(source, /async function fillComboboxField/);
  assert.match(source, /function readComboboxOptions/);
  assert.match(source, /comboboxLinkedOptionElements/);
  assert.match(source, /const portalOptions = floatingPortalOptionElements\(\)/);
  assert.match(source, /portalOptions\.length\s+\?\s+portalOptions/);
  assert.match(source, /function searchComboboxOptions/);
  assert.match(source, /function fillChoiceField/);
  assert.match(source, /function fillNativeOrTextField/);
  assert.match(source, /async function ashbyFillApplicationFields/);
  assert.match(source, /async function ashbyFillEeoc/);
  assert.match(source, /fieldValues: committedFieldValues/);
  assert.match(source, /fieldTargets/);
  assert.match(source, /WebGPTConnectorTools\.register\(\s*APPLICATION_FIELDS_TOOL/);
  assert.match(source, /WebGPTConnectorTools\.register\(EEOC_TOOL, ashbyFillEeoc\)/);
});

test("Ashby adapter hides EEOC policy copy and keeps only actionable fields", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /function isAshbyPolicyNoiseText/);
  assert.match(source, /equal employment opportunity/);
  assert.match(source, /completion is voluntary/);
  assert.match(source, /self-identification of veteran status/);
  assert.match(source, /filterPlannerNoiseList\(state\.visibleTextSummary/);
  assert.match(source, /filterPlannerNoiseGroups\(state\.groups/);
  assert.match(source, /function filterPlannerNoiseControls/);
  assert.match(source, /controls: filterPlannerNoiseControls/);
  assert.match(source, /Ashby EEOC\/policy copy is not actionable for the planner/);
});

test("Ashby connector state uses fieldKey identity for post-action verification", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /fieldKey: field\.sectionKind === "eeoc" \? field\.eeocFieldKey \|\| field\.fieldPath : field\.fieldPath/);
  assert.match(source, /groupTargetId: fieldTargetId\(field\.fieldPath\)/);
  assert.match(source, /matchedBy: field\.eeocFieldKey && field\.eeocFieldKey === fieldKey/);
  assert.match(source, /matchMode: "ashby_runtime_field"/);
});

test("Ashby yes/no fields use field-local active buttons and connector-managed hints", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /function yesNoButtonsForRoot/);
  assert.match(source, /function yesNoSelectedValue/);
  assert.match(source, /selectedFromClasses\(button\) === true/);
  assert.match(source, /if \(isYesNoFieldRoot\(field\.root\)\) return yesNoSelectedValue\(field\.root\)/);
  assert.match(source, /async function fillYesNoField/);
  assert.match(source, /if \(isYesNoFieldRoot\(field\.root\)\) return fillYesNoField\(field, value, ctx\)/);
  assert.match(source, /const isConnectorManagedOption = Boolean\(field\.connectorTool && !isComboboxOption\)/);
  assert.match(source, /semanticRole: isComboboxOption\s+\? "ashby_autocomplete_option"\s+: isConnectorManagedOption\s+\? "ashby_connector_managed_option"/);
  assert.match(source, /preferredAction: isConnectorManagedOption\s+\? field\.connectorTool\s+: "click"/);
  assert.match(source, /avoidAction: isConnectorManagedOption \? true : undefined/);
  assert.match(source, /function optionSelectorForField/);
  assert.match(source, /function buildSelectorOverrides/);
  assert.match(source, /const rootSelector = `\[data-field-path="\$\{cssEscape\(field\.fieldPath\)\}"\]`/);
  assert.match(source, /enhanceControls\(\s*state\.controls \|\| \[\],\s*siteAdapter\.actionHintsByTargetId \|\| \{\},\s*siteAdapter\.selectorOverrides \|\| \{\}/);
});

test("Ashby EEOC race matching maps Indian to Asian, not American Indian", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /\\bindia\(\?:n\)\?\\b/);
  assert.match(source, /aliases\.push\("Asian \(Not Hispanic or Latino\)"\)/);
  assert.match(source, /if \(\/\\basian\\b\/\.test\(optionKey\)\) return 1000/);
  assert.match(source, /if \(\/\\bamerican indian\\b\|\\balaska native\\b\/\.test\(optionKey\)\) return 0/);
});

test("Ashby location combobox maps PA abbreviation to Pennsylvania portal options", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /const US_STATE_NAMES = \{/);
  assert.match(source, /pa: "Pennsylvania"/);
  assert.match(source, /function locationAliasesFor/);
  assert.match(source, /\$\{before\}, \$\{stateName\}, United States/);
  assert.match(source, /if \(isLocationFieldKey\(fieldKey\)\)/);
});

test("Ashby application connector encourages synthesized normal answers", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /ASHBY_APPLICATION_SYNTHESIS_HINT/);
  assert.match(source, /ASHBY_FILL_KNOWN_VALUES_HINT/);
  assert.match(source, /fill every answerable field by default/);
  assert.match(source, /do not stop, ask, or defer the whole form just because a few fields are unknown/);
  assert.match(source, /Fill every field with a known, visible, My Info-supported, or safely synthesized value/);
  assert.match(source, /unknown fields are not blockers/);
  assert.match(source, /synthesize a concise honest answer from runContext\.myInfo/);
  assert.match(source, /Generated text must use complete sentences/);
  assert.match(source, /never be truncated mid-word or mid-sentence/);
  assert.doesNotMatch(source, /(?:about|around|up to|aim(?:\s+\w+){0,3})\s+500\s+(?:characters|chars)/i);
  assert.match(source, /explicit profile fields and synthesized normal answers in the same connector call/);
  assert.match(source, /Fill all answerable non-file Ashby application fields in ONE step/);
  assert.match(source, /Include every known or safely synthesized value now/);
  assert.match(source, /do not omit known fields just because other fields are unknown/);
});
