import { MICROSOFT_EXCEL_SURFACE } from "./surfaces.js";
import { MICROSOFT_EXCEL_TOKEN_STORAGE_KEY } from "../config.js";
import { getMicrosoftExcelConfiguration } from "../settings/microsoftExcelConfig.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const DEFAULT_GRID_RANGE = "A1:T50";
let interactiveAuthPromise = null;

function normalizeText(value) {
  return String(value ?? "").trim();
}

async function getMicrosoftConfig() {
  const config = await getMicrosoftExcelConfiguration();
  return {
    ...config,
    tenantId: normalizeText(config.tenantId),
    clientId: normalizeText(config.clientId),
    scopes: Array.isArray(config.scopes)
      ? config.scopes.map(normalizeText).filter(Boolean)
      : [],
  };
}

function microsoftSetupError() {
  return new Error(
    "Microsoft Excel OAuth is not configured. Open WebGPT Settings, add the tenant ID and application client ID from your Microsoft Entra app registration, then add the displayed redirect URI to that app.",
  );
}

async function isMicrosoftConfigured() {
  const config = await getMicrosoftConfig();
  return Boolean(config.configured && config.tenantId && config.clientId);
}

function to2dValues(values) {
  if (!Array.isArray(values)) return [];
  return values.map((row) => (Array.isArray(row) ? row : [row]));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

async function sha256Base64Url(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncodeBytes(new Uint8Array(digest));
}

function getTokenEndpoint(tenantId) {
  return `https://login.microsoftonline.com/${encodeURIComponent(
    tenantId,
  )}/oauth2/v2.0/token`;
}

function getAuthorizeEndpoint(tenantId) {
  return `https://login.microsoftonline.com/${encodeURIComponent(
    tenantId,
  )}/oauth2/v2.0/authorize`;
}

async function readStoredToken() {
  const stored = await chrome.storage.local.get(MICROSOFT_EXCEL_TOKEN_STORAGE_KEY);
  return stored?.[MICROSOFT_EXCEL_TOKEN_STORAGE_KEY] || null;
}

async function saveStoredToken(token) {
  await chrome.storage.local.set({
    [MICROSOFT_EXCEL_TOKEN_STORAGE_KEY]: token,
  });
}

async function clearStoredToken() {
  await chrome.storage.local.remove(MICROSOFT_EXCEL_TOKEN_STORAGE_KEY);
}

function isAccessTokenFresh(token) {
  return Boolean(
    token?.accessToken &&
      Number(token.expiresAt || 0) > Date.now() + 60_000,
  );
}

function buildStoredToken(json) {
  return {
    accessToken: json.access_token || "",
    refreshToken: json.refresh_token || "",
    idToken: json.id_token || "",
    scope: json.scope || "",
    tokenType: json.token_type || "Bearer",
    expiresAt: Date.now() + Math.max(60, Number(json.expires_in || 3600)) * 1000,
    savedAt: Date.now(),
  };
}

async function tokenRequest(params) {
  const { tenantId } = await getMicrosoftConfig();
  const response = await fetch(getTokenEndpoint(tenantId), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      json?.error_description ||
        json?.error ||
        `Microsoft token request failed with status ${response.status}.`,
    );
  }

  const token = buildStoredToken(json || {});
  await saveStoredToken(token);
  return token;
}

async function refreshAccessToken(refreshToken) {
  const { clientId, scopes } = await getMicrosoftConfig();
  return tokenRequest({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: scopes.join(" "),
  });
}

function parseLaunchRedirect(redirectUrl, expectedState) {
  if (!redirectUrl) {
    throw new Error("Microsoft authorization was cancelled.");
  }

  const parsed = new URL(redirectUrl);
  const error = parsed.searchParams.get("error");
  if (error) {
    throw new Error(
      parsed.searchParams.get("error_description") ||
        `Microsoft authorization failed: ${error}`,
    );
  }

  const state = parsed.searchParams.get("state") || "";
  if (state !== expectedState) {
    throw new Error("Microsoft authorization returned an invalid state.");
  }

  const code = parsed.searchParams.get("code") || "";
  if (!code) {
    throw new Error("Microsoft did not return an authorization code.");
  }

  return code;
}

async function interactiveAuthorize() {
  if (!chrome.identity?.launchWebAuthFlow) {
    throw new Error("Chrome identity launchWebAuthFlow is unavailable.");
  }

  const config = await getMicrosoftConfig();

  if (!(await isMicrosoftConfigured())) {
    throw microsoftSetupError();
  }

  const { clientId, scopes, tenantId } = config;
  const redirectUri = chrome.identity.getRedirectURL("microsoft");
  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: scopes.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });

  const redirectUrl = await chrome.identity.launchWebAuthFlow({
    url: `${getAuthorizeEndpoint(tenantId)}?${params.toString()}`,
    interactive: true,
  });

  const code = parseLaunchRedirect(redirectUrl, state);
  return tokenRequest({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    scope: scopes.join(" "),
  });
}

async function getAccessToken({ interactive = false } = {}) {
  if (!(await isMicrosoftConfigured())) {
    throw microsoftSetupError();
  }

  const storedToken = await readStoredToken();
  if (isAccessTokenFresh(storedToken)) {
    return storedToken.accessToken;
  }

  if (storedToken?.refreshToken) {
    try {
      const refreshedToken = await refreshAccessToken(storedToken.refreshToken);
      if (refreshedToken?.accessToken) {
        return refreshedToken.accessToken;
      }
    } catch {
      await clearStoredToken();
    }
  }

  if (!interactive) {
    throw new Error("Microsoft Excel authorization is required.");
  }

  const token = await interactiveAuthorize();
  if (!token?.accessToken) {
    throw new Error("Microsoft did not return an access token.");
  }
  return token.accessToken;
}

async function graphFetch(path, options = {}, retry = true) {
  const token = await getAccessToken({ interactive: false });
  const response = await fetch(`${GRAPH_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 401 && retry) {
    await clearStoredToken();
    return graphFetch(path, options, false);
  }

  if (response.status === 204) {
    return {};
  }

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      json?.error?.message ||
        `Microsoft Graph request failed with status ${response.status}.`,
    );
  }

  return json || {};
}

function encodeSharingUrl(url = "") {
  const bytes = new TextEncoder().encode(String(url || ""));
  return `u!${base64UrlEncodeBytes(bytes)}`;
}

function parseExcelFileName(url = "") {
  try {
    const parsed = new URL(url);
    const fileParam = parsed.searchParams.get("file");
    if (fileParam) return fileParam;

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const last = decodeURIComponent(pathParts[pathParts.length - 1] || "");
    if (/\.(xlsx|xlsm|xlsb)$/i.test(last)) return last;
  } catch {
    // ignore
  }

  return "";
}

function isSharePointHost(host = "") {
  return host.endsWith(".sharepoint.com") || host.endsWith("-my.sharepoint.com");
}

function isPersonalOneDriveUrl(url = "") {
  const text = String(url || "");
  let parsed = null;

  try {
    parsed = new URL(text);
  } catch {
    parsed = null;
  }

  if (parsed) {
    const host = parsed.hostname.toLowerCase();

    // Tenant SharePoint / OneDrive for Business URLs can contain Office redirect
    // params that mention personal-content hosts even when the selected workbook
    // should be resolved through the tenant URL.
    if (isSharePointHost(host)) return false;

    if (
      host === "onedrive.live.com" ||
      host.endsWith(".onedrive.live.com") ||
      host === "my.microsoftpersonalcontent.com" ||
      host.endsWith(".my.microsoftpersonalcontent.com")
    ) {
      return true;
    }

    const nestedUrls = [
      parsed.searchParams.get("ru"),
      parsed.searchParams.get("wopisrc"),
      parsed.searchParams.get("pmo"),
    ].filter(Boolean);

    return nestedUrls.some((nestedUrl) => isPersonalOneDriveUrl(nestedUrl));
  }

  return (
    /\/\/(?:[^/]+\.)?my\.microsoftpersonalcontent\.com\//i.test(text) ||
    /\/\/(?:[^/]+\.)?onedrive\.live\.com\//i.test(text)
  );
}

function personalOneDriveUnsupportedError() {
  return new Error(
    "This workbook appears to be stored in personal OneDrive. WebGPT's Microsoft Excel runtime currently supports workbooks stored in OneDrive for Business, SharePoint, or Microsoft 365 group drives through Microsoft Graph. Move the workbook to your work or school SharePoint/OneDrive location and open that copy before starting the workflow.",
  );
}

function normalizeDriveItem(item = {}, fallbackUrl = "") {
  const driveId = item?.parentReference?.driveId || item?.driveId || "";
  const itemId = item?.id || "";

  if (!driveId || !itemId) {
    throw new Error("Microsoft Graph did not return a workbook drive item.");
  }

  return {
    workbookDriveId: driveId,
    workbookItemId: itemId,
    workbookTitle: item.name || "",
    workbookWebUrl: item.webUrl || fallbackUrl || "",
  };
}

async function resolveWorkbookFromUrl(url = "") {
  if (isPersonalOneDriveUrl(url)) {
    throw personalOneDriveUnsupportedError();
  }

  const shareToken = encodeSharingUrl(url);

  try {
    const item = await graphFetch(`/shares/${shareToken}/driveItem`, {
      headers: {
        Prefer: "redeemSharingLinkIfNecessary",
      },
    });
    return normalizeDriveItem(item, url);
  } catch (shareError) {
    const fileName = parseExcelFileName(url);
    if (!fileName) {
      throw shareError;
    }

    const json = await graphFetch(
      `/me/drive/search(q='${encodeURIComponent(
        fileName.replace(/'/g, "''"),
      )}')?$select=id,name,webUrl,parentReference,file&$top=10`,
    );
    const candidates = Array.isArray(json?.value) ? json.value : [];
    const exact =
      candidates.find((item) => item?.name === fileName) || candidates[0] || null;

    if (!exact) {
      throw new Error(
        `Could not resolve the open Excel workbook through Microsoft Graph. ${shareError?.message || ""}`.trim(),
      );
    }

    return normalizeDriveItem(exact, url);
  }
}

function escapeODataString(value = "") {
  return String(value || "").replace(/'/g, "''");
}

function worksheetPath(worksheetName = "") {
  return `/worksheets('${encodeURIComponent(escapeODataString(worksheetName))}')`;
}

function stripWorksheetName(range = "") {
  const text = String(range || "");
  const bang = text.lastIndexOf("!");
  return bang >= 0 ? text.slice(bang + 1).replace(/^'/, "").replace(/'$/, "") : text;
}

function rangePath({ workbook, worksheetName, range }) {
  const cleanRange = stripWorksheetName(range || DEFAULT_GRID_RANGE);
  return `/drives/${encodeURIComponent(workbook.workbookDriveId)}/items/${encodeURIComponent(
    workbook.workbookItemId,
  )}/workbook${worksheetPath(worksheetName)}/range(address='${encodeURIComponent(
    escapeODataString(cleanRange),
  )}')`;
}

function workbookPath(workbook, suffix = "") {
  return `/drives/${encodeURIComponent(workbook.workbookDriveId)}/items/${encodeURIComponent(
    workbook.workbookItemId,
  )}/workbook${suffix}`;
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

function indexToColumnLetters(index) {
  let n = Number(index || 0) + 1;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters || "A";
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

function parseA1Range(range = "") {
  const clean = stripWorksheetName(range || DEFAULT_GRID_RANGE);
  const [startRaw, endRaw] = clean.split(":");
  const start = parseA1Cell(startRaw || "A1");
  const end = parseA1Cell(endRaw || startRaw || "A1");

  return {
    start,
    end,
  };
}

function normalizeRangeResult({ json = {}, range = "", worksheetName = "" }) {
  const parsed = parseA1Range(range || json.address || DEFAULT_GRID_RANGE);
  const values = Array.isArray(json.values) ? json.values : [];

  return {
    address: json.address || range,
    range: json.address || range,
    worksheetName,
    values,
    rowCount: Number(json.rowCount || values.length || 0),
    columnCount: Number(
      json.columnCount ||
        values.reduce(
          (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
          0,
        ) ||
        0,
    ),
    cellCount: Number(json.cellCount || 0),
    startRowIndex: Number.isInteger(parsed.start.rowIndex)
      ? parsed.start.rowIndex
      : 0,
    startColumnIndex: Number.isInteger(parsed.start.columnIndex)
      ? parsed.start.columnIndex
      : 0,
  };
}

async function listWorksheets(workbook) {
  const json = await graphFetch(workbookPath(workbook, "/worksheets"));
  const worksheets = Array.isArray(json?.value) ? json.value : [];

  return worksheets.map((worksheet) => ({
    id: worksheet.id || "",
    name: worksheet.name || "",
    position: Number.isFinite(worksheet.position) ? worksheet.position : null,
    visibility: worksheet.visibility || "",
  }));
}

function chooseActiveWorksheet(worksheets = [], requestedName = "") {
  if (requestedName) {
    const byName = worksheets.find((worksheet) => worksheet.name === requestedName);
    if (byName) return byName;
  }

  return (
    worksheets.find((worksheet) => worksheet.visibility !== "Hidden") ||
    worksheets[0] ||
    null
  );
}

function findWorksheetByName(worksheets = [], name = "") {
  const expected = normalizeText(name).toLowerCase();
  return worksheets.find((worksheet) => normalizeText(worksheet.name).toLowerCase() === expected) || null;
}

async function addWorksheet({ workbook, worksheets = [], sheetName = "" }) {
  const name = normalizeText(sheetName);
  if (!name) {
    throw new Error("add_sheet requires sheetName.");
  }

  const existing = findWorksheetByName(worksheets, name);
  if (existing) {
    return {
      sheetName: existing.name,
      worksheetId: existing.id || "",
      skipped: true,
    };
  }

  const json = await graphFetch(workbookPath(workbook, "/worksheets/add"), {
    method: "POST",
    body: {
      name,
    },
  });

  return {
    sheetName: json?.name || name,
    worksheetId: json?.id || "",
    skipped: false,
  };
}

async function readRange({ workbook, worksheetName, range }) {
  const json = await graphFetch(
    rangePath({ workbook, worksheetName, range: range || DEFAULT_GRID_RANGE }),
  );
  return normalizeRangeResult({
    json,
    range: range || DEFAULT_GRID_RANGE,
    worksheetName,
  });
}

async function writeRange({ workbook, worksheetName, range, values }) {
  const json = await graphFetch(
    rangePath({ workbook, worksheetName, range }),
    {
      method: "PATCH",
      body: {
        values: to2dValues(values),
      },
    },
  );

  return normalizeRangeResult({
    json,
    range,
    worksheetName,
  });
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
  workbook,
  worksheetName,
  range,
  query,
  columns = [],
  matchMode = "contains",
  caseSensitive = false,
  limit = 20,
}) {
  const readResult = await readRange({ workbook, worksheetName, range });
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
    address: readResult.address,
    range: readResult.range,
    worksheetName,
    query,
    matches,
  };
}

function parseRangeEndRow(address = "") {
  const clean = stripWorksheetName(address);
  const endRaw = clean.split(":")[1] || clean.split(":")[0] || "A1";
  const end = parseA1Cell(endRaw);
  return Number.isInteger(end.rowIndex) ? end.rowIndex : 0;
}

async function getUsedRange({ workbook, worksheetName }) {
  const json = await graphFetch(
    workbookPath(workbook, `${worksheetPath(worksheetName)}/usedRange()`),
  );
  return normalizeRangeResult({
    json,
    range: json.address || "A1",
    worksheetName,
  });
}

async function appendRows({ workbook, worksheetName, range = "", startColumn = "", values }) {
  const rows = to2dValues(values);
  const usedRange = await getUsedRange({ workbook, worksheetName });
  const rangeStart = parseA1Range(range || startColumn || "A1").start;
  const startColumnIndex = Number.isInteger(rangeStart.columnIndex)
    ? rangeStart.columnIndex
    : 0;
  const nextRowIndex = parseRangeEndRow(usedRange.address || usedRange.range) + 1;
  const rowCount = rows.length || 1;
  const columnCount = rows.reduce(
    (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
    0,
  ) || 1;
  const startCell = `${indexToColumnLetters(startColumnIndex)}${nextRowIndex + 1}`;
  const endCell = `${indexToColumnLetters(startColumnIndex + columnCount - 1)}${
    nextRowIndex + rowCount
  }`;
  const appendRange = `${startCell}:${endCell}`;

  return writeRange({
    workbook,
    worksheetName,
    range: appendRange,
    values: rows,
  });
}

async function formatRange({ workbook, worksheetName, range, format = {} }) {
  const basePath = rangePath({ workbook, worksheetName, range });
  const appliedFormat = {};

  if (format.background || format.backgroundColor || format.fillColor) {
    appliedFormat.fillColor =
      format.background || format.backgroundColor || format.fillColor;
    await graphFetch(`${basePath}/format/fill`, {
      method: "PATCH",
      body: {
        color: appliedFormat.fillColor,
      },
    });
  }

  const fontPatch = {};
  if (format.textColor || format.foregroundColor) {
    fontPatch.color = format.textColor || format.foregroundColor;
  }
  if (typeof format.bold === "boolean") {
    fontPatch.bold = format.bold;
  }
  if (Object.keys(fontPatch).length) {
    Object.assign(appliedFormat, fontPatch);
    await graphFetch(`${basePath}/format/font`, {
      method: "PATCH",
      body: fontPatch,
    });
  }

  const formatPatch = {};
  const width = Number(format.width || format.columnWidth || 0);
  if (width > 0) {
    formatPatch.columnWidth = width;
  }
  if (format.horizontalAlignment || format.align) {
    formatPatch.horizontalAlignment = normalizeText(
      format.horizontalAlignment || format.align,
    );
  }
  if (Object.keys(formatPatch).length) {
    Object.assign(appliedFormat, formatPatch);
    await graphFetch(`${basePath}/format`, {
      method: "PATCH",
      body: formatPatch,
    });
  }

  return {
    address: range,
    worksheetName,
    appliedFormat,
    skipped: Object.keys(appliedFormat).length === 0,
  };
}

async function setActiveRange({ tabId, worksheetName, range }) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return {
    activeRange: stripWorksheetName(range || DEFAULT_GRID_RANGE),
    worksheetName,
    url: tab?.url || "",
    uiSelectionUpdated: false,
  };
}

function parseUrlExcelInfo(url = "") {
  try {
    const parsed = new URL(url);
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    return {
      range:
        hashParams.get("range") ||
        parsed.searchParams.get("range") ||
        parsed.searchParams.get("activeCell") ||
        "",
      worksheetName:
        hashParams.get("worksheet") ||
        parsed.searchParams.get("worksheet") ||
        "",
    };
  } catch {
    return {
      range: "",
      worksheetName: "",
    };
  }
}

async function getWorkbookContextFromTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const workbook = await resolveWorkbookFromUrl(tab.url || "");
  return {
    tab,
    workbook,
  };
}

async function extractStateFromTab(tabId, { goal, step, meta = {} } = {}) {
  await getAccessToken({ interactive: false });

  const { tab, workbook } = await getWorkbookContextFromTab(tabId);
  const worksheets = await listWorksheets(workbook);
  const urlInfo = parseUrlExcelInfo(tab.url || "");
  const activeWorksheet = chooseActiveWorksheet(worksheets, urlInfo.worksheetName);

  if (!activeWorksheet) {
    throw new Error("No worksheet found in the current Excel workbook.");
  }

  const gridRange = meta?.range || DEFAULT_GRID_RANGE;
  const visibleGrid = await readRange({
    workbook,
    worksheetName: activeWorksheet.name,
    range: gridRange,
  });

  return {
    surface: MICROSOFT_EXCEL_SURFACE,
    authStatus: "authenticated",
    goal: goal || "",
    step: step || 1,
    timestamp: new Date().toISOString(),
    url: tab.url || "",
    workbookDriveId: workbook.workbookDriveId,
    workbookItemId: workbook.workbookItemId,
    workbookTitle: workbook.workbookTitle || tab.title || "",
    workbookWebUrl: workbook.workbookWebUrl || tab.url || "",
    activeWorksheetName: activeWorksheet.name,
    activeRange: urlInfo.range || "",
    worksheets: worksheets.map((worksheet) => ({
      ...worksheet,
      active: worksheet.name === activeWorksheet.name,
    })),
    visibleGrid: {
      address: visibleGrid.address,
      range: visibleGrid.range || visibleGrid.address,
      startRow: visibleGrid.startRowIndex,
      startColumn: visibleGrid.startColumnIndex,
      rowCount: visibleGrid.rowCount,
      columnCount: visibleGrid.columnCount,
      values: visibleGrid.values,
    },
  };
}

async function runMicrosoftExcelCommand({ tabId, state, command, workbook, worksheets }) {
  const name = normalizeText(command?.name || command?.tool || command?.type);
  const worksheetName =
    normalizeText(command?.worksheetName || command?.sheetName) ||
    state.activeWorksheetName ||
    chooseActiveWorksheet(worksheets)?.name ||
    "";

  if (!worksheetName && name !== "list_worksheets") {
    throw new Error("No worksheet is available for Microsoft Excel command execution.");
  }

  if (name === "list_worksheets") {
    return {
      worksheets,
    };
  }

  if (name === "add_sheet") {
    return addWorksheet({
      workbook,
      worksheets,
      sheetName: command.sheetName || command.worksheetName || command.title,
    });
  }

  if (name === "read_range") {
    return readRange({
      workbook,
      worksheetName,
      range: command.range,
    });
  }

  if (name === "write_range") {
    return writeRange({
      workbook,
      worksheetName,
      range: command.range,
      values: command.values,
    });
  }

  if (name === "append_rows") {
    return appendRows({
      workbook,
      worksheetName,
      range: command.range,
      startColumn: command.startColumn,
      values: command.values,
    });
  }

  if (name === "find_rows") {
    return findRows({
      workbook,
      worksheetName,
      range: command.range,
      query: command.query,
      columns: command.columns,
      matchMode: command.matchMode,
      caseSensitive: Boolean(command.caseSensitive),
      limit: command.limit,
    });
  }

  if (name === "format_range") {
    return formatRange({
      workbook,
      worksheetName,
      range: command.range,
      format: command.format || {},
    });
  }

  if (name === "set_active_range") {
    return setActiveRange({
      tabId,
      worksheetName,
      range: command.range,
    });
  }

  throw new Error(`Unsupported Microsoft Excel command: ${name || "unknown"}`);
}

async function runMicrosoftExcelCommandsInTab(tabId, state, commands = []) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return {
      ok: true,
      surface: MICROSOFT_EXCEL_SURFACE,
      summary: "No Microsoft Excel commands to execute.",
      results: [],
    };
  }

  const { workbook } = await getWorkbookContextFromTab(tabId);
  const worksheets = await listWorksheets(workbook);
  const results = [];

  for (const command of commands) {
    try {
      const result = await runMicrosoftExcelCommand({
        tabId,
        state,
        command,
        workbook,
        worksheets,
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
        surface: MICROSOFT_EXCEL_SURFACE,
        summary: `Microsoft Excel command failed: ${error?.message || String(error)}`,
        error: error?.message || String(error),
        results,
      };
    }
  }

  return {
    ok: true,
    surface: MICROSOFT_EXCEL_SURFACE,
    summary: `Executed ${results.length} Microsoft Excel command${
      results.length === 1 ? "" : "s"
    }.`,
    results,
  };
}

async function runReplayActionsInTab(tabId, replaySteps = []) {
  const commands = replaySteps
    .map((step) => step?.command || step)
    .filter((command) => command?.surface === MICROSOFT_EXCEL_SURFACE || command?.name);
  const state = await extractStateFromTab(tabId, {
    meta: { beforeReplay: true },
  });
  return runMicrosoftExcelCommandsInTab(tabId, state, commands);
}

async function getMicrosoftExcelAuthStatus() {
  if (!(await isMicrosoftConfigured())) {
    return {
      ok: true,
      surface: MICROSOFT_EXCEL_SURFACE,
      authenticated: false,
      authStatus: "unconfigured",
      configMissing: true,
      error: microsoftSetupError().message,
    };
  }

  try {
    await getAccessToken({ interactive: false });
    return {
      ok: true,
      surface: MICROSOFT_EXCEL_SURFACE,
      authenticated: true,
      authStatus: "authenticated",
    };
  } catch (error) {
    return {
      ok: true,
      surface: MICROSOFT_EXCEL_SURFACE,
      authenticated: false,
      authStatus: "unauthenticated",
      error: error?.message || String(error),
    };
  }
}

async function connectMicrosoftExcel() {
  if (!interactiveAuthPromise) {
    interactiveAuthPromise = (async () => {
      await getAccessToken({ interactive: true });
      return getMicrosoftExcelAuthStatus();
    })().finally(() => {
      interactiveAuthPromise = null;
    });
  }

  return interactiveAuthPromise;
}

export const microsoftExcelRuntime = {
  connectMicrosoftExcel,
  extractStateFromTab,
  getMicrosoftExcelAuthStatus,
  runMicrosoftExcelCommandsInTab,
  runReplayActionsInTab,
};
