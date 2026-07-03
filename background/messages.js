import { ensureHydrated } from "./state/sessionStore.js";
import {
  getBackendConfiguration,
  resetStoredBackendBaseUrl,
  setStoredBackendBaseUrl,
} from "./settings/backendConfig.js";
import {
  getMicrosoftExcelConfiguration,
  resetStoredMicrosoftExcelConfig,
  setStoredMicrosoftExcelConfig,
} from "./settings/microsoftExcelConfig.js";
import {
  getMyInfoConfiguration,
  getMyInfoRunSnapshot,
  resetStoredMyInfoConfig,
  setStoredMyInfoConfig,
} from "./settings/myInfoConfig.js";
import {
  resetSession,
  requestStop,
  startAgent,
  startTemplateQueue,
  provideHintAndResume,
  confirmSuccess,
  rejectSuccessAndResume,
  resumeAfterAccess,
  getSessionState,
  attachSessionToTab,
  listArtifacts,
  detectSurfaceForTab,
  getGoogleSheetsAuthStatus,
  connectGoogleSheets,
  getMicrosoftExcelAuthStatus,
  connectMicrosoftExcel,
} from "./controller/index.js";

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  return tab.id;
}

export function registerMessageHandlers() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      await ensureHydrated();

      if (message?.type === "WEBGPT_GET_SESSION") {
        const session = await getSessionState(message.tabId);
        sendResponse({ ok: true, session });
        return;
      }

      if (message?.type === "WEBGPT_RESET_SESSION") {
        const result = await resetSession(message.tabId);
        sendResponse(result);
        return;
      }

      if (message?.type === "WEBGPT_STOP_AGENT") {
        const result = await requestStop(message.tabId);
        sendResponse(result);
        return;
      }

      if (message?.type === "WEBGPT_START_AGENT") {
        const myInfo = await getMyInfoRunSnapshot();
        const result = await startAgent(
          message.tabId,
          message.goal || "",
          message.inputValues || {},
          message.isTemplate || false,
          message.artifactFileName || "",
          message.surface || "",
          myInfo,
          message.profileAttachments || [],
        );
        sendResponse({ ok: true, result });
        return;
      }

      if (message?.type === "WEBGPT_START_TEMPLATE_QUEUE") {
        const myInfo = await getMyInfoRunSnapshot();
        const result = await startTemplateQueue(message.tabId, {
          goalTemplate: message.goalTemplate || "",
          inputSchema: message.inputSchema || [],
          inputValues: message.inputValues || {},
          artifactFileName: message.artifactFileName || "",
          surface: message.surface || "",
          myInfo,
        });
        sendResponse({ ok: true, result });
        return;
      }

      if (message?.type === "WEBGPT_PROVIDE_HINT") {
        const result = await provideHintAndResume(
          message.tabId,
          message.hint || "",
        );
        sendResponse({ ok: true, result });
        return;
      }

      if (message?.type === "WEBGPT_CONFIRM_SUCCESS") {
        const result = await confirmSuccess(message.tabId);
        sendResponse({ ok: true, result });
        return;
      }

      if (message?.type === "WEBGPT_REJECT_SUCCESS") {
        const result = await rejectSuccessAndResume(
          message.tabId,
          message.hint || "",
        );
        sendResponse({ ok: true, result });
        return;
      }

      if (message?.type === "WEBGPT_RESUME_AFTER_ACCESS") {
        const result = await resumeAfterAccess(message.tabId);
        sendResponse({ ok: true, result });
        return;
      }
      if (message?.type === "WEBGPT_LIST_ARTIFACTS") {
        const result = await listArtifacts();
        sendResponse({ ok: true, artifacts: result });
        return;
      }

      if (message?.type === "WEBGPT_GET_BACKEND_CONFIG") {
        const config = await getBackendConfiguration();
        sendResponse({ ok: true, config });
        return;
      }

      if (message?.type === "WEBGPT_SET_BACKEND_CONFIG") {
        const config = await setStoredBackendBaseUrl(message.baseUrl || "");
        sendResponse({ ok: true, config });
        return;
      }

      if (message?.type === "WEBGPT_RESET_BACKEND_CONFIG") {
        const config = await resetStoredBackendBaseUrl();
        sendResponse({ ok: true, config });
        return;
      }

      if (message?.type === "WEBGPT_GET_MICROSOFT_EXCEL_CONFIG") {
        const config = await getMicrosoftExcelConfiguration();
        sendResponse({ ok: true, config });
        return;
      }

      if (message?.type === "WEBGPT_SET_MICROSOFT_EXCEL_CONFIG") {
        const config = await setStoredMicrosoftExcelConfig({
          tenantId: message.tenantId || "",
          clientId: message.clientId || "",
          scopes: message.scopes || "",
        });
        sendResponse({ ok: true, config });
        return;
      }

      if (message?.type === "WEBGPT_RESET_MICROSOFT_EXCEL_CONFIG") {
        const config = await resetStoredMicrosoftExcelConfig();
        sendResponse({ ok: true, config });
        return;
      }

      if (message?.type === "WEBGPT_GET_MY_INFO_CONFIG") {
        const config = await getMyInfoConfiguration();
        sendResponse({ ok: true, config });
        return;
      }

      if (message?.type === "WEBGPT_SET_MY_INFO_CONFIG") {
        const config = await setStoredMyInfoConfig({
          enabledForRuns: message.enabledForRuns,
          text: message.text || "",
        });
        sendResponse({ ok: true, config });
        return;
      }

      if (message?.type === "WEBGPT_RESET_MY_INFO_CONFIG") {
        const config = await resetStoredMyInfoConfig();
        sendResponse({ ok: true, config });
        return;
      }

      if (message?.type === "WEBGPT_ATTACH_TO_TAB") {
        const result = await attachSessionToTab(
          message.tabId,
          message.targetTabId,
        );
        sendResponse({ ok: true, result });
        return;
      }

      if (message?.type === "WEBGPT_ATTACH_TO_ACTIVE_TAB") {
        const activeTabId = await getActiveTabId();
        const result = await attachSessionToTab(message.tabId, activeTabId);
        sendResponse({ ok: true, result });
        return;
      }

      if (message?.type === "WEBGPT_GET_TAB_SURFACE") {
        const tabId = message.tabId || (await getActiveTabId());
        const result = await detectSurfaceForTab(tabId);
        sendResponse({ ok: true, ...result });
        return;
      }

      if (message?.type === "WEBGPT_GET_GOOGLE_SHEETS_AUTH_STATUS") {
        const result = await getGoogleSheetsAuthStatus();
        sendResponse(result);
        return;
      }

      if (message?.type === "WEBGPT_CONNECT_GOOGLE_SHEETS") {
        const result = await connectGoogleSheets();
        sendResponse(result);
        return;
      }

      if (message?.type === "WEBGPT_GET_MICROSOFT_EXCEL_AUTH_STATUS") {
        const result = await getMicrosoftExcelAuthStatus();
        sendResponse(result);
        return;
      }

      if (message?.type === "WEBGPT_CONNECT_MICROSOFT_EXCEL") {
        const result = await connectMicrosoftExcel();
        sendResponse(result);
        return;
      }

      sendResponse({
        ok: false,
        error: `Unknown message type: ${message?.type || "undefined"}`,
      });
    })().catch((error) => {
      sendResponse({
        ok: false,
        error: error?.message || String(error),
      });
    });

    return true;
  });
}
