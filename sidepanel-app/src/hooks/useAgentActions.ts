/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback } from "react";
declare const chrome: any;

export type StartAgentRequest = {
  tabId: number;
  goal: string;
  artifactFileName?: string | null;
  inputValues?: Record<string, string[]>;
  isTemplate?: boolean;
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
