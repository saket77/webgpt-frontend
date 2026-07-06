const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("InvestorGain IPO adapter is injected before state extraction", () => {
  const source = readSource("packages/page-runtime/src/manifest.js");

  assert.match(source, /content-scripts\/adapters\/investorGainIpo\.js/);
  const adapterIndex = source.indexOf(
    "content-scripts/adapters/investorGainIpo.js",
  );
  const extractStateIndex = source.indexOf("content-scripts/extractState.js");
  assert.ok(adapterIndex !== -1 && extractStateIndex !== -1);
  assert.ok(adapterIndex < extractStateIndex);
});

test("InvestorGain IPO adapter scopes itself to the GMP report page", () => {
  const source = readSource(
    "packages/page-runtime/src/content-scripts/adapters/investorGainIpo.js",
  );

  assert.match(source, /const ADAPTER_ID = "investorgain\.ipo_gmp_report"/);
  assert.match(source, /host !== "investorgain\.com"/);
  assert.match(source, /host !== "www\.investorgain\.com"/);
  assert.match(source, /live-ipo-gmp\|ipo-gmp-live/);
  assert.match(source, /#reportTabsWrap\[aria-label='Report parameters'\]/);
  assert.match(source, /table#reportTable\.report-data-table/);
  assert.match(source, /table\.report-data-table/);
  assert.match(source, /ipo gmp/);
});

test("InvestorGain IPO adapter exposes report parameter and read connector tools", () => {
  const source = readSource(
    "packages/page-runtime/src/content-scripts/adapters/investorGainIpo.js",
  );

  assert.match(source, /const READ_TOOL = "investorgain_read_ipo_gmp_table"/);
  assert.match(source, /const APPLY_FILTERS_TOOL = "investorgain_apply_ipo_filters"/);
  assert.match(source, /function provideTools/);
  assert.match(source, /name: APPLY_FILTERS_TOOL/);
  assert.match(source, /name: READ_TOOL/);
  assert.match(source, /required: \["parameter", "navigationAction"\]/);
  assert.match(source, /mayCauseNavigation: true/);
  assert.match(source, /mayCauseNavigation: false/);
  assert.match(source, /connectorTools\.register\(READ_TOOL, readIpoTable\)/);
  assert.match(
    source,
    /connectorTools\.register\(APPLY_FILTERS_TOOL, applyIpoFilters\)/,
  );
});

test("InvestorGain IPO read tool uses the public JSON endpoint with DOM fallback", () => {
  const source = readSource(
    "packages/page-runtime/src/content-scripts/adapters/investorGainIpo.js",
  );

  assert.match(source, /https:\/\/webnodejs\.investorgain\.com/);
  assert.match(source, /cloud\/v2\/report\/data-read/);
  assert.match(source, /reportTableData/);
  assert.match(source, /async function fetchApiRows/);
  assert.match(source, /await fetch\(apiUrl/);
  assert.match(source, /source = "api"/);
  assert.match(source, /sourceParameter = activeParameterFromUrl/);
  assert.match(source, /requestedParameter/);
  assert.match(source, /collectVisibleRows/);
  assert.match(source, /source = rows\.length \? "visible_dom" : ""/);
  assert.match(source, /recoverable: true/);
  assert.doesNotMatch(source, /function filterRows/);
  assert.doesNotMatch(source, /resultFilters/);
});

test("InvestorGain IPO visible table prefers extract, not read", () => {
  const source = readSource(
    "packages/page-runtime/src/content-scripts/adapters/investorGainIpo.js",
  );
  const tableStart = source.indexOf("function tableGroup");
  const rowStart = source.indexOf("function rowGroup");
  const tableSource = source.slice(tableStart, rowStart);

  assert.match(tableSource, /preferredAction: "extract"/);
  assert.match(tableSource, /type: "extract"/);
  assert.doesNotMatch(tableSource, /connectorTool: READ_TOOL/);
  assert.doesNotMatch(tableSource, /preferredAction: READ_TOOL/);
  assert.match(source, /Prefer extract for visible table, row, and cell data/);
});

test("InvestorGain IPO adapter exposes report tabs, rows, and cells in state", () => {
  const source = readSource(
    "packages/page-runtime/src/content-scripts/adapters/investorGainIpo.js",
  );

  assert.match(source, /REPORT_PARAMETERS = \[/);
  assert.match(source, /code: "nonzero", label: "Only Active GMP"/);
  assert.match(source, /code: "open", label: "Open"/);
  assert.match(source, /code: "current", label: "Upcoming"/);
  assert.match(source, /code: "closing-today", label: "Closing Today"/);
  assert.match(source, /code: "ipo", label: "Mainboard"/);
  assert.match(source, /kind: "investorgain_ipo_report_parameters"/);
  assert.match(source, /kind: "investorgain_ipo_gmp_table"/);
  assert.match(source, /kind: "investorgain_ipo_gmp_row"/);
  assert.match(source, /kind: "investorgain_ipo_gmp_cell"/);
  assert.match(source, /visibleRows/);
  assert.match(source, /cells/);
  assert.match(source, /visibleTextSummary/);
  assert.match(source, /siteAdapter/);
});

test("InvestorGain IPO rows include user-driven IPO workflow fields", () => {
  const source = readSource(
    "packages/page-runtime/src/content-scripts/adapters/investorGainIpo.js",
  );

  assert.match(source, /gmpAmount/);
  assert.match(source, /gmpPercent/);
  assert.match(source, /subscriptionTimes/);
  assert.match(source, /price/);
  assert.match(source, /estimatedListingPrice/);
  assert.match(source, /openDateKey/);
  assert.match(source, /closeDateKey/);
  assert.match(source, /updatedOn/);
  assert.match(source, /does not apply a built-in good-buy threshold/);
  assert.doesNotMatch(source, /onlyAlertCandidates/);
  assert.doesNotMatch(source, /defaultAlertThresholds/);
  assert.doesNotMatch(source, /gmpPercent >= 60/);
  assert.doesNotMatch(source, /subscriptionTimes >= 10/);
});

test("InvestorGain IPO read connector schema does not expose row filters", () => {
  const source = readSource(
    "packages/page-runtime/src/content-scripts/adapters/investorGainIpo.js",
  );
  const readToolStart = source.indexOf("name: READ_TOOL");
  const readToolEnd = source.indexOf("webgpt:", readToolStart);
  const readToolSource = source.slice(readToolStart, readToolEnd);

  assert.match(readToolSource, /Read unfiltered normalized InvestorGain IPO GMP/);
  assert.match(readToolSource, /parameter/);
  assert.match(readToolSource, /source/);
  assert.match(readToolSource, /page/);
  assert.match(readToolSource, /sort/);
  assert.doesNotMatch(readToolSource, /nameContains/);
  assert.doesNotMatch(readToolSource, /category/);
  assert.doesNotMatch(readToolSource, /statusFilter/);
  assert.doesNotMatch(readToolSource, /minGmpPercent/);
  assert.doesNotMatch(readToolSource, /maxGmpPercent/);
  assert.doesNotMatch(readToolSource, /minSubscriptionTimes/);
  assert.doesNotMatch(readToolSource, /maxSubscriptionTimes/);
  assert.doesNotMatch(readToolSource, /priceMin/);
  assert.doesNotMatch(readToolSource, /priceMax/);
  assert.doesNotMatch(readToolSource, /openOnOrAfter/);
  assert.doesNotMatch(readToolSource, /closeOnOrBefore/);
});
