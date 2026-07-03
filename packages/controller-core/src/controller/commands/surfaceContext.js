import { saveSession } from "../../state/sessionStore.js";
import { sleep } from "../../utils/common.js";
import {
  BROWSER_DOM_SURFACE,
  GOOGLE_SHEETS_SURFACE,
  MICROSOFT_EXCEL_SURFACE,
  normalizeSurface,
} from "../../runtime/surfaces.js";
import { getControllerCorePorts } from "../../ports.js";

function surfaceUrl(state = {}) {
  if (state.surface === MICROSOFT_EXCEL_SURFACE) {
    return state.workbookWebUrl || state.url || "";
  }

  return state.url || "";
}

function surfaceContextId(state = {}) {
  if (state.surface === GOOGLE_SHEETS_SURFACE && state.spreadsheetId) {
    return `spreadsheet:${state.spreadsheetId}`;
  }

  if (
    state.surface === MICROSOFT_EXCEL_SURFACE &&
    state.workbookDriveId &&
    state.workbookItemId
  ) {
    return `workbook:${state.workbookDriveId}:${state.workbookItemId}`;
  }

  return surfaceUrl(state);
}

function surfaceContextFromState(state = {}) {
  const surface = normalizeSurface(state.surface);
  if (!surface || surface === BROWSER_DOM_SURFACE) return null;

  const url = surfaceUrl(state);
  const id = surfaceContextId(state);
  if (!url) return null;

  return {
    id,
    surface,
    url,
    title: state.spreadsheetTitle || state.workbookTitle || "",
  };
}

async function waitForTabComplete(tabId) {
  for (let i = 0; i < 40; i += 1) {
    const tab = await getControllerCorePorts().host.getTab(tabId).catch(() => null);
    if (tab?.status === "complete") return;
    await sleep(250);
  }
}

function tabMatchesContext(tabUrl = "", context = {}) {
  const url = String(tabUrl || "");
  const contextUrl = String(context?.url || "");
  const contextId = String(context?.id || "");

  if (contextId.startsWith("spreadsheet:")) {
    const spreadsheetId = contextId.slice("spreadsheet:".length);
    return Boolean(spreadsheetId && url.includes(`/d/${spreadsheetId}`));
  }

  if (contextId.startsWith("workbook:")) {
    return Boolean(contextUrl && url === contextUrl);
  }

  return Boolean(contextUrl && url === contextUrl);
}

function isGoogleSheetsUrl(value = "") {
  return /^https:\/\/docs\.google\.com\/spreadsheets\//i.test(String(value || ""));
}

function googleSheetsUrlFromContextId(contextId = "") {
  const id = String(contextId || "").trim();
  if (!id.startsWith("spreadsheet:")) return "";

  const spreadsheetId = id.slice("spreadsheet:".length).trim();
  if (!spreadsheetId) return "";

  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;
}

function contextFromRequestedContextId(surface, contextId = "") {
  const targetSurface = normalizeSurface(surface);
  const requestedContextId = String(contextId || "").trim();
  if (!targetSurface || !requestedContextId) return null;

  if (targetSurface === GOOGLE_SHEETS_SURFACE) {
    if (isGoogleSheetsUrl(requestedContextId)) {
      return {
        id: requestedContextId,
        surface: targetSurface,
        url: requestedContextId,
        title: "",
      };
    }

    const url = googleSheetsUrlFromContextId(requestedContextId);
    if (url) {
      return {
        id: requestedContextId,
        surface: targetSurface,
        url,
        title: "",
      };
    }
  }

  if (
    targetSurface === MICROSOFT_EXCEL_SURFACE &&
    /^https:\/\//i.test(requestedContextId)
  ) {
    return {
      id: requestedContextId,
      surface: targetSurface,
      url: requestedContextId,
      title: "",
    };
  }

  return null;
}

export async function rememberSurfaceContext(tabId, session, state) {
  const context = surfaceContextFromState(state);
  if (!context) return session;
  const currentSurfaceContexts = session.surfaceContexts || {};
  const currentSurfaceBucket = currentSurfaceContexts[context.surface] || {};
  const currentItems = currentSurfaceBucket.items || {};

  const next = {
    ...session,
    surfaceContexts: {
      ...currentSurfaceContexts,
      [context.surface]: {
        activeId: context.id,
        items: {
          ...currentItems,
          [context.id]: context,
        },
      },
    },
  };

  await saveSession(tabId, next);
  return next;
}

export async function activateSurfaceFromContext(
  tabId,
  session,
  surface,
  runtime,
  contextId = "",
) {
  const targetSurface = normalizeSurface(surface);
  if (!targetSurface || targetSurface === BROWSER_DOM_SURFACE) return session;

  const bucket = session.surfaceContexts?.[targetSurface];
  const requestedContextId = String(contextId || "").trim();
  const context =
    bucket?.items?.[requestedContextId] ||
    contextFromRequestedContextId(targetSurface, requestedContextId) ||
    bucket?.items?.[bucket.activeId];

  const tab = await getControllerCorePorts().host.getTab(tabId).catch(() => null);
  const detected = await runtime.detectSurfaceForTab?.(tabId).catch(() => null);
  if (!requestedContextId && detected?.surface === targetSurface) return session;
  if (requestedContextId && tabMatchesContext(tab?.url, context)) return session;

  if (!context?.url) return session;

  await getControllerCorePorts().host.updateTab(tabId, { url: context.url });
  await waitForTabComplete(tabId);

  return {
    ...session,
    lastKnownUrl: context.url,
  };
}
