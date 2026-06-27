/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { sendToWorker } from "./useSavedArtifacts";

type BackendConfiguration = {
  baseUrl: string;
  source: string;
  overrideBaseUrl: string;
  defaultBaseUrl: string;
};

type BackendConfigurationResponse = {
  ok?: boolean;
  error?: string;
  config?: BackendConfiguration;
};

type LoadingAction = "refresh" | "save" | "reset" | "localhost" | null;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useBackendConfiguration() {
  const [config, setConfig] = useState<BackendConfiguration | null>(null);
  const [draftBaseUrl, setDraftBaseUrl] = useState("");
  const [error, setError] = useState("");
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);

  const applyConfig = useCallback((nextConfig: BackendConfiguration) => {
    setConfig(nextConfig);
    setDraftBaseUrl(nextConfig.baseUrl || "");
    setError("");
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      setLoadingAction("refresh");

      const response = await sendToWorker<BackendConfigurationResponse>({
        type: "WEBGPT_GET_BACKEND_CONFIG",
      });

      if (!response?.ok || !response.config) {
        throw new Error(response?.error || "Failed to load backend config.");
      }

      applyConfig(response.config);
      return response.config;
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      return null;
    } finally {
      setLoadingAction(null);
    }
  }, [applyConfig]);

  const saveConfig = useCallback(async (baseUrl = draftBaseUrl) => {
    try {
      setLoadingAction("save");

      const response = await sendToWorker<BackendConfigurationResponse>({
        type: "WEBGPT_SET_BACKEND_CONFIG",
        baseUrl,
      });

      if (!response?.ok || !response.config) {
        throw new Error(response?.error || "Failed to save backend config.");
      }

      applyConfig(response.config);
      return response.config;
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      return null;
    } finally {
      setLoadingAction(null);
    }
  }, [applyConfig, draftBaseUrl]);

  const useLocalhostConfig = useCallback(async () => {
    try {
      setLoadingAction("localhost");

      const response = await sendToWorker<BackendConfigurationResponse>({
        type: "WEBGPT_SET_BACKEND_CONFIG",
        baseUrl: "http://localhost:3000",
      });

      if (!response?.ok || !response.config) {
        throw new Error(response?.error || "Failed to save backend config.");
      }

      applyConfig(response.config);
      return response.config;
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      return null;
    } finally {
      setLoadingAction(null);
    }
  }, [applyConfig]);

  const resetConfig = useCallback(async () => {
    try {
      setLoadingAction("reset");

      const response = await sendToWorker<BackendConfigurationResponse>({
        type: "WEBGPT_RESET_BACKEND_CONFIG",
      });

      if (!response?.ok || !response.config) {
        throw new Error(response?.error || "Failed to reset backend config.");
      }

      applyConfig(response.config);
      return response.config;
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      return null;
    } finally {
      setLoadingAction(null);
    }
  }, [applyConfig]);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  const hasOverride = config?.source === "storage";

  const hasUnsavedChanges = useMemo(() => {
    return draftBaseUrl.trim() !== (config?.baseUrl || "").trim();
  }, [config?.baseUrl, draftBaseUrl]);

  return {
    config,
    draftBaseUrl,
    setDraftBaseUrl,
    error,
    loadingAction,
    hasOverride,
    hasUnsavedChanges,
    refreshConfig,
    saveConfig,
    useLocalhostConfig,
    resetConfig,
  };
}
