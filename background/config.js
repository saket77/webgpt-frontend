export const DEFAULT_API_BASE_URL =
  "https://webgpt-backend-production.up.railway.app";
export const BACKEND_BASE_URL_STORAGE_KEY = "webgpt_backend_base_url_v1";
export const MICROSOFT_EXCEL_CONFIG_STORAGE_KEY =
  "webgpt_microsoft_excel_config_v1";
export const MICROSOFT_EXCEL_TOKEN_STORAGE_KEY =
  "webgpt_microsoft_excel_auth_v1";

export const MAX_STEPS = 20;
export const POST_ACTION_STATE_SETTLE_MS = 1000;
export const POST_NAVIGATION_RESUME_SETTLE_MS = 1000;
export const MAX_EVENTS = 300;
export const STORAGE_KEY = "webgpt_sessions_by_tab_v1";

export const MICROSOFT_EXCEL_DEFAULT_SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "User.Read",
  "Files.ReadWrite",
];
