import { resolveBackendBaseUrl } from "../../settings/backendConfig.js";
import { createWebGptPlannerAdapter as createSharedWebGptPlannerAdapter } from "@webgpt/planner-http-adapter";

export function createWebGptPlannerAdapter({ baseUrl } = {}) {
  return createSharedWebGptPlannerAdapter({
    baseUrl,
    resolveBaseUrl: resolveBackendBaseUrl,
  });
}

export const webgptPlannerAdapter = createWebGptPlannerAdapter();
