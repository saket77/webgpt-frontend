import { browserRuntime } from "./browser.js";
import { googleSheetsRuntime } from "./googleSheets.js";
import { microsoftExcelRuntime } from "./microsoftExcel.js";
import {
  BROWSER_DOM_SURFACE,
  GOOGLE_SHEETS_SURFACE,
  MICROSOFT_EXCEL_SURFACE,
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
  const hasMicrosoftExcelStep = steps.some(
    (step) =>
      step?.surface === MICROSOFT_EXCEL_SURFACE ||
      step?.command?.surface === MICROSOFT_EXCEL_SURFACE,
  );
  const hasDomStep = steps.some((step) => step?.action?.type);

  if (hasGoogleSheetsStep && !hasMicrosoftExcelStep && !hasDomStep) {
    return GOOGLE_SHEETS_SURFACE;
  }

  if (hasMicrosoftExcelStep && !hasGoogleSheetsStep && !hasDomStep) {
    return MICROSOFT_EXCEL_SURFACE;
  }

  return BROWSER_DOM_SURFACE;
}

export const appRuntime = {
  ...browserRuntime,

  connectGoogleSheets: googleSheetsRuntime.connectGoogleSheets,
  connectMicrosoftExcel: microsoftExcelRuntime.connectMicrosoftExcel,
  detectSurfaceForTab,
  getGoogleSheetsAuthStatus: googleSheetsRuntime.getGoogleSheetsAuthStatus,
  getMicrosoftExcelAuthStatus:
    microsoftExcelRuntime.getMicrosoftExcelAuthStatus,

  async extractStateFromTab(tabId, options = {}) {
    const detectedSurface =
      normalizeSurface(options.surface) ||
      (await detectSurfaceForTab(tabId)).surface ||
      BROWSER_DOM_SURFACE;

    if (detectedSurface === GOOGLE_SHEETS_SURFACE) {
      return googleSheetsRuntime.extractStateFromTab(tabId, options);
    }

    if (detectedSurface === MICROSOFT_EXCEL_SURFACE) {
      return microsoftExcelRuntime.extractStateFromTab(tabId, options);
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

  async runMicrosoftExcelCommandsInTab(tabId, state, commands) {
    return microsoftExcelRuntime.runMicrosoftExcelCommandsInTab(
      tabId,
      state,
      commands,
    );
  },

  async runReplayActionsInTab(tabId, replaySteps = []) {
    if (replayBatchSurface(replaySteps) === GOOGLE_SHEETS_SURFACE) {
      return googleSheetsRuntime.runReplayActionsInTab(tabId, replaySteps);
    }

    if (replayBatchSurface(replaySteps) === MICROSOFT_EXCEL_SURFACE) {
      return microsoftExcelRuntime.runReplayActionsInTab(tabId, replaySteps);
    }

    return browserRuntime.runReplayActionsInTab(tabId, replaySteps);
  },
};

export {
  BROWSER_DOM_SURFACE,
  GOOGLE_SHEETS_SURFACE,
  MICROSOFT_EXCEL_SURFACE,
  detectSurfaceForTab,
  normalizeSurface,
};
