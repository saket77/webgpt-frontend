import { createServer } from "node:http";
import { validateCreateCloudRunRequest } from "./validation.js";
import { listRoutineTemplates } from "./templates.js";
import {
  validateCreateRoutineRequest,
  validatePatchRoutineRequest,
} from "./routineValidation.js";

const JSON_LIMIT_BYTES = 1024 * 1024;

function sendJson(res, statusCode, body, headers = {}) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > JSON_LIMIT_BYTES) {
        reject(Object.assign(new Error("Request body too large."), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readRequestBody(req);
  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), {
      statusCode: 400,
    });
  }
}

function bearerAuthorized(req, adminToken) {
  if (!adminToken) return true;
  return req.headers.authorization === `Bearer ${adminToken}`;
}

function parseUrl(req) {
  return new URL(req.url || "/", "http://webgpt-cloud-service.local");
}

function parseEventLimit(url) {
  const raw = url.searchParams.get("eventLimit");
  if (raw === null || raw === "") return undefined;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
}

function cloudRunResponseOptions(url) {
  const eventMode = url.searchParams.get("events");

  return {
    eventLimit: eventMode === "none" ? 0 : parseEventLimit(url),
    includeEventPayload:
      eventMode === "full" ||
      url.searchParams.get("debug") === "1" ||
      url.searchParams.get("includeEventPayload") === "1",
  };
}

export function createCloudRunHttpHandler({ store, queue, config }) {
  return async function cloudRunHttpHandler(req, res) {
    try {
      if (!bearerAuthorized(req, config.adminToken)) {
        sendJson(
          res,
          401,
          { ok: false, error: "Missing or invalid bearer token." },
          { "www-authenticate": "Bearer" },
        );
        return;
      }

      const url = parseUrl(req);

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, {
          ok: true,
          service: "webgpt-cloud-service",
          sqlite: true,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/routine-templates") {
        sendJson(res, 200, {
          ok: true,
          templates: listRoutineTemplates(),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/cloud-runs") {
        const body = await readJson(req);
        const validation = validateCreateCloudRunRequest(body);
        if (!validation.ok) {
          sendJson(res, 400, { ok: false, error: validation.error });
          return;
        }

        const row = store.createRun(validation.value);
        queue.enqueue();

        sendJson(res, 202, {
          ...store.getRunForApi(row.id),
          links: { self: `/cloud-runs/${row.id}` },
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/routines") {
        sendJson(res, 200, {
          ok: true,
          routines: store.listRoutines(),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/routines") {
        const body = await readJson(req);
        const validation = validateCreateRoutineRequest(body);
        if (!validation.ok) {
          sendJson(res, 400, { ok: false, error: validation.error });
          return;
        }

        const routine = store.createRoutine(validation.value);
        sendJson(res, 201, { ok: true, routine });
        return;
      }

      const routineTriggerMatch = url.pathname.match(/^\/routines\/([^/]+)\/trigger$/);
      if (req.method === "POST" && routineTriggerMatch) {
        const routineId = decodeURIComponent(routineTriggerMatch[1]);
        const result = store.triggerRoutine(routineId, { triggeredBy: "manual" });
        if (!result) {
          sendJson(res, 404, { ok: false, error: "Routine not found." });
          return;
        }

        queue.enqueue();
        sendJson(res, 202, {
          ok: true,
          trigger: result.trigger,
          cloudRun: {
            ...result.cloudRun,
            links: { self: `/cloud-runs/${result.cloudRun.id}` },
          },
          notification: result.notification,
        });
        return;
      }

      const routineTriggersMatch = url.pathname.match(/^\/routines\/([^/]+)\/triggers$/);
      if (req.method === "GET" && routineTriggersMatch) {
        const routineId = decodeURIComponent(routineTriggersMatch[1]);
        const routine = store.getRoutine(routineId);
        if (!routine) {
          sendJson(res, 404, { ok: false, error: "Routine not found." });
          return;
        }

        sendJson(res, 200, {
          ok: true,
          routineId,
          triggers: store.listRoutineTriggers(routineId),
        });
        return;
      }

      const routineMatch = url.pathname.match(/^\/routines\/([^/]+)$/);
      if (routineMatch) {
        const routineId = decodeURIComponent(routineMatch[1]);
        const routine = store.getRoutine(routineId);
        if (!routine) {
          sendJson(res, 404, { ok: false, error: "Routine not found." });
          return;
        }

        if (req.method === "GET") {
          sendJson(res, 200, { ok: true, routine });
          return;
        }

        if (req.method === "PATCH") {
          const body = await readJson(req);
          const validation = validatePatchRoutineRequest(body, routine);
          if (!validation.ok) {
            sendJson(res, 400, { ok: false, error: validation.error });
            return;
          }

          sendJson(res, 200, {
            ok: true,
            routine: store.updateRoutine(routineId, validation.value),
          });
          return;
        }
      }

      const match = url.pathname.match(/^\/cloud-runs\/([^/]+)$/);
      if (req.method === "GET" && match) {
        const run = store.getRunForApi(
          decodeURIComponent(match[1]),
          cloudRunResponseOptions(url),
        );
        if (!run) {
          sendJson(res, 404, { ok: false, error: "Cloud run not found." });
          return;
        }

        sendJson(res, 200, run);
        return;
      }

      sendJson(res, 404, { ok: false, error: "Not found." });
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }

      sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error?.message || "Internal server error.",
      });
    }
  };
}

export function createCloudRunHttpServer(options) {
  return createServer(createCloudRunHttpHandler(options));
}
