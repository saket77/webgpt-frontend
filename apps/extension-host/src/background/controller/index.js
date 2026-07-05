import { createControllerCore } from "@webgpt/controller-core";
import { webgptPlannerAdapter } from "../adapters/webgpt/plannerAdapter.js";
import { appRuntime } from "../runtime/index.js";
import * as sessionStore from "../state/sessionStore.js";
import { addEvent } from "../events.js";
import {
  MAX_EVENTS,
  MAX_STEPS,
  POST_ACTION_STATE_SETTLE_MS,
  POST_NAVIGATION_RESUME_SETTLE_MS,
} from "../config.js";

const chromeHost = {
  async hasBrowserHostAccess(origins) {
    return chrome.permissions.contains({ origins });
  },

  async getTab(tabId) {
    return chrome.tabs.get(tabId);
  },

  async updateTab(tabId, update) {
    return chrome.tabs.update(tabId, update);
  },

  onTabCreated(handler) {
    chrome.tabs.onCreated.addListener(handler);
    return () => chrome.tabs.onCreated.removeListener(handler);
  },

  onTabUpdated(handler) {
    chrome.tabs.onUpdated.addListener(handler);
    return () => chrome.tabs.onUpdated.removeListener(handler);
  },
};

export function createExtensionController({
  plannerAdapter = webgptPlannerAdapter,
  runtime = appRuntime,
} = {}) {
  return createControllerCore({
    plannerAdapter,
    runtime,
    sessionStore,
    eventSink: { addEvent },
    host: chromeHost,
    config: {
      MAX_EVENTS,
      MAX_STEPS,
      POST_ACTION_STATE_SETTLE_MS,
      POST_NAVIGATION_RESUME_SETTLE_MS,
    },
  });
}

const defaultController = createExtensionController();

export const attachSessionToTab = defaultController.attachSessionToTab;
export const confirmSuccess = defaultController.confirmSuccess;
export const connectGoogleSheets = defaultController.connectGoogleSheets;
export const connectMicrosoftExcel = defaultController.connectMicrosoftExcel;
export const continueRun = defaultController.continueRun;
export const detectSurfaceForTab = defaultController.detectSurfaceForTab;
export const getGoogleSheetsAuthStatus =
  defaultController.getGoogleSheetsAuthStatus;
export const getMicrosoftExcelAuthStatus =
  defaultController.getMicrosoftExcelAuthStatus;
export const getSessionState = defaultController.getSessionState;
export const listArtifacts = defaultController.listArtifacts;
export const pauseForForcedStop = defaultController.pauseForForcedStop;
export const provideHintAndResume = defaultController.provideHintAndResume;
export const registerTabHandlers = defaultController.registerTabHandlers;
export const rejectSuccessAndResume = defaultController.rejectSuccessAndResume;
export const resumeAfterAccess = defaultController.resumeAfterAccess;
export const requestStop = defaultController.requestStop;
export const resetSession = defaultController.resetSession;
export const startAgent = defaultController.startAgent;
export const startTemplateQueue = defaultController.startTemplateQueue;

export default defaultController;
