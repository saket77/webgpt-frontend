import {
  provideHintAndResumeFlow,
} from "./flows/pauseFlow.js";
import {
  continueRunFlow,
  resumeAfterAccessFlow,
  startAgentFlow,
} from "./flows/runFlow.js";
import {
  confirmSuccessFlow,
  rejectSuccessAndResumeFlow,
} from "./flows/successFlow.js";
import { createListArtifacts } from "./flows/artifacts.js";
import { startTemplateQueueFlow } from "./flows/templateQueueFlow.js";
import { createAttachSessionToTab } from "./session/attach.js";
import { createSessionLifecycleHandlers } from "./session/lifecycle.js";
import { createRegisterTabHandlers } from "./tabs.js";
import { configureControllerCorePorts } from "../ports.js";
import { configureControllerCoreConfig } from "../config.js";

export function createControllerCore({
  plannerAdapter,
  runtime,
  sessionStore,
  eventSink,
  host,
  config,
} = {}) {
  if (!plannerAdapter) {
    throw new Error("createControllerCore requires a plannerAdapter.");
  }
  if (!runtime) {
    throw new Error("createControllerCore requires a runtime.");
  }

  configureControllerCorePorts({ sessionStore, eventSink, host });
  configureControllerCoreConfig(config || {});

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
    myInfo = null,
    profileAttachments = [],
    attachments = [],
  ) =>
    startAgentFlow(
      tabId,
      goal,
      inputValues,
      isTemplate,
      artifactFileName,
      surface,
      myInfo,
      profileAttachments,
      attachments,
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

  const resumeAfterAccess = (tabId) =>
    resumeAfterAccessFlow(tabId, {
      continueRun,
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
    connectMicrosoftExcel: runtime.connectMicrosoftExcel,
    connectZohoBooks: runtime.connectZohoBooks,
    continueRun,
    detectSurfaceForTab: runtime.detectSurfaceForTab,
    getGoogleSheetsAuthStatus: runtime.getGoogleSheetsAuthStatus,
    getMicrosoftExcelAuthStatus: runtime.getMicrosoftExcelAuthStatus,
    getZohoBooksAuthStatus: runtime.getZohoBooksAuthStatus,
    getSessionState: lifecycle.getSessionState,
    listArtifacts,
    pauseForForcedStop: lifecycle.pauseForForcedStop,
    provideHintAndResume,
    registerTabHandlers,
    rejectSuccessAndResume,
    resumeAfterAccess,
    requestStop: lifecycle.requestStop,
    resetSession: lifecycle.resetSession,
    startAgent,
    startTemplateQueue,
  };
}

export { createControllerCore as createController };
