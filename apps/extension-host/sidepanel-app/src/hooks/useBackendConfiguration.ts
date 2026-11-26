/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { sendToWorker } from "./useSavedArtifacts";

type BackendConfiguration = {
  baseUrl: string;
  source: string;
  overrideBaseUrl: string;
  defaultBaseUrl: string;
  mintTokenConfigured: boolean;
  mintTokenProvisioned?: boolean;
};

type BackendConfigurationResponse = {
  ok?: boolean;
  error?: string;
  config?: BackendConfiguration;
};

type LoadingAction = "refresh" | "save" | "reset" | "localhost" | "saveMint" | "removeMint" | null;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function supportsLocalMint(baseUrl?: string) {
  if (!baseUrl) return false;
  try {
    const url = new URL(baseUrl);
    return url.protocol === "http:" &&
      ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) &&
      !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function useBackendConfiguration() {
  const [config, setConfig] = useState<BackendConfiguration | null>(null);
  const [draftBaseUrl, setDraftBaseUrl] = useState("");
  const [draftMintToken, setDraftMintToken] = useState("");
  const [error, setError] = useState("");
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);

  const applyConfig = useCallback((nextConfig: BackendConfiguration) => {
    setConfig(nextConfig);
    setDraftBaseUrl(nextConfig.baseUrl || "");
    setDraftMintToken("");
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

  const updateMintToken = useCallback(async (token: string) => {
    if (!config || !supportsLocalMint(config.baseUrl)) return null;

    try {
      setLoadingAction(token ? "saveMint" : "removeMint");
      const response = await sendToWorker<BackendConfigurationResponse>({
        type: "WEBGPT_SET_LOCAL_MINT_TOKEN",
        baseUrl: config.baseUrl,
        token,
      });
      if (!response?.ok || !response.config) {
        throw new Error(response?.error || "Failed to update the local mint token.");
      }
      applyConfig(response.config);
      return response.config;
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      return null;
    } finally {
      setDraftMintToken("");
      setLoadingAction(null);
    }
  }, [applyConfig, config]);

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
    draftMintToken,
    setDraftMintToken,
    error,
    loadingAction,
    hasOverride,
    hasUnsavedChanges,
    supportsLocalMint: supportsLocalMint(config?.baseUrl),
    refreshConfig,
    saveConfig,
    useLocalhostConfig,
    resetConfig,
    updateMintToken,
  };
}
