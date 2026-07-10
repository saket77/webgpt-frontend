import { defaultDatabasePath } from "./paths.js";

const DEFAULT_PORT = 3100;
const DEFAULT_BACKEND_URL = "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_ROUTINE_SCHEDULER_INTERVAL_MS = 60000;
const DEFAULT_NOTIFICATION_INTERVAL_MS = 15000;
const DEFAULT_RESEND_TIMEOUT_MS = 15000;
const DEFAULT_SMTP_PORT = 465;
const DEFAULT_SMTP_TIMEOUT_MS = 15000;

function readNumber(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readEmailProvider(env) {
  if (env.WEBGPT_EMAIL_PROVIDER) return String(env.WEBGPT_EMAIL_PROVIDER).trim();
  if (env.RESEND_API_KEY) return "resend";
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) return "smtp";
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
  const smtpPort = readNumber(env.SMTP_PORT, DEFAULT_SMTP_PORT);
  const emailFrom =
    emailProvider === "smtp"
      ? env.WEBGPT_EMAIL_FROM || env.SMTP_USER || ""
      : env.WEBGPT_EMAIL_FROM ||
        env.RESEND_FROM ||
        "WebGPT <onboarding@resend.dev>";

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
    resendApiKey: env.RESEND_API_KEY || "",
    resendTimeoutMs: readNumber(env.RESEND_TIMEOUT_MS, DEFAULT_RESEND_TIMEOUT_MS),
    smtpHost: env.SMTP_HOST || "",
    smtpPass: env.SMTP_PASS || "",
    smtpPort,
    smtpSecure: readBoolean(env.SMTP_SECURE, smtpPort === 465),
    smtpTimeoutMs: readNumber(env.SMTP_TIMEOUT_MS, DEFAULT_SMTP_TIMEOUT_MS),
    smtpUser: env.SMTP_USER || "",
    routineSchedulerIntervalMs: readNumber(
      env.WEBGPT_ROUTINE_SCHEDULER_INTERVAL_MS,
      DEFAULT_ROUTINE_SCHEDULER_INTERVAL_MS,
    ),
    timeoutMs: readNumber(env.WEBGPT_CLOUD_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}
