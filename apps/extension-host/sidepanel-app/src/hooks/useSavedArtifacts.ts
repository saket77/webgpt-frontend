/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";

declare const chrome: any;

export async function sendToWorker<T = any>(message: any): Promise<T> {
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

export type SavedArtifactInputSchemaItem = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
};

export type SavedArtifactSummary = {
  goal: string;
  description: string;
  successfulReplayArtifactFileName: string | null;
  inputSchema: SavedArtifactInputSchemaItem[];
  createdAt: string;
  updatedAt: string;
};

export function useSavedArtifacts(autoLoad = true) {
  const [artifacts, setArtifacts] = useState<SavedArtifactSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await sendToWorker<{
        ok?: boolean;
        error?: string;
        artifacts?: SavedArtifactSummary[];
      }>({
        type: "WEBGPT_LIST_ARTIFACTS",
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Failed to load artifacts.");
      }

      setArtifacts(Array.isArray(response.artifacts) ? response.artifacts : []);
    } catch (err) {
      setArtifacts([]);
      setError(
        err instanceof Error ? err.message : "Failed to load artifacts.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!autoLoad) return;
    void refresh();
  }, [autoLoad, refresh]);

  return {
    artifacts,
    loading,
    error,
    refresh,
  };
}
