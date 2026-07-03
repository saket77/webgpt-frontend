import {
  BACKEND_BASE_URL_STORAGE_KEY,
  DEFAULT_API_BASE_URL,
} from "../config.js";

function trimTrailingSlash(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function normalizeBackendBaseUrl(baseUrl) {
  const value = String(baseUrl || "").trim();

  if (!value) {
    throw new Error("Backend base URL is required.");
  }

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Backend base URL must be an absolute http(s) URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Backend base URL must use http or https.");
  }

  return trimTrailingSlash(parsed.toString());
}

export async function getStoredBackendBaseUrl() {
  const stored = await chrome.storage.local.get(BACKEND_BASE_URL_STORAGE_KEY);
  const value = stored?.[BACKEND_BASE_URL_STORAGE_KEY];

  if (!value || typeof value !== "string" || !value.trim()) {
    return "";
  }

  return value.trim();
}

export async function getBackendConfiguration() {
  const storedBaseUrl = await getStoredBackendBaseUrl();

  if (!storedBaseUrl) {
    return {
      baseUrl: DEFAULT_API_BASE_URL,
      source: "default",
      overrideBaseUrl: "",
      defaultBaseUrl: DEFAULT_API_BASE_URL,
    };
  }

  return {
    baseUrl: normalizeBackendBaseUrl(storedBaseUrl),
    source: "storage",
    overrideBaseUrl: storedBaseUrl,
    defaultBaseUrl: DEFAULT_API_BASE_URL,
  };
}

export async function resolveBackendBaseUrl({ baseUrl } = {}) {
  if (baseUrl && String(baseUrl).trim()) {
    return normalizeBackendBaseUrl(baseUrl);
  }

  const config = await getBackendConfiguration();
  return config.baseUrl;
}

export async function setStoredBackendBaseUrl(baseUrl) {
  const normalized = normalizeBackendBaseUrl(baseUrl);

  await chrome.storage.local.set({
    [BACKEND_BASE_URL_STORAGE_KEY]: normalized,
  });

  return getBackendConfiguration();
}

export async function resetStoredBackendBaseUrl() {
  await chrome.storage.local.remove(BACKEND_BASE_URL_STORAGE_KEY);
  return getBackendConfiguration();
}
