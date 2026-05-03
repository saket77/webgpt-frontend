import { sleep } from "../utils/common.js";
import { GOOGLE_SHEETS_SURFACE } from "./surfaces.js";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DEFAULT_GRID_RANGE = "A1:T50";
const OAUTH_PLACEHOLDER = "YOUR_EXTENSION_OAUTH_CLIENT_ID.apps.googleusercontent.com";
let interactiveAuthPromise = null;

function oauthSetupError() {
  return new Error(
    "Google Sheets OAuth is not configured. Replace manifest.json oauth2.client_id with a Chrome Extension OAuth client ID for this extension, then reload the extension.",
  );
}

function getOauthClientId() {
  return chrome.runtime.getManifest()?.oauth2?.client_id || "";
}

function isOauthConfigured() {
  const clientId = getOauthClientId();
  return Boolean(clientId && clientId !== OAUTH_PLACEHOLDER);
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function to2dValues(values) {
  if (!Array.isArray(values)) return [];
  return values.map((row) => (Array.isArray(row) ? row : [row]));
}

function encodeRange(range) {
  return encodeURIComponent(range);
}

function quoteSheetName(sheetName = "") {
  const text = normalizeText(sheetName);
  if (!text) return "";
  return `'${text.replace(/'/g, "''")}'`;
}

function rangeHasSheetName(range = "") {
  return String(range).includes("!");
}

function qualifyRange(range = "", sheetName = "") {
  const cleanRange = normalizeText(range);
  if (!cleanRange) return "";
  if (rangeHasSheetName(cleanRange)) return cleanRange;
  const cleanSheetName = normalizeText(sheetName);
  return cleanSheetName ? `${quoteSheetName(cleanSheetName)}!${cleanRange}` : cleanRange;
}

function stripSheetName(range = "") {
  const text = String(range || "");
  const bang = text.lastIndexOf("!");
  return bang >= 0 ? text.slice(bang + 1) : text;
}

function splitRangeSheetName(range = "") {
  const text = String(range || "");
  const bang = text.lastIndexOf("!");
  if (bang < 0) {
    return {
      sheetName: "",
      range: text,
    };
  }

  return {
    sheetName: text
      .slice(0, bang)
      .replace(/^'/, "")
      .replace(/'$/, "")
      .replace(/''/g, "'"),
    range: text.slice(bang + 1),
  };
}

function columnLettersToIndex(letters = "") {
  const clean = String(letters || "").toUpperCase();
  let index = 0;
  for (const char of clean) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) continue;
    index = index * 26 + (code - 64);
  }
  return index > 0 ? index - 1 : null;
}

function parseA1Cell(cell = "") {
  const match = /^([A-Za-z]*)(\d*)$/.exec(String(cell || "").trim());
  if (!match) {
    return {
      columnIndex: null,
      rowIndex: null,
    };
  }

  return {
    columnIndex: match[1] ? columnLettersToIndex(match[1]) : null,
    rowIndex: match[2] ? Number(match[2]) - 1 : null,
  };
}

function parseA1Start(range = "") {
  const cleanRange = stripSheetName(range).split(":")[0] || "A1";
  return parseA1Cell(cleanRange);
}

function parseA1GridRange(range = "", sheetId = null) {
  const cleanRange = stripSheetName(range || DEFAULT_GRID_RANGE);
  const [startRaw, endRaw] = cleanRange.split(":");
  const start = parseA1Cell(startRaw || "A1");
  const end = parseA1Cell(endRaw || "");
  const gridRange = {};

  if (sheetId !== null && sheetId !== undefined) {
    gridRange.sheetId = sheetId;
  }

  if (Number.isInteger(start.rowIndex)) {
    gridRange.startRowIndex = start.rowIndex;
    gridRange.endRowIndex = Number.isInteger(end.rowIndex)
      ? end.rowIndex + 1
      : start.rowIndex + 1;
  }

  if (Number.isInteger(start.columnIndex)) {
    gridRange.startColumnIndex = start.columnIndex;
    gridRange.endColumnIndex = Number.isInteger(end.columnIndex)
      ? end.columnIndex + 1
      : start.columnIndex + 1;
  }

  return gridRange;
}

function cssColorToRgb(color) {
  const text = normalizeText(color);
  const hexMatch = /^#?([0-9a-f]{6})$/i.exec(text);
  if (!hexMatch) return null;
  const hex = hexMatch[1];
  return {
    red: parseInt(hex.slice(0, 2), 16) / 255,
    green: parseInt(hex.slice(2, 4), 16) / 255,
    blue: parseInt(hex.slice(4, 6), 16) / 255,
  };
}

function parseSpreadsheetId(url = "") {
  const match = /\/spreadsheets\/d\/([^/]+)/.exec(String(url || ""));
  return match?.[1] || "";
}

function parseUrlSheetInfo(url = "") {
  try {
    const parsed = new URL(url);
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    const searchParams = parsed.searchParams;

    return {
      gid: hashParams.get("gid") || searchParams.get("gid") || "",
      range: hashParams.get("range") || searchParams.get("range") || "",
    };
  } catch {
    return {
      gid: "",
      range: "",
    };
  }
}

function normalizeSheetProperties(sheet) {
  const properties = sheet?.properties || {};
  return {
    sheetId: properties.sheetId ?? null,
    title: properties.title || "",
    index: properties.index ?? null,
    hidden: Boolean(properties.hidden),
    gridProperties: properties.gridProperties || {},
  };
}

function chooseActiveSheet(sheets = [], gid = "") {
  const gidNumber = gid === "" ? null : Number(gid);
  if (Number.isFinite(gidNumber)) {
    const byGid = sheets.find((sheet) => Number(sheet.sheetId) === gidNumber);
    if (byGid) return byGid;
  }

  return sheets.find((sheet) => !sheet.hidden) || sheets[0] || null;
}

function buildSheetTabs(sheets = [], activeSheet = null) {
  return sheets.map((sheet) => ({
    sheetId: sheet.sheetId,
    title: sheet.title,
    index: sheet.index,
    hidden: sheet.hidden,
    active: Boolean(activeSheet && sheet.sheetId === activeSheet.sheetId),
  }));
}

async function getAuthToken({ interactive = false } = {}) {
  if (!chrome.identity?.getAuthToken) {
    throw new Error("Chrome identity API is unavailable in this extension context.");
  }

  if (!isOauthConfigured()) {
    throw oauthSetupError();
  }

  try {
    const result = await chrome.identity.getAuthToken({
      interactive,
      scopes: [SHEETS_SCOPE],
    });
    const token = typeof result === "string" ? result : result?.token;

    if (!token) {
      throw new Error("Google did not return an access token.");
    }

    return token;
  } catch (error) {
    if (!isOauthConfigured()) throw oauthSetupError();
    throw new Error(error?.message || "Google Sheets authorization failed.");
  }
}

async function removeCachedToken(token) {
  if (!token || !chrome.identity?.removeCachedAuthToken) return;
  await chrome.identity.removeCachedAuthToken({ token }).catch(() => null);
}

async function sheetsFetch(spreadsheetId, path, options = {}, retry = true) {
  const token = await getAuthToken({ interactive: false });
  const response = await fetch(`${SHEETS_API_BASE}/${spreadsheetId}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 401 && retry) {
    await removeCachedToken(token);
    return sheetsFetch(spreadsheetId, path, options, false);
  }

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      json?.error?.message ||
        `Google Sheets API request failed with status ${response.status}.`,
    );
  }

  return json || {};
}

async function getSpreadsheetMetadata(spreadsheetId) {
  const fields = [
    "spreadsheetId",
    "properties(title)",
    "sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount)))",
  ].join(",");

  return sheetsFetch(spreadsheetId, `?fields=${encodeURIComponent(fields)}`);
}

async function readValues({ spreadsheetId, range, sheetName = "", majorDimension = "ROWS" }) {
  const qualifiedRange = qualifyRange(range, sheetName);
  const params = new URLSearchParams({
    majorDimension: majorDimension || "ROWS",
  });
  const json = await sheetsFetch(
    spreadsheetId,
    `/values/${encodeRange(qualifiedRange)}?${params.toString()}`,
  );
  const start = parseA1Start(qualifiedRange);

  return {
    range: json.range || qualifiedRange,
    sheetName: splitRangeSheetName(json.range || qualifiedRange).sheetName || sheetName,
    values: Array.isArray(json.values) ? json.values : [],
    rowCount: Array.isArray(json.values) ? json.values.length : 0,
    columnCount: Array.isArray(json.values)
      ? Math.max(0, ...json.values.map((row) => (Array.isArray(row) ? row.length : 0)))
      : 0,
    startRowIndex: Number.isInteger(start.rowIndex) ? start.rowIndex : 0,
    startColumnIndex: Number.isInteger(start.columnIndex) ? start.columnIndex : 0,
  };
}

async function writeValues({ spreadsheetId, range, sheetName = "", values, inputOption }) {
  const qualifiedRange = qualifyRange(range, sheetName);
  const params = new URLSearchParams({
    valueInputOption: inputOption || "USER_ENTERED",
  });
  const json = await sheetsFetch(
    spreadsheetId,
    `/values/${encodeRange(qualifiedRange)}?${params.toString()}`,
    {
      method: "PUT",
      body: {
        range: qualifiedRange,
        majorDimension: "ROWS",
        values: to2dValues(values),
      },
    },
  );

  return {
    updatedRange: json.updatedRange || qualifiedRange,
    updatedRows: Number(json.updatedRows || 0),
    updatedColumns: Number(json.updatedColumns || 0),
    updatedCells: Number(json.updatedCells || 0),
  };
}

async function appendValues({
  spreadsheetId,
  range,
  sheetName = "",
  values,
  inputOption,
  insertDataOption,
}) {
  const qualifiedRange = qualifyRange(range, sheetName);
  const params = new URLSearchParams({
    valueInputOption: inputOption || "USER_ENTERED",
    insertDataOption: insertDataOption || "INSERT_ROWS",
  });
  const json = await sheetsFetch(
    spreadsheetId,
    `/values/${encodeRange(qualifiedRange)}:append?${params.toString()}`,
    {
      method: "POST",
      body: {
        range: qualifiedRange,
        majorDimension: "ROWS",
        values: to2dValues(values),
      },
    },
  );

  const updates = json.updates || {};
  return {
    tableRange: json.tableRange || "",
    updatedRange: updates.updatedRange || "",
    updatedRows: Number(updates.updatedRows || 0),
    updatedColumns: Number(updates.updatedColumns || 0),
    updatedCells: Number(updates.updatedCells || 0),
  };
}

function normalizeColumnIndexes(columns = []) {
  if (!Array.isArray(columns)) return [];
  return columns
    .map((column) => {
      if (Number.isInteger(column)) return column;
      const text = normalizeText(column);
      if (/^\d+$/.test(text)) return Number(text);
      return columnLettersToIndex(text);
    })
    .filter((column) => Number.isInteger(column) && column >= 0);
}

async function findRows({
  spreadsheetId,
  range,
  sheetName = "",
  query,
  columns = [],
  matchMode = "contains",
  caseSensitive = false,
  limit = 20,
}) {
  const readResult = await readValues({ spreadsheetId, range, sheetName });
  const needle = caseSensitive ? normalizeText(query) : normalizeText(query).toLowerCase();
  const columnIndexes = normalizeColumnIndexes(columns);
  const maxMatches = Math.max(1, Math.min(Number(limit || 20), 100));
  const matches = [];

  for (let rowOffset = 0; rowOffset < readResult.values.length; rowOffset += 1) {
    const row = Array.isArray(readResult.values[rowOffset])
      ? readResult.values[rowOffset]
      : [];
    const candidateIndexes = columnIndexes.length
      ? columnIndexes
      : row.map((_value, index) => index);

    const matched = candidateIndexes.some((index) => {
      const haystack = caseSensitive
        ? normalizeText(row[index])
        : normalizeText(row[index]).toLowerCase();
      return matchMode === "exact" ? haystack === needle : haystack.includes(needle);
    });

    if (!matched) continue;

    const rowIndex = readResult.startRowIndex + rowOffset;
    matches.push({
      rowIndex: String(rowIndex),
      rowNumber: rowIndex + 1,
      values: row,
    });

    if (matches.length >= maxMatches) break;
  }

  return {
    range: readResult.range,
    sheetName: readResult.sheetName || sheetName,
    query,
    matches,
  };
}

function buildRepeatCellFormat(format = {}) {
  const userEnteredFormat = {};
  const fields = [];
  const background = cssColorToRgb(format.background || format.backgroundColor);
  const textColor = cssColorToRgb(format.textColor || format.foregroundColor);

  if (background) {
    userEnteredFormat.backgroundColor = background;
    fields.push("userEnteredFormat.backgroundColor");
  }

  if (textColor || typeof format.bold === "boolean") {
    userEnteredFormat.textFormat = {};
    if (textColor) {
      userEnteredFormat.textFormat.foregroundColor = textColor;
      fields.push("userEnteredFormat.textFormat.foregroundColor");
    }
    if (typeof format.bold === "boolean") {
      userEnteredFormat.textFormat.bold = format.bold;
      fields.push("userEnteredFormat.textFormat.bold");
    }
  }

  if (format.horizontalAlignment || format.align) {
    userEnteredFormat.horizontalAlignment = normalizeText(
      format.horizontalAlignment || format.align,
    ).toUpperCase();
    fields.push("userEnteredFormat.horizontalAlignment");
  }

  return {
    userEnteredFormat,
    fields,
  };
}

function buildFormatRequests({ range, format, sheet }) {
  const gridRange = parseA1GridRange(range, sheet?.sheetId);
  const requests = [];
  const repeatCell = buildRepeatCellFormat(format);

  if (repeatCell.fields.length) {
    requests.push({
      repeatCell: {
        range: gridRange,
        cell: {
          userEnteredFormat: repeatCell.userEnteredFormat,
        },
        fields: repeatCell.fields.join(","),
      },
    });
  }

  const width = Number(format?.width || format?.columnWidth || format?.pixelSize || 0);
  if (width > 0 && Number.isInteger(gridRange.startColumnIndex)) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: sheet?.sheetId,
          dimension: "COLUMNS",
          startIndex: gridRange.startColumnIndex,
          endIndex:
            gridRange.endColumnIndex || gridRange.startColumnIndex + 1,
        },
        properties: {
          pixelSize: width,
        },
        fields: "pixelSize",
      },
    });
  }

  return requests;
}

function findSheetForCommand(command, metadata, activeSheet) {
  const explicitSheetName =
    normalizeText(command.sheetName) || splitRangeSheetName(command.range).sheetName;
  const sheets = (metadata?.sheets || []).map(normalizeSheetProperties);

  if (explicitSheetName) {
    const byTitle = sheets.find((sheet) => sheet.title === explicitSheetName);
    if (byTitle) return byTitle;
  }

  return activeSheet || sheets[0] || null;
}

async function formatRange({ spreadsheetId, command, metadata, activeSheet }) {
  const sheet = findSheetForCommand(command, metadata, activeSheet);
  if (!sheet) {
    throw new Error("No sheet found for format_range.");
  }

  const requests = buildFormatRequests({
    range: command.range || DEFAULT_GRID_RANGE,
    format: command.format || {},
    sheet,
  });

  if (!requests.length) {
    return {
      updatedRange: command.range || "",
      appliedFormat: {},
      skipped: true,
    };
  }

  await sheetsFetch(spreadsheetId, ":batchUpdate", {
    method: "POST",
    body: { requests },
  });

  return {
    updatedRange: qualifyRange(command.range || DEFAULT_GRID_RANGE, sheet.title),
    appliedFormat: command.format || {},
  };
}

async function waitForTabUrl(tabId, expectedRange) {
  for (let i = 0; i < 10; i += 1) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!expectedRange || String(tab?.url || "").includes(encodeURIComponent(expectedRange))) {
      return tab?.url || "";
    }
    await sleep(100);
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return tab?.url || "";
}

async function setActiveRange({ tabId, range, sheet }) {
  const tab = await chrome.tabs.get(tabId);
  const parsed = new URL(tab.url);
  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  const cleanRange = stripSheetName(range || DEFAULT_GRID_RANGE);

  if (sheet?.sheetId !== null && sheet?.sheetId !== undefined) {
    hashParams.set("gid", String(sheet.sheetId));
  }
  hashParams.set("range", cleanRange);
  parsed.hash = hashParams.toString();

  await chrome.tabs.update(tabId, {
    url: parsed.toString(),
  });

  const observedUrl = await waitForTabUrl(tabId, cleanRange);
  return {
    activeRange: cleanRange,
    sheetName: sheet?.title || "",
    url: observedUrl || parsed.toString(),
  };
}

async function extractStateFromTab(tabId, { goal, step, meta = {} } = {}) {
  const tab = await chrome.tabs.get(tabId);
  const spreadsheetId = parseSpreadsheetId(tab.url || "");

  if (!spreadsheetId) {
    throw new Error("The active tab is not a Google Sheets spreadsheet.");
  }

  await getAuthToken({ interactive: false });

  const metadata = await getSpreadsheetMetadata(spreadsheetId);
  const sheets = (metadata.sheets || []).map(normalizeSheetProperties);
  const urlInfo = parseUrlSheetInfo(tab.url || "");
  const activeSheet = chooseActiveSheet(sheets, urlInfo.gid);
  const activeRange = urlInfo.range || "";
  const activeSheetName = activeSheet?.title || "";
  const gridRange = meta?.range || DEFAULT_GRID_RANGE;
  const visibleGrid = await readValues({
    spreadsheetId,
    sheetName: activeSheetName,
    range: gridRange,
  });

  return {
    surface: GOOGLE_SHEETS_SURFACE,
    authStatus: "authenticated",
    goal: goal || "",
    step: step || 1,
    timestamp: new Date().toISOString(),
    url: tab.url || "",
    spreadsheetId,
    spreadsheetTitle: metadata?.properties?.title || tab.title || "",
    activeSheetName,
    activeRange,
    formulaBarValue: "",
    sheetTabs: buildSheetTabs(sheets, activeSheet),
    visibleGrid: {
      range: visibleGrid.range || qualifyRange(gridRange, activeSheetName),
      startRow: visibleGrid.startRowIndex,
      startColumn: visibleGrid.startColumnIndex,
      rowCount: visibleGrid.rowCount,
      columnCount: visibleGrid.columnCount,
      values: visibleGrid.values,
    },
  };
}

async function runGoogleSheetsCommand({ tabId, state, command, metadata, activeSheet }) {
  const spreadsheetId = state?.spreadsheetId || parseSpreadsheetId(state?.url || "");
  const name = normalizeText(command?.name || command?.tool || command?.type);

  if (!spreadsheetId) {
    throw new Error("No spreadsheet ID is available for Google Sheets command execution.");
  }

  if (name === "read_values") {
    return readValues({
      spreadsheetId,
      range: command.range,
      sheetName: command.sheetName || state.activeSheetName,
      majorDimension: command.majorDimension || "ROWS",
    });
  }

  if (name === "write_values") {
    return writeValues({
      spreadsheetId,
      range: command.range,
      sheetName: command.sheetName || state.activeSheetName,
      values: command.values,
      inputOption: command.inputOption,
    });
  }

  if (name === "append_values") {
    return appendValues({
      spreadsheetId,
      range: command.range,
      sheetName: command.sheetName || state.activeSheetName,
      values: command.values,
      inputOption: command.inputOption,
      insertDataOption: command.insertDataOption,
    });
  }

  if (name === "find_rows") {
    return findRows({
      spreadsheetId,
      range: command.range,
      sheetName: command.sheetName || state.activeSheetName,
      query: command.query,
      columns: command.columns,
      matchMode: command.matchMode,
      caseSensitive: Boolean(command.caseSensitive),
      limit: command.limit,
    });
  }

  if (name === "format_range") {
    return formatRange({
      spreadsheetId,
      command: {
        ...command,
        sheetName: command.sheetName || state.activeSheetName,
      },
      metadata,
      activeSheet,
    });
  }

  if (name === "set_active_range") {
    const sheet = findSheetForCommand(
      {
        ...command,
        sheetName: command.sheetName || state.activeSheetName,
      },
      metadata,
      activeSheet,
    );
    return setActiveRange({
      tabId,
      range: command.range,
      sheet,
    });
  }

  throw new Error(`Unsupported Google Sheets command: ${name || "unknown"}`);
}

async function runGoogleSheetsCommandsInTab(tabId, state, commands = []) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return {
      ok: true,
      surface: GOOGLE_SHEETS_SURFACE,
      summary: "No Google Sheets commands to execute.",
      results: [],
    };
  }

  const spreadsheetId = state?.spreadsheetId || parseSpreadsheetId(state?.url || "");
  const metadata = spreadsheetId ? await getSpreadsheetMetadata(spreadsheetId) : null;
  const sheets = (metadata?.sheets || []).map(normalizeSheetProperties);
  const activeSheet =
    sheets.find((sheet) => sheet.title === state?.activeSheetName) || sheets[0] || null;
  const results = [];

  for (const command of commands) {
    try {
      const result = await runGoogleSheetsCommand({
        tabId,
        state,
        command,
        metadata,
        activeSheet,
      });
      results.push({
        ok: true,
        command,
        result,
      });
    } catch (error) {
      results.push({
        ok: false,
        command,
        error: error?.message || String(error),
      });

      return {
        ok: false,
        surface: GOOGLE_SHEETS_SURFACE,
        summary: `Google Sheets command failed: ${error?.message || String(error)}`,
        error: error?.message || String(error),
        results,
      };
    }
  }

  return {
    ok: true,
    surface: GOOGLE_SHEETS_SURFACE,
    summary: `Executed ${results.length} Google Sheets command${
      results.length === 1 ? "" : "s"
    }.`,
    results,
  };
}

async function runReplayActionsInTab(tabId, replaySteps = []) {
  const commands = replaySteps
    .map((step) => step?.command || step)
    .filter((command) => command?.surface === GOOGLE_SHEETS_SURFACE || command?.name);
  const state = await extractStateFromTab(tabId, {
    meta: { beforeReplay: true },
  });
  return runGoogleSheetsCommandsInTab(tabId, state, commands);
}

async function getGoogleSheetsAuthStatus() {
  if (!isOauthConfigured()) {
    return {
      ok: true,
      surface: GOOGLE_SHEETS_SURFACE,
      authenticated: false,
      authStatus: "unconfigured",
      configMissing: true,
      error: oauthSetupError().message,
    };
  }

  try {
    await getAuthToken({ interactive: false });
    return {
      ok: true,
      surface: GOOGLE_SHEETS_SURFACE,
      authenticated: true,
      authStatus: "authenticated",
    };
  } catch (error) {
    return {
      ok: true,
      surface: GOOGLE_SHEETS_SURFACE,
      authenticated: false,
      authStatus: "unauthenticated",
      error: error?.message || String(error),
    };
  }
}

async function connectGoogleSheets() {
  if (!interactiveAuthPromise) {
    interactiveAuthPromise = (async () => {
      await getAuthToken({ interactive: true });
      return getGoogleSheetsAuthStatus();
    })().finally(() => {
      interactiveAuthPromise = null;
    });
  }

  return interactiveAuthPromise;
}

export const googleSheetsRuntime = {
  connectGoogleSheets,
  extractStateFromTab,
  getGoogleSheetsAuthStatus,
  runGoogleSheetsCommandsInTab,
  runReplayActionsInTab,
};
