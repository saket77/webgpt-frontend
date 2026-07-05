(function () {
  const ADAPTER_ID = "eprocure.latest_active_tenders";
  const READ_TOOL = "eprocure_read_tender_table";
  const NAVIGATE_TOOL = "eprocure_navigate_tender_page";
  const TABLE_TARGET_ID = `site:${ADAPTER_ID}:latest_tender_table`;
  const PAGINATION_TARGET_ID = `site:${ADAPTER_ID}:pagination`;
  const registry = globalThis.WebGPTContentAdapters;
  const extractModules = globalThis.WebGPTExtractStateModules || {};
  const domUtils = extractModules.domUtils || {};

  if (!registry || typeof registry.register !== "function") {
    throw new Error(
      "content-scripts/adapters/registry.js must load before eprocure.js",
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
  const isVisible =
    domUtils.isVisible ||
    ((el) => {
      if (!el || !(el instanceof Element)) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.width > 0 &&
        rect.height > 0
      );
    });

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
    const title = normalizeText(el.getAttribute("title"));
    const href = normalizeText(el.getAttribute("href"));
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

  function stripOuterBrackets(value) {
    const text = normalizeText(value);
    if (text.startsWith("[") && text.endsWith("]")) {
      return normalizeText(text.slice(1, -1));
    }
    return text;
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function normalizeDateKey(value) {
    const text = normalizeText(value);
    if (!text) return "";

    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;

    const compact = text.match(/^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})/);
    if (compact) {
      const month = MONTHS[lower(compact[2])];
      if (month) return `${compact[3]}-${month}-${pad2(compact[1])}`;
    }

    const natural = text
      .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
      .match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
    if (natural) {
      const month = MONTHS[lower(natural[2])];
      if (month) return `${natural[3]}-${month}-${pad2(natural[1])}`;
    }

    return "";
  }

  function parseEprocureDate(value) {
    const text = normalizeText(value);
    const dateKey = normalizeDateKey(text);
    const match = text.match(
      /^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M))?/i,
    );

    if (!dateKey || !match) {
      return {
        raw: text,
        dateKey,
        dateTimeLocal: "",
        sortKey: dateKey,
      };
    }

    let hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const meridiem = lower(match[6]);

    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;

    const dateTimeLocal = match[4]
      ? `${dateKey}T${pad2(hour)}:${pad2(minute)}:00`
      : "";

    return {
      raw: text,
      dateKey,
      dateTimeLocal,
      sortKey: `${dateKey} ${pad2(hour)}:${pad2(minute)}`,
    };
  }

  function findTenderTable(documentRef = document) {
    const primary = documentRef.querySelector(
      "form#LatestActiveTenders table#table",
    );
    if (primary && tableHasTenderHeaders(primary)) return primary;

    return Array.from(documentRef.querySelectorAll("table")).find((table) =>
      tableHasTenderHeaders(table),
    );
  }

  function tableHasTenderHeaders(table) {
    const text = lower(textContent(table));
    return (
      text.includes("e-published date") &&
      text.includes("title and ref.no./tender id") &&
      text.includes("organisation chain")
    );
  }

  function tenderRows(table) {
    if (!table) return [];
    return Array.from(table.querySelectorAll("tr.even, tr.odd")).filter(
      (row) => row.querySelectorAll("td").length >= 6,
    );
  }

  function parseReferenceParts(titleCell, title) {
    const raw = normalizeText(titleCell?.textContent || "");
    const bracketValues = Array.from(raw.matchAll(/\[([^\]]*)\]/g))
      .map((match) => normalizeText(match[1]))
      .filter(Boolean);
    const titleKey = lower(title);
    const parts = bracketValues.filter((value, index) => {
      if (index !== 0) return true;
      return lower(value) !== titleKey;
    });
    const tenderIdIndex = [...parts]
      .reverse()
      .findIndex((value) => /20\d{2}_[A-Z0-9]+_\d+_\d+/i.test(value));

    if (tenderIdIndex >= 0) {
      const index = parts.length - 1 - tenderIdIndex;
      return {
        referenceNo: parts.slice(0, index).join("]["),
        tenderId: parts[index],
      };
    }

    return {
      referenceNo: parts.length > 1 ? parts.slice(0, -1).join("][") : parts[0] || "",
      tenderId: parts.length > 1 ? parts[parts.length - 1] : "",
    };
  }

  function parseTenderRow(row, index, controls = []) {
    const cells = Array.from(row.querySelectorAll(":scope > td"));
    const link = cells[4]?.querySelector("a[href]");
    const titleControl = findControlForElement(controls, link);
    const title = stripOuterBrackets(textContent(link));
    const publish = parseEprocureDate(textContent(cells[1]));
    const close = parseEprocureDate(textContent(cells[2]));
    const open = parseEprocureDate(textContent(cells[3]));
    const refs = parseReferenceParts(cells[4], title);

    return {
      position: index + 1,
      serialNumber: normalizeText(textContent(cells[0])).replace(/\.$/, ""),
      publishedDate: publish.raw,
      publishedDateKey: publish.dateKey,
      publishedDateTimeLocal: publish.dateTimeLocal,
      publishedSortKey: publish.sortKey,
      bidSubmissionClosingDate: close.raw,
      bidSubmissionClosingDateKey: close.dateKey,
      tenderOpeningDate: open.raw,
      tenderOpeningDateKey: open.dateKey,
      title,
      referenceNo: refs.referenceNo,
      tenderId: refs.tenderId,
      organisationChain: textContent(cells[5]),
      detailUrl: absoluteUrl(link?.getAttribute("href")),
      titleTargetId: titleControl?.id || "",
      detailTargetId: titleControl?.id || "",
      titleLinkText: textContent(link),
      titleLinkBounds: elementBounds(link),
      rowId: normalizeText(row.id),
      bounds: elementBounds(row),
    };
  }

  function collectTenderRows(documentRef = document, controls = []) {
    const table = findTenderTable(documentRef);
    return tenderRows(table).map((row, index) =>
      parseTenderRow(row, index, controls),
    );
  }

  function dateCounts(rows) {
    const counts = {};
    for (const row of rows || []) {
      const key = row.publishedDateKey || "unknown";
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  function findPaginationFooter(table = findTenderTable()) {
    return table?.querySelector(".list_footer") || null;
  }

  function paginationLinks(documentRef = document) {
    const footer = findPaginationFooter(findTenderTable(documentRef));
    return Array.from(
      footer?.querySelectorAll("a[href*='TablePages']") || [],
    ).filter((link) => link instanceof Element);
  }

  function currentPageNumber(documentRef = document) {
    const footer = findPaginationFooter(findTenderTable(documentRef));
    const current = normalizeText(footer?.querySelector("b")?.textContent);
    const parsed = Number(current);
    return Number.isInteger(parsed) ? parsed : null;
  }

  function findPaginationLink({
    direction = "next",
    pageNumber = null,
    document: documentRef = document,
  } = {}) {
    const links = paginationLinks(documentRef);
    const normalizedDirection = lower(direction || "next");

    if (Number.isInteger(pageNumber) && pageNumber > 0) {
      return (
        links.find((link) => normalizeText(link.textContent) === String(pageNumber)) ||
        null
      );
    }

    const idCandidatesByDirection = {
      next: ["linkFwd", "linkNext"],
      previous: ["linkBack", "linkPrev"],
      first: ["linkFirst"],
      last: ["linkLast"],
    };
    const textCandidatesByDirection = {
      next: [">"],
      previous: ["<"],
      first: ["<<"],
      last: [">>"],
    };
    const ids = idCandidatesByDirection[normalizedDirection] || ["linkFwd"];
    const texts = textCandidatesByDirection[normalizedDirection] || [">"];

    return (
      links.find((link) => ids.includes(normalizeText(link.id))) ||
      links.find((link) => texts.includes(normalizeText(link.textContent))) ||
      null
    );
  }

  function paginationState(documentRef = document, controls = []) {
    const table = findTenderTable(documentRef);
    const links = paginationLinks(documentRef);
    const currentPage = currentPageNumber(documentRef);
    const nextLink = findPaginationLink({ direction: "next", document: documentRef });
    const prevLink = findPaginationLink({
      direction: "previous",
      document: documentRef,
    });
    const lastLink = findPaginationLink({ direction: "last", document: documentRef });
    const nextControl = findControlForElement(controls, nextLink);

    return {
      currentPageNumber: currentPage,
      visiblePageNumbers: links
        .map((link) => Number(normalizeText(link.textContent)))
        .filter((value) => Number.isInteger(value)),
      hasNextPage: Boolean(nextLink),
      hasPreviousPage: Boolean(prevLink),
      nextPageTargetId: nextControl?.id || "",
      nextPageUrl: absoluteUrl(nextLink?.getAttribute("href")),
      lastPageUrl: absoluteUrl(lastLink?.getAttribute("href")),
      paginationTargetId: PAGINATION_TARGET_ID,
      tableFound: Boolean(table),
    };
  }

  function rowText(row) {
    return [
      `S.No: ${row.serialNumber || row.position}`,
      `e-Published Date: ${row.publishedDate}`,
      `Bid Submission Closing Date: ${row.bidSubmissionClosingDate}`,
      `Tender Opening Date: ${row.tenderOpeningDate}`,
      `Title: ${row.title}`,
      row.referenceNo ? `Reference No: ${row.referenceNo}` : "",
      row.tenderId ? `Tender ID: ${row.tenderId}` : "",
      `Organisation Chain: ${row.organisationChain}`,
      row.detailUrl ? `Detail URL: ${row.detailUrl}` : "",
    ]
      .filter(Boolean)
      .join("; ");
  }

  function rowKey(row) {
    return [
      "eprocure",
      row.tenderId,
      row.referenceNo,
      row.serialNumber || row.position,
      row.publishedDate,
    ]
      .filter(Boolean)
      .join("|");
  }

  function rowGroup(row) {
    const id = row.tenderId || row.referenceNo || row.position;
    const targetId = `site:${ADAPTER_ID}:tender:${id}`;
    const controlIds = unique([row.titleTargetId]);
    const openDetailAction = row.titleTargetId
      ? {
          type: "click",
          targetId: row.titleTargetId,
        }
      : null;

    return {
      id: `eprocure_tender_${id}`,
      targetId,
      collectionTargetId: TABLE_TARGET_ID,
      kind: "eprocure_tender_result",
      adapterId: ADAPTER_ID,
      preferredAction: "extract",
      suggestedAction: {
        type: "extract",
        targetId,
      },
      openDetailAction,
      label: `eProcure tender: ${row.title || id}`,
      text: rowText(row),
      position: row.position,
      serialNumber: row.serialNumber,
      publishedDate: row.publishedDate,
      publishedDateKey: row.publishedDateKey,
      publishedDateTimeLocal: row.publishedDateTimeLocal,
      bidSubmissionClosingDate: row.bidSubmissionClosingDate,
      tenderOpeningDate: row.tenderOpeningDate,
      title: row.title,
      referenceNo: row.referenceNo,
      tenderId: row.tenderId,
      organisationChain: row.organisationChain,
      detailUrl: row.detailUrl,
      titleTargetId: row.titleTargetId,
      detailTargetId: row.detailTargetId,
      titleLinkText: row.titleLinkText,
      controlIds,
      bounds: row.bounds,
    };
  }

  function tableGroup(rows, page) {
    const latest = rows[0] || null;
    const oldest = rows[rows.length - 1] || null;
    return {
      id: "eprocure_latest_tender_table",
      targetId: TABLE_TARGET_ID,
      kind: "eprocure_tender_table",
      adapterId: ADAPTER_ID,
      preferredAction: READ_TOOL,
      connectorTool: READ_TOOL,
      label: "eProcure latest active tender table",
      text: [
        `${rows.length} visible tender rows`,
        "rows are sorted newest to oldest by e-Published Date",
        page.currentPageNumber ? `current page: ${page.currentPageNumber}` : "",
        latest?.publishedDate ? `newest visible published date: ${latest.publishedDate}` : "",
        oldest?.publishedDate ? `oldest visible published date: ${oldest.publishedDate}` : "",
        page.hasNextPage ? "next page link available" : "no next page link visible",
      ]
        .filter(Boolean)
        .join("; "),
      rowCount: rows.length,
      latestPublishedDate: latest?.publishedDate || "",
      latestPublishedDateKey: latest?.publishedDateKey || "",
      oldestPublishedDate: oldest?.publishedDate || "",
      oldestPublishedDateKey: oldest?.publishedDateKey || "",
      dateCounts: dateCounts(rows),
      controlIds: unique([page.nextPageTargetId]),
    };
  }

  function paginationGroup(page) {
    return {
      id: "eprocure_pagination",
      targetId: PAGINATION_TARGET_ID,
      kind: "eprocure_tender_pagination",
      adapterId: ADAPTER_ID,
      preferredAction: NAVIGATE_TOOL,
      connectorTool: NAVIGATE_TOOL,
      label: "eProcure tender pagination",
      text: [
        page.currentPageNumber ? `current page: ${page.currentPageNumber}` : "",
        page.visiblePageNumbers.length
          ? `visible page links: ${page.visiblePageNumbers.join(", ")}`
          : "",
        page.hasNextPage ? "next page link available" : "next page link not visible",
      ]
        .filter(Boolean)
        .join("; "),
      currentPageNumber: page.currentPageNumber,
      visiblePageNumbers: page.visiblePageNumbers,
      hasNextPage: page.hasNextPage,
      hasPreviousPage: page.hasPreviousPage,
      nextPageTargetId: page.nextPageTargetId,
      controlIds: unique([page.nextPageTargetId]),
    };
  }

  function buildRowActionHints(rows) {
    const hints = {};
    for (const row of rows || []) {
      if (!row.titleTargetId) continue;
      hints[row.titleTargetId] = {
        semanticRole: "eprocure_tender_title_link",
        preferredAction: "click",
        navigationAction: true,
        verifyAfterAction: "tenderDetailPageLoaded",
        instruction:
          "Click this Title and Ref.No./Tender ID link to open the tender detail page.",
        tenderId: row.tenderId,
        referenceNo: row.referenceNo,
        publishedDate: row.publishedDate,
        publishedDateKey: row.publishedDateKey,
        rowTargetId: `site:${ADAPTER_ID}:tender:${
          row.tenderId || row.referenceNo || row.position
        }`,
      };
    }
    return hints;
  }

  function buildActionHints(page, rows = []) {
    const hints = {};
    if (page.nextPageTargetId) {
      hints[page.nextPageTargetId] = {
        semanticRole: "eprocure_next_page_link",
        preferredAction: "click",
        navigationAction: true,
        verifyAfterAction: "urlOrTablePageChanged",
        instruction:
          "Click to move to the next in-session eProcure tender results page.",
      };
    }
    return {
      ...hints,
      ...buildRowActionHints(rows),
    };
  }

  function visibleTextFacts(rows, page) {
    const counts = dateCounts(rows);
    const dateSummary = Object.entries(counts)
      .map(([date, count]) => `${date}: ${count}`)
      .join(", ");
    const oldest = rows[rows.length - 1];
    const newest = rows[0];

    return [
      `eProcure latest active tenders detected: ${rows.length} visible rows.`,
      dateSummary ? `Visible e-Published date counts: ${dateSummary}.` : "",
      newest?.publishedDate && oldest?.publishedDate
        ? `Visible rows run newest to oldest from ${newest.publishedDate} to ${oldest.publishedDate}.`
        : "",
      page.hasNextPage
        ? `Use ${NAVIGATE_TOOL} with direction next and navigationAction true to continue pagination.`
        : "No next eProcure tender page link is visible.",
      "Visible eProcure tender row groups are already normalized; use normal extract on matching row groups when state has enough evidence.",
      `Use ${READ_TOOL} with optional filters when the goal needs a filtered/all visible row batch as an action result.`,
    ].filter(Boolean);
  }

  function buildSiteAdapter(state, documentRef) {
    const rows = collectTenderRows(documentRef, state.controls || []);
    const page = paginationState(documentRef, state.controls || []);
    const newest = rows[0] || {};
    const oldest = rows[rows.length - 1] || {};

    return {
      id: ADAPTER_ID,
      pageKind: "latest_active_tenders_orgwise",
      sourceName: "eProcurement System Government of India",
      timezone: "Asia/Kolkata",
      sortOrder: "published_date_desc",
      tableTargetId: TABLE_TARGET_ID,
      paginationTargetId: PAGINATION_TARGET_ID,
      rowCount: rows.length,
      dateCounts: dateCounts(rows),
      currentPageNumber: page.currentPageNumber,
      visiblePageNumbers: page.visiblePageNumbers,
      hasNextPage: page.hasNextPage,
      hasPreviousPage: page.hasPreviousPage,
      nextPageTargetId: page.nextPageTargetId,
      newestVisiblePublishedDate: newest.publishedDate || "",
      newestVisiblePublishedDateKey: newest.publishedDateKey || "",
      oldestVisiblePublishedDate: oldest.publishedDate || "",
      oldestVisiblePublishedDateKey: oldest.publishedDateKey || "",
      primaryControlIds: unique([
        page.nextPageTargetId,
        ...rows.map((row) => row.titleTargetId),
      ]),
      actionHintsByTargetId: buildActionHints(page, rows),
      groups: [tableGroup(rows, page), paginationGroup(page), ...rows.map(rowGroup)],
      plannerHints: [
        "eProcure latest active tender rows are sorted newest to oldest by e-Published Date.",
        "If the requested tender rows are visible in state, prefer normal extract on the matching eProcure tender row group targetId; do not call a connector tool just to re-read one already-visible row.",
        `Use ${READ_TOOL} when the task needs all visible rows or a filtered visible batch; omit filters to return all visible rows, or pass publishedDate/fromPublishedDate/toPublishedDate.`,
        "To open a specific tender, click that row group's titleTargetId/detailTargetId for the Title and Ref.No./Tender ID link.",
        `Use ${NAVIGATE_TOOL} with direction next and navigationAction true to continue to the next in-session page. Do not construct pagination URLs manually.`,
        "For a date query, read the current table, keep matching published dates, then paginate while the oldest visible published date is newer than or equal to the requested start date. Stop when visible rows are older than the requested date range.",
      ],
    };
  }

  function isEprocureLatestActiveTenders(url, documentRef) {
    const parsed = safeUrl(url);
    const host = parsed.hostname;
    if (host !== "eprocure.gov.in" && !host.endsWith(".eprocure.gov.in")) {
      return false;
    }

    const pageName = parsed.searchParams.get("page") || "";
    if (pageName === "FrontEndLatestActiveTendersOrgwise") return true;

    const formPage = documentRef.querySelector(
      "form#LatestActiveTenders input[name='page'][value='FrontEndLatestActiveTendersOrgwise']",
    );
    return Boolean(formPage && findTenderTable(documentRef));
  }

  function makeExtractionItem(row) {
    return {
      key: rowKey(row),
      text: rowText(row),
      label: `eProcure tender ${row.serialNumber || row.position}`,
      heading: row.title,
      nearbyText: [
        `Published ${row.publishedDate}`,
        `Closing ${row.bidSubmissionClosingDate}`,
        row.organisationChain,
      ]
        .filter(Boolean)
        .join("; "),
      href: row.detailUrl,
      bounds: row.bounds,
      context: {
        source: READ_TOOL,
        adapterId: ADAPTER_ID,
        position: row.position,
        serialNumber: row.serialNumber,
        publishedDate: row.publishedDate,
        publishedDateKey: row.publishedDateKey,
        publishedDateTimeLocal: row.publishedDateTimeLocal,
        bidSubmissionClosingDate: row.bidSubmissionClosingDate,
        tenderOpeningDate: row.tenderOpeningDate,
        title: row.title,
        referenceNo: row.referenceNo,
        tenderId: row.tenderId,
        organisationChain: row.organisationChain,
        titleTargetId: row.titleTargetId,
        detailTargetId: row.detailTargetId,
      },
    };
  }

  function filterRows(rows, action = {}) {
    let result = Array.isArray(rows) ? rows.slice() : [];
    const publishedDate = normalizeDateKey(action.publishedDate);
    let fromDate = normalizeDateKey(action.fromPublishedDate);
    let toDate = normalizeDateKey(action.toPublishedDate);

    if (publishedDate) {
      fromDate = publishedDate;
      toDate = publishedDate;
    }

    if (fromDate && toDate && fromDate > toDate) {
      const tmp = fromDate;
      fromDate = toDate;
      toDate = tmp;
    }

    if (fromDate) {
      result = result.filter((row) => row.publishedDateKey >= fromDate);
    }
    if (toDate) {
      result = result.filter((row) => row.publishedDateKey <= toDate);
    }

    const startRow = Number(action.startRow);
    const endRow = Number(action.endRow);
    if (Number.isInteger(startRow) && startRow > 0) {
      result = result.filter((row) => row.position >= startRow);
    }
    if (Number.isInteger(endRow) && endRow > 0) {
      result = result.filter((row) => row.position <= endRow);
    }

    return result;
  }

  async function readTenderTable(action = {}, ctx = {}) {
    const rows = collectTenderRows(document, ctx?.state?.controls || []);
    const filteredRows = filterRows(rows, action);
    const page = paginationState(document);
    const counts = dateCounts(rows);

    return {
      ok: true,
      committed: true,
      detail: `Read ${filteredRows.length} of ${rows.length} visible eProcure tender rows.`,
      rowCount: rows.length,
      extractedRowCount: filteredRows.length,
      currentPageNumber: page.currentPageNumber,
      hasNextPage: page.hasNextPage,
      newestVisiblePublishedDate: rows[0]?.publishedDate || "",
      newestVisiblePublishedDateKey: rows[0]?.publishedDateKey || "",
      oldestVisiblePublishedDate: rows[rows.length - 1]?.publishedDate || "",
      oldestVisiblePublishedDateKey: rows[rows.length - 1]?.publishedDateKey || "",
      dateCounts: counts,
      rows: filteredRows,
      extractionBatch: {
        frameId: Number.isInteger(action.frameId) ? action.frameId : 0,
        targetId: TABLE_TARGET_ID,
        context: {
          source: READ_TOOL,
          adapterId: ADAPTER_ID,
          publishedDate: normalizeText(action.publishedDate),
          fromPublishedDate: normalizeText(action.fromPublishedDate),
          toPublishedDate: normalizeText(action.toPublishedDate),
          startRow: Number.isInteger(Number(action.startRow))
            ? Number(action.startRow)
            : null,
          endRow: Number.isInteger(Number(action.endRow))
            ? Number(action.endRow)
            : null,
          visibleRowCount: rows.length,
          extractedRowCount: filteredRows.length,
          currentPageNumber: page.currentPageNumber,
          dateCounts: counts,
        },
        extractedCount: filteredRows.length,
        items: filteredRows.map(makeExtractionItem),
      },
    };
  }

  function describePagination() {
    const page = paginationState(document);
    return [
      page.currentPageNumber ? `current page ${page.currentPageNumber}` : "",
      page.visiblePageNumbers.length
        ? `visible pages ${page.visiblePageNumbers.join(", ")}`
        : "",
      page.hasNextPage ? "next available" : "next not available",
    ]
      .filter(Boolean)
      .join("; ");
  }

  async function navigateTenderPage(action = {}, ctx = {}) {
    const pageNumber = Number(action.pageNumber);
    const link = findPaginationLink({
      direction: action.direction || "next",
      pageNumber: Number.isInteger(pageNumber) ? pageNumber : null,
      document,
    });

    if (!link) {
      return {
        ok: false,
        recoverable: true,
        detail: `Could not find requested eProcure pagination link (${describePagination()}).`,
      };
    }

    const direction = normalizeText(action.direction || "");
    const label = normalizeText(link.textContent);
    const href = absoluteUrl(link.getAttribute("href"));
    const clickElement = ctx?.primitives?.clickElement;

    if (typeof clickElement === "function") {
      await clickElement(link);
    } else {
      link.click();
    }

    return {
      ok: true,
      committed: true,
      navigationStarted: true,
      detail: `Navigating eProcure tenders to ${direction || `page ${label}` || "next page"}.`,
      direction: direction || "next",
      pageNumber: Number.isInteger(pageNumber) ? pageNumber : null,
      linkText: label,
      href,
    };
  }

  function provideTools({ document: documentRef } = {}) {
    if (!isEprocureLatestActiveTenders(location.href, documentRef || document)) {
      return [];
    }

    return [
      {
        type: "function",
        name: READ_TOOL,
        description:
          "Read normalized rows from the visible eProcure latest active tenders table. If no filters are provided, returns all visible rows. Optional filters are applied only to the currently visible page.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            publishedDate: {
              type: "string",
              description:
                "Optional exact e-Published date to keep from visible rows, e.g. 2026-07-04 or 04-Jul-2026.",
            },
            fromPublishedDate: {
              type: "string",
              description:
                "Optional inclusive start e-Published date for visible rows, e.g. 2026-07-04.",
            },
            toPublishedDate: {
              type: "string",
              description:
                "Optional inclusive end e-Published date for visible rows, e.g. 2026-07-04.",
            },
            startRow: {
              type: "integer",
              description: "Optional 1-based visible row position to start reading.",
            },
            endRow: {
              type: "integer",
              description: "Optional 1-based visible row position to stop reading.",
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
      {
        type: "function",
        name: NAVIGATE_TOOL,
        description:
          "Navigate the eProcure tender table pagination using the live session-bound pagination links. Do not construct eProcure pagination URLs manually.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            direction: {
              type: "string",
              enum: ["next", "previous", "first", "last"],
              description:
                "Pagination direction. Use next while searching older tender publication dates.",
            },
            pageNumber: {
              type: "integer",
              description:
                "Optional visible page number to click instead of direction.",
            },
            navigationAction: {
              type: "boolean",
              enum: [true],
              description:
                "Must be true because eProcure pagination changes the document.",
            },
          },
          required: ["navigationAction"],
        },
        webgpt: {
          adapterId: ADAPTER_ID,
          replayable: true,
          mayCauseNavigation: true,
        },
      },
    ];
  }

  const connectorTools = globalThis.WebGPTConnectorTools;
  if (connectorTools && typeof connectorTools.register === "function") {
    connectorTools.register(READ_TOOL, readTenderTable);
    connectorTools.register(NAVIGATE_TOOL, navigateTenderPage);
  }

  registry.register({
    id: ADAPTER_ID,
    priority: 70,

    match({ url, document: documentRef }) {
      return isEprocureLatestActiveTenders(url, documentRef || document);
    },

    enhanceState({ state, document: documentRef }) {
      const siteAdapter = buildSiteAdapter(state, documentRef || document);

      return {
        ...state,
        site: {
          ...(state.site || {}),
          mode: siteAdapter.pageKind,
          adapterId: ADAPTER_ID,
          eprocureRowCount: siteAdapter.rowCount,
          eprocureCurrentPageNumber: siteAdapter.currentPageNumber,
          eprocureOldestVisiblePublishedDateKey:
            siteAdapter.oldestVisiblePublishedDateKey,
        },
        siteAdapter,
        visibleTextSummary: [
          ...visibleTextFacts(collectTenderRows(documentRef || document), siteAdapter),
          ...(state.visibleTextSummary || []),
        ].slice(0, 80),
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
