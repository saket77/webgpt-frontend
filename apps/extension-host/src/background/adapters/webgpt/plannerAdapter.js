import { resolveBackendBaseUrl } from "../../settings/backendConfig.js";
import { getMintAccess } from "../../settings/mintAccess.js";
import { createWebGptPlannerAdapter as createSharedWebGptPlannerAdapter } from "@webgpt-mundhada/planner-http-adapter";

export function createWebGptPlannerAdapter({ baseUrl } = {}) {
  const planner = createSharedWebGptPlannerAdapter({
    baseUrl,
    resolveBaseUrl: resolveBackendBaseUrl,
    resolveMintToken: async (url) => (await getMintAccess(url))?.token,
  });
  return {
    ...planner,
    startCommandRun(input) {
      return planner.startCommandRun(input.surface === "browser_dom" ? {
        ...input,
        browserContext: { ...input.browserContext, chromeStepLifecycle: 1 },
      } : input);
    },
  };
}

export const webgptPlannerAdapter = createWebGptPlannerAdapter();
