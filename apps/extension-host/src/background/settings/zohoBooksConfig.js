import {
  ZOHO_BOOKS_CONFIG_STORAGE_KEY,
  ZOHO_BOOKS_DEFAULT_SCOPES,
  ZOHO_BOOKS_TOKEN_STORAGE_KEY,
} from "../config.js";

const DATA_CENTERS = {
  com: {
    label: "United States",
    accountsUrl: "https://accounts.zoho.com",
    apiDomain: "https://www.zohoapis.com",
  },
  in: {
    label: "India",
    accountsUrl: "https://accounts.zoho.in",
    apiDomain: "https://www.zohoapis.in",
  },
  eu: {
    label: "Europe",
    accountsUrl: "https://accounts.zoho.eu",
    apiDomain: "https://www.zohoapis.eu",
  },
  "com.au": {
    label: "Australia",
    accountsUrl: "https://accounts.zoho.com.au",
    apiDomain: "https://www.zohoapis.com.au",
  },
  jp: {
    label: "Japan",
    accountsUrl: "https://accounts.zoho.jp",
    apiDomain: "https://www.zohoapis.jp",
  },
  ca: {
    label: "Canada",
    accountsUrl: "https://accounts.zoho.ca",
    apiDomain: "https://www.zohoapis.ca",
  },
  "com.cn": {
    label: "China",
    accountsUrl: "https://accounts.zoho.com.cn",
    apiDomain: "https://www.zohoapis.com.cn",
  },
  sa: {
    label: "Saudi Arabia",
    accountsUrl: "https://accounts.zoho.sa",
    apiDomain: "https://www.zohoapis.sa",
  },
};

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
  return normalized.length ? normalized : [...ZOHO_BOOKS_DEFAULT_SCOPES];
}

function normalizeDataCenter(value) {
  const dataCenter = normalizeText(value || "in").toLowerCase().replace(/^\./, "");
  if (!DATA_CENTERS[dataCenter]) {
    throw new Error(
      `Unsupported Zoho data center: ${dataCenter || "blank"}. Use one of ${Object.keys(DATA_CENTERS).join(", ")}.`,
    );
  }
  return dataCenter;
}

function normalizeClientId(clientId) {
  const value = normalizeText(clientId);
  if (!value) throw new Error("Zoho client ID is required.");
  return value;
}

function normalizeClientSecret(clientSecret) {
  const value = normalizeText(clientSecret);
  if (!value) throw new Error("Zoho client secret is required.");
  return value;
}

async function clearStoredZohoBooksToken() {
  await chrome.storage.local.remove(ZOHO_BOOKS_TOKEN_STORAGE_KEY);
}

export function getZohoBooksRedirectUri() {
  return chrome.identity?.getRedirectURL
    ? chrome.identity.getRedirectURL("zoho-books")
    : "";
}

export function getZohoDataCenterOptions() {
  return Object.entries(DATA_CENTERS).map(([id, value]) => ({
    id,
    label: value.label,
    accountsUrl: value.accountsUrl,
    apiDomain: value.apiDomain,
  }));
}

export async function getStoredZohoBooksConfig() {
  const stored = await chrome.storage.local.get(ZOHO_BOOKS_CONFIG_STORAGE_KEY);
  const value = stored?.[ZOHO_BOOKS_CONFIG_STORAGE_KEY];
  if (!value || typeof value !== "object") return null;

  const dataCenter = DATA_CENTERS[value.dataCenter]
    ? value.dataCenter
    : "in";

  return {
    dataCenter,
    clientId: normalizeText(value.clientId),
    clientSecret: normalizeText(value.clientSecret),
    scopes: normalizeScopes(value.scopes),
  };
}

export async function getZohoBooksConfiguration() {
  const storedConfig = await getStoredZohoBooksConfig();
  const dataCenter = normalizeDataCenter(storedConfig?.dataCenter || "in");
  const configured = Boolean(storedConfig?.clientId && storedConfig?.clientSecret);
  const dataCenterConfig = DATA_CENTERS[dataCenter];

  return {
    dataCenter,
    dataCenterOptions: getZohoDataCenterOptions(),
    accountsUrl: dataCenterConfig.accountsUrl,
    apiDomain: dataCenterConfig.apiDomain,
    clientId: storedConfig?.clientId || "",
    clientSecret: storedConfig?.clientSecret || "",
    scopes: storedConfig?.scopes?.length
      ? storedConfig.scopes
      : [...ZOHO_BOOKS_DEFAULT_SCOPES],
    defaultScopes: [...ZOHO_BOOKS_DEFAULT_SCOPES],
    source: configured ? "storage" : "missing",
    configured,
    redirectUri: getZohoBooksRedirectUri(),
  };
}

export async function setStoredZohoBooksConfig(config = {}) {
  const dataCenter = normalizeDataCenter(config.dataCenter || "in");
  const clientId = normalizeClientId(config.clientId);
  const clientSecret = normalizeClientSecret(config.clientSecret);
  const scopes = normalizeScopes(config.scopes);

  await chrome.storage.local.set({
    [ZOHO_BOOKS_CONFIG_STORAGE_KEY]: {
      dataCenter,
      clientId,
      clientSecret,
      scopes,
    },
  });
  await clearStoredZohoBooksToken();
  return getZohoBooksConfiguration();
}

export async function resetStoredZohoBooksConfig() {
  await chrome.storage.local.remove(ZOHO_BOOKS_CONFIG_STORAGE_KEY);
  await clearStoredZohoBooksToken();
  return getZohoBooksConfiguration();
}
