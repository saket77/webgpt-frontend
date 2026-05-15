import {
  MICROSOFT_EXCEL_CONFIG_STORAGE_KEY,
  MICROSOFT_EXCEL_DEFAULT_SCOPES,
  MICROSOFT_EXCEL_TOKEN_STORAGE_KEY,
} from "../config.js";

const CLIENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9.-]*$/i;

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeScopes(scopes) {
  const values = Array.isArray(scopes)
    ? scopes
    : String(scopes || "")
        .split(/[\s,]+/g)
        .filter(Boolean);

  const normalized = values.map(normalizeText).filter(Boolean);
  return normalized.length ? normalized : [...MICROSOFT_EXCEL_DEFAULT_SCOPES];
}

function normalizeTenantId(tenantId) {
  const value = normalizeText(tenantId);

  if (!value) {
    throw new Error("Microsoft tenant ID is required.");
  }

  if (!TENANT_ID_PATTERN.test(value) || value.includes("/")) {
    throw new Error(
      "Microsoft tenant ID must be a tenant GUID, verified domain, or Microsoft tenant alias.",
    );
  }

  return value;
}

function normalizeClientId(clientId) {
  const value = normalizeText(clientId);

  if (!value) {
    throw new Error("Microsoft application client ID is required.");
  }

  if (!CLIENT_ID_PATTERN.test(value)) {
    throw new Error("Microsoft application client ID must be a GUID.");
  }

  return value;
}

async function clearStoredMicrosoftToken() {
  await chrome.storage.local.remove(MICROSOFT_EXCEL_TOKEN_STORAGE_KEY);
}

export function getMicrosoftExcelRedirectUri() {
  return chrome.identity?.getRedirectURL
    ? chrome.identity.getRedirectURL("microsoft")
    : "";
}

export async function getStoredMicrosoftExcelConfig() {
  const stored = await chrome.storage.local.get(MICROSOFT_EXCEL_CONFIG_STORAGE_KEY);
  const value = stored?.[MICROSOFT_EXCEL_CONFIG_STORAGE_KEY];

  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    tenantId: normalizeText(value.tenantId),
    clientId: normalizeText(value.clientId),
    scopes: normalizeScopes(value.scopes),
  };
}

export async function getMicrosoftExcelConfiguration() {
  const storedConfig = await getStoredMicrosoftExcelConfig();
  const configured = Boolean(storedConfig?.tenantId && storedConfig?.clientId);

  return {
    tenantId: storedConfig?.tenantId || "",
    clientId: storedConfig?.clientId || "",
    scopes: storedConfig?.scopes?.length
      ? storedConfig.scopes
      : [...MICROSOFT_EXCEL_DEFAULT_SCOPES],
    defaultScopes: [...MICROSOFT_EXCEL_DEFAULT_SCOPES],
    source: configured ? "storage" : "missing",
    configured,
    redirectUri: getMicrosoftExcelRedirectUri(),
  };
}

export async function setStoredMicrosoftExcelConfig(config = {}) {
  const tenantId = normalizeTenantId(config.tenantId);
  const clientId = normalizeClientId(config.clientId);
  const scopes = normalizeScopes(config.scopes);

  await chrome.storage.local.set({
    [MICROSOFT_EXCEL_CONFIG_STORAGE_KEY]: {
      tenantId,
      clientId,
      scopes,
    },
  });
  await clearStoredMicrosoftToken();

  return getMicrosoftExcelConfiguration();
}

export async function resetStoredMicrosoftExcelConfig() {
  await chrome.storage.local.remove(MICROSOFT_EXCEL_CONFIG_STORAGE_KEY);
  await clearStoredMicrosoftToken();
  return getMicrosoftExcelConfiguration();
}
