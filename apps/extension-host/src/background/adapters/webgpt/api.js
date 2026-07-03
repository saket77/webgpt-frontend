import { resolveBackendBaseUrl } from "../../settings/backendConfig.js";
import { createWebGptApiClient as createSharedWebGptApiClient } from "../../../../../../packages/planner-http-adapter/src/index.js";

export function createWebGptApiClient({ baseUrl } = {}) {
  return createSharedWebGptApiClient({
    baseUrl,
    resolveBaseUrl: resolveBackendBaseUrl,
  });
}

export const webgptApiClient = createWebGptApiClient();

export const {
  completeTemplateQueueItem,
  confirmRunSuccess,
  fetchArtifacts,
  getRun,
  postCommandResult,
  provideHumanHint,
  rejectRunSuccess,
  saveSuccessfulArtifacts,
  startCommandRun,
  startTemplateQueueCommand,
  stopRun,
} = webgptApiClient;
