import { createWebGptApiClient } from "./api.js";
import { createReplayPreflight } from "./replay.js";
import { buildBrowserContext, syncSessionWithRun } from "./runContext.js";

export function createWebGptPlannerAdapter({ baseUrl } = {}) {
  const apiClient = createWebGptApiClient({ baseUrl });
  const tryRunReplayPreflight = createReplayPreflight({
    postCommandResult: apiClient.postCommandResult,
  });

  return {
    buildBrowserContext,
    completeTemplateQueueItem: apiClient.completeTemplateQueueItem,
    confirmRunSuccess: apiClient.confirmRunSuccess,
    fetchArtifacts: apiClient.fetchArtifacts,
    getRun: apiClient.getRun,
    postCommandResult: apiClient.postCommandResult,
    provideHumanHint: apiClient.provideHumanHint,
    rejectRunSuccess: apiClient.rejectRunSuccess,
    saveSuccessfulArtifacts: apiClient.saveSuccessfulArtifacts,
    startCommandRun: apiClient.startCommandRun,
    startTemplateQueueCommand: apiClient.startTemplateQueueCommand,
    stopRun: apiClient.stopRun,
    syncSessionWithRun,
    tryRunReplayPreflight,
  };
}

export const webgptPlannerAdapter = createWebGptPlannerAdapter();
