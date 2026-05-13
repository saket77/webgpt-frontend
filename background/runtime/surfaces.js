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

export function isMicrosoftExcelUrl(url) {
  const text = String(url || "");
  const isMicrosoftHost =
    /^https:\/\/[^/]*\.sharepoint\.com\//i.test(text) ||
    /^https:\/\/[^/]*-my\.sharepoint\.com\//i.test(text) ||
    /^https:\/\/onedrive\.live\.com\//i.test(text) ||
    /^https:\/\/[^/]*\.officeapps\.live\.com\//i.test(text) ||
    /^https:\/\/(www\.)?office\.com\//i.test(text) ||
    /^https:\/\/(www\.)?microsoft365\.com\//i.test(text);

  if (!isMicrosoftHost) return false;

  return (
    /\/:x:\//i.test(text) ||
    /\/_layouts\/15\/Doc\.aspx/i.test(text) ||
    /\/_layouts\/xlviewerinternal\.aspx/i.test(text) ||
    /\/excel\.aspx/i.test(text) ||
    /[?&](file|sourcedoc|resid)=/i.test(text)
  );
}

export function detectSurfaceFromUrl(url) {
  if (isGoogleSheetsUrl(url)) return GOOGLE_SHEETS_SURFACE;
  if (isMicrosoftExcelUrl(url)) return MICROSOFT_EXCEL_SURFACE;
  return BROWSER_DOM_SURFACE;
}

export async function detectSurfaceForTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return {
    surface: detectSurfaceFromUrl(tab?.url || ""),
    url: tab?.url || "",
    title: tab?.title || "",
  };
}
