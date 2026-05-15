export const BROWSER_DOM_SURFACE = "browser_dom";
export const GOOGLE_SHEETS_SURFACE = "google_sheets";
export const MICROSOFT_EXCEL_SURFACE = "microsoft_excel";

export function normalizeSurface(value) {
  const text = String(value || "").trim().toLowerCase();

  if (
    text === GOOGLE_SHEETS_SURFACE ||
    text === "google-sheets" ||
    text === "sheets"
  ) {
    return GOOGLE_SHEETS_SURFACE;
  }

  if (
    text === MICROSOFT_EXCEL_SURFACE ||
    text === "microsoft-excel" ||
    text === "excel" ||
    text === "excel_online" ||
    text === "excel-online"
  ) {
    return MICROSOFT_EXCEL_SURFACE;
  }

  if (
    text === BROWSER_DOM_SURFACE ||
    text === "browser-dom" ||
    text === "dom" ||
    text === "browser"
  ) {
    return BROWSER_DOM_SURFACE;
  }

  return "";
}

export function isGoogleSheetsUrl(url) {
  return /^https:\/\/docs\.google\.com\/spreadsheets\//i.test(
    String(url || ""),
  );
}

function hasExcelDocumentSignal(value = "") {
  const text = String(value || "");
  return (
    /(?:^|[/?#&=_.-])excel(?:[/?#&=_.-]|$)/i.test(text) ||
    /\.(xlsx|xlsm|xlsb|xls)(?:[/?#&=]|$)/i.test(text)
  );
}

function hasExcelTitleSignal(title = "") {
  const text = String(title || "");
  return /\bexcel\b/i.test(text) || /\.(xlsx|xlsm|xlsb|xls)\b/i.test(text);
}

export function isMicrosoftExcelUrl(url, title = "") {
  const text = String(url || "");
  let parsed = null;

  try {
    parsed = new URL(text);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  const isSharePointHost =
    host.endsWith(".sharepoint.com") || host.endsWith("-my.sharepoint.com");
  const isMicrosoftHost =
    isSharePointHost ||
    host === "onedrive.live.com" ||
    host.endsWith(".officeapps.live.com") ||
    host === "office.com" ||
    host === "www.office.com" ||
    host === "microsoft365.com" ||
    host === "www.microsoft365.com" ||
    host === "excel.cloud.microsoft" ||
    host === "www.excel.cloud.microsoft" ||
    host === "m365.cloud.microsoft";

  if (!isMicrosoftHost) return false;

  if (host === "excel.cloud.microsoft" || host === "www.excel.cloud.microsoft") {
    return true;
  }

  return (
    /\/:x:\//i.test(text) ||
    /\/_layouts\/15\/Doc\.aspx/i.test(text) ||
    /\/_layouts\/15\/WopiFrame\.aspx/i.test(text) ||
    /\/_layouts\/xlviewerinternal\.aspx/i.test(text) ||
    /\/excel\.aspx/i.test(text) ||
    /[?&](file|sourcedoc|resid)=/i.test(text) ||
    hasExcelDocumentSignal(text) ||
    hasExcelTitleSignal(title)
  );
}

export function detectSurfaceFromUrl(url, title = "") {
  if (isGoogleSheetsUrl(url)) return GOOGLE_SHEETS_SURFACE;
  if (isMicrosoftExcelUrl(url, title)) return MICROSOFT_EXCEL_SURFACE;
  return BROWSER_DOM_SURFACE;
}

export async function detectSurfaceForTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return {
    surface: detectSurfaceFromUrl(tab?.url || "", tab?.title || ""),
    url: tab?.url || "",
    title: tab?.title || "",
  };
}
