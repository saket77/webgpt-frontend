const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Dotloop adapter is injected before state extraction", () => {
  const source = readSource("packages/page-runtime/src/manifest.js");

  assert.match(source, /content-scripts\/adapters\/dotloop\.js/);
  const dotloopIndex = source.indexOf("content-scripts/adapters/dotloop.js");
  const extractIndex = source.indexOf("content-scripts/extractState.js");
  assert.ok(dotloopIndex !== -1 && extractIndex !== -1);
  assert.ok(dotloopIndex < extractIndex, "Dotloop adapter must load before extraction");
});

test("Dotloop document reading does not add Chrome debugger permission", () => {
  const manifest = JSON.parse(readSource("apps/extension-host/src/manifest.json"));
  assert.ok(!manifest.permissions.includes("debugger"));
});

test("Dotloop adapter exposes connector tools from enhanced document and modal state", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/dotloop.js");

  assert.match(source, /const ADAPTER_ID = "dotloop\.local"/);
  assert.match(source, /function provideTools/);
  assert.match(source, /collectDocumentFields\(state \|\| \{ controls: \[\] \}, documentRef, url\)/);
  assert.match(source, /collectAddPersonModal\(state \|\| \{ controls: \[\] \}, doc\)/);
  assert.match(source, /name: "dotloop_fill_document_fields"/);
  assert.match(source, /name: "dotloop_add_person"/);
  assert.match(source, /name: READ_DOCUMENT_TOOL/);
  assert.match(source, /dotloop_read_document/);
  assert.match(source, /name: READ_DOCUMENT_TOOL/);
  assert.match(source, /dotloop_read_document/);
  assert.match(source, /fieldValues/);
  assert.match(source, /fieldValueProperties\[field\.machineKey\]/);
  assert.match(source, /roleLabels/);
  assert.match(source, /sendIntroEmail/);
  assert.match(source, /addToTeam/);
  assert.match(source, /additionalProperties: false/);
  assert.match(source, /provideTools,/);
});

test("Dotloop connector executors reuse existing Dotloop selectors and register with WebGPTConnectorTools", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/dotloop.js");

  assert.match(source, /async function dotloopFillDocumentFields/);
  assert.match(source, /async function dotloopReadDocument/);
  assert.match(source, /fetchDocumentRevisionPayload/);
  assert.match(source, /documentPagesFromDom/);
  assert.match(source, /documentFieldsFromDom/);
  assert.match(source, /dotloopDocumentReadRequest/);
  assert.match(source, /s3ImageUrl/);
  assert.match(source, /\/my\/rest\/v1_0\/document\//);
  assert.match(source, /async function dotloopReadDocument/);
  assert.match(source, /fetchDocumentRevisionPayload/);
  assert.match(source, /documentPagesFromDom/);
  assert.match(source, /documentFieldsFromDom/);
  assert.match(source, /dotloopDocumentReadRequest/);
  assert.match(source, /s3ImageUrl/);
  assert.match(source, /\/my\/rest\/v1_0\/document\//);
  assert.match(source, /function fieldValuesFromAction/);
  assert.match(source, /function matchingDocumentFieldItems/);
  assert.match(source, /function visionFieldTargetForAction/);
  assert.match(source, /function matchingDocumentFieldItemsByVisionTarget/);
  assert.match(source, /function scoreFieldMatch/);
  assert.match(source, /function visionTargetRects/);
  assert.match(source, /overlapRatio/);
  assert.match(source, /verticalOverlapRatio/);
  assert.match(source, /matchMode/);
  assert.match(source, /fieldTargets/);
  assert.match(source, /visionFieldTargets/);
  assert.match(source, /function editorNavigationGroup/);
  assert.match(source, /dotloop_editor_navigation/);
  assert.match(source, /function visionFieldTargetForAction/);
  assert.match(source, /function matchingDocumentFieldItemsByVisionTarget/);
  assert.match(source, /function scoreFieldMatch/);
  assert.match(source, /function visionTargetRects/);
  assert.match(source, /overlapRatio/);
  assert.match(source, /verticalOverlapRatio/);
  assert.match(source, /matchMode/);
  assert.match(source, /fieldTargets/);
  assert.match(source, /visionFieldTargets/);
  assert.match(source, /function editorNavigationGroup/);
  assert.match(source, /dotloop_editor_navigation/);
  assert.match(source, /\.data-item/);
  assert.match(source, /fieldValueFor\(item\)/);
  assert.match(source, /fieldEditability\(item, fieldType, currentValue\)/);
  assert.match(source, /documentFieldActivationTarget/);
  assert.match(source, /matching placeholder or vision field target not found/);
  assert.match(source, /matching placeholder or vision field target not found/);
  assert.match(source, /async function dotloopAddPerson/);
  assert.match(source, /function findAddPersonModal/);
  assert.match(source, /#inputName/);
  assert.match(source, /#inputEmail/);
  assert.match(source, /#inputRole/);
  assert.match(source, /li\[data-selected\]/);
  assert.match(source, /#send-email-checkbox/);
  assert.match(source, /#add-to-team-checkbox/);
  assert.match(source, /#add-person-button/);
  assert.match(source, /WebGPTConnectorTools\.register\(\s*"dotloop_fill_document_fields"/);
  assert.match(source, /WebGPTConnectorTools\.register\(\s*"dotloop_add_person"/);
  assert.match(source, /WebGPTConnectorTools\.register\(\s*READ_DOCUMENT_TOOL/);
  assert.match(source, /WebGPTConnectorTools\.register\(\s*READ_DOCUMENT_TOOL/);
});

test("Dotloop hints prefer connector tools and remove stale site-adapter-only guidance", () => {
  const source = readSource("packages/page-runtime/src/content-scripts/adapters/dotloop.js");

  assert.doesNotMatch(source, /no Dotloop API or special executor exists/);
  assert.match(source, /Dotloop connector adapter active/);
  assert.match(source, /connector action available: dotloop_fill_document_fields\(fieldValues\)/);
  assert.match(source, /connector action available: dotloop_add_person/);
  assert.match(source, /Read the current Dotloop PDF\/document in ONE action/);
  assert.match(source, /click the editor back target first, then choose the named document/);
  assert.match(source, /before asking the user for a URL/);
  assert.match(source, /run dotloop_read_document to extract visual PDF labels/);
  assert.match(source, /documents that do not expose machine-readable placeholder keys/);
  assert.match(source, /vision-mapped fields from dotloop_read_document/);
  assert.match(source, /Read the current Dotloop PDF\/document in ONE action/);
  assert.match(source, /click the editor back target first, then choose the named document/);
  assert.match(source, /before asking the user for a URL/);
  assert.match(source, /run dotloop_read_document to extract visual PDF labels/);
  assert.match(source, /documents that do not expose machine-readable placeholder keys/);
  assert.match(source, /vision-mapped fields from dotloop_read_document/);
  assert.match(source, /preferredAction: field\.machineKey\s*\?\s*FILL_DOCUMENT_FIELDS_TOOL/);
  assert.match(source, /connectorTool: field\.machineKey \? FILL_DOCUMENT_FIELDS_TOOL : ""/);
  assert.match(source, /preferredAction: ADD_PERSON_TOOL/);
  assert.match(source, /verifyAfterAction:\s*field\.machineKey \? "adapter_group_current_value"/);
  assert.match(source, /verifyAfterAction: "adapter_group_or_people_list"/);
});
