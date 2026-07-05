export {
  createControllerCore,
  createControllerCore as createController,
} from "./controller/index.js";
export { configureControllerCorePorts } from "./ports.js";
export { configureControllerCoreConfig } from "./config.js";
export {
  BROWSER_DOM_SURFACE,
  GOOGLE_SHEETS_SURFACE,
  MICROSOFT_EXCEL_SURFACE,
  normalizeSurface,
} from "./runtime/surfaces.js";
export { getEmptySession } from "./state/sessionStore.js";
