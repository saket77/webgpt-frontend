const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("eProcure adapter is injected before state extraction", () => {
  const source = readSource("packages/page-runtime/src/manifest.js");

  assert.match(source, /content-scripts\/adapters\/eprocure\.js/);
  assert.match(
    source,
    /content-scripts\/adapters\/eprocure\.js",\n\s+"content-scripts\/extractState\.js"/,
  );
});

test("eProcure adapter scopes itself to the latest active tenders table", () => {
  const source = readSource(
    "packages/page-runtime/src/content-scripts/adapters/eprocure.js",
  );

  assert.match(source, /const ADAPTER_ID = "eprocure\.latest_active_tenders"/);
  assert.match(source, /FrontEndLatestActiveTendersOrgwise/);
  assert.match(source, /form#LatestActiveTenders table#table/);
  assert.match(source, /e-published date/);
  assert.match(source, /title and ref\.no\.\/tender id/);
  assert.match(source, /organisation chain/);
  assert.match(source, /host !== "eprocure\.gov\.in"/);
});

test("eProcure adapter exposes structured table and pagination connector tools", () => {
  const source = readSource(
    "packages/page-runtime/src/content-scripts/adapters/eprocure.js",
  );

  assert.match(source, /const READ_TOOL = "eprocure_read_tender_table"/);
  assert.match(source, /const NAVIGATE_TOOL = "eprocure_navigate_tender_page"/);
  assert.match(source, /function provideTools/);
  assert.match(source, /name: READ_TOOL/);
  assert.match(source, /name: NAVIGATE_TOOL/);
  assert.match(source, /publishedDate/);
  assert.match(source, /fromPublishedDate/);
  assert.match(source, /toPublishedDate/);
  assert.match(source, /startRow/);
  assert.match(source, /endRow/);
  assert.match(source, /direction/);
  assert.match(source, /pageNumber/);
  assert.match(source, /navigationAction/);
  assert.match(source, /enum: \[true\]/);
  assert.match(source, /required: \["navigationAction"\]/);
  assert.match(source, /mayCauseNavigation: true/);
});

test("eProcure adapter parses tender row fields and exposes extractable groups", () => {
  const source = readSource(
    "packages/page-runtime/src/content-scripts/adapters/eprocure.js",
  );

  assert.match(source, /publishedDateKey/);
  assert.match(source, /publishedDateTimeLocal/);
  assert.match(source, /bidSubmissionClosingDate/);
  assert.match(source, /tenderOpeningDate/);
  assert.match(source, /referenceNo/);
  assert.match(source, /tenderId/);
  assert.match(source, /organisationChain/);
  assert.match(source, /detailUrl/);
  assert.match(source, /titleTargetId/);
  assert.match(source, /detailTargetId/);
  assert.match(source, /kind: "eprocure_tender_result"/);
  assert.match(source, /preferredAction: "extract"/);
  assert.match(source, /suggestedAction:\s*\{\s*type: "extract"/);
  assert.match(source, /openDetailAction/);
  assert.match(source, /kind: "eprocure_tender_table"/);
  assert.match(source, /connectorTool: READ_TOOL/);
  assert.doesNotMatch(source, /eprocure_tender_published_date_bucket/);
  assert.doesNotMatch(source, /publishedDateGroups/);
});

test("eProcure row groups expose clickable title/detail link controls", () => {
  const source = readSource(
    "packages/page-runtime/src/content-scripts/adapters/eprocure.js",
  );

  assert.match(source, /const titleControl = findControlForElement\(controls, link\)/);
  assert.match(source, /titleTargetId: titleControl\?\.id/);
  assert.match(source, /detailTargetId: titleControl\?\.id/);
  assert.match(source, /controlIds = unique\(\[row\.titleTargetId\]\)/);
  assert.match(source, /semanticRole: "eprocure_tender_title_link"/);
  assert.match(source, /preferredAction: "click"/);
  assert.match(source, /Title and Ref\.No\.\/Tender ID link/);
  assert.match(source, /rowTargetId/);
});

test("eProcure adapter gives planner enough date-range pagination guidance", () => {
  const source = readSource(
    "packages/page-runtime/src/content-scripts/adapters/eprocure.js",
  );

  assert.match(source, /sortOrder: "published_date_desc"/);
  assert.match(source, /timezone: "Asia\/Kolkata"/);
  assert.match(source, /rows are sorted newest to oldest by e-Published Date/);
  assert.match(source, /Do not construct pagination URLs manually/);
  assert.match(source, /oldest visible published date is newer than or equal to the requested start date/);
  assert.match(source, /Stop when visible rows are older than the requested date range/);
  assert.match(source, /prefer normal extract on the matching eProcure tender row group targetId/);
  assert.match(source, /do not call a connector tool just to re-read one already-visible row/);
  assert.match(source, /omit filters to return all visible rows/);
  assert.match(source, /click that row group's titleTargetId\/detailTargetId/);
  assert.match(source, /visibleTextSummary/);
  assert.match(source, /siteAdapter/);
});

test("eProcure connector executors are registered in the content-script runtime", () => {
  const source = readSource(
    "packages/page-runtime/src/content-scripts/adapters/eprocure.js",
  );

  assert.match(source, /globalThis\.WebGPTConnectorTools/);
  assert.match(source, /connectorTools\.register\(READ_TOOL, readTenderTable\)/);
  assert.match(source, /connectorTools\.register\(NAVIGATE_TOOL, navigateTenderPage\)/);
  assert.match(source, /ctx\?\.primitives\?\.clickElement/);
  assert.match(source, /link\.click\(\)/);
});

test("extension host treats connector navigation flags as navigation-causing", () => {
  const source = readSource("apps/extension-host/src/background/runtime/browser.js");

  assert.match(source, /action\.mayCauseNavigation \|\| action\.navigationAction/);
});
