/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { sendToWorker } from "./useSavedArtifacts";

declare const chrome: any;

type MyInfoConfiguration = {
  enabledForRuns: boolean;
  text: string;
};

type MyInfoConfigurationResponse = {
  ok?: boolean;
  error?: string;
  config?: MyInfoConfiguration;
};

type SessionResponse = {
  ok?: boolean;
  error?: string;
  session?: {
    runId?: string;
    running?: boolean;
    awaitingNavigation?: boolean;
    pausedReason?: string;
    pendingStep?: number | null;
    movedToTabId?: number | null;
  } | null;
};

type LoadingAction = "refresh" | "save" | "clear" | null;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRunActive(session: SessionResponse["session"]) {
  return Boolean(
    session?.running ||
      session?.awaitingNavigation ||
      session?.pausedReason ||
      session?.pendingStep,
  );
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  return typeof tab?.id === "number" ? tab.id : null;
}

export function useMyInfoConfiguration() {
  const [config, setConfig] = useState<MyInfoConfiguration | null>(null);
  const [draftEnabledForRuns, setDraftEnabledForRuns] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [runActive, setRunActive] = useState(false);
  const [error, setError] = useState("");
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);

  const applyConfig = useCallback((nextConfig: MyInfoConfiguration) => {
    setConfig(nextConfig);
    setDraftEnabledForRuns(Boolean(nextConfig.enabledForRuns));
    setDraftText(nextConfig.text || "");
    setError("");
  }, []);

  const refreshRunState = useCallback(async () => {
    const tabId = await getActiveTabId();
    if (tabId == null) {
      setRunActive(false);
      return false;
    }

    const response = await sendToWorker<SessionResponse>({
      type: "WEBGPT_GET_SESSION",
      tabId,
    });

    let session = response?.session || null;

    if (session?.movedToTabId) {
      const movedResponse = await sendToWorker<SessionResponse>({
        type: "WEBGPT_GET_SESSION",
        tabId: session.movedToTabId,
      });
      session = movedResponse?.session || session;
    }

    const active = isRunActive(session);
    setRunActive(active);
    return active;
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      setLoadingAction("refresh");

      const [response] = await Promise.all([
        sendToWorker<MyInfoConfigurationResponse>({
          type: "WEBGPT_GET_MY_INFO_CONFIG",
        }),
        refreshRunState(),
      ]);

      if (!response?.ok || !response.config) {
        throw new Error(response?.error || "Failed to load My Info.");
      }

      applyConfig(response.config);
      return response.config;
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      return null;
    } finally {
      setLoadingAction(null);
    }
  }, [applyConfig, refreshRunState]);

  const saveConfig = useCallback(async () => {
    try {
      setLoadingAction("save");
      await refreshRunState();

      const response = await sendToWorker<MyInfoConfigurationResponse>({
        type: "WEBGPT_SET_MY_INFO_CONFIG",
        enabledForRuns: draftEnabledForRuns,
        text: draftText,
      });

      if (!response?.ok || !response.config) {
        throw new Error(response?.error || "Failed to save My Info.");
      }

      applyConfig(response.config);
      return response.config;
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      return null;
    } finally {
      setLoadingAction(null);
    }
  }, [applyConfig, draftEnabledForRuns, draftText, refreshRunState]);

  const clearConfig = useCallback(async () => {
    try {
      setLoadingAction("clear");
      await refreshRunState();

      const response = await sendToWorker<MyInfoConfigurationResponse>({
        type: "WEBGPT_RESET_MY_INFO_CONFIG",
      });

      if (!response?.ok || !response.config) {
        throw new Error(response?.error || "Failed to clear My Info.");
      }

      applyConfig(response.config);
      return response.config;
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      return null;
    } finally {
      setLoadingAction(null);
    }
  }, [applyConfig, refreshRunState]);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshRunState();
    }, 2000);

    return () => window.clearInterval(timer);
  }, [refreshRunState]);

  const hasUnsavedChanges = useMemo(() => {
    return (
      draftEnabledForRuns !== Boolean(config?.enabledForRuns) ||
      draftText.trim() !== (config?.text || "").trim()
    );
  }, [config?.enabledForRuns, config?.text, draftEnabledForRuns, draftText]);

  return {
    config,
    draftEnabledForRuns,
    setDraftEnabledForRuns,
    draftText,
    setDraftText,
    runActive,
    error,
    loadingAction,
    hasUnsavedChanges,
    refreshConfig,
    refreshRunState,
    saveConfig,
    clearConfig,
  };
}
