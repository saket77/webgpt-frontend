import { resolveBackendBaseUrl } from "../../settings/backendConfig.js";
import { createWebGptPlannerAdapter as createSharedWebGptPlannerAdapter } from "../../../../../../packages/planner-http-adapter/src/index.js";

export function createWebGptPlannerAdapter({ baseUrl } = {}) {
  return createSharedWebGptPlannerAdapter({
    baseUrl,
    resolveBaseUrl: resolveBackendBaseUrl,
  });
}

export const webgptPlannerAdapter = createWebGptPlannerAdapter();
