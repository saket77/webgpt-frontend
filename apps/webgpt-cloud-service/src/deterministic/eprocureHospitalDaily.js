const DEFAULT_URL =
  "https://eprocure.gov.in/eprocure/app?page=FrontEndLatestActiveTendersOrgwise&service=page&org=";
const DEFAULT_KEYWORD = "Hospital";
const DEFAULT_TIMEZONE = "Asia/Kolkata";
const DEFAULT_MAX_PAGES = 25;
const EPROCURE_ORIGIN = "https://eprocure.gov.in";

const MONTHS = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

export const EPROCURE_HOSPITAL_DAILY_FILTERS = {
  keyword: DEFAULT_KEYWORD,
  timezone: DEFAULT_TIMEZONE,
  maxPages: DEFAULT_MAX_PAGES,
};

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    );
}

function htmlToText(value) {
  return normalizeText(
    decodeHtmlEntities(value)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  );
}

function absoluteUrl(value) {
  const raw = decodeHtmlEntities(value);
  if (!raw) return "";
  try {
    return new URL(raw, EPROCURE_ORIGIN).toString();
  } catch {
    return raw;
  }
}

function todayDateKey({ now = new Date(), timezone = DEFAULT_TIMEZONE } = {}) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseEprocureDate(value) {
  const text = normalizeText(value);
  const match = text.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M))?/i);
  if (!match) return { raw: text, dateKey: "", sortKey: "" };

  const day = match[1].padStart(2, "0");
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()] || "";
  const year = match[3];
  let hour = match[4] ? Number(match[4]) : 0;
  const minute = match[5] ? Number(match[5]) : 0;
  const meridiem = String(match[6] || "").toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;

  const dateKey = month ? `${year}-${month}-${day}` : "";
  return {
    raw: text,
    dateKey,
    sortKey: dateKey ? `${dateKey} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : "",
  };
}

function rowMatches(row, keyword) {
  const needle = normalizeText(keyword).toLowerCase();
  if (!needle) return true;
  return [
    row.title,
    row.referenceNo,
    row.tenderId,
    row.organisationChain,
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function firstLink(html) {
  const match = String(html || "").match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  return {
    href: match ? absoluteUrl(match[1]) : "",
    text: match ? htmlToText(match[2]) : "",
  };
}

function parseReferenceParts(titleCell, title) {
  const bracketValues = Array.from(String(titleCell || "").matchAll(/\[([^\]]*)\]/g))
    .map((match) => htmlToText(match[1]))
    .filter(Boolean);
  const titleKey = normalizeText(title).toLowerCase();
  const parts = bracketValues.filter((value, index) => {
    if (index !== 0) return true;
    return value.toLowerCase() !== titleKey;
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

function extractCells(rowHtml) {
  return Array.from(String(rowHtml || "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)).map(
    (match) => match[1],
  );
}

function parseTenderRows(html, pageNumber) {
  const rows = [];
  const matches = String(html || "").matchAll(
    /<tr class=["'](?:even|odd)["'] id=["']informal[^"']*["']>([\s\S]*?)<\/tr>/gi,
  );

  for (const [index, match] of Array.from(matches).entries()) {
    const cells = extractCells(match[1]);
    if (cells.length < 6) continue;

    const link = firstLink(cells[4]);
    const title = link.text.replace(/^\[|\]$/g, "").trim();
    const refs = parseReferenceParts(cells[4], title);
    const published = parseEprocureDate(htmlToText(cells[1]));
    const closing = parseEprocureDate(htmlToText(cells[2]));
    const opening = parseEprocureDate(htmlToText(cells[3]));

    rows.push({
      pageNumber,
      position: index + 1,
      serialNumber: htmlToText(cells[0]).replace(/\.$/, ""),
      publishedDate: published.raw,
      publishedDateKey: published.dateKey,
      publishedSortKey: published.sortKey,
      bidSubmissionClosingDate: closing.raw,
      bidSubmissionClosingDateKey: closing.dateKey,
      tenderOpeningDate: opening.raw,
      tenderOpeningDateKey: opening.dateKey,
      title,
      referenceNo: refs.referenceNo,
      tenderId: refs.tenderId,
      organisationChain: htmlToText(cells[5]),
      detailUrl: link.href,
    });
  }

  return rows;
}

function findNextPageUrl(html) {
  const match = String(html || "").match(
    /<a\b[^>]*id=["']linkFwd["'][^>]*href=["']([^"']+)["']/i,
  );
  return match ? absoluteUrl(match[1]) : "";
}

function setCookieHeaders(headers) {
  if (typeof headers?.getSetCookie === "function") return headers.getSetCookie();
  if (typeof headers?.raw === "function") return headers.raw()["set-cookie"] || [];
  const value = headers?.get?.("set-cookie");
  return value ? [value] : [];
}

function updateCookieJar(jar, headers) {
  for (const header of setCookieHeaders(headers)) {
    const pair = String(header || "").split(";")[0];
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex <= 0) continue;
    jar.set(pair.slice(0, separatorIndex), pair.slice(separatorIndex + 1));
  }
}

function cookieHeader(jar) {
  return Array.from(jar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

async function fetchHtml({ fetchImpl, url, cookieJar }) {
  const headers = {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  };
  const cookie = cookieHeader(cookieJar);
  if (cookie) headers.Cookie = cookie;

  const response = await fetchImpl(url, { method: "GET", headers });
  updateCookieJar(cookieJar, response.headers);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`eProcure request failed with HTTP ${response.status}.`);
  }
  return body;
}

function buildSummary({ rows, filters, targetDateKey, pagesRead, totalRowsRead }) {
  if (rows.length === 0) {
    return `No eProcure tenders published on ${targetDateKey} matched keyword "${filters.keyword}" after reading ${totalRowsRead} row${totalRowsRead === 1 ? "" : "s"} across ${pagesRead} page${pagesRead === 1 ? "" : "s"}.`;
  }

  const names = rows
    .map((row) => `${row.title}${row.tenderId ? ` (${row.tenderId})` : ""}`)
    .join("; ");
  return `Found ${rows.length} eProcure tender${rows.length === 1 ? "" : "s"} published on ${targetDateKey} matching keyword "${filters.keyword}": ${names}.`;
}

function rowKey(row) {
  return ["eprocure", "hospital_daily", row.tenderId || row.referenceNo || row.title]
    .filter(Boolean)
    .join("|");
}

function rowText(row) {
  return [
    row.title,
    row.tenderId ? `Tender ID: ${row.tenderId}` : "",
    row.referenceNo ? `Reference: ${row.referenceNo}` : "",
    row.organisationChain ? `Organisation: ${row.organisationChain}` : "",
    row.publishedDate ? `Published: ${row.publishedDate}` : "",
    row.bidSubmissionClosingDate ? `Closing: ${row.bidSubmissionClosingDate}` : "",
    row.tenderOpeningDate ? `Opening: ${row.tenderOpeningDate}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function toEmailRow(row) {
  return {
    kind: "eprocure_tender",
    title: row.title,
    tenderId: row.tenderId,
    referenceNo: row.referenceNo,
    organisationChain: row.organisationChain,
    published: row.publishedDate,
    closing: row.bidSubmissionClosingDate,
    opening: row.tenderOpeningDate,
    detailUrl: row.detailUrl,
  };
}

export async function runEprocureHospitalDailyDeterministic({
  workflow = {},
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation available for deterministic eProcure workflow.");
  }

  const filters = {
    ...EPROCURE_HOSPITAL_DAILY_FILTERS,
    ...(workflow.filters || {}),
  };
  const maxPages = Math.max(1, Number(filters.maxPages) || DEFAULT_MAX_PAGES);
  const targetDateKey = filters.dateKey || todayDateKey({ now, timezone: filters.timezone });
  const cookieJar = new Map();
  const fetchedUrls = [];
  const allRows = [];
  const matchedRows = [];

  let url = workflow.url || DEFAULT_URL;
  let pagesRead = 0;
  let stopAfterPage = false;

  while (url && pagesRead < maxPages && !stopAfterPage) {
    pagesRead += 1;
    fetchedUrls.push(url);
    const html = await fetchHtml({ fetchImpl, url, cookieJar });
    const rows = parseTenderRows(html, pagesRead);
    allRows.push(...rows);

    for (const row of rows) {
      if (row.publishedDateKey === targetDateKey && rowMatches(row, filters.keyword)) {
        matchedRows.push(row);
      }
      if (row.publishedDateKey && row.publishedDateKey < targetDateKey) {
        stopAfterPage = true;
      }
    }

    if (stopAfterPage) break;
    url = findNextPageUrl(html);
  }

  const summary = buildSummary({
    rows: matchedRows,
    filters,
    targetDateKey,
    pagesRead,
    totalRowsRead: allRows.length,
  });

  return {
    ok: true,
    status: "completed",
    summary,
    finalResult: {
      summary,
      source: {
        type: "eprocure_html",
        urls: fetchedUrls,
        fetchedAt: now.toISOString(),
      },
      filters: {
        keyword: filters.keyword,
        timezone: filters.timezone,
        targetDateKey,
        maxPages,
      },
      pagesRead,
      totalRowsRead: allRows.length,
      matchedRows: matchedRows.length,
      rows: matchedRows.map(toEmailRow),
      structuredData: {
        items: matchedRows.map((row) => ({
          type: "eprocure_tender",
          key: rowKey(row),
          text: rowText(row),
          data: row,
        })),
      },
    },
  };
}
