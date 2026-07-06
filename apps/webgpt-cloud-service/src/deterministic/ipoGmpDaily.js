const REPORT_ID = "331";
const API_ORIGIN = "https://webnodejs.investorgain.com";
const DEFAULT_VERSION = "09-18";

export const IPO_GMP_DAILY_FILTERS = {
  parameter: "ipo",
  category: "IPO",
  statusCode: "open",
  minGmpPercent: 50,
  minSubscriptionTimes: 10,
  subscriptionComparator: ">",
};

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlToText(value) {
  return normalizeText(
    decodeHtmlEntities(value)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  );
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
  return match ? Number(match[1]) : null;
}

function parseGmpAmount(value) {
  const text = htmlToText(value).replace(/,/g, "");
  const currency = text.match(/₹\s*([-+]?\d+(?:\.\d+)?)/);
  if (currency) return Number(currency[1]);
  const first = text.match(/^[-+]?\d+(?:\.\d+)?/);
  return first ? Number(first[0]) : null;
}

function absoluteUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  try {
    return new URL(raw, "https://www.investorgain.com").toString();
  } catch {
    return raw;
  }
}

function firstLinkData(html) {
  const raw = String(html || "");
  const match = raw.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  if (!match) return { href: "", text: "" };
  return {
    href: absoluteUrl(match[1]),
    text: htmlToText(match[2]),
  };
}

function cleanIpoName(value) {
  return normalizeText(value)
    .replace(/\s+(IPO|O|U|C|CT|LT)$/i, "")
    .replace(/\s+L@\s*[-+]?[\d.]+%?$/i, "")
    .trim();
}

function detectStatusFromHtml(nameHtml) {
  const html = String(nameHtml || "");
  const text = htmlToText(html);
  if (/\bCT\b/.test(text) || /bg-danger/.test(html)) return "closing_today";
  if (/\bO\b/.test(text) || /bg-success/.test(html)) return "open";
  if (/\bU\b/.test(text) || /bg-warning/.test(html)) return "upcoming";
  if (/\bC\b/.test(text) || /bg-primary/.test(html)) return "closed";
  if (/\bLT\b/.test(text)) return "listing_today";
  if (/\bL@/i.test(text) || /bg-info/.test(html)) return "listed";
  return "";
}

function financialYearFor(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return month >= 4
    ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;
}

function buildApiUrl({ page = 1, parameter = "ipo", now = new Date(), version = DEFAULT_VERSION } = {}) {
  const date = now instanceof Date ? now : new Date(now);
  const url = new URL(
    `/cloud/v2/report/data-read/${REPORT_ID}/${page}/${date.getMonth() + 1}/${date.getFullYear()}/${financialYearFor(date)}/0/${parameter}`,
    API_ORIGIN,
  );
  url.searchParams.set("search", "");
  url.searchParams.set("v", version);
  return url.toString();
}

function extractRowsFromPayload(payload) {
  if (Array.isArray(payload?.reportTableData)) return payload.reportTableData;
  if (Array.isArray(payload?.data?.reportTableData)) return payload.data.reportTableData;
  return [];
}

function normalizeIpoRow(raw = {}, index = 0) {
  const link = firstLinkData(raw.Name);
  const name = cleanIpoName(normalizeText(raw["~ipo_name"]) || link.text || htmlToText(raw.Name));
  const gmpPercent = parseGmpPercent(raw["~gmp_percent_calc"], raw.GMP);
  const gmpAmount = parseGmpAmount(raw.GMP);
  const subscriptionTimes = parseSubscription(raw.Sub);
  const price = parseNumber(raw["Price (₹)"]);

  return {
    position: index + 1,
    name: name || `IPO row ${index + 1}`,
    category: normalizeText(raw["~IPO_Category"]) || "",
    statusCode: detectStatusFromHtml(raw.Name),
    gmpText: htmlToText(raw.GMP),
    gmpAmount,
    gmpPercent,
    subscriptionText: htmlToText(raw.Sub),
    subscriptionTimes,
    price,
    ipoSize: htmlToText(raw["IPO Size"]),
    lot: htmlToText(raw.Lot),
    openDate: htmlToText(raw.Open),
    closeDate: htmlToText(raw.Close),
    boaDate: htmlToText(raw["BoA Dt"]),
    listingDate: htmlToText(raw.Listing),
    updatedOn: htmlToText(raw["Updated-On"]),
    detailUrl: absoluteUrl(raw["~urlrewrite_folder_name"] || link.href),
    rowId: normalizeText(raw["~id"]),
  };
}

function passesMomIpoFilters(row, filters = IPO_GMP_DAILY_FILTERS) {
  const subscription =
    filters.subscriptionComparator === ">"
      ? row.subscriptionTimes !== null && row.subscriptionTimes > filters.minSubscriptionTimes
      : row.subscriptionTimes !== null && row.subscriptionTimes >= filters.minSubscriptionTimes;

  return (
    row.category === filters.category &&
    row.statusCode === filters.statusCode &&
    row.gmpPercent !== null &&
    row.gmpPercent >= filters.minGmpPercent &&
    subscription
  );
}

function rowKey(row) {
  return ["investorgain", "ipo_gmp_daily", row.rowId || row.name]
    .filter(Boolean)
    .join("|");
}

function rowText(row) {
  return [
    row.name,
    `Subscription: ${row.subscriptionTimes}x`,
    `GMP: ${row.gmpAmount !== null ? `₹${row.gmpAmount}` : row.gmpText} (${row.gmpPercent}%)`,
    row.price !== null ? `Price: ₹${row.price}` : "",
    row.openDate ? `Open: ${row.openDate}` : "",
    row.closeDate ? `Close: ${row.closeDate}` : "",
    row.updatedOn ? `Updated: ${row.updatedOn}` : "",
    row.detailUrl ? `Detail: ${row.detailUrl}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function toEmailRow(row) {
  return {
    name: row.name,
    subscription: row.subscriptionTimes !== null ? `${row.subscriptionTimes}x` : "",
    gmp: row.gmpAmount !== null ? `₹${row.gmpAmount}` : row.gmpText,
    gmpPercent: row.gmpPercent !== null ? `${row.gmpPercent}%` : "",
    price: row.price !== null ? `₹${row.price}` : "",
    open: row.openDate,
    close: row.closeDate,
    updated: row.updatedOn,
    detailUrl: row.detailUrl,
  };
}

function buildSummary(rows, filters) {
  if (rows.length === 0) {
    return `No open Mainboard IPOs matched subscription > ${filters.minSubscriptionTimes}x and GMP >= ${filters.minGmpPercent}%.`;
  }

  const names = rows
    .map((row) => `${row.name} (${row.subscriptionTimes}x subscription, ${row.gmpPercent}% GMP)`)
    .join("; ");
  return `Found ${rows.length} open Mainboard IPO${rows.length === 1 ? "" : "s"} matching subscription > ${filters.minSubscriptionTimes}x and GMP >= ${filters.minGmpPercent}%: ${names}.`;
}

export async function runIpoGmpDailyDeterministic({
  workflow = {},
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation available for deterministic IPO workflow.");
  }

  const filters = {
    ...IPO_GMP_DAILY_FILTERS,
    ...(workflow.filters || {}),
  };
  const maxPages = Number(workflow.maxPages || 3);
  const fetchedUrls = [];
  const rawRows = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = buildApiUrl({
      page,
      parameter: filters.parameter || "ipo",
      now,
      version: workflow.version || DEFAULT_VERSION,
    });
    fetchedUrls.push(url);

    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
      },
    });
    if (!response?.ok) {
      throw new Error(`InvestorGain API returned HTTP ${response?.status || "unknown"}.`);
    }

    const payload = await response.json();
    rawRows.push(...extractRowsFromPayload(payload));

    const totalPages = Number(payload?.totalPages || payload?.data?.totalPages || 1);
    if (!Number.isFinite(totalPages) || page >= totalPages) break;
  }

  const allRows = rawRows.map(normalizeIpoRow);
  const rows = allRows.filter((row) => passesMomIpoFilters(row, filters));
  const summary = buildSummary(rows, filters);
  const emailRows = rows.map(toEmailRow);

  return {
    ok: true,
    source: "deterministic",
    summary,
    finalResult: {
      summary,
      source: {
        type: "investorgain_api",
        urls: fetchedUrls,
        fetchedAt: new Date(now).toISOString(),
      },
      filters,
      totalRowsRead: allRows.length,
      matchedRows: rows.length,
      rows: emailRows,
      structuredData: {
        items: rows.map((row) => ({
          key: rowKey(row),
          text: rowText(row),
          label: `IPO alert candidate: ${row.name}`,
          heading: row.name,
          nearbyText: `Subscription ${row.subscriptionTimes}x; GMP ${row.gmpPercent}%`,
          href: row.detailUrl,
          context: row,
        })),
      },
    },
  };
}
