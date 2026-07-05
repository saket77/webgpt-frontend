import { useEffect, useRef } from "react";
import type { SavedArtifactSummary } from "./useSavedArtifacts";

export type RunLaunchRequest = {
  mode?: "normal" | "template";
  goal?: string;
  artifactFileName?: string | null;
  artifact?: SavedArtifactSummary | null;
  autoStart?: boolean;
  source?: "saved-artifact";
  inputValues?: Record<string, string[]>;
};

type UseAgentLaunchRequestArgs = {
  launchRequest?: RunLaunchRequest | null;
  onLaunchRequestHandled?: () => void;
  applyLaunchRequest: (request: RunLaunchRequest) => void;
  autoStartLaunchRequest?: (request: RunLaunchRequest) => Promise<void>;
};

export function useAgentLaunchRequest({
  launchRequest,
  onLaunchRequestHandled,
  applyLaunchRequest,
  autoStartLaunchRequest,
}: UseAgentLaunchRequestArgs) {
  const handledKeyRef = useRef<string>("");

  useEffect(() => {
    if (!launchRequest) return;

    const key = JSON.stringify({
      mode: launchRequest.mode || "normal",
      goal: launchRequest.goal || "",
      artifactFileName: launchRequest.artifactFileName || "",
      successfulReplayArtifactFileName:
        launchRequest.artifact?.successfulReplayArtifactFileName || "",
      autoStart: Boolean(launchRequest.autoStart),
      source: launchRequest.source || "",
      inputValues: launchRequest.inputValues || {},
    });

    if (handledKeyRef.current === key) {
      return;
    }

    handledKeyRef.current = key;
    applyLaunchRequest(launchRequest);

    if (launchRequest.autoStart && autoStartLaunchRequest) {
      void autoStartLaunchRequest(launchRequest);
    }

    onLaunchRequestHandled?.();
  }, [
    launchRequest,
    onLaunchRequestHandled,
    applyLaunchRequest,
    autoStartLaunchRequest,
  ]);
}
