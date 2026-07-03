export function nowIso() {
  return new Date().toISOString();
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function tabKey(tabId) {
  return String(tabId);
}

export async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
