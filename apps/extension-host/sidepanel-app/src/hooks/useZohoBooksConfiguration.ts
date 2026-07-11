/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { sendToWorker } from "./useSavedArtifacts";

type ZohoDataCenterOption = {
  id: string;
  label: string;
  accountsUrl: string;
  apiDomain: string;
};

type ZohoBooksConfiguration = {
  dataCenter: string;
  dataCenterOptions: ZohoDataCenterOption[];
  accountsUrl: string;
  apiDomain: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  defaultScopes: string[];
  source: string;
  configured: boolean;
  redirectUri: string;
};

type ZohoBooksConfigResponse = {
  ok?: boolean;
  error?: string;
  config?: ZohoBooksConfiguration;
};

type ZohoBooksAuthStatus = {
  ok?: boolean;
  authenticated?: boolean;
  authStatus?: string;
  configMissing?: boolean;
  error?: string;
};

type LoadingAction = "refresh" | "save" | "reset" | "connect" | null;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function scopesToText(scopes: string[] = []) {
  return scopes.join(" ");
}

function normalizeDraftScopes(value: string) {
  return value.trim().split(/[\s,]+/g).filter(Boolean).join(" ");
}

export function useZohoBooksConfiguration() {
  const [config, setConfig] = useState<ZohoBooksConfiguration | null>(null);
  const [authStatus, setAuthStatus] = useState<ZohoBooksAuthStatus | null>(null);
  const [draftDataCenter, setDraftDataCenter] = useState("in");
  const [draftClientId, setDraftClientId] = useState("");
  const [draftClientSecret, setDraftClientSecret] = useState("");
  const [draftScopes, setDraftScopes] = useState("");
  const [error, setError] = useState("");
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);

  const applyConfig = useCallback((nextConfig: ZohoBooksConfiguration) => {
    setConfig(nextConfig);
    setDraftDataCenter(nextConfig.dataCenter || "in");
    setDraftClientId(nextConfig.clientId || "");
    setDraftClientSecret(nextConfig.clientSecret || "");
    setDraftScopes(scopesToText(nextConfig.scopes || nextConfig.defaultScopes));
    setError("");
  }, []);

  const refreshAuthStatus = useCallback(async () => {
    const response = await sendToWorker<ZohoBooksAuthStatus>({
      type: "WEBGPT_GET_ZOHO_BOOKS_AUTH_STATUS",
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to load Zoho Books auth.");
    }

    setAuthStatus(response);
    return response;
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      setLoadingAction("refresh");
      const response = await sendToWorker<ZohoBooksConfigResponse>({
        type: "WEBGPT_GET_ZOHO_BOOKS_CONFIG",
      });

      if (!response?.ok || !response.config) {
        throw new Error(response?.error || "Failed to load Zoho Books config.");
      }

      applyConfig(response.config);
      await refreshAuthStatus();
      return response.config;
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      return null;
    } finally {
      setLoadingAction(null);
    }
  }, [applyConfig, refreshAuthStatus]);

  const saveConfig = useCallback(async () => {
    try {
      setLoadingAction("save");
      const response = await sendToWorker<ZohoBooksConfigResponse>({
        type: "WEBGPT_SET_ZOHO_BOOKS_CONFIG",
        dataCenter: draftDataCenter,
        clientId: draftClientId,
        clientSecret: draftClientSecret,
        scopes: draftScopes,
      });

      if (!response?.ok || !response.config) {
        throw new Error(response?.error || "Failed to save Zoho Books config.");
      }

      applyConfig(response.config);
      await refreshAuthStatus();
      return response.config;
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      return null;
    } finally {
      setLoadingAction(null);
    }
  }, [applyConfig, draftClientId, draftClientSecret, draftDataCenter, draftScopes, refreshAuthStatus]);

  const resetConfig = useCallback(async () => {
    try {
      setLoadingAction("reset");
      const response = await sendToWorker<ZohoBooksConfigResponse>({
        type: "WEBGPT_RESET_ZOHO_BOOKS_CONFIG",
      });

      if (!response?.ok || !response.config) {
        throw new Error(response?.error || "Failed to reset Zoho Books config.");
      }

      applyConfig(response.config);
      await refreshAuthStatus();
      return response.config;
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      return null;
    } finally {
      setLoadingAction(null);
    }
  }, [applyConfig, refreshAuthStatus]);

  const connectZohoBooks = useCallback(async () => {
    try {
      setLoadingAction("connect");
      const response = await sendToWorker<ZohoBooksAuthStatus>({
        type: "WEBGPT_CONNECT_ZOHO_BOOKS",
      });

      if (!response?.ok || !response.authenticated) {
        throw new Error(response?.error || "Zoho Books authorization failed.");
      }

      setAuthStatus(response);
      setError("");
      return response;
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      await refreshAuthStatus().catch(() => null);
      return null;
    } finally {
      setLoadingAction(null);
    }
  }, [refreshAuthStatus]);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  const hasUnsavedChanges = useMemo(() => {
    return (
      draftDataCenter.trim() !== (config?.dataCenter || "in").trim() ||
      draftClientId.trim() !== (config?.clientId || "").trim() ||
      draftClientSecret.trim() !== (config?.clientSecret || "").trim() ||
      normalizeDraftScopes(draftScopes) !== scopesToText(config?.scopes || [])
    );
  }, [config?.clientId, config?.clientSecret, config?.dataCenter, config?.scopes, draftClientId, draftClientSecret, draftDataCenter, draftScopes]);

  return {
    config,
    authStatus,
    draftDataCenter,
    setDraftDataCenter,
    draftClientId,
    setDraftClientId,
    draftClientSecret,
    setDraftClientSecret,
    draftScopes,
    setDraftScopes,
    error,
    loadingAction,
    hasUnsavedChanges,
    refreshConfig,
    saveConfig,
    resetConfig,
    connectZohoBooks,
  };
}
