import { defaultDatabasePath } from "./paths.js";

const DEFAULT_PORT = 3100;
const DEFAULT_BACKEND_URL = "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_ROUTINE_SCHEDULER_INTERVAL_MS = 60000;
const DEFAULT_NOTIFICATION_INTERVAL_MS = 15000;
const DEFAULT_GMAIL_TIMEOUT_MS = 15000;
const DEFAULT_GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

function readNumber(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readEmailProvider(env) {
  if (env.WEBGPT_EMAIL_PROVIDER) return String(env.WEBGPT_EMAIL_PROVIDER).trim();
  if (env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN) {
    return "gmail_api";
  }
  return "console";
}

export function readCloudServiceConfig(env = process.env) {
  const adminToken = String(env.WEBGPT_CLOUD_ADMIN_TOKEN || "");
  const nodeEnv = String(env.NODE_ENV || "development");

  if (nodeEnv === "production" && !adminToken) {
    throw new Error(
      "WEBGPT_CLOUD_ADMIN_TOKEN is required when NODE_ENV=production.",
    );
  }

  const host =
    env.WEBGPT_CLOUD_HOST || (adminToken ? "0.0.0.0" : "127.0.0.1");
  const emailProvider = readEmailProvider(env);
  const emailFrom =
    emailProvider === "gmail_api"
      ? env.WEBGPT_EMAIL_FROM || env.GMAIL_FROM || ""
      : env.WEBGPT_EMAIL_FROM || "WebGPT <notifications@localhost>";

  return {
    adminToken,
    backend: env.WEBGPT_BACKEND_URL || DEFAULT_BACKEND_URL,
    dbPath: env.WEBGPT_CLOUD_DB_PATH || defaultDatabasePath,
    emailFrom,
    emailProvider,
    host,
    logsDir: env.WEBGPT_CLOUD_LOGS_DIR || "",
    nodeEnv,
    notificationIntervalMs: readNumber(
      env.WEBGPT_NOTIFICATION_INTERVAL_MS,
      DEFAULT_NOTIFICATION_INTERVAL_MS,
    ),
    port: readNumber(env.WEBGPT_CLOUD_PORT || env.PORT, DEFAULT_PORT),
    projectId: env.BROWSERBASE_PROJECT_ID || "",
    gmailClientId: env.GMAIL_CLIENT_ID || "",
    gmailClientSecret: env.GMAIL_CLIENT_SECRET || "",
    gmailRefreshToken: env.GMAIL_REFRESH_TOKEN || "",
    gmailSendUrl: env.GMAIL_SEND_URL || DEFAULT_GMAIL_SEND_URL,
    gmailTimeoutMs: readNumber(env.GMAIL_TIMEOUT_MS, DEFAULT_GMAIL_TIMEOUT_MS),
    gmailTokenUrl: env.GMAIL_TOKEN_URL || DEFAULT_GMAIL_TOKEN_URL,
    routineSchedulerIntervalMs: readNumber(
      env.WEBGPT_ROUTINE_SCHEDULER_INTERVAL_MS,
      DEFAULT_ROUTINE_SCHEDULER_INTERVAL_MS,
    ),
    timeoutMs: readNumber(env.WEBGPT_CLOUD_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}
