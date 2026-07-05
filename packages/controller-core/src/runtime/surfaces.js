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
