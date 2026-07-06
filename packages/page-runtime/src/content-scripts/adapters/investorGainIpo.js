(function () {
  const ADAPTER_ID = "investorgain.ipo_gmp_report";
  const READ_TOOL = "investorgain_read_ipo_gmp_table";
  const APPLY_FILTERS_TOOL = "investorgain_apply_ipo_filters";
  const REPORT_ID = "331";
  const API_ORIGIN = "https://webnodejs.investorgain.com";
  const DEFAULT_VERSION = "09-18";
  const TABLE_TARGET_ID = `site:${ADAPTER_ID}:ipo_gmp_table`;
  const PARAMETERS_TARGET_ID = `site:${ADAPTER_ID}:report_parameters`;
  const MAX_STATE_ROWS = 40;
  const MAX_CELL_GROUPS = 160;

  const REPORT_PARAMETERS = [
    { code: "all", label: "All" },
    { code: "nonzero", label: "Only Active GMP" },
    { code: "open", label: "Open", statusLabel: "Open" },
    { code: "current", label: "Upcoming", statusLabel: "Upcoming" },
    { code: "close", label: "Close", statusLabel: "Closed" },
    { code: "sme", label: "SME", category: "SME" },
    { code: "ipo", label: "Mainboard", category: "IPO" },
    { code: "closing-today", label: "Closing Today", statusLabel: "Closing Today" },
    { code: "listed", label: "Listed", statusLabel: "Listed" },
  ];

  const PARAMETER_ALIASES = new Map([
    ["active", "nonzero"],
    ["activegmp", "nonzero"],
    ["all", "all"],
    ["allipos", "all"],
    ["close", "close"],
    ["closed", "close"],
    ["closing", "close"],
    ["closingtoday", "closing-today"],
    ["current", "current"],
    ["ipo", "ipo"],
    ["listed", "listed"],
    ["mainboard", "ipo"],
    ["mainboardipo", "ipo"],
    ["nonzero", "nonzero"],
    ["onlyactivegmp", "nonzero"],
    ["open", "open"],
    ["sme", "sme"],
    ["smeipo", "sme"],
    ["upcoming", "current"],
  ]);

  const STATUS_ALIASES = new Map([
    ["activegmp", "nonzero"],
    ["all", "all"],
    ["close", "close"],
    ["closed", "close"],
    ["closingtoday", "closing-today"],
    ["listed", "listed"],
    ["mainboard", "ipo"],
    ["open", "open"],
    ["sme", "sme"],
    ["upcoming", "current"],
  ]);

  const MONTHS = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12",
  };

  const registry = globalThis.WebGPTContentAdapters;
  const extractModules = globalThis.WebGPTExtractStateModules || {};
  const domUtils = extractModules.domUtils || {};

  if (!registry || typeof registry.register !== "function") {
    throw new Error(
      "content-scripts/adapters/registry.js must load before investorGainIpo.js",
    );
  }

  const normalizeText =
    domUtils.normalizeText ||
    ((value) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim());
  const lower =
    domUtils.lower || ((value) => normalizeText(value).toLowerCase());
  const textContent =
    domUtils.textContent ||
    ((el) => normalizeText(el?.innerText || el?.textContent || el?.value || ""));

  function safeUrl(url) {
    try {
      return new URL(url || location.href);
    } catch {
      return new URL(location.href);
    }
  }

  function absoluteUrl(value, base = location.href) {
    const raw = normalizeText(value);
    if (!raw) return "";
    try {
      return new URL(raw, base).toString();
    } catch {
      return raw;
    }
  }

  function cssEscape(value) {
    if (globalThis.CSS && typeof globalThis.CSS.escape === "function") {
      return globalThis.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function unique(items) {
    return Array.from(new Set((items || []).filter(Boolean)));
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function compactKey(value) {
    return lower(value).replace(/[^a-z0-9]+/g, "");
  }

  function parameterInfo(code) {
    return REPORT_PARAMETERS.find((item) => item.code === code) || null;
  }

  function normalizeParameter(value) {
    const text = compactKey(value);
    if (!text) return "";
    if (PARAMETER_ALIASES.has(text)) return PARAMETER_ALIASES.get(text);
    const byCode = REPORT_PARAMETERS.find((item) => compactKey(item.code) === text);
    if (byCode) return byCode.code;
    const byLabel = REPORT_PARAMETERS.find((item) => compactKey(item.label) === text);
    return byLabel?.code || "";
  }

  function normalizeStatus(value) {
    const text = compactKey(value);
    if (!text) return "";
    return STATUS_ALIASES.get(text) || normalizeParameter(value) || text;
  }

  function normalizeCategory(value) {
    const text = compactKey(value);
    if (!text) return "";
    if (text === "mainboard" || text === "mainboardipo" || text === "ipo") {
      return "IPO";
    }
    if (text === "sme" || text === "smeipo") return "SME";
    return normalizeText(value).toUpperCase();
  }

  function reportPageUrl(parameter) {
    const code = normalizeParameter(parameter) || "ipo";
    return `https://www.investorgain.com/report/ipo-gmp-live/${REPORT_ID}/${code}/?`;
  }

  function activeParameterFromUrl(url = location.href) {
    const parsed = safeUrl(url);
    const match = parsed.pathname.match(
      /\/report\/(?:live-ipo-gmp|ipo-gmp-live)\/331\/([^/?#]+)/i,
    );
    return normalizeParameter(match?.[1]) || "ipo";
  }

  function parameterFromAction(action = {}) {
    return (
      normalizeParameter(action.parameter) ||
      normalizeStatus(action.status) ||
      activeParameterFromUrl(location.href)
    );
  }

  function elementBounds(el) {
    if (!el || !(el instanceof Element)) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function center(bounds) {
    return {
      x: Number(bounds?.x || 0) + Number(bounds?.width || 0) / 2,
      y: Number(bounds?.y || 0) + Number(bounds?.height || 0) / 2,
    };
  }

  function boundsContain(outer, inner) {
    if (!outer || !inner) return false;
    const point = center(inner);
    return (
      point.x >= outer.x &&
      point.x <= outer.x + outer.width &&
      point.y >= outer.y &&
      point.y <= outer.y + outer.height
    );
  }

  function selectorCandidatesFor(el) {
    if (!el || !(el instanceof Element)) return [];

    const tag = lower(el.tagName);
    const id = normalizeText(el.id);
    const href = normalizeText(el.getAttribute("href"));
    const title = normalizeText(el.getAttribute("title"));
    const result = [];

    if (id) result.push(`#${cssEscape(id)}`);
    for (const attr of ["data-testid", "data-test", "data-qa", "data-cy"]) {
      const value = normalizeText(el.getAttribute(attr));
      if (value) result.push(`[${attr}="${cssEscape(value)}"]`);
    }
    if (title) result.push(`${tag}[title="${cssEscape(title)}"]`);
    if (tag === "a" && href && href.length <= 220) {
      result.push(`a[href="${cssEscape(href)}"]`);
    }

    return result;
  }

  function findControlForElement(controls, el) {
    if (!el || !(el instanceof Element)) return null;

    const selectors = new Set(selectorCandidatesFor(el));
    const tag = lower(el.tagName);
    const title = normalizeText(el.getAttribute("title"));
    const href = normalizeText(el.getAttribute("href"));
    const bounds = elementBounds(el);

    const selectorMatches = (controls || []).filter((control) =>
      selectors.has(control.selector),
    );
    if (selectorMatches.length === 1) return selectorMatches[0];

    return (
      selectorMatches.find(
        (control) =>
          boundsContain(bounds, control.bounds) &&
          (!control.tag || !tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          title && control.title === title && (!control.tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          href &&
          control.selector === `a[href="${cssEscape(href)}"]` &&
          (!control.tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          boundsContain(bounds, control.bounds) &&
          (!control.tag || control.tag === tag),
      ) ||
      null
    );
  }

  function htmlToText(value) {
    const raw = String(value || "");
    if (!raw) return "";
    const container = document.createElement("div");
    container.innerHTML = raw.replace(/<br\s*\/?>/gi, " | ");
    return normalizeText(container.textContent || "");
  }

  function firstLinkData(html) {
    const raw = String(html || "");
    if (!raw) return { href: "", text: "" };
    const container = document.createElement("div");
    container.innerHTML = raw;
    const link = container.querySelector("a[href]");
    if (!link) return { href: "", text: "" };
    return {
      href: absoluteUrl(link.getAttribute("href")),
      text: textContent(link),
    };
  }

  function cleanTabLabel(value) {
    return normalizeText(value)
      .replace(/\s+New$/i, "")
      .replace(/\s+(O|U|C|CT|L)$/i, "")
      .trim();
  }

  function cleanIpoName(value) {
    return normalizeText(value)
      .replace(/\s+(O|U|C|CT|LT)$/i, "")
      .replace(/\s+L@\s*[-+]?[\d.]+%?$/i, "")
      .trim();
  }

  function parseNumber(value) {
    const text = htmlToText(value)
      .replace(/,/g, "")
      .replace(/₹/g, "")
      .replace(/rs\.?/gi, "")
      .replace(/%/g, "")
      .replace(/x\b/gi, "");
    const match = text.match(/[-+]?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseSubscription(value) {
    const text = htmlToText(value);
    const match = text.match(/([-+]?\d+(?:\.\d+)?)\s*x/i);
    if (match) return Number(match[1]);
    return parseNumber(text);
  }

  function parseGmpPercent(hiddenValue, gmpValue) {
    const hidden = parseNumber(hiddenValue);
    if (hidden !== null) return hidden;
    const text = htmlToText(gmpValue);
    const match = text.match(/\(([-+]?\d+(?:\.\d+)?)\s*%\)/);
    if (match) return Number(match[1]);
    return null;
  }

  function parseGmpAmount(value) {
    const text = htmlToText(value).replace(/,/g, "");
    const currency = text.match(/₹\s*([-+]?\d+(?:\.\d+)?)/);
    if (currency) return Number(currency[1]);
    const first = text.match(/^[-+]?\d+(?:\.\d+)?/);
    if (first) return Number(first[0]);
    return null;
  }

  function normalizeDateKey(value, fallbackYear = new Date().getFullYear()) {
    const text = htmlToText(value);
    if (!text) return "";

    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;

    const dashed = text.match(/^(\d{1,2})-([A-Za-z]{3,9})-(\d{2,4})/);
    if (dashed) {
      const month = MONTHS[lower(dashed[2])];
      const year =
        dashed[3].length === 2 ? `20${dashed[3]}` : String(dashed[3]);
      if (month) return `${year}-${month}-${pad2(dashed[1])}`;
    }

    const short = text.match(/^(\d{1,2})-([A-Za-z]{3,9})\b/);
    if (short) {
      const month = MONTHS[lower(short[2])];
      if (month) return `${fallbackYear}-${month}-${pad2(short[1])}`;
    }

    const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (slash) {
      const year = slash[3].length === 2 ? `20${slash[3]}` : String(slash[3]);
      return `${year}-${pad2(slash[2])}-${pad2(slash[1])}`;
    }

    return "";
  }

  function detectStatusFromHtml(nameHtml, fallbackParameter = "") {
    const html = String(nameHtml || "");
    const text = htmlToText(html);
    if (/\bCT\b/.test(text) || /bg-danger/.test(html)) {
      return { statusCode: "closing_today", statusLabel: "Closing Today" };
    }
    if (/\bO\b/.test(text) || /bg-success/.test(html)) {
      return { statusCode: "open", statusLabel: "Open" };
    }
    if (/\bU\b/.test(text) || /bg-warning/.test(html)) {
      return { statusCode: "upcoming", statusLabel: "Upcoming" };
    }
    if (/\bC\b/.test(text) || /bg-primary/.test(html)) {
      return { statusCode: "closed", statusLabel: "Closed" };
    }
    if (/\bLT\b/.test(text)) {
      return { statusCode: "listing_today", statusLabel: "Listing Today" };
    }
    if (/\bL@/i.test(text) || /bg-info/.test(html)) {
      return { statusCode: "listed", statusLabel: "Listed" };
    }

    const parameter = normalizeParameter(fallbackParameter);
    const info = parameterInfo(parameter);
    if (info?.statusLabel) {
      return {
        statusCode: parameter === "close" ? "closed" : parameter.replace(/-/g, "_"),
        statusLabel: info.statusLabel,
      };
    }
    return { statusCode: "", statusLabel: "" };
  }

  function detectCategoryFromHtml(nameHtml) {
    const text = htmlToText(nameHtml);
    if (/\b(?:NSE|BSE)?\s*SME\b/i.test(text)) return "SME";
    if (/\bmainboard\b/i.test(text)) return "IPO";
    return "";
  }

  function reportContext(documentRef = document) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const defaultFinancialYear =
      month >= 4
        ? `${year}-${String(year + 1).slice(-2)}`
        : `${year - 1}-${String(year).slice(-2)}`;
    const html = String(documentRef.documentElement?.innerHTML || "");

    const monthMatch =
      html.match(/["'](?:month|currentMonth)["']\s*:\s*["']?(\d{1,2})/i) ||
      html.match(/data-read\/331\/1\/(\d{1,2})\//i);
    const yearMatch =
      html.match(/["'](?:year|currentYear)["']\s*:\s*["']?(\d{4})/i) ||
      html.match(/data-read\/331\/1\/\d{1,2}\/(\d{4})\//i);
    const financialYearMatch =
      html.match(/["']financialYear["']\s*:\s*["'](\d{4}-\d{2})["']/i) ||
      html.match(/data-read\/331\/1\/\d{1,2}\/\d{4}\/(\d{4}-\d{2})\//i);
    const versionMatch =
      html.match(/[?&]v=(\d{2}-\d{2})/i) ||
      html.match(/["']version["']\s*:\s*["'](\d{2}-\d{2})["']/i);

    return {
      month: Number(monthMatch?.[1] || month),
      year: Number(yearMatch?.[1] || year),
      financialYear: financialYearMatch?.[1] || defaultFinancialYear,
      version: versionMatch?.[1] || DEFAULT_VERSION,
    };
  }

  function buildApiUrl({
    parameter = "ipo",
    page = 1,
    search = "",
    sort = "0",
    context = reportContext(),
  } = {}) {
    const code = normalizeParameter(parameter) || "ipo";
    const pageNumber = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const sortKey = normalizeText(sort || "0") || "0";
    const url = new URL(
      `/cloud/v2/report/data-read/${REPORT_ID}/${pageNumber}/${context.month}/${context.year}/${context.financialYear}/${sortKey}/${code}`,
      API_ORIGIN,
    );
    url.searchParams.set("search", normalizeText(search));
    url.searchParams.set("v", context.version || DEFAULT_VERSION);
    return url.toString();
  }

  function findReportTabsWrap(documentRef = document) {
    return (
      documentRef.querySelector("#reportTabsWrap[aria-label='Report parameters']") ||
      documentRef.querySelector("[aria-label='Report parameters']")
    );
  }

  function collectReportTabs(documentRef = document, controls = []) {
    const active = activeParameterFromUrl(location.href);
    const wrap = findReportTabsWrap(documentRef);
    const byCode = new Map();

    for (const link of Array.from(wrap?.querySelectorAll("a[href]") || [])) {
      const href = absoluteUrl(link.getAttribute("href"));
      const hrefParameter = normalizeParameter(
        safeUrl(href).pathname.match(/\/331\/([^/?#]+)/)?.[1],
      );
      const label = cleanTabLabel(textContent(link));
      const code = hrefParameter || normalizeParameter(label);
      if (!code) continue;
      const control = findControlForElement(controls, link);
      byCode.set(code, {
        code,
        label: parameterInfo(code)?.label || label || code,
        href,
        active:
          link.getAttribute("aria-selected") === "true" ||
          link.classList.contains("active") ||
          code === active,
        targetId: control?.id || "",
        bounds: elementBounds(link),
      });
    }

    for (const parameter of REPORT_PARAMETERS) {
      if (!byCode.has(parameter.code)) {
        byCode.set(parameter.code, {
          code: parameter.code,
          label: parameter.label,
          href: reportPageUrl(parameter.code),
          active: parameter.code === active,
          targetId: "",
          bounds: null,
        });
      }
    }

    return REPORT_PARAMETERS.map((parameter) => byCode.get(parameter.code)).filter(
      Boolean,
    );
  }

  function findReportTable(documentRef = document) {
    const primary = documentRef.querySelector(
      "table#reportTable.report-data-table, table#reportTable, table.report-data-table",
    );
    if (primary && tableLooksLikeIpoReport(primary)) return primary;
    return Array.from(documentRef.querySelectorAll("table")).find((table) =>
      tableLooksLikeIpoReport(table),
    );
  }

  function tableLooksLikeIpoReport(table) {
    const text = lower(textContent(table));
    return (
      text.includes("gmp") &&
      (text.includes("sub") || text.includes("subscription")) &&
      text.includes("price") &&
      (text.includes("open") || text.includes("close"))
    );
  }

  function tableHeaders(table) {
    const headers = Array.from(table?.querySelectorAll("thead th") || [])
      .map((th) => cleanTabLabel(textContent(th)))
      .filter(Boolean);
    if (headers.length) return headers;

    const firstRow = table?.querySelector("tr");
    return Array.from(firstRow?.querySelectorAll("th,td") || []).map(
      (_cell, index) => `Column ${index + 1}`,
    );
  }

  function cellsForRow(row) {
    try {
      return Array.from(row.querySelectorAll(":scope > td"));
    } catch {
      return Array.from(row.querySelectorAll("td"));
    }
  }

  function valueFor(cells, aliases) {
    const desired = (aliases || []).map(compactKey);
    for (const [header, value] of Object.entries(cells || {})) {
      const key = compactKey(header);
      if (desired.includes(key)) return value;
      if (desired.some((alias) => key.includes(alias))) return value;
    }
    return "";
  }

  function normalizeIpoRow({
    index,
    cells = {},
    raw = {},
    detailUrl = "",
    nameHtml = "",
    parameter = "",
    source = "visible_dom",
    bounds = null,
    detailTargetId = "",
  }) {
    const link = firstLinkData(nameHtml || raw.Name || "");
    const name =
      cleanIpoName(
        normalizeText(raw["~ipo_name"]) ||
          link.text ||
          valueFor(cells, ["Name"]) ||
          htmlToText(nameHtml || raw.Name),
      ) || `IPO row ${index + 1}`;
    const gmpText = valueFor(cells, ["GMP"]) || htmlToText(raw.GMP);
    const priceText =
      valueFor(cells, ["Price (₹)", "Price", "Price Rs"]) ||
      htmlToText(raw["Price (₹)"]);
    const subscriptionText = valueFor(cells, ["Sub", "Subscription"]) || htmlToText(raw.Sub);
    const openText = valueFor(cells, ["Open"]) || htmlToText(raw.Open);
    const closeText = valueFor(cells, ["Close"]) || htmlToText(raw.Close);
    const boaText = valueFor(cells, ["BoA Dt", "BoA Date", "Allotment"]) || htmlToText(raw["BoA Dt"]);
    const listingText = valueFor(cells, ["Listing"]) || htmlToText(raw.Listing);
    const updatedText =
      valueFor(cells, ["Updated-On", "Updated On", "Updated"]) ||
      htmlToText(raw["Updated-On"]);
    const category =
      normalizeCategory(raw["~IPO_Category"]) ||
      detectCategoryFromHtml(nameHtml || raw.Name) ||
      parameterInfo(normalizeParameter(parameter))?.category ||
      "";
    const status = detectStatusFromHtml(nameHtml || raw.Name, parameter);
    const gmpAmount = parseGmpAmount(gmpText || raw.GMP);
    const price = parseNumber(priceText || raw["Price (₹)"]);
    const gmpPercent = parseGmpPercent(raw["~gmp_percent_calc"], gmpText || raw.GMP);
    const subscriptionTimes = parseSubscription(subscriptionText || raw.Sub);
    const estimatedListingPrice =
      price !== null && gmpAmount !== null ? Number((price + gmpAmount).toFixed(2)) : null;

    return {
      position: index + 1,
      name,
      ipoName: name,
      category,
      statusCode: status.statusCode,
      statusLabel: status.statusLabel,
      gmpText: gmpText || "",
      gmpAmount,
      gmpPercent,
      subscriptionText: subscriptionText || "",
      subscriptionTimes,
      priceText: priceText || "",
      price,
      estimatedListingPrice,
      ipoSize: valueFor(cells, ["IPO Size"]) || htmlToText(raw["IPO Size"]),
      lot: valueFor(cells, ["Lot"]) || htmlToText(raw.Lot),
      pe: valueFor(cells, ["P/E", "~P/E"]) || htmlToText(raw["~P/E"]),
      openDate: openText || "",
      openDateKey: normalizeDateKey(raw["~Srt_Open"] || openText),
      closeDate: closeText || "",
      closeDateKey: normalizeDateKey(raw["~Srt_Close"] || closeText),
      boaDate: boaText || "",
      boaDateKey: normalizeDateKey(raw["~Srt_BoA_Dt"] || boaText),
      listingDate: listingText || "",
      listingDateKey: normalizeDateKey(raw["~Str_Listing"] || listingText),
      updatedOn: updatedText || "",
      anchorInvestor: valueFor(cells, ["Anchor"]) || htmlToText(raw.Anchor),
      detailUrl: detailUrl || link.href,
      rowId: normalizeText(raw["~id"]) || "",
      urlRewriteFolderName: normalizeText(raw["~urlrewrite_folder_name"]) || "",
      highlightRow: normalizeText(raw["~Highlight_Row"]) || "",
      displayOrder: parseNumber(raw["~Display_Order"]),
      cells,
      source,
      bounds,
      detailTargetId,
    };
  }

  function parseDomRow(row, index, headers, controls = [], parameter = "") {
    const cells = cellsForRow(row);
    const values = {};
    cells.forEach((cell, cellIndex) => {
      const header = headers[cellIndex] || `Column ${cellIndex + 1}`;
      values[header] = textContent(cell);
    });

    const nameCell = cells[0] || row;
    const detailLink = nameCell.querySelector("a[href]") || row.querySelector("a[href]");
    const detailControl = findControlForElement(controls, detailLink);
    return normalizeIpoRow({
      index,
      cells: values,
      nameHtml: nameCell.innerHTML || textContent(nameCell),
      detailUrl: absoluteUrl(detailLink?.getAttribute("href")),
      parameter,
      source: "visible_dom",
      bounds: elementBounds(row),
      detailTargetId: detailControl?.id || "",
    });
  }

  function collectVisibleRows(
    documentRef = document,
    controls = [],
    parameter = activeParameterFromUrl(location.href),
  ) {
    const table = findReportTable(documentRef);
    if (!table) return [];
    const headers = tableHeaders(table);
    const rows = Array.from(
      table.querySelectorAll("tbody tr, #tableBody tr, tr"),
    ).filter((row) => cellsForRow(row).length >= 4);
    return rows
      .filter((row) => !row.querySelector("th"))
      .map((row, index) => parseDomRow(row, index, headers, controls, parameter));
  }

  function collectColumns(documentRef = document) {
    return tableHeaders(findReportTable(documentRef));
  }

  function rowText(row) {
    return [
      `Name: ${row.name}`,
      row.category ? `Category: ${row.category}` : "",
      row.statusLabel ? `Status: ${row.statusLabel}` : "",
      row.gmpText ? `GMP: ${row.gmpText}` : "",
      row.gmpPercent !== null ? `GMP percent: ${row.gmpPercent}%` : "",
      row.subscriptionText ? `Subscription: ${row.subscriptionText}` : "",
      row.subscriptionTimes !== null
        ? `Subscription times: ${row.subscriptionTimes}x`
        : "",
      row.priceText ? `Price: ${row.priceText}` : "",
      row.openDate ? `Open: ${row.openDate}` : "",
      row.closeDate ? `Close: ${row.closeDate}` : "",
      row.updatedOn ? `Updated: ${row.updatedOn}` : "",
      row.detailUrl ? `Detail URL: ${row.detailUrl}` : "",
    ]
      .filter(Boolean)
      .join("; ");
  }

  function rowKey(row) {
    return ["investorgain", row.rowId, row.name, row.openDateKey, row.closeDateKey]
      .filter(Boolean)
      .join("|");
  }

  function makeExtractionItem(row) {
    return {
      key: rowKey(row),
      text: rowText(row),
      label: `InvestorGain IPO GMP row ${row.position}`,
      heading: row.name,
      nearbyText: [
        row.statusLabel,
        row.category,
        row.gmpPercent !== null ? `GMP ${row.gmpPercent}%` : "",
        row.subscriptionTimes !== null ? `Sub ${row.subscriptionTimes}x` : "",
      ]
        .filter(Boolean)
        .join("; "),
      href: row.detailUrl,
      bounds: row.bounds,
      context: {
        source: READ_TOOL,
        adapterId: ADAPTER_ID,
        position: row.position,
        name: row.name,
        category: row.category,
        statusCode: row.statusCode,
        statusLabel: row.statusLabel,
        gmpAmount: row.gmpAmount,
        gmpPercent: row.gmpPercent,
        subscriptionTimes: row.subscriptionTimes,
        price: row.price,
        estimatedListingPrice: row.estimatedListingPrice,
        openDateKey: row.openDateKey,
        closeDateKey: row.closeDateKey,
        updatedOn: row.updatedOn,
        detailUrl: row.detailUrl,
      },
    };
  }

  function parameterGroup(tabs, activeParameter) {
    const active = parameterInfo(activeParameter);
    return {
      id: "investorgain_ipo_report_parameters",
      targetId: PARAMETERS_TARGET_ID,
      kind: "investorgain_ipo_report_parameters",
      adapterId: ADAPTER_ID,
      preferredAction: APPLY_FILTERS_TOOL,
      connectorTool: APPLY_FILTERS_TOOL,
      label: "InvestorGain IPO GMP report parameters",
      text: [
        `Active report parameter: ${active?.label || activeParameter}`,
        `Available parameters: ${tabs.map((tab) => `${tab.label} (${tab.code})`).join(", ")}`,
        `Use ${APPLY_FILTERS_TOOL} to switch the live report tab.`,
      ].join("; "),
      activeParameter,
      activeParameterLabel: active?.label || activeParameter,
      parameters: tabs.map((tab) => ({
        code: tab.code,
        label: tab.label,
        href: tab.href,
        active: tab.active,
        targetId: tab.targetId,
      })),
      controlIds: unique(tabs.map((tab) => tab.targetId)),
    };
  }

  function tableGroup(rows, columns, activeParameter) {
    const label = parameterInfo(activeParameter)?.label || activeParameter;
    return {
      id: "investorgain_ipo_gmp_table",
      targetId: TABLE_TARGET_ID,
      kind: "investorgain_ipo_gmp_table",
      adapterId: ADAPTER_ID,
      preferredAction: "extract",
      suggestedAction: {
        type: "extract",
        targetId: TABLE_TARGET_ID,
      },
      label: "InvestorGain IPO GMP table",
      text: [
        `${rows.length} visible IPO GMP rows`,
        `active parameter: ${label}`,
        columns.length ? `columns: ${columns.join(", ")}` : "",
        "Extract this table or its row/cell groups when the visible rows answer the user's request.",
      ]
        .filter(Boolean)
        .join("; "),
      activeParameter,
      activeParameterLabel: label,
      rowCount: rows.length,
      columns,
    };
  }

  function rowGroup(row) {
    const targetId = `site:${ADAPTER_ID}:ipo:${row.rowId || row.position}`;
    return {
      id: `investorgain_ipo_row_${row.rowId || row.position}`,
      targetId,
      collectionTargetId: TABLE_TARGET_ID,
      kind: "investorgain_ipo_gmp_row",
      adapterId: ADAPTER_ID,
      preferredAction: "extract",
      suggestedAction: {
        type: "extract",
        targetId,
      },
      label: `IPO GMP row: ${row.name}`,
      text: rowText(row),
      position: row.position,
      name: row.name,
      category: row.category,
      statusCode: row.statusCode,
      statusLabel: row.statusLabel,
      gmpAmount: row.gmpAmount,
      gmpPercent: row.gmpPercent,
      subscriptionTimes: row.subscriptionTimes,
      price: row.price,
      estimatedListingPrice: row.estimatedListingPrice,
      openDateKey: row.openDateKey,
      closeDateKey: row.closeDateKey,
      updatedOn: row.updatedOn,
      detailUrl: row.detailUrl,
      detailTargetId: row.detailTargetId,
      controlIds: unique([row.detailTargetId]),
      bounds: row.bounds,
    };
  }

  function cellGroups(rows) {
    const groups = [];
    for (const row of rows || []) {
      for (const [column, value] of Object.entries(row.cells || {})) {
        if (groups.length >= MAX_CELL_GROUPS) return groups;
        const idPart = compactKey(column) || groups.length + 1;
        groups.push({
          id: `investorgain_ipo_cell_${row.position}_${idPart}`,
          targetId: `site:${ADAPTER_ID}:ipo:${row.rowId || row.position}:cell:${idPart}`,
          collectionTargetId: TABLE_TARGET_ID,
          kind: "investorgain_ipo_gmp_cell",
          adapterId: ADAPTER_ID,
          preferredAction: "extract",
          label: `${row.name} ${column}`,
          text: `IPO: ${row.name}; row ${row.position}; ${column}: ${value}`,
          rowPosition: row.position,
          rowName: row.name,
          columnName: column,
          value,
        });
      }
    }
    return groups;
  }

  function buildActionHints(tabs, rows) {
    const hints = {};
    for (const tab of tabs || []) {
      if (!tab.targetId) continue;
      hints[tab.targetId] = {
        semanticRole: "investorgain_report_parameter_tab",
        preferredAction: APPLY_FILTERS_TOOL,
        connectorTool: APPLY_FILTERS_TOOL,
        navigationAction: true,
        verifyAfterAction: "investorGainReportParameterChanged",
        instruction: `Switch InvestorGain IPO GMP report parameter to ${tab.label}.`,
        parameter: tab.code,
      };
    }
    for (const row of rows || []) {
      if (!row.detailTargetId) continue;
      hints[row.detailTargetId] = {
        semanticRole: "investorgain_ipo_detail_link",
        preferredAction: "click",
        navigationAction: true,
        verifyAfterAction: "investorGainIpoDetailLoaded",
        instruction: `Open InvestorGain IPO detail page for ${row.name}.`,
        ipoName: row.name,
      };
    }
    return hints;
  }

  function visibleTextFacts(siteAdapter) {
    const active = siteAdapter.activeParameterLabel || siteAdapter.activeParameter;
    return [
      `InvestorGain IPO GMP report detected. Active report parameter: ${active}.`,
      `Report parameter tabs: ${REPORT_PARAMETERS.map((item) => `${item.label} (${item.code})`).join(", ")}.`,
      `Visible IPO GMP table rows: ${siteAdapter.rowCount}; columns: ${siteAdapter.columns.join(", ")}.`,
      "This adapter exposes IPO facts and user-supplied filters; it does not apply a built-in good-buy threshold.",
      "Prefer extract on the visible table, row groups, or cell groups when the current state contains the requested IPO data.",
      `Use ${READ_TOOL} only as a fallback refresh or non-visible report read; it returns unfiltered normalized rows for the requested report parameter.`,
      `Use ${APPLY_FILTERS_TOOL} with navigationAction true to switch the visible report parameter tab.`,
    ].filter(Boolean);
  }

  function buildSiteAdapter(state, documentRef = document) {
    const activeParameter = activeParameterFromUrl(location.href);
    const controls = state.controls || [];
    const tabs = collectReportTabs(documentRef, controls);
    const rows = collectVisibleRows(documentRef, controls, activeParameter).slice(
      0,
      MAX_STATE_ROWS,
    );
    const columns = collectColumns(documentRef);
    const activeInfo = parameterInfo(activeParameter);

    return {
      id: ADAPTER_ID,
      pageKind: "investorgain_ipo_gmp_report",
      sourceName: "InvestorGain",
      timezone: "Asia/Kolkata",
      reportId: REPORT_ID,
      tableTargetId: TABLE_TARGET_ID,
      parametersTargetId: PARAMETERS_TARGET_ID,
      activeParameter,
      activeParameterLabel: activeInfo?.label || activeParameter,
      apiEndpointTemplate:
        "https://webnodejs.investorgain.com/cloud/v2/report/data-read/331/{page}/{month}/{year}/{financialYear}/{sort}/{parameter}?search={search}&v={version}",
      reportParameters: tabs,
      columns,
      rowCount: rows.length,
      visibleRows: rows,
      groups: [
        parameterGroup(tabs, activeParameter),
        tableGroup(rows, columns, activeParameter),
        ...rows.map(rowGroup),
        ...cellGroups(rows),
      ],
      actionHintsByTargetId: buildActionHints(tabs, rows),
      plannerHints: [
        "InvestorGain IPO GMP rows expose normalized fields including name, category, status, GMP amount, GMP percent, subscription times, price, open date, close date, listing date, and updated time.",
        "Prefer extract for visible table, row, and cell data. After switching report tabs, extract the visible rows if they contain the requested IPO facts.",
        `Use ${READ_TOOL} only when the visible state does not contain the requested rows or an API-backed refresh is explicitly useful; the read tool does not apply category, status, threshold, price, date, or name filters.`,
        "For any good-buy or alert rule, compare the extracted/read row fields against the user's explicit thresholds in planner reasoning.",
        `Use ${APPLY_FILTERS_TOOL} only when the visible site tab should change; pass navigationAction true and a parameter such as open, ipo, sme, closing-today, or listed.`,
        "Report parameter code ipo means Mainboard; current means Upcoming; nonzero means Only Active GMP.",
      ],
    };
  }

  function isInvestorGainIpoReport(url, documentRef = document) {
    const parsed = safeUrl(url);
    const host = parsed.hostname;
    if (host !== "investorgain.com" && host !== "www.investorgain.com") {
      return false;
    }

    if (
      /\/report\/(?:live-ipo-gmp|ipo-gmp-live)\/331(?:\/|$)/i.test(
        parsed.pathname,
      )
    ) {
      return true;
    }

    const tabs = findReportTabsWrap(documentRef);
    const table = findReportTable(documentRef);
    const pageText = lower(textContent(documentRef.body));
    return Boolean(
      tabs &&
        table &&
        (pageText.includes("ipo gmp") ||
          Array.from(tabs.querySelectorAll("a[href]")).some((link) =>
            String(link.getAttribute("href") || "").includes("ipo-gmp-live/331"),
          )),
    );
  }

  function extractReportRows(payload) {
    if (Array.isArray(payload?.reportTableData)) return payload.reportTableData;
    if (Array.isArray(payload?.data?.reportTableData)) {
      return payload.data.reportTableData;
    }
    if (Array.isArray(payload?.rows)) return payload.rows;
    if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
    return [];
  }

  async function fetchApiRows(action = {}, parameter = "ipo") {
    const context = reportContext(document);
    const apiUrl = buildApiUrl({
      parameter,
      page: action.page || 1,
      sort: action.sort || "0",
      context,
    });
    const response = await fetch(apiUrl, {
      method: "GET",
      credentials: "omit",
      headers: {
        accept: "application/json, text/plain, */*",
      },
    });

    if (!response.ok) {
      throw new Error(`InvestorGain API returned HTTP ${response.status}`);
    }

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`InvestorGain API returned non-JSON data: ${error.message}`);
    }

    const rawRows = extractReportRows(payload);
    return {
      apiUrl,
      context,
      rows: rawRows.map((row, index) =>
        normalizeIpoRow({
          index,
          raw: row || {},
          nameHtml: row?.Name || "",
          parameter,
          source: "api",
        }),
      ),
      rawRowCount: rawRows.length,
    };
  }

  async function readIpoTable(action = {}, ctx = {}) {
    const parameter = parameterFromAction(action) || "ipo";
    const requestedSource = normalizeText(action.source || "auto") || "auto";
    let rows = [];
    let source = "";
    let sourceParameter = parameter;
    let apiUrl = "";
    let apiError = "";

    if (requestedSource !== "visible") {
      try {
        const apiResult = await fetchApiRows(action, parameter);
        rows = apiResult.rows;
        source = "api";
        apiUrl = apiResult.apiUrl;
      } catch (error) {
        apiError = error?.message || String(error);
      }
    }

    if (!rows.length && requestedSource !== "api") {
      sourceParameter = activeParameterFromUrl(location.href);
      rows = collectVisibleRows(
        document,
        ctx?.state?.controls || [],
        sourceParameter,
      );
      source = rows.length ? "visible_dom" : "";
    }

    if (!rows.length) {
      return {
        ok: false,
        recoverable: true,
        detail: apiError
          ? `Could not read InvestorGain IPO GMP rows from API or visible table. API error: ${apiError}`
          : "Could not find InvestorGain IPO GMP rows in the API response or visible table.",
        parameter,
        apiUrl,
        apiError,
      };
    }

    const info = parameterInfo(sourceParameter);
    const requestedInfo = parameterInfo(parameter);

    return {
      ok: true,
      committed: true,
      detail:
        sourceParameter === parameter
          ? `Read ${rows.length} unfiltered InvestorGain IPO GMP rows from ${source} for ${info?.label || sourceParameter}.`
          : `Read ${rows.length} unfiltered visible InvestorGain IPO GMP rows from ${info?.label || sourceParameter}; requested ${requestedInfo?.label || parameter} could not be read from the API.`,
      source,
      parameter: sourceParameter,
      parameterLabel: info?.label || sourceParameter,
      requestedParameter: parameter,
      requestedParameterLabel: requestedInfo?.label || parameter,
      apiUrl,
      apiError,
      rowCount: rows.length,
      extractedRowCount: rows.length,
      rows,
      extractionBatch: {
        frameId: Number.isInteger(action.frameId) ? action.frameId : 0,
        targetId: TABLE_TARGET_ID,
        context: {
          source: READ_TOOL,
          adapterId: ADAPTER_ID,
          dataSource: source,
          parameter: sourceParameter,
          parameterLabel: info?.label || sourceParameter,
          requestedParameter: parameter,
          requestedParameterLabel: requestedInfo?.label || parameter,
          rowCount: rows.length,
          extractedRowCount: rows.length,
          apiUrl,
        },
        extractedCount: rows.length,
        items: rows.map(makeExtractionItem),
      },
    };
  }

  function findParameterLink(parameter, documentRef = document) {
    const code = normalizeParameter(parameter);
    if (!code) return null;
    const wrap = findReportTabsWrap(documentRef);
    return (
      Array.from(wrap?.querySelectorAll("a[href]") || []).find((link) => {
        const href = normalizeText(link.getAttribute("href"));
        const linkParameter = normalizeParameter(
          safeUrl(absoluteUrl(href)).pathname.match(/\/331\/([^/?#]+)/)?.[1],
        );
        return linkParameter === code || normalizeParameter(textContent(link)) === code;
      }) || null
    );
  }

  async function applyIpoFilters(action = {}, ctx = {}) {
    const parameter = parameterFromAction(action);
    if (!parameter) {
      return {
        ok: false,
        recoverable: true,
        detail:
          "InvestorGain apply filters requires a report parameter such as all, nonzero, open, current, close, sme, ipo, closing-today, or listed.",
      };
    }

    const active = activeParameterFromUrl(location.href);
    const info = parameterInfo(parameter);
    if (parameter === active && action.forceNavigation !== true) {
      return {
        ok: true,
        committed: false,
        navigationStarted: false,
        detail: `InvestorGain IPO GMP report is already on ${info?.label || parameter}.`,
        parameter,
        parameterLabel: info?.label || parameter,
      };
    }

    const link = findParameterLink(parameter, document);
    const href = absoluteUrl(link?.getAttribute("href")) || reportPageUrl(parameter);
    const clickElement = ctx?.primitives?.clickElement;

    if (link && typeof clickElement === "function") {
      await clickElement(link);
    } else if (link) {
      link.click();
    } else {
      window.location.assign(href);
    }

    return {
      ok: true,
      committed: true,
      navigationStarted: true,
      detail: `Switching InvestorGain IPO GMP report to ${info?.label || parameter}.`,
      parameter,
      parameterLabel: info?.label || parameter,
      href,
    };
  }

  function provideTools({ document: documentRef } = {}) {
    if (!isInvestorGainIpoReport(location.href, documentRef || document)) {
      return [];
    }

    return [
      {
        type: "function",
        name: APPLY_FILTERS_TOOL,
        description:
          "Switch the InvestorGain IPO GMP live report parameter tab, such as All, Only Active GMP, Open, Upcoming, Close, SME, Mainboard, Closing Today, or Listed.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            parameter: {
              type: "string",
              enum: REPORT_PARAMETERS.map((item) => item.code),
              description:
                "Report parameter/tab code. Use ipo for Mainboard, sme for SME, current for Upcoming, nonzero for Only Active GMP.",
            },
            navigationAction: {
              type: "boolean",
              enum: [true],
              description:
                "Must be true because switching InvestorGain report parameters changes the page URL/table.",
            },
            forceNavigation: {
              type: "boolean",
              description:
                "Optional. Set true to reload/click the parameter even if it is already active.",
            },
          },
          required: ["parameter", "navigationAction"],
        },
        webgpt: {
          adapterId: ADAPTER_ID,
          replayable: true,
          mayCauseNavigation: true,
        },
      },
      {
        type: "function",
        name: READ_TOOL,
        description:
          "Read unfiltered normalized InvestorGain IPO GMP live rows for a report parameter. Uses the public InvestorGain JSON endpoint first, then falls back to the visible DOM table.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            parameter: {
              type: "string",
              enum: REPORT_PARAMETERS.map((item) => item.code),
              description:
                "Optional report parameter to read. Use open for open IPOs, ipo for Mainboard, sme for SME, closing-today for closing today, all for all rows.",
            },
            source: {
              type: "string",
              enum: ["auto", "api", "visible"],
              description:
                "Optional source. auto uses API first then visible DOM fallback.",
            },
            page: {
              type: "integer",
              description: "Optional InvestorGain endpoint page number. Defaults to 1.",
            },
            sort: {
              type: "string",
              description:
                "Optional InvestorGain endpoint sort key. Defaults to 0, matching the site.",
            },
          },
          required: [],
        },
        webgpt: {
          adapterId: ADAPTER_ID,
          replayable: true,
          mayCauseNavigation: false,
        },
      },
    ];
  }

  const connectorTools = globalThis.WebGPTConnectorTools;
  if (connectorTools && typeof connectorTools.register === "function") {
    connectorTools.register(READ_TOOL, readIpoTable);
    connectorTools.register(APPLY_FILTERS_TOOL, applyIpoFilters);
  }

  registry.register({
    id: ADAPTER_ID,
    priority: 75,

    match({ url, document: documentRef }) {
      return isInvestorGainIpoReport(url, documentRef || document);
    },

    enhanceState({ state, document: documentRef }) {
      const siteAdapter = buildSiteAdapter(state, documentRef || document);

      return {
        ...state,
        site: {
          ...(state.site || {}),
          mode: siteAdapter.pageKind,
          adapterId: ADAPTER_ID,
          investorGainReportParameter: siteAdapter.activeParameter,
          investorGainVisibleRowCount: siteAdapter.rowCount,
        },
        siteAdapter,
        visibleTextSummary: [
          ...visibleTextFacts(siteAdapter),
          ...(state.visibleTextSummary || []),
        ].slice(0, 100),
        groups: [...siteAdapter.groups, ...(state.groups || [])],
        controls: (state.controls || []).map((control) => {
          const hint = siteAdapter.actionHintsByTargetId?.[control.id];
          if (!hint) return control;
          return {
            ...control,
            adapterHints: {
              ...(control.adapterHints || {}),
              ...hint,
            },
          };
        }),
      };
    },

    provideTools,
  });
})();
