const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Greenhouse adapter is injected before state extraction", () => {
  const source = readSource("packages/page-runtime/src/manifest.js");

  assert.match(source, /content-scripts\/adapters\/greenhouse\.js/);
  assert.match(
    source,
    /content-scripts\/adapters\/greenhouse\.js",\n\s+"content-scripts\/extractState\.js"/,
  );
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

test("Greenhouse adapter reports field state and policy buckets", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /Greenhouse application state/);
  assert.match(source, /currentValue: blank/);
  assert.match(source, /typed search text is not a committed selection/);
  assert.match(source, /answered: \$\{answered \? "true" : "false"\}/);
  assert.match(source, /required fields still missing/);
  assert.match(source, /safe profile\/contact field; fill from My Info when available/);
  assert.match(source, /sensitive optional EEOC field; answer from runContext\.myInfo values or direct EEOC inferences/);
  assert.match(source, /upload\/file boundary; do not upload unless requested/);
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
  assert.match(source, /GREENHOUSE_COVER_LETTER_HINT/);
  assert.match(source, /runContext\.myInfo/);
  assert.match(source, /visible job description\/context/);
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

test("Greenhouse adapter batches connector selects and keeps a combobox fallback", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /function isBatchableTextField/);
  assert.match(source, /Batch every independent safe Greenhouse fill/);
  assert.match(source, /GREENHOUSE_FILL_KNOWN_VALUES_HINT/);
  assert.match(source, /do not stop, ask, or defer the whole form just because a few fields are unknown/);
  assert.match(source, /Fill every field with a known, visible, My Info-supported, or safely synthesized value/);
  assert.match(source, /unknown fields are not blockers/);
  assert.match(source, /connector-select fills/);
  assert.match(source, /GREENHOUSE_EEOC_BATCH_HINT/);
  assert.match(source, /one planner step that batches safe text\/long_text\/url\/tel\/email fills/);
  assert.match(source, /greenhouse_fill_select calls, and greenhouse_fill_eeoc/);
  assert.match(source, /searches when the desired option is not immediately visible/);
  assert.match(source, /do not pre-open the menu just to inspect finite options/i);
  assert.match(source, /Use click\/open\/observe only when the connector tool is unavailable or failed/);
  assert.match(source, /function isConnectorFillSelectField/);
  assert.match(source, /const shouldOpenCombobox/);
  assert.match(source, /Greenhouse Phone Country Code is the phone country\/extension selector/);
  assert.match(source, /batch greenhouse_fill_select\(fieldKey=\\"country\\"/);
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
  assert.match(source, /name: "greenhouse_fill_select"/);
  assert.match(source, /function connectorSelectFields/);
  assert.match(source, /collectFieldRoots\(documentRef \|\| document\)/);
  assert.match(source, /\.application--questions/);
  assert.match(source, /\.education--form/);
  assert.match(source, /"demographic"/);
  assert.match(source, /fieldSectionKind !== "demographic"/);
  assert.match(source, /fieldKey === "false"/); // excludes unusable id="false" selects
  // Runner-side executor: opens, reads options, searches when needed, matches, commits.
  assert.match(source, /async function greenhouseFillSelect/);
  assert.match(source, /function readComboboxOptions/);
  assert.match(source, /function searchComboboxOptions/);
  assert.match(source, /function matchComboboxOption/);
  assert.match(source, /function dispatchReactSelectInput/);
  assert.match(source, /function waitForComboboxOptions/);
  assert.match(source, /function fieldValueAliases/);
  assert.match(source, /function phoneCountryCodeAliases/);
  assert.match(source, /function equivalentValuesForSelect/);
  assert.match(source, /United States/);
  assert.match(source, /\+1/);
  assert.match(source, /India/);
  assert.match(source, /\+91/);
  assert.match(source, /function scoreComboboxOption/);
  assert.match(source, /No, I do not have a disability and have not had one in the past/);
  assert.match(source, /Virginia Polytechnic Institute and State University/);
  assert.match(source, /Bachelor's Degree/);
  assert.match(source, /function committedSelectValue/);
  assert.match(source, /function waitForCommittedSelectValue/);
  assert.match(source, /recoverable:\s*true/);
  assert.match(source, /continueBatch:\s*true/);
  assert.match(source, /equivalentValues:\s*equivalentValuesForSelect/);
  assert.match(source, /greenhouse_phone_country_code_connector_select/);
  assert.match(source, /greenhouse_demographic_connector_select/);
  assert.match(source, /WebGPTConnectorTools\.register\(\s*"greenhouse_fill_select"/);
  // Enhanced state should describe connector-backed selects as batchable connector actions.
  assert.match(source, /function isConnectorFillSelectField/);
  assert.match(source, /preferredAction:\s*field\.connectorTool/);
  assert.match(source, /connectorTool:\s*field\.connectorTool/);
  assert.match(source, /batchPlacement:\s*"can_batch"/);
  assert.match(source, /greenhouse_fill_select\(fieldKey, value\)/);
  // The tool is declared on the adapter registration.
  assert.match(source, /provideTools,/);
});

test("Greenhouse adapter exposes demographic section selects through the connector", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /GREENHOUSE_DEMOGRAPHIC_INFERENCE_HINT/);
  assert.match(source, /GREENHOUSE_DEMOGRAPHIC_BATCH_HINT/);
  assert.match(source, /Gender Male -> Man/);
  assert.match(source, /Indian\/India\/South Asian -> Asian/);
  assert.match(source, /no disability -> No/);
  assert.match(source, /not a veteran -> No/);
  assert.match(source, /Omit sexual orientation, transgender status/);
  assert.match(source, /function demographicSectionGroups/);
  assert.match(source, /greenhouse_demographic_section/);
  assert.match(source, /Greenhouse demographic section detected/);
  assert.match(source, /#demographic-section \.select, \.demographic--container \.select/);
  assert.match(source, /field\.demographicOptional/);
  assert.match(source, /Sensitive optional Greenhouse demographic field/);
  assert.match(source, /aliases\.push\("Man", "Male"\)/);
  assert.match(source, /aliases\.push\("Asian"\)/);
  assert.match(source, /aliases\.push\("No"\)/);
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
  assert.match(source, /preferredAction: "greenhouse_fill_eeoc"/);
  assert.match(source, /connector action available: greenhouse_fill_eeoc/);
  assert.match(source, /name: "greenhouse_fill_eeoc"/);
  assert.match(source, /fieldValues/);
  assert.match(source, /direct EEOC inferences from My Info/);
  assert.match(source, /GREENHOUSE_EEOC_RACE_AFTER_HISPANIC_HINT/);
  assert.match(source, /same greenhouse_fill_eeoc call as hispanic_ethnicity=\\"No\\"/);
  assert.match(source, /connector fills Hispanic\/Latino first, waits for Race, then fills Race/);
  assert.match(source, /input\.closest\("\.select"\) \|\|/);
  assert.match(source, /async function greenhouseFillEeoc/);
  assert.match(source, /scopeSelector: "\.eeoc__container"/);
  assert.match(source, /fieldValues:\s*committedFieldValues/);
  assert.match(source, /recoverable:\s*failed\.length > 0/);
  assert.match(source, /WebGPTConnectorTools\.register\(\s*"greenhouse_fill_eeoc"/);
});

test("Greenhouse adapter marks submit boundaries and uses My Info for EEOC", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /greenhouse_submit_application_boundary/);
  assert.match(source, /Do not click when USER_GOAL says not to submit/);
  assert.match(source, /Greenhouse EEOC fields are sensitive optional fields/);
  assert.match(source, /values in runContext\.myInfo are user-provided profile facts/);
  assert.match(source, /direct derivations such as ethnicity\/race Indian -> Hispanic\/Latino No/);
  assert.match(source, /If My Info does not support a matching value/);
  assert.match(source, /decline\/prefer-not-to-answer/);
  assert.match(source, /mention blanks in done summaries/);
});

test("Greenhouse adapter encourages synthesized normal optional answers", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /GREENHOUSE_APPLICATION_SYNTHESIS_HINT/);
  assert.match(source, /fill every answerable field by default even when optional/);
  assert.match(source, /Fill every field with a known, visible, My Info-supported, or safely synthesized value/);
  assert.match(source, /synthesize a concise honest answer from runContext\.myInfo/);
  assert.match(source, /prefer concise complete answers/);
  assert.match(source, /never truncate mid-word or mid-sentence/);
  assert.match(source, /finish naturally/);
  assert.match(source, /Final complete cover letter text/);
  assert.doesNotMatch(source, /(?:about|around|up to|aim(?:\s+\w+){0,3})\s+500\s+(?:characters|chars)/i);
  assert.match(source, /This is planner guidance, not an enforcement cap/);
  assert.match(source, /do not synthesize sensitive EEOC, legal\/work-authorization, demographic, or file-upload answers/);
  assert.match(source, /function isNormalSynthesizableField/);
  assert.match(source, /normalSynthesizable/);
  assert.match(source, /normal answerable application question/);
  assert.match(source, /This normal Greenhouse application question is answerable even when optional/);
  assert.match(source, /Greenhouse optional normal application questions are still part of the application/);
  assert.match(source, /"long_text"/);
});

test("Greenhouse EEOC matching infers Indian as Hispanic No and race Asian", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /GREENHOUSE_HISPANIC_INDIAN_HINT/);
  assert.match(source, /Indian\/India\/South Asian in runContext\.myInfo directly supports selecting No/);
  assert.match(source, /GREENHOUSE_RACE_INDIAN_HINT/);
  assert.match(source, /Indian\/India\/South Asian maps to Asian \(Not Hispanic or Latino\)/);
  assert.match(source, /include race=\\"Asian \(Not Hispanic or Latino\)\\"/);
  assert.match(source, /if \(optionKey === "no"\) return 2000/);
  assert.match(source, /aliases\.push\("Asian \(Not Hispanic or Latino\)"\)/);
  assert.match(source, /if \(\/\\basian\\b\/\.test\(optionKey\)\) return 2000/);
  assert.match(source, /if \(\/\\bamerican indian\\b\|\\balaska native\\b\/\.test\(optionKey\)\) return 0/);
  assert.match(source, /EEOC_FIELD_SPECS\.map\(\(spec\) => \[/);
});

test("Greenhouse select matching keeps exact and sponsorship-polarity matches safe", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /function sponsorshipPolarityConflict/);
  assert.match(source, /hasNoSponsorshipIntent/);
  assert.match(source, /hasNeedsSponsorshipIntent/);
  assert.match(source, /if \(optionKey === wantedKey\) return 2000/);
  assert.match(source, /if \(sponsorshipPolarityConflict\(optionKey, wantedKey\)\) return 0/);
  assert.match(source, /const wantedTokens = unique\(selectTokens\(value\)\)/);
  assert.match(source, /Math\.min\(overlap\.length \* 120, 760\)/);
});

test("Greenhouse adapter filters long EEOC policy copy from planner state", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/greenhouse.js");

  assert.match(source, /function isGreenhousePolicyNoiseText/);
  assert.match(source, /vietnam era veterans readjustment assistance act/);
  assert.match(source, /omb control number/);
  assert.match(source, /paperwork reduction act/);
  assert.match(source, /function filterPlannerNoiseList/);
  assert.match(source, /function filterPlannerNoiseGroups/);
  assert.match(source, /function filterPlannerNoiseControls/);
  assert.match(source, /\.\.\.filterPlannerNoiseList\(state\.visibleTextSummary \|\| \[\]\)/);
  assert.match(source, /\.\.\.filterPlannerNoiseGroups\(state\.groups \|\| \[\]\)/);
  assert.match(source, /controls: filterPlannerNoiseControls/);
});
