import { webgptPlannerAdapter } from "../adapters/webgpt/plannerAdapter.js";
import { appRuntime } from "../runtime/index.js";
import {
  provideHintAndResumeFlow,
} from "./flows/pauseFlow.js";
import { continueRunFlow, startAgentFlow } from "./flows/runFlow.js";
import {
  confirmSuccessFlow,
  rejectSuccessAndResumeFlow,
} from "./flows/successFlow.js";
import { createListArtifacts } from "./flows/artifacts.js";
import { startTemplateQueueFlow } from "./flows/templateQueueFlow.js";
import { createAttachSessionToTab } from "./session/attach.js";
import { createSessionLifecycleHandlers } from "./session/lifecycle.js";
import { createRegisterTabHandlers } from "./tabs.js";

export function createController({
  plannerAdapter = webgptPlannerAdapter,
  runtime = appRuntime,
} = {}) {
  const lifecycle = createSessionLifecycleHandlers({ plannerAdapter });
  const attachSessionToTab = createAttachSessionToTab({ runtime });
  const listArtifacts = createListArtifacts({ plannerAdapter });

  const continueRun = (tabId, initialCommand = null) =>
    continueRunFlow(tabId, initialCommand, {
      continueRun,
      deleteBackendRunAndClearLocal: lifecycle.deleteBackendRunAndClearLocal,
      plannerAdapter,
      runtime,
      stopIfRequested: lifecycle.stopIfRequested,
    });

  const startAgent = (
    tabId,
    goal,
    inputValues = {},
    isTemplate,
    artifactFileName = "",
    surface = "",
  ) =>
    startAgentFlow(
      tabId,
      goal,
      inputValues,
      isTemplate,
      artifactFileName,
      surface,
      {
        continueRun,
        plannerAdapter,
        runtime,
      },
    );

  const startTemplateQueue = (tabId, args = {}) =>
    startTemplateQueueFlow(tabId, args, {
      continueRun,
      plannerAdapter,
      runtime,
    });

  const provideHintAndResume = (tabId, hint) =>
    provideHintAndResumeFlow(tabId, hint, {
      continueRun,
      plannerAdapter,
      runtime,
    });

  const confirmSuccess = (tabId) =>
    confirmSuccessFlow(tabId, {
      deleteBackendRunAndClearLocal: lifecycle.deleteBackendRunAndClearLocal,
      plannerAdapter,
    });

  const rejectSuccessAndResume = (tabId, hint) =>
    rejectSuccessAndResumeFlow(tabId, hint, {
      continueRun,
      plannerAdapter,
    });

  const registerTabHandlers = createRegisterTabHandlers({
    continueRun,
    pauseForForcedStop: lifecycle.pauseForForcedStop,
    runtime,
  });

  return {
    attachSessionToTab,
    confirmSuccess,
    connectGoogleSheets: runtime.connectGoogleSheets,
    continueRun,
    detectSurfaceForTab: runtime.detectSurfaceForTab,
    getGoogleSheetsAuthStatus: runtime.getGoogleSheetsAuthStatus,
    getSessionState: lifecycle.getSessionState,
    listArtifacts,
    pauseForForcedStop: lifecycle.pauseForForcedStop,
    provideHintAndResume,
    registerTabHandlers,
    rejectSuccessAndResume,
    requestStop: lifecycle.requestStop,
    resetSession: lifecycle.resetSession,
    startAgent,
    startTemplateQueue,
  };
}

const defaultController = createController();

export const attachSessionToTab = defaultController.attachSessionToTab;
export const confirmSuccess = defaultController.confirmSuccess;
export const connectGoogleSheets = defaultController.connectGoogleSheets;
export const continueRun = defaultController.continueRun;
export const detectSurfaceForTab = defaultController.detectSurfaceForTab;
export const getGoogleSheetsAuthStatus =
  defaultController.getGoogleSheetsAuthStatus;
export const getSessionState = defaultController.getSessionState;
export const listArtifacts = defaultController.listArtifacts;
export const pauseForForcedStop = defaultController.pauseForForcedStop;
export const provideHintAndResume = defaultController.provideHintAndResume;
export const registerTabHandlers = defaultController.registerTabHandlers;
export const rejectSuccessAndResume = defaultController.rejectSuccessAndResume;
export const requestStop = defaultController.requestStop;
export const resetSession = defaultController.resetSession;
export const startAgent = defaultController.startAgent;
export const startTemplateQueue = defaultController.startTemplateQueue;

export default defaultController;
