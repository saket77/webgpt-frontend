import {
  BROWSER_DOM_SURFACE,
  GOOGLE_SHEETS_SURFACE,
  MICROSOFT_EXCEL_SURFACE,
  normalizeSurface,
} from "../../runtime/surfaces.js";

const WEBGPT_HOST_ORIGINS = ["http://*/*", "https://*/*"];

async function hasBrowserHostAccess() {
  return chrome.permissions.contains({
    origins: WEBGPT_HOST_ORIGINS,
  });
}

function replayBatchSurface(replaySteps = []) {
  const steps = Array.isArray(replaySteps) ? replaySteps : [];
  const hasGoogleSheetsStep = steps.some(
    (step) =>
      step?.surface === GOOGLE_SHEETS_SURFACE ||
      step?.command?.surface === GOOGLE_SHEETS_SURFACE,
  );
  const hasMicrosoftExcelStep = steps.some(
    (step) =>
      step?.surface === MICROSOFT_EXCEL_SURFACE ||
      step?.command?.surface === MICROSOFT_EXCEL_SURFACE,
  );
  const hasDomStep = steps.some((step) => step?.action?.type);

  if (hasGoogleSheetsStep && !hasMicrosoftExcelStep && !hasDomStep) {
    return GOOGLE_SHEETS_SURFACE;
  }

  if (hasMicrosoftExcelStep && !hasGoogleSheetsStep && !hasDomStep) {
    return MICROSOFT_EXCEL_SURFACE;
  }

  return BROWSER_DOM_SURFACE;
}

function commandSurface(command, session) {
  if (!command || command.type === "done" || command.type === "ask_human") {
    return "";
  }

  if (command.type === "wait_for_navigation") {
    return "";
  }

  if (
    command.type === "extract_state" ||
    command.type === "navigation_completed"
  ) {
    return (
      normalizeSurface(command.surface) ||
      normalizeSurface(session?.surface) ||
      BROWSER_DOM_SURFACE
    );
  }

  if (command.type === "run_google_sheets_commands") {
    return GOOGLE_SHEETS_SURFACE;
  }

  if (command.type === "run_microsoft_excel_commands") {
    return MICROSOFT_EXCEL_SURFACE;
  }

  if (command.type === "run_replay_batch") {
    return replayBatchSurface(command.batch?.steps);
  }

  return BROWSER_DOM_SURFACE;
}

function surfaceLabel(surface) {
  if (surface === GOOGLE_SHEETS_SURFACE) return "Google Sheets";
  if (surface === MICROSOFT_EXCEL_SURFACE) return "Microsoft Excel";
  return "website";
}

export async function getMissingCommandAccess(command, session, runtime) {
  const surface = commandSurface(command, session);
  if (!surface) return null;

  if (surface === BROWSER_DOM_SURFACE) {
    if (await hasBrowserHostAccess()) return null;

    return {
      surface,
      reason: "missing_browser_host_access",
      message: "Website access is required before continuing.",
    };
  }

  const authStatus =
    surface === GOOGLE_SHEETS_SURFACE
      ? await runtime.getGoogleSheetsAuthStatus?.()
      : await runtime.getMicrosoftExcelAuthStatus?.();

  if (authStatus?.authenticated) return null;

  return {
    surface,
    reason: authStatus?.configMissing
      ? "surface_auth_config_missing"
      : "surface_auth_required",
    message:
      authStatus?.error ||
      `${surfaceLabel(surface)} access is required before continuing.`,
  };
}
