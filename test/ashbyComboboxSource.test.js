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
  assert.match(source, /const selectedValue = isCombobox[\s\S]{0,180}selectedValueFromOptions/);
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

test("Ashby guidance reports field state without inferring workflow answers", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /function isSensitiveField/);
  assert.match(source, /currentValue: blank/);
  assert.match(source, /answered: \$\{answered \? "true" : "false"\}/);
  assert.match(source, /sensitive field detected/);
  assert.match(source, /only caller-provided exact field-keyed values and leaves omitted fields unchanged/);
  assert.match(source, /No required Ashby text or choice field is visibly missing/);
  assert.doesNotMatch(source, /isOptionalProfileField/);
  assert.doesNotMatch(source, /isOneOfThreeAnswerField/);
  assert.doesNotMatch(source, /safeMyInfoFill/);
  assert.doesNotMatch(source, /runContext\.myInfo|My Info|USER_GOAL/);
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
  assert.match(source, /const batchPlacement = connectorTool \? "can_batch" : ""/);
  assert.match(source, /Exact caller-provided values keyed by live Ashby fieldKey\. Omitted fields remain unchanged/);
  assert.match(source, /Do not fill or click this connector-managed control directly/);
  assert.match(source, /avoidAction: true,\s+safeFillTarget: false,\s+observeAfterAction: false/);
  assert.match(source, /Ashby connector-managed controls execute through their advertised connector tool/);
  assert.doesNotMatch(source, /safeFillTarget: field\.connectorTool !== EEOC_TOOL/);
  assert.match(source, /provideTools,/);
});

test("Ashby connector executors fill non-file fields and EEOC through WebGPTConnectorTools", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /function provideTools/);
  assert.match(source, /name: APPLICATION_FIELDS_TOOL/);
  assert.match(source, /name: EEOC_TOOL/);
  assert.match(source, /function eeocFieldSchemaDescription/);
  assert.match(source, /Exact caller-provided answer for \$\{field\.question\}/);
  assert.match(source, /Use exact visible option text when options are present/);
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
  assert.doesNotMatch(source, /runContext\.myInfo|My Info|USER_GOAL/);
});

test("Ashby adapter hides EEOC policy copy and keeps only actionable fields", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /function isAshbyPolicyNoiseText/);
  assert.match(source, /equal employment opportunity/);
  assert.match(source, /completion is voluntary/);
  assert.match(source, /self-identification of veteran status/);
  assert.match(source, /function buildPlannerDescriptionEvidence/);
  assert.match(source, /function filterPlannerNoiseHeadings/);
  assert.match(source, /filterPlannerNoiseList\(\s*state\.visibleTextSummary/);
  assert.match(source, /filterPlannerNoiseGroups\(\s*state\.groups/);
  assert.match(source, /headings: filterPlannerNoiseHeadings/);
  assert.match(source, /function filterPlannerNoiseControls/);
  assert.match(source, /controls: filterPlannerNoiseControls/);
  assert.match(source, /Ashby legal and EEOC explanatory copy is filtered from actionable state/);
});

test("Ashby connector state uses fieldKey identity for post-action verification", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /fieldKey: field\.fieldKey/);
  assert.match(source, /const targetKey = field\.logicalKind \? field\.fieldKey : field\.fieldPath/);
  assert.match(source, /groupTargetId: fieldTargetId\(targetKey\)/);
  assert.match(source, /matchedBy: field\.eeocFieldKey && field\.eeocFieldKey === fieldKey/);
  assert.match(source, /matchMode: "ashby_runtime_field"/);
});

test("Ashby splits compound phone and SMS controls into exact logical field keys", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /function phoneSmsComposite/);
  assert.match(source, /fieldKey: `\$\{fieldPath\}::phone`/);
  assert.match(source, /fieldKey: `\$\{fieldPath\}::sms_consent`/);
  assert.match(source, /\.flatMap\(\(root, index\) => collectFields\(state, root, index\)\)/);
  assert.match(source, /\.flatMap\(\(root, index\) => collectRuntimeFieldsForRoot\(root, index\)\)/);
  assert.match(source, /return field\.fieldKey === key \|\| field\.eeocFieldKey === key/);
  assert.doesNotMatch(source, /field\.fieldPath === key \|\|/);
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

test("Ashby select matching requires exact normalized live option text", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /function matchOption\(options, value\)/);
  assert.match(source, /canonicalSelectText\(option\.text \|\| option\.optionText\) === expected/);
  assert.doesNotMatch(source, /fieldValueAliases|scoreOptionText|South Asian/);
});

test("Ashby combobox searches only for the exact caller-provided value", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /function searchQueriesFor\(_fieldKey, value\)/);
  assert.match(source, /return exactValue \? \[exactValue\] : \[\]/);
  assert.doesNotMatch(source, /US_STATE_NAMES|locationAliasesFor|isLocationFieldKey/);
});

test("Ashby application connector delegates answer selection to its caller", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  assert.match(source, /Fill caller-selected non-file Ashby application fields with exact values keyed by fieldKey/);
  assert.match(source, /Fill caller-selected Ashby EEOC self-identification fields with exact values keyed by fieldKey/);
  assert.match(source, /Omitted fields remain unchanged/);
  assert.match(source, /supply an exact caller-provided value for this field key/);
  assert.doesNotMatch(source, /ASHBY_APPLICATION_SYNTHESIS_HINT|ASHBY_FILL_KNOWN_VALUES_HINT/);
  assert.doesNotMatch(source, /runContext\.myInfo|My Info|USER_GOAL|synthesi/i);
});
