import { MY_INFO_CONFIG_STORAGE_KEY } from "../config.js";

function normalizeBoolean(value) {
  return Boolean(value);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeMyInfoConfig(value = {}) {
  return {
    enabledForRuns: normalizeBoolean(value.enabledForRuns),
    text: normalizeText(value.text),
  };
}

export async function getMyInfoConfiguration() {
  const stored = await chrome.storage.local.get(MY_INFO_CONFIG_STORAGE_KEY);
  return normalizeMyInfoConfig(stored?.[MY_INFO_CONFIG_STORAGE_KEY] || {});
}

export async function getMyInfoRunSnapshot() {
  const config = await getMyInfoConfiguration();

  if (!config.enabledForRuns || !config.text) {
    return {
      enabled: false,
      text: "",
    };
  }

  return {
    enabled: true,
    text: config.text,
  };
}

export async function setStoredMyInfoConfig(config = {}) {
  const normalized = normalizeMyInfoConfig(config);

  await chrome.storage.local.set({
    [MY_INFO_CONFIG_STORAGE_KEY]: normalized,
  });

  return getMyInfoConfiguration();
}

export async function resetStoredMyInfoConfig() {
  await chrome.storage.local.remove(MY_INFO_CONFIG_STORAGE_KEY);
  return getMyInfoConfiguration();
}
