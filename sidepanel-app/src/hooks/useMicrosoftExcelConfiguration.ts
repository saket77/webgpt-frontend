/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { sendToWorker } from "./useSavedArtifacts";

type MicrosoftExcelConfiguration = {
  tenantId: string;
  clientId: string;
  scopes: string[];
  defaultScopes: string[];
  source: string;
  configured: boolean;
  redirectUri: string;
};

type MicrosoftExcelConfigResponse = {
  ok?: boolean;
  error?: string;
  config?: MicrosoftExcelConfiguration;
};

type MicrosoftExcelAuthStatus = {
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

export function useMicrosoftExcelConfiguration() {
  const [config, setConfig] = useState<MicrosoftExcelConfiguration | null>(null);
  const [authStatus, setAuthStatus] = useState<MicrosoftExcelAuthStatus | null>(
    null,
  );
  const [draftTenantId, setDraftTenantId] = useState("");
  const [draftClientId, setDraftClientId] = useState("");
  const [draftScopes, setDraftScopes] = useState("");
  const [error, setError] = useState("");
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);

  const applyConfig = useCallback((nextConfig: MicrosoftExcelConfiguration) => {
    setConfig(nextConfig);
    setDraftTenantId(nextConfig.tenantId || "");
    setDraftClientId(nextConfig.clientId || "");
    setDraftScopes(scopesToText(nextConfig.scopes || nextConfig.defaultScopes));
    setError("");
  }, []);

  const refreshAuthStatus = useCallback(async () => {
    const response = await sendToWorker<MicrosoftExcelAuthStatus>({
      type: "WEBGPT_GET_MICROSOFT_EXCEL_AUTH_STATUS",
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to load Microsoft Excel auth.");
    }

    setAuthStatus(response);
    return response;
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      setLoadingAction("refresh");

      const response = await sendToWorker<MicrosoftExcelConfigResponse>({
        type: "WEBGPT_GET_MICROSOFT_EXCEL_CONFIG",
      });

      if (!response?.ok || !response.config) {
        throw new Error(response?.error || "Failed to load Microsoft Excel config.");
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

      const response = await sendToWorker<MicrosoftExcelConfigResponse>({
        type: "WEBGPT_SET_MICROSOFT_EXCEL_CONFIG",
        tenantId: draftTenantId,
        clientId: draftClientId,
        scopes: draftScopes,
      });

      if (!response?.ok || !response.config) {
        throw new Error(response?.error || "Failed to save Microsoft Excel config.");
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
  }, [applyConfig, draftClientId, draftScopes, draftTenantId, refreshAuthStatus]);

  const resetConfig = useCallback(async () => {
    try {
      setLoadingAction("reset");

      const response = await sendToWorker<MicrosoftExcelConfigResponse>({
        type: "WEBGPT_RESET_MICROSOFT_EXCEL_CONFIG",
      });

      if (!response?.ok || !response.config) {
        throw new Error(response?.error || "Failed to reset Microsoft Excel config.");
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

  const connectMicrosoftExcel = useCallback(async () => {
    try {
      setLoadingAction("connect");

      const response = await sendToWorker<MicrosoftExcelAuthStatus>({
        type: "WEBGPT_CONNECT_MICROSOFT_EXCEL",
      });

      if (!response?.ok || !response.authenticated) {
        throw new Error(response?.error || "Microsoft Excel authorization failed.");
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
      draftTenantId.trim() !== (config?.tenantId || "").trim() ||
      draftClientId.trim() !== (config?.clientId || "").trim() ||
      normalizeDraftScopes(draftScopes) !== scopesToText(config?.scopes || [])
    );
  }, [config?.clientId, config?.scopes, config?.tenantId, draftClientId, draftScopes, draftTenantId]);

  return {
    config,
    authStatus,
    draftTenantId,
    setDraftTenantId,
    draftClientId,
    setDraftClientId,
    draftScopes,
    setDraftScopes,
    error,
    loadingAction,
    hasUnsavedChanges,
    refreshConfig,
    saveConfig,
    resetConfig,
    connectMicrosoftExcel,
  };
}
