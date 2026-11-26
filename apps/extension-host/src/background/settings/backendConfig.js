import {
  BACKEND_BASE_URL_STORAGE_KEY,
  DEFAULT_API_BASE_URL,
} from "../config.js";
import { getMintAccess, setLocalMintToken } from "./mintAccess.js";
import { localBenchConfig } from "./localBenchConfig.js";

const defaultBaseUrl = localBenchConfig?.baseUrl || DEFAULT_API_BASE_URL;

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
  const baseUrl = storedBaseUrl ? normalizeBackendBaseUrl(storedBaseUrl) : defaultBaseUrl;
  return {
    baseUrl,
    source: storedBaseUrl ? "storage" : "default",
    overrideBaseUrl: storedBaseUrl,
    defaultBaseUrl,
    mintTokenProvisioned: baseUrl === localBenchConfig?.baseUrl,
    mintTokenConfigured: Boolean(await getMintAccess(baseUrl)),
  };
}

export async function resolveBackendBaseUrl({ baseUrl } = {}) {
  if (baseUrl && String(baseUrl).trim()) {
    return normalizeBackendBaseUrl(baseUrl);
  }

  const storedBaseUrl = await getStoredBackendBaseUrl();
  return storedBaseUrl ? normalizeBackendBaseUrl(storedBaseUrl) : defaultBaseUrl;
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

export async function setStoredLocalMintToken({ baseUrl, token }) {
  const activeBaseUrl = await resolveBackendBaseUrl();
  if (normalizeBackendBaseUrl(baseUrl) !== activeBaseUrl) {
    throw new Error("The active backend changed. Refresh Settings and try again.");
  }
  if (activeBaseUrl === localBenchConfig?.baseUrl) {
    throw new Error("The local bench build supplies its own mint token.");
  }
  await setLocalMintToken(activeBaseUrl, token);
  return getBackendConfiguration();
}
