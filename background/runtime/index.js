import { browserRuntime } from "./browser.js";
import { googleSheetsRuntime } from "./googleSheets.js";
import {
  BROWSER_DOM_SURFACE,
  GOOGLE_SHEETS_SURFACE,
  detectSurfaceForTab,
  normalizeSurface,
} from "./surfaces.js";

function replayBatchSurface(replaySteps = []) {
  const steps = Array.isArray(replaySteps) ? replaySteps : [];
  const hasGoogleSheetsStep = steps.some(
    (step) =>
      step?.surface === GOOGLE_SHEETS_SURFACE ||
      step?.command?.surface === GOOGLE_SHEETS_SURFACE,
  );
  const hasDomStep = steps.some((step) => step?.action?.type);

  if (hasGoogleSheetsStep && !hasDomStep) {
    return GOOGLE_SHEETS_SURFACE;
  }

  return BROWSER_DOM_SURFACE;
}

export const appRuntime = {
  ...browserRuntime,

  connectGoogleSheets: googleSheetsRuntime.connectGoogleSheets,
  detectSurfaceForTab,
  getGoogleSheetsAuthStatus: googleSheetsRuntime.getGoogleSheetsAuthStatus,

  async extractStateFromTab(tabId, options = {}) {
    const detectedSurface =
      normalizeSurface(options.surface) ||
      (await detectSurfaceForTab(tabId)).surface ||
      BROWSER_DOM_SURFACE;

    if (detectedSurface === GOOGLE_SHEETS_SURFACE) {
      return googleSheetsRuntime.extractStateFromTab(tabId, options);
    }

    return browserRuntime.extractStateFromTab(tabId, options);
  },

  async runGoogleSheetsCommandsInTab(tabId, state, commands) {
    return googleSheetsRuntime.runGoogleSheetsCommandsInTab(
      tabId,
      state,
      commands,
    );
  },

  async runReplayActionsInTab(tabId, replaySteps = []) {
    if (replayBatchSurface(replaySteps) === GOOGLE_SHEETS_SURFACE) {
      return googleSheetsRuntime.runReplayActionsInTab(tabId, replaySteps);
    }

    return browserRuntime.runReplayActionsInTab(tabId, replaySteps);
  },
};

export {
  BROWSER_DOM_SURFACE,
  GOOGLE_SHEETS_SURFACE,
  detectSurfaceForTab,
  normalizeSurface,
};
