import { validateCreateCloudRunRequest } from "./validation.js";
import { getRoutineTemplate } from "./templates.js";
import { computeNextDailyRunAt, validateDailySchedule } from "./schedule.js";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeWorkflow(workflow) {
  if (!isObject(workflow)) {
    return { ok: false, error: "workflow must be an object." };
  }

  const type = workflow.type || "cloud_run";
  if (type !== "cloud_run" && type !== "supported_workflow") {
    return {
      ok: false,
      error: "Only cloud_run and supported_workflow workflows are supported in v0.",
    };
  }

  const validation = validateCreateCloudRunRequest(workflow);
  if (!validation.ok) return validation;

  if (type === "supported_workflow") {
    const templateId = String(workflow.templateId || "").trim();
    const strategy = String(workflow.strategy || "").trim();

    if (templateId !== "ipo_gmp_daily") {
      return {
        ok: false,
        error: `Unsupported supported_workflow templateId: ${templateId || "(missing)"}.`,
      };
    }

    if (strategy !== "deterministic_then_browserbase") {
      return {
        ok: false,
        error: `Unsupported supported_workflow strategy: ${strategy || "(missing)"}.`,
      };
    }

    return {
      ok: true,
      value: {
        type: "supported_workflow",
        templateId,
        strategy,
        ...validation.value,
        filters: isObject(workflow.filters) ? { ...workflow.filters } : {},
      },
    };
  }

  return {
    ok: true,
    value: {
      type: "cloud_run",
      ...validation.value,
    },
  };
}

function normalizeNotification(notification) {
  if (notification === undefined) return { ok: true, value: null };
  if (notification === null) return { ok: true, value: null };
  if (!isObject(notification)) {
    return { ok: false, error: "notification must be an object or null." };
  }

  if (notification.type !== "email") {
    return { ok: false, error: "Only email notifications are supported in v0." };
  }

  if (!Array.isArray(notification.to) || notification.to.length === 0) {
    return { ok: false, error: "notification.to must include at least one email." };
  }

  const to = notification.to.map((email) => String(email || "").trim()).filter(Boolean);
  if (to.length !== notification.to.length) {
    return { ok: false, error: "notification.to contains an empty email." };
  }

  return {
    ok: true,
    value: {
      type: "email",
      to,
    },
  };
}

function normalizeSchedule(schedule) {
  if (schedule === undefined) return { ok: true, value: null };
  if (schedule === null) return { ok: true, value: null };
  return validateDailySchedule(schedule);
}

export function validateCreateRoutineRequest(body = {}, { now = new Date() } = {}) {
  if (!isObject(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const templateId = body.templateId === undefined ? "" : String(body.templateId || "").trim();
  const template = templateId ? getRoutineTemplate(templateId) : null;
  if (templateId && !template) {
    return { ok: false, error: `Unknown routine template: ${templateId}.` };
  }

  let workflowInput = body.workflow;
  if (template) {
    workflowInput = {
      ...template.workflow,
      ...(isObject(body.workflow) ? body.workflow : {}),
    };
  }

  if (!workflowInput) {
    return {
      ok: false,
      error: "workflow is required when templateId is not provided.",
    };
  }

  const workflow = normalizeWorkflow(workflowInput);
  if (!workflow.ok) return workflow;

  const schedule = normalizeSchedule(body.schedule);
  if (!schedule.ok) return schedule;

  const notification = normalizeNotification(body.notification);
  if (!notification.ok) return notification;

  const enabled = body.enabled === undefined ? true : body.enabled;
  if (typeof enabled !== "boolean") {
    return { ok: false, error: "enabled must be a boolean." };
  }

  const name = nonEmptyString(body.name)
    ? body.name.trim()
    : template?.name || "Custom WebGPT routine";

  return {
    ok: true,
    value: {
      templateId: templateId || "",
      name,
      enabled,
      schedule: schedule.value,
      workflow: workflow.value,
      notification: notification.value,
      nextRunAt:
        enabled && schedule.value
          ? computeNextDailyRunAt(schedule.value, { now })
          : null,
    },
  };
}

export function validatePatchRoutineRequest(body = {}, existingRoutine, { now = new Date() } = {}) {
  if (!isObject(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const supported = ["enabled", "name", "schedule", "workflow", "notification"];
  const unknown = Object.keys(body).filter((key) => !supported.includes(key));
  if (unknown.length > 0) {
    return { ok: false, error: `Unsupported routine field: ${unknown[0]}.` };
  }

  if (Object.keys(body).length === 0) {
    return { ok: false, error: "At least one routine field is required." };
  }

  const patch = {};

  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") {
      return { ok: false, error: "enabled must be a boolean." };
    }
    patch.enabled = body.enabled;
  }

  if ("name" in body) {
    if (!nonEmptyString(body.name)) {
      return { ok: false, error: "name must be a non-empty string." };
    }
    patch.name = body.name.trim();
  }

  if ("workflow" in body) {
    const workflow = normalizeWorkflow(body.workflow);
    if (!workflow.ok) return workflow;
    patch.workflow = workflow.value;
  }

  if ("schedule" in body) {
    const schedule = normalizeSchedule(body.schedule);
    if (!schedule.ok) return schedule;
    patch.schedule = schedule.value;
  }

  if ("notification" in body) {
    const notification = normalizeNotification(body.notification);
    if (!notification.ok) return notification;
    patch.notification = notification.value;
  }

  const nextEnabled =
    patch.enabled !== undefined ? patch.enabled : Boolean(existingRoutine.enabled);
  const nextSchedule =
    patch.schedule !== undefined ? patch.schedule : existingRoutine.schedule;
  patch.nextRunAt =
    nextEnabled && nextSchedule
      ? computeNextDailyRunAt(nextSchedule, { now })
      : null;

  return { ok: true, value: patch };
}
