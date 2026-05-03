export const BROWSER_DOM_SURFACE = "browser_dom";
export const GOOGLE_SHEETS_SURFACE = "google_sheets";

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

export function detectSurfaceFromUrl(url) {
  return isGoogleSheetsUrl(url) ? GOOGLE_SHEETS_SURFACE : BROWSER_DOM_SURFACE;
}

export async function detectSurfaceForTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return {
    surface: detectSurfaceFromUrl(tab?.url || ""),
    url: tab?.url || "",
    title: tab?.title || "",
  };
}
