/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback } from "react";
declare const chrome: any;

export type ProfileAttachmentRole = "resume" | "cover_letter";

export type AttachmentPayload = {
  name: string;
  mimeType: string;
  size: number;
  role?: ProfileAttachmentRole;
  purpose?: "auto" | "profile";
  contentBase64: string;
};

export type ProfileAttachmentPayload = AttachmentPayload & {
  role: ProfileAttachmentRole;
};

export type StartAgentRequest = {
  tabId: number;
  goal: string;
  artifactFileName?: string | null;
  inputValues?: Record<string, string[]>;
  isTemplate?: boolean;
  surface?: string;
  attachments?: AttachmentPayload[];
  profileAttachments?: ProfileAttachmentPayload[];
};

async function sendToWorker<T = any>(message: any): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

export function useAgentActions() {
  const startRun = useCallback(
    async ({
      tabId,
      goal,
      artifactFileName,
      inputValues,
      isTemplate,
      surface,
      attachments,
      profileAttachments,
    }: StartAgentRequest) => {
      return sendToWorker<{
        ok?: boolean;
        error?: string;
      }>({
        type: "WEBGPT_START_AGENT",
        tabId,
        goal,
        artifactFileName: artifactFileName || null,
        inputValues: inputValues || {},
        isTemplate: isTemplate || false,
        surface: surface || "",
        attachments: attachments || [],
        profileAttachments: profileAttachments || [],
      });
    },
    [],
  );

  const stopRun = useCallback(async (tabId: number) => {
    return sendToWorker<{
      ok?: boolean;
      error?: string;
    }>({
      type: "WEBGPT_STOP_AGENT",
      tabId,
    });
  }, []);

  const acceptSuccess = useCallback(async (tabId: number) => {
    return sendToWorker<{
      ok?: boolean;
      error?: string;
      result?: {
        completed?: boolean;
        summary?: string;
        finalResult?: any;
      };
    }>({
      type: "WEBGPT_CONFIRM_SUCCESS",
      tabId,
    });
  }, []);
  const sendHumanHint = useCallback(async (tabId: number, hint: string) => {
    return sendToWorker<{
      ok?: boolean;
      error?: string;
    }>({
      type: "WEBGPT_PROVIDE_HINT",
      tabId,
      hint,
    });
  }, []);

  return {
    startRun,
    stopRun,
    acceptSuccess,
    sendHumanHint,
  };
}
