import { localBenchConfig } from "./localBenchConfig.js";

// Browser session storage is private to trusted extension contexts by default.
export const MINT_ACCESS_STORAGE_KEY = "webgpt_local_mint_access_v1";
const MINT_TOKEN_FORMAT = /^[\x21-\x7e]{1,4096}$/;

function loopbackOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) &&
        !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) {
      return url.origin;
    }
  } catch {
    // A bad development configuration cannot opt into mint.
  }
  return "";
}

async function getStoredMintAccess(origin) {
  const stored = await chrome.storage.session.get(MINT_ACCESS_STORAGE_KEY);
  const access = stored?.[MINT_ACCESS_STORAGE_KEY];
  return loopbackOrigin(access?.baseUrl) === origin ? access : null;
}

export async function setLocalMintToken(baseUrl, token) {
  const origin = loopbackOrigin(baseUrl);
  if (!origin) throw new Error("A local HTTP backend is required to configure a mint token.");
  if (typeof token !== "string" || (token !== "" && !MINT_TOKEN_FORMAT.test(token))) {
    throw new Error("Enter a valid local mint token without spaces.");
  }

  if (!token) {
    if (await getStoredMintAccess(origin)) await chrome.storage.session.remove(MINT_ACCESS_STORAGE_KEY);
    return;
  }

  await chrome.storage.session.set({
    [MINT_ACCESS_STORAGE_KEY]: {
      baseUrl: origin,
      token,
    },
  });
}

export async function getMintAccess(baseUrl) {
  const origin = loopbackOrigin(baseUrl);
  if (!origin) return null;
  if (origin === localBenchConfig?.baseUrl) return { token: localBenchConfig.token };
  const access = await getStoredMintAccess(origin);
  const token = access?.token;
  if (typeof token !== "string" || !MINT_TOKEN_FORMAT.test(token)) return null;
  return { token };
}
