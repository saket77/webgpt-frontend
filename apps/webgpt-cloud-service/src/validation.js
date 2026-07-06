const SUPPORTED_MODE = "webgpt";
const SUPPORTED_EXECUTION = "browserbase";
const DEFAULT_TIMEOUT_MS = 120000;

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateCreateCloudRunRequest(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  if (!nonEmptyString(body.url)) {
    return { ok: false, error: "Missing required field: url." };
  }

  try {
    new URL(body.url);
  } catch {
    return { ok: false, error: "url must be an absolute URL." };
  }

  if (!nonEmptyString(body.goal)) {
    return { ok: false, error: "Missing required field: goal." };
  }

  const mode = body.mode === undefined ? SUPPORTED_MODE : body.mode;
  if (mode !== SUPPORTED_MODE) {
    return { ok: false, error: `Unsupported mode: ${String(mode)}.` };
  }

  const execution =
    body.execution === undefined ? SUPPORTED_EXECUTION : body.execution;
  if (execution !== SUPPORTED_EXECUTION) {
    return {
      ok: false,
      error: `Unsupported execution: ${String(execution)}.`,
    };
  }

  const timeoutMs =
    body.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : Number(body.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { ok: false, error: "timeoutMs must be a positive number." };
  }

  const autoConfirm =
    body.autoConfirm === undefined ? true : body.autoConfirm;
  if (typeof autoConfirm !== "boolean") {
    return { ok: false, error: "autoConfirm must be a boolean." };
  }

  return {
    ok: true,
    value: {
      url: body.url.trim(),
      goal: body.goal.trim(),
      mode,
      execution,
      timeoutMs,
      autoConfirm,
    },
  };
}
