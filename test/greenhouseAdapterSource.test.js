const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Greenhouse adapter is injected before state extraction", async () => {
  const { PAGE_RUNTIME_SCRIPT_FILES } = await import(
    "../packages/page-runtime/src/manifest.js",
  );

  const greenhouseIndex = PAGE_RUNTIME_SCRIPT_FILES.indexOf(
    "content-scripts/adapters/greenhouse.js",
  );
  const extractStateIndex = PAGE_RUNTIME_SCRIPT_FILES.indexOf(
    "content-scripts/extractState.js",
  );
  assert.ok(greenhouseIndex !== -1 && extractStateIndex !== -1);
  assert.ok(greenhouseIndex < extractStateIndex);
});

test("Greenhouse adapter scopes itself to the application form regions", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /const ADAPTER_ID = "greenhouse\.application"/);
  assert.match(source, /form#application-form/);
  assert.match(source, /form\.application--form/);
  assert.match(source, /\.application--questions/);
  assert.match(source, /\.field-wrapper/);
  assert.match(source, /\.education--form/);
  assert.match(source, /fieldset\.phone-input/);
  assert.match(source, /\.phone-input__country \.select__container/);
  assert.match(source, /function isPhoneCountryCodeRoot/);
  assert.match(source, /Phone Country Code/);
  assert.match(
    source,
    /\.phone-input__phone > \.text-input-wrapper > \.input-wrapper/,
  );
  assert.match(source, /\.eeoc__container/);
  assert.match(source, /\.eeoc__question__wrapper/);
  assert.match(source, /getElements\("\.select, \.field-wrapper", eeoc\)/);
  assert.match(source, /root\.matches\("\.field-wrapper"\) && root\.querySelector\("\.select"\)/);
  assert.match(source, /#demographic-section, \.demographic--container/);
  assert.match(source, /\.application--submit button\[type='submit'\]/);
});

test("Greenhouse adapter reports mechanical field state and factual categories", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /Greenhouse application state/);
  assert.match(source, /function isSensitiveField/);
  assert.match(source, /function isLegalOrWorkAuthorizationField/);
  assert.match(source, /currentValue: blank/);
  assert.match(source, /typed search text is not a committed selection/);
  assert.match(source, /answered: \$\{answered \? "true" : "false"\}/);
  assert.match(source, /required fields still missing/);
  assert.match(source, /sensitive self-identification field detected/);
  assert.match(source, /legal or work-authorization field detected/);
  assert.match(source, /upload\/file boundary/);
  assert.doesNotMatch(source, /runContext\.myInfo|My Info|USER_GOAL/);
});

test("Greenhouse adapter treats manual cover-letter textarea as text, not upload", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

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

test("Greenhouse adapter exposes a cover-letter connector command through enhanced state", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /const COVER_LETTER_TARGET_ID/);
  assert.match(source, /textarea#cover_letter_text/);
  assert.match(source, /function findCoverLetterManualButton/);
  assert.match(source, /\benter manually\b/i);
  assert.match(source, /function coverLetterEntryInfo/);
  assert.match(source, /function coverLetterGroups/);
  assert.match(source, /greenhouse_cover_letter_section/);
  assert.match(source, /greenhouse_cover_letter_manual_entry/);
  assert.match(source, /siteAdapter\.coverLetterAvailable/);
  assert.match(source, /coverLetterGroups\(coverLetterInfo\)/);
  assert.match(source, /preferredAction: "greenhouse_write_cover_letter"/);
  assert.match(source, /connectorTool: "greenhouse_write_cover_letter"/);
  assert.match(source, /name: "greenhouse_write_cover_letter"/);
  assert.match(source, /letterText/);
  assert.match(source, /async function greenhouseWriteCoverLetter/);
  assert.match(source, /ctx\?\.primitives\?\.fillElement/);
  assert.match(source, /ctx\?\.primitives\?\.clickElement/);
  assert.match(source, /waitForCoverLetterTextarea/);
  assert.match(source, /WebGPTConnectorTools\.register\(\s*"greenhouse_write_cover_letter"/);
  assert.match(source, /Write exact caller-provided cover-letter text/);
  assert.match(source, /without adapter-side generation or rewriting/);
  assert.doesNotMatch(source, /GREENHOUSE_COVER_LETTER_HINT|runContext\.myInfo|USER_GOAL/);
});

test("Greenhouse adapter keeps comboboxes and options deterministic inside the field", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

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

test("Greenhouse adapter exposes exact-value connector and combobox mechanics", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /greenhouse_fill_application_fields/);
  assert.match(source, /exact caller-provided fieldValues/);
  assert.match(source, /leaves omitted fields unchanged/);
  assert.match(source, /fillSelectByFieldKey/);
  assert.match(source, /function isConnectorFillSelectField/);
  assert.match(source, /const shouldOpenCombobox/);
  assert.match(source, /Greenhouse Phone Country Code is a phone country\/extension selector/);
  assert.match(source, /pass its exact visible option through \$\{SELECT_TOOL\}\(fieldKey="country", value\)/);
  assert.match(source, /function comboboxOpenElements/);
  assert.match(source, /function findComboboxOpenControl/);
  assert.match(source, /\.select__indicators button\[aria-label='Toggle flyout'\]/);
  assert.match(source, /root\.querySelector\("\.select__control"\)/);
  assert.match(source, /openTargetId/);
  assert.match(source, /greenhouse_combobox_control_opener/);
  assert.match(source, /preferredAction: "click"/);
  assert.match(source, /preferredAction:\s*field\.connectorTool/);
  assert.match(source, /Click the Toggle flyout button or inner \.select__control area/);
  assert.match(source, /Do not click the outer field wrapper/);
  assert.match(source, /do not fill search text before opening this menu/);
  assert.match(source, /after_batchable_plain_fields_click_then_observe/);
  assert.match(source, /after_batchable_plain_fields_fill_then_observe/);
  assert.doesNotMatch(source, /GREENHOUSE_FILL_KNOWN_VALUES_HINT|GREENHOUSE_EEOC_BATCH_HINT/);
  assert.doesNotMatch(source, /runContext\.myInfo|My Info|USER_GOAL|synthesi/i);
});

test("Greenhouse adapter pins combobox openers/options to unique field-scoped selectors", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

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

test("Greenhouse adapter exposes a greenhouse_fill_select connector tool (open+search+match+commit in one step)", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  // provideTools surfaces the single-step select tool from the same roots as enhanced state.
  assert.match(source, /function provideTools/);
  assert.match(source, /const SELECT_TOOL = "greenhouse_fill_select"/);
  assert.match(source, /name: SELECT_TOOL/);
  assert.match(source, /function connectorSelectFields/);
  assert.match(source, /collectFieldRoots\(documentRef \|\| document\)/);
  assert.match(source, /\.application--questions/);
  assert.match(source, /\.education--form/);
  assert.match(source, /"demographic"/);
  assert.match(source, /\["application", "education", "demographic"\]\.includes\(fieldSectionKind\)/);
  assert.match(source, /fieldKey === "false"/); // excludes unusable id="false" selects
  // Runner-side executor: opens, reads options, searches when needed, matches, commits.
  assert.match(source, /async function greenhouseFillSelect/);
  assert.match(source, /function readComboboxOptions/);
  assert.match(source, /function searchComboboxOptions/);
  assert.match(source, /function matchComboboxOption/);
  assert.match(source, /function dispatchReactSelectInput/);
  assert.match(source, /function waitForComboboxOptions/);
  assert.match(source, /function equivalentValuesForSelect/);
  assert.match(source, /function searchQueriesFor\(_fieldKey, value\)/);
  assert.match(source, /return query \? \[query\] : \[\]/);
  assert.match(source, /function scoreComboboxOption/);
  assert.match(source, /optionKey && wantedKey && optionKey === wantedKey \? 2000 : 0/);
  assert.match(source, /function committedSelectValue/);
  assert.match(source, /function waitForCommittedSelectValue/);
  assert.match(source, /recoverable:\s*true/);
  assert.match(source, /continueBatch:\s*true/);
  assert.match(source, /equivalentValues:\s*equivalentValuesForSelect/);
  assert.match(source, /greenhouse_phone_country_code_connector_select/);
  assert.match(source, /greenhouse_sensitive_connector_field/);
  assert.match(source, /WebGPTConnectorTools\.register\(\s*SELECT_TOOL/);
  // Enhanced state should describe connector-backed selects as batchable connector actions.
  assert.match(source, /function isConnectorFillSelectField/);
  assert.match(source, /preferredAction:\s*field\.connectorTool/);
  assert.match(source, /connectorTool:\s*field\.connectorTool/);
  assert.match(source, /batchPlacement:\s*"can_batch"/);
  // The tool is declared on the adapter registration.
  assert.match(source, /provideTools,/);
  assert.doesNotMatch(source, /fieldValueAliases|phoneCountryCodeAliases|selectTokens/);
});

test("Greenhouse adapter exposes keyed exact-value application fields", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /const APPLICATION_FIELDS_TOOL = "greenhouse_fill_application_fields"/);
  assert.match(source, /function connectorApplicationFields/);
  assert.match(source, /function isLegalOrWorkAuthorizationField/);
  assert.match(source, /advertised non-file Greenhouse application and education fields/);
  assert.match(source, /Exact caller-provided values keyed by advertised Greenhouse fieldKey/);
  assert.match(source, /function applicationFillGroups/);
  assert.match(source, /greenhouse_application_fill_batch/);
  assert.match(source, /async function greenhouseFillApplicationFields/);
  assert.match(source, /fieldValues: committedFieldValues/);
  assert.match(source, /fieldTargets/);
  assert.match(
    source,
    /WebGPTConnectorTools\.register\(\s*APPLICATION_FIELDS_TOOL,\s*greenhouseFillApplicationFields/,
  );
  assert.doesNotMatch(source, /actionEffects|stateDelta/);
  assert.doesNotMatch(source, /!field\.sensitiveOptional|!field\.legalSensitive/);
});

test("Ashby and Greenhouse upload state exposes one field-scoped trigger and upstream filename", () => {
  const greenhouse = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");
  const ashby = readSource("packages/page-runtime/src/content-scripts/adapters/ashby.js");

  for (const source of [greenhouse, ashby]) {
    assert.match(source, /function uploadTriggerInfo/);
    assert.match(source, /committedFilename:/);
    assert.match(source, /uploadTriggerTargetId:/);
    assert.match(source, /field\.uploadTriggerTargetId && field\.uploadTriggerSelector/);
    assert.match(source, /\.\.\.fields\.map\(\(field\) => field\.uploadTriggerTargetId\)/);
  }
  assert.match(greenhouse, /\.field-wrapper:has\(\$\{inputSelector\}\) button/);
  assert.match(ashby, /\.ashby-application-form-input-file:has\(\$\{inputSelector\}\) button/);
});

test("Greenhouse adapter exposes demographic section mechanics without inference", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /function demographicSectionGroups/);
  assert.match(source, /greenhouse_demographic_section/);
  assert.match(source, /Greenhouse demographic section detected/);
  assert.match(source, /#demographic-section \.select, \.demographic--container \.select/);
  assert.match(source, /field\.demographic/);
  assert.match(source, /exact caller-provided sensitive values and does not infer answers/);
  assert.doesNotMatch(source, /GREENHOUSE_DEMOGRAPHIC_INFERENCE_HINT|GREENHOUSE_DEMOGRAPHIC_BATCH_HINT/);
  assert.doesNotMatch(source, /fieldValueAliases|runContext\.myInfo|USER_GOAL/);
});

test("Greenhouse adapter exposes an EEOC composite connector tool with section hints", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /const EEOC_FIELD_SPECS/);
  assert.match(source, /fieldKey: "gender"/);
  assert.match(source, /fieldKey: "hispanic_ethnicity"/);
  assert.match(source, /fieldKey: "race"/);
  assert.match(source, /fieldKey: "veteran_status"/);
  assert.match(source, /fieldKey: "disability_status"/);
  assert.match(source, /function eeocSectionGroups/);
  assert.match(source, /greenhouse_eeoc_section/);
  assert.match(source, /preferredAction: EEOC_TOOL/);
  assert.match(source, /connector action available: \$\{EEOC_TOOL\}/);
  assert.match(source, /name: EEOC_TOOL/);
  assert.match(source, /fieldValues/);
  assert.match(source, /exact caller-provided values for advertised Greenhouse EEOC and custom demographic field keys/);
  assert.match(source, /re-resolves conditional fields/);
  assert.match(source, /does not infer sensitive answers/);
  assert.match(source, /input\.closest\("\.select"\) \|\|/);
  assert.match(source, /async function greenhouseFillEeoc/);
  assert.match(source, /scopeSelector: "\.eeoc__container"/);
  assert.match(source, /fieldValues:\s*committedFieldValues/);
  assert.match(source, /recoverable:\s*failed\.length > 0/);
  assert.match(source, /WebGPTConnectorTools\.register\(\s*EEOC_TOOL/);
  assert.doesNotMatch(source, /GREENHOUSE_EEOC_RACE_AFTER_HISPANIC_HINT|runContext\.myInfo/);
});

test("Greenhouse adapter marks guarded submit boundaries", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /greenhouse_submit_application_boundary/);
  assert.match(source, /guarded-submit host capability and explicit authorization/);
  assert.match(source, /requiresAuthorization: true/);
  assert.doesNotMatch(source, /runContext\.myInfo|My Info|USER_GOAL/);
});

test("Greenhouse adapter delegates answer selection and prose generation to its caller", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /Fill exact caller-provided values for advertised non-file Greenhouse application and education fields/);
  assert.match(source, /leaves omitted fields unchanged/);
  assert.match(source, /Exact complete cover-letter text to write without adapter-side generation or rewriting/);
  assert.doesNotMatch(source, /GREENHOUSE_APPLICATION_SYNTHESIS_HINT|isNormalSynthesizableField|normalSynthesizable/);
  assert.doesNotMatch(source, /runContext\.myInfo|My Info|USER_GOAL|synthesi/i);
});

test("Greenhouse EEOC matching requires exact normalized visible option text", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /function scoreComboboxOption\(optionText, value, _fieldKey\)/);
  assert.match(source, /optionKey && wantedKey && optionKey === wantedKey \? 2000 : 0/);
  assert.match(source, /const entries = fields\s+\.map\(\(field\) => \[field, requestedFieldValues\[field\.fieldKey\]\]\)/);
  assert.doesNotMatch(source, /GREENHOUSE_HISPANIC_INDIAN_HINT|GREENHOUSE_RACE_INDIAN_HINT|fieldValueAliases/);
});

test("Greenhouse select matching has no semantic or sponsorship aliases", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /function scoreComboboxOption/);
  assert.match(source, /optionKey && wantedKey && optionKey === wantedKey/);
  assert.doesNotMatch(source, /sponsorshipPolarityConflict|hasNoSponsorshipIntent|hasNeedsSponsorshipIntent|selectTokens/);
});

test("Greenhouse adapter filters long EEOC policy copy from planner state", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /function isGreenhousePolicyNoiseText/);
  assert.match(source, /vietnam era veterans readjustment assistance act/);
  assert.match(source, /omb control number/);
  assert.match(source, /paperwork reduction act/);
  assert.match(source, /function filterPlannerNoiseList/);
  assert.match(source, /function buildPlannerDescriptionEvidence/);
  assert.match(source, /function filterPlannerNoiseHeadings/);
  assert.match(source, /function filterPlannerNoiseGroups/);
  assert.match(source, /function filterPlannerNoiseControls/);
  assert.match(source, /\.\.\.filterPlannerNoiseList\(\s*state\.visibleTextSummary \|\| \[\]/);
  assert.match(source, /\.\.\.filterPlannerNoiseGroups\(\s*state\.groups \|\| \[\]/);
  assert.match(source, /headings: filterPlannerNoiseHeadings/);
  assert.match(source, /controls: filterPlannerNoiseControls/);
});
