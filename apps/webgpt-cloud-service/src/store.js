import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const RUN_COLUMNS = [
  "id",
  "status",
  "mode",
  "execution",
  "url",
  "goal",
  "request_json",
  "result_json",
  "error_message",
  "browserbase_session_id",
  "live_view_url",
  "session_url",
  "planner_run_id",
  "event_log_path",
  "summary",
  "progress_message",
  "progress_updated_at",
  "source_type",
  "source_id",
  "created_at",
  "started_at",
  "session_ready_at",
  "completed_at",
];

const UPDATE_COLUMNS = new Set(RUN_COLUMNS.filter((column) => column !== "id"));
const DEFAULT_EVENT_LIMIT = 25;
const MAX_EVENT_LIMIT = 100;

function nowIso() {
  return new Date().toISOString();
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function fromJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeRunId(id = "") {
  return String(id || "").trim();
}

function progressMessageForStatus(row) {
  if (row.progress_message) return row.progress_message;
  if (row.status === "queued") return "Cloud run queued.";
  if (row.status === "running") return "Cloud run running.";
  if (row.status === "completed") return "Cloud run completed.";
  if (row.status === "failed") return row.error_message || "Cloud run failed.";
  return "";
}

function assignIfPresent(target, source, key) {
  if (!source || source[key] === undefined || source[key] === null || source[key] === "") {
    return;
  }
  target[key] = source[key];
}

function compactEventPayload(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;

  const preview = {};
  for (const key of [
    "timestamp",
    "tabId",
    "kind",
    "step",
    "surface",
    "surfaceContextId",
    "url",
    "title",
    "plannerStatus",
    "commandSurface",
    "nextSurface",
    "nextCommandType",
    "nextCommandReason",
    "reason",
    "message",
    "summary",
    "plannerSummary",
    "controlsCount",
    "scrollableContainersCount",
    "frameCount",
    "primaryFrameId",
    "plannerRunId",
    "eventLogPath",
    "notificationId",
  ]) {
    assignIfPresent(preview, event, key);
  }

  if (Array.isArray(event.actions) && event.actions.length > 0) {
    preview.actions = event.actions.slice(0, 5).map((action) => {
      const actionPreview = {};
      for (const key of ["actionType", "targetId", "url", "key", "frameId"]) {
        assignIfPresent(actionPreview, action, key);
      }
      return actionPreview;
    });
  }

  if (event.finalResult) preview.hasFinalResult = true;
  if (event.saveResult) preview.artifactsSaved = true;

  return Object.keys(preview).length > 0 ? preview : null;
}

function rowToProgressEvent(row, { includeEventPayload = false } = {}) {
  const eventPayload = fromJson(row.event_json, null);
  const event = {
    id: row.id,
    kind: row.kind,
    message: row.message || "",
    createdAt: row.created_at,
  };

  if (includeEventPayload) {
    event.event = eventPayload;
  } else {
    const eventPreview = compactEventPayload(eventPayload);
    if (eventPreview) event.eventPreview = eventPreview;
  }

  return event;
}

export function createCloudRunId() {
  return `cloud_run_${randomUUID()}`;
}

export function createRoutineId() {
  return `routine_${randomUUID()}`;
}

export function createRoutineTriggerId() {
  return `routine_trigger_${randomUUID()}`;
}

function rowToRoutine(row) {
  if (!row) return null;

  return {
    ok: true,
    id: row.id,
    templateId: row.template_id || "",
    name: row.name,
    enabled: Boolean(row.enabled),
    schedule: fromJson(row.schedule_json, null),
    workflow: fromJson(row.workflow_json, null),
    notification: fromJson(row.notification_json, null),
    nextRunAt: row.next_run_at || null,
    lastTriggeredAt: row.last_triggered_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at || null,
  };
}

function rowToRoutineTrigger(row) {
  if (!row) return null;

  return {
    ok: true,
    id: row.id,
    routineId: row.routine_id,
    cloudRunId: row.cloud_run_id || "",
    triggeredBy: row.triggered_by,
    status: row.status,
    dueAt: row.due_at || null,
    error: row.error_message ? { message: row.error_message } : null,
    createdAt: row.created_at,
    completedAt: row.completed_at || null,
  };
}

function rowToNotification(row) {
  if (!row) return null;

  return {
    id: row.id,
    routineId: row.routine_id,
    triggerId: row.trigger_id,
    cloudRunId: row.cloud_run_id,
    status: row.status,
    transport: row.transport,
    to: fromJson(row.to_json, []),
    subject: row.subject || "",
    bodyText: row.body_text || "",
    attempts: row.attempts || 0,
    lastError: row.last_error || "",
    createdAt: row.created_at,
    sentAt: row.sent_at || null,
    updatedAt: row.updated_at,
  };
}

export function rowToCloudRun(row, events = [], { includeEventPayload = false } = {}) {
  if (!row) return null;

  const resultJson = fromJson(row.result_json, null);
  const progressEvents = events.map((event) =>
    rowToProgressEvent(event, { includeEventPayload }),
  );

  return {
    ok: true,
    id: row.id,
    status: row.status,
    mode: row.mode,
    execution: row.execution,
    url: row.url,
    goal: row.goal,
    browserbaseSessionId: row.browserbase_session_id || "",
    liveViewUrl: row.live_view_url || "",
    sessionUrl: row.session_url || "",
    plannerRunId: row.planner_run_id || "",
    eventLogPath: row.event_log_path || "",
    summary: row.summary || "",
    finalResult: resultJson?.finalResult ?? null,
    error: row.error_message ? { message: row.error_message } : null,
    progress: {
      message: progressMessageForStatus(row),
      updatedAt: row.progress_updated_at || null,
      eventsMode: includeEventPayload ? "full" : "compact",
      events: progressEvents,
    },
    source: {
      type: row.source_type || "one_off",
      id: row.source_id || "",
    },
    createdAt: row.created_at,
    startedAt: row.started_at || null,
    sessionReadyAt: row.session_ready_at || null,
    completedAt: row.completed_at || null,
  };
}

export class CloudRunStore {
  constructor({ dbPath, database } = {}) {
    if (!database && !dbPath) {
      throw new Error("CloudRunStore requires dbPath or database.");
    }

    this.dbPath = dbPath || "";
    this.db = database || this.#openDatabase(dbPath);
    this.#prepare();
  }

  #openDatabase(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    return new DatabaseSync(dbPath);
  }

  #prepare() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        execution TEXT NOT NULL,
        url TEXT NOT NULL,
        goal TEXT NOT NULL,
        request_json TEXT NOT NULL,
        result_json TEXT,
        error_message TEXT,
        browserbase_session_id TEXT,
        live_view_url TEXT,
        session_url TEXT,
        planner_run_id TEXT,
        event_log_path TEXT,
        summary TEXT,
        progress_message TEXT,
        progress_updated_at TEXT,
        source_type TEXT,
        source_id TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        session_ready_at TEXT,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_cloud_runs_status_created
      ON cloud_runs(status, created_at);

      CREATE TABLE IF NOT EXISTS cloud_run_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        message TEXT,
        event_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES cloud_runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_cloud_run_events_run_id_id
      ON cloud_run_events(run_id, id);

      CREATE TABLE IF NOT EXISTS routines (
        id TEXT PRIMARY KEY,
        template_id TEXT,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        schedule_json TEXT,
        workflow_json TEXT NOT NULL,
        notification_json TEXT,
        next_run_at TEXT,
        last_triggered_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_routines_due
      ON routines(enabled, next_run_at);

      CREATE TABLE IF NOT EXISTS routine_triggers (
        id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL,
        cloud_run_id TEXT,
        triggered_by TEXT NOT NULL,
        status TEXT NOT NULL,
        due_at TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE CASCADE,
        FOREIGN KEY (cloud_run_id) REFERENCES cloud_runs(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_routine_triggers_routine_created
      ON routine_triggers(routine_id, created_at);

      CREATE TABLE IF NOT EXISTS notification_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        routine_id TEXT NOT NULL,
        trigger_id TEXT NOT NULL,
        cloud_run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        transport TEXT NOT NULL,
        to_json TEXT NOT NULL,
        subject TEXT,
        body_text TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE CASCADE,
        FOREIGN KEY (trigger_id) REFERENCES routine_triggers(id) ON DELETE CASCADE,
        FOREIGN KEY (cloud_run_id) REFERENCES cloud_runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_notification_outbox_status
      ON notification_outbox(status, created_at);
    `);

    this.#ensureColumn("cloud_runs", "progress_message", "TEXT");
    this.#ensureColumn("cloud_runs", "progress_updated_at", "TEXT");
    this.#ensureColumn("cloud_runs", "source_type", "TEXT");
    this.#ensureColumn("cloud_runs", "source_id", "TEXT");
  }

  #ensureColumn(tableName, columnName, definition) {
    const columns = this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((column) => column.name);

    if (columns.includes(columnName)) return;
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  close() {
    this.db.close();
  }

  createRun(
    request,
    {
      id = createCloudRunId(),
      createdAt = nowIso(),
      sourceType = "one_off",
      sourceId = "",
    } = {},
  ) {
    const run = {
      id,
      status: "queued",
      mode: request.mode,
      execution: request.execution,
      url: request.url,
      goal: request.goal,
      request_json: toJson(request),
      result_json: null,
      error_message: null,
      browserbase_session_id: null,
      live_view_url: null,
      session_url: null,
      planner_run_id: null,
      event_log_path: null,
      summary: null,
      progress_message: "Cloud run queued.",
      progress_updated_at: createdAt,
      source_type: sourceType || "one_off",
      source_id: sourceId || null,
      created_at: createdAt,
      started_at: null,
      session_ready_at: null,
      completed_at: null,
    };

    this.db
      .prepare(
        `
        INSERT INTO cloud_runs (
          ${RUN_COLUMNS.join(", ")}
        ) VALUES (
          ${RUN_COLUMNS.map(() => "?").join(", ")}
        )
      `,
      )
      .run(...RUN_COLUMNS.map((column) => run[column]));

    this.recordProgressEvent(id, {
      kind: "queued",
      message: "Cloud run queued.",
      createdAt,
    });

    return this.getRun(id);
  }

  getRun(id) {
    const runId = normalizeRunId(id);
    if (!runId) return null;
    return this.db
      .prepare("SELECT * FROM cloud_runs WHERE id = ?")
      .get(runId) || null;
  }

  getNextQueuedRun() {
    return this.db
      .prepare(
        `
        SELECT * FROM cloud_runs
        WHERE status = 'queued'
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      )
      .get() || null;
  }

  hasQueuedRuns() {
    const row = this.db
      .prepare("SELECT 1 AS exists_flag FROM cloud_runs WHERE status = 'queued' LIMIT 1")
      .get();
    return Boolean(row);
  }

  updateRun(id, fields = {}) {
    const entries = Object.entries(fields).filter(([column]) =>
      UPDATE_COLUMNS.has(column),
    );

    if (entries.length === 0) return this.getRun(id);

    const assignments = entries.map(([column]) => `${column} = ?`).join(", ");
    this.db
      .prepare(`UPDATE cloud_runs SET ${assignments} WHERE id = ?`)
      .run(...entries.map(([, value]) => value), id);

    return this.getRun(id);
  }

  getRunEvents(id, { limit = DEFAULT_EVENT_LIMIT } = {}) {
    const runId = normalizeRunId(id);
    const numericLimit = Number(limit);
    if (numericLimit === 0) return [];

    const eventLimit = Math.max(
      1,
      Math.min(Number.isFinite(numericLimit) ? numericLimit : DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT),
    );
    const rows = this.db
      .prepare(
        `
        SELECT * FROM (
          SELECT *
          FROM cloud_run_events
          WHERE run_id = ?
          ORDER BY id DESC
          LIMIT ?
        )
        ORDER BY id ASC
      `,
      )
      .all(runId, eventLimit);

    return rows || [];
  }

  getRunForApi(
    id,
    { eventLimit = DEFAULT_EVENT_LIMIT, includeEventPayload = false } = {},
  ) {
    const row = this.getRun(id);
    if (!row) return null;
    return rowToCloudRun(row, this.getRunEvents(id, { limit: eventLimit }), {
      includeEventPayload,
    });
  }

  recordProgressEvent(id, {
    kind = "progress",
    message = "",
    event = null,
    createdAt = nowIso(),
  } = {}) {
    const runId = normalizeRunId(id);
    if (!runId) return null;

    this.db
      .prepare(
        `
        INSERT INTO cloud_run_events (
          run_id,
          kind,
          message,
          event_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
      )
      .run(runId, kind || "progress", message || "", toJson(event), createdAt);

    return this.updateRun(runId, {
      progress_message: message || kind || "Cloud run progress updated.",
      progress_updated_at: createdAt,
    });
  }

  markRunning(id, { startedAt = nowIso() } = {}) {
    const row = this.updateRun(id, {
      status: "running",
      started_at: startedAt,
      completed_at: null,
      error_message: null,
    });
    this.recordProgressEvent(id, {
      kind: "running",
      message: "Cloud run started.",
      createdAt: startedAt,
    });
    return row;
  }

  markSessionReady(id, session, { sessionReadyAt = nowIso() } = {}) {
    const row = this.updateRun(id, {
      browserbase_session_id: session.browserbaseSessionId || null,
      live_view_url: session.liveViewUrl || null,
      session_url: session.sessionUrl || null,
      session_ready_at: sessionReadyAt,
    });
    this.recordProgressEvent(id, {
      kind: "session_ready",
      message: "Browserbase session ready.",
      event: session,
      createdAt: sessionReadyAt,
    });
    return row;
  }

  markEventLogReady(id, { eventLogPath } = {}, { createdAt = nowIso() } = {}) {
    const row = this.updateRun(id, {
      event_log_path: eventLogPath || null,
    });
    this.recordProgressEvent(id, {
      kind: "event_log_ready",
      message: "Cloud runtime event log ready.",
      event: { eventLogPath: eventLogPath || "" },
      createdAt,
    });
    return row;
  }

  markCompleted(id, result, { completedAt = nowIso() } = {}) {
    const row = this.updateRun(id, {
      status: "completed",
      result_json: toJson(result),
      error_message: null,
      browserbase_session_id: result.browserbaseSessionId || null,
      live_view_url: result.liveViewUrl || null,
      session_url: result.sessionUrl || null,
      planner_run_id: result.plannerRunId || null,
      event_log_path: result.eventLogPath || null,
      summary: result.summary || null,
      completed_at: completedAt,
    });
    this.recordProgressEvent(id, {
      kind: "completed",
      message: result.summary || "Cloud run completed.",
      event: {
        plannerRunId: result.plannerRunId || "",
        eventLogPath: result.eventLogPath || "",
      },
      createdAt: completedAt,
    });
    return row;
  }

  markFailed(id, error, result = null, { completedAt = nowIso() } = {}) {
    const fields = {
      status: "failed",
      result_json: result ? toJson(result) : null,
      error_message: error?.message || String(error || "Cloud run failed."),
      completed_at: completedAt,
    };

    if (result) {
      fields.browserbase_session_id = result.browserbaseSessionId || null;
      fields.live_view_url = result.liveViewUrl || null;
      fields.session_url = result.sessionUrl || null;
      fields.planner_run_id = result.plannerRunId || null;
      fields.event_log_path = result.eventLogPath || null;
      fields.summary = result.summary || null;
    }

    const row = this.updateRun(id, fields);
    this.recordProgressEvent(id, {
      kind: "failed",
      message: fields.error_message,
      event: result
        ? {
            plannerRunId: result.plannerRunId || "",
            eventLogPath: result.eventLogPath || "",
          }
        : null,
      createdAt: completedAt,
    });
    return row;
  }

  createRoutine(routine, { id = createRoutineId(), createdAt = nowIso() } = {}) {
    this.db
      .prepare(
        `
        INSERT INTO routines (
          id,
          template_id,
          name,
          enabled,
          schedule_json,
          workflow_json,
          notification_json,
          next_run_at,
          last_triggered_at,
          created_at,
          updated_at,
          archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        id,
        routine.templateId || null,
        routine.name,
        routine.enabled ? 1 : 0,
        toJson(routine.schedule),
        toJson(routine.workflow),
        toJson(routine.notification),
        routine.nextRunAt || null,
        null,
        createdAt,
        createdAt,
        null,
      );

    return this.getRoutine(id);
  }

  listRoutines() {
    return this.db
      .prepare(
        `
        SELECT *
        FROM routines
        WHERE archived_at IS NULL
        ORDER BY created_at DESC, id DESC
      `,
      )
      .all()
      .map(rowToRoutine);
  }

  getRoutine(id) {
    const routineId = normalizeRunId(id);
    if (!routineId) return null;

    const row = this.db
      .prepare("SELECT * FROM routines WHERE id = ? AND archived_at IS NULL")
      .get(routineId);

    return rowToRoutine(row);
  }

  updateRoutine(id, patch, { updatedAt = nowIso() } = {}) {
    const fields = {};

    if ("name" in patch) fields.name = patch.name;
    if ("enabled" in patch) fields.enabled = patch.enabled ? 1 : 0;
    if ("schedule" in patch) fields.schedule_json = toJson(patch.schedule);
    if ("workflow" in patch) fields.workflow_json = toJson(patch.workflow);
    if ("notification" in patch) fields.notification_json = toJson(patch.notification);
    if ("nextRunAt" in patch) fields.next_run_at = patch.nextRunAt || null;
    fields.updated_at = updatedAt;

    const entries = Object.entries(fields);
    const assignments = entries.map(([column]) => `${column} = ?`).join(", ");
    this.db
      .prepare(`UPDATE routines SET ${assignments} WHERE id = ? AND archived_at IS NULL`)
      .run(...entries.map(([, value]) => value), id);

    return this.getRoutine(id);
  }

  listDueRoutines(now = nowIso(), { limit = 10 } = {}) {
    return this.db
      .prepare(
        `
        SELECT *
        FROM routines
        WHERE archived_at IS NULL
          AND enabled = 1
          AND next_run_at IS NOT NULL
          AND next_run_at <= ?
        ORDER BY next_run_at ASC, id ASC
        LIMIT ?
      `,
      )
      .all(now, Math.max(1, Math.min(Number(limit) || 10, 100)))
      .map(rowToRoutine);
  }

  setRoutineNextRunAt(id, nextRunAt, { updatedAt = nowIso() } = {}) {
    this.db
      .prepare(
        `
        UPDATE routines
        SET next_run_at = ?,
            updated_at = ?
        WHERE id = ? AND archived_at IS NULL
      `,
      )
      .run(nextRunAt || null, updatedAt, id);

    return this.getRoutine(id);
  }

  listRoutineTriggers(routineId) {
    return this.db
      .prepare(
        `
        SELECT *
        FROM routine_triggers
        WHERE routine_id = ?
        ORDER BY created_at DESC, id DESC
      `,
      )
      .all(routineId)
      .map(rowToRoutineTrigger);
  }

  getRoutineTrigger(id) {
    const row = this.db
      .prepare("SELECT * FROM routine_triggers WHERE id = ?")
      .get(id);
    return rowToRoutineTrigger(row);
  }

  createNotificationOutbox({
    routine,
    triggerId,
    cloudRunId,
    createdAt = nowIso(),
  }) {
    const notification = routine.notification;
    if (!notification || notification.type !== "email") return null;

    const result = this.db
      .prepare(
        `
        INSERT INTO notification_outbox (
          routine_id,
          trigger_id,
          cloud_run_id,
          status,
          transport,
          to_json,
          subject,
          body_text,
          attempts,
          last_error,
          created_at,
          sent_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        routine.id,
        triggerId,
        cloudRunId,
        "waiting_for_run",
        "email",
        toJson(notification.to || []),
        null,
        null,
        0,
        null,
        createdAt,
        null,
        createdAt,
      );

    const notificationId = Number(result.lastInsertRowid);

    this.recordProgressEvent(cloudRunId, {
      kind: "notification_waiting",
      message: "Email notification queued and waiting for run completion.",
      event: { notificationId },
      createdAt,
    });

    return this.getNotification(notificationId);
  }

  getNotification(id) {
    const row = this.db
      .prepare("SELECT * FROM notification_outbox WHERE id = ?")
      .get(id);
    return rowToNotification(row);
  }

  listPendingNotifications({ limit = 10 } = {}) {
    return this.db
      .prepare(
        `
        SELECT *
        FROM notification_outbox
        WHERE status = 'waiting_for_run'
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      `,
      )
      .all(Math.max(1, Math.min(Number(limit) || 10, 100)))
      .map(rowToNotification);
  }

  markNotificationSent(id, { subject, bodyText, sentAt = nowIso() } = {}) {
    this.db
      .prepare(
        `
        UPDATE notification_outbox
        SET status = 'sent',
            subject = ?,
            body_text = ?,
            attempts = attempts + 1,
            last_error = NULL,
            sent_at = ?,
            updated_at = ?
        WHERE id = ?
      `,
      )
      .run(subject || "", bodyText || "", sentAt, sentAt, id);

    return this.getNotification(id);
  }

  markNotificationFailed(id, error, { updatedAt = nowIso() } = {}) {
    this.db
      .prepare(
        `
        UPDATE notification_outbox
        SET status = 'failed',
            attempts = attempts + 1,
            last_error = ?,
            updated_at = ?
        WHERE id = ?
      `,
      )
      .run(error?.message || String(error || "Notification failed."), updatedAt, id);

    return this.getNotification(id);
  }

  markNotificationSkipped(id, reason, { updatedAt = nowIso() } = {}) {
    this.db
      .prepare(
        `
        UPDATE notification_outbox
        SET status = 'skipped',
            last_error = ?,
            updated_at = ?
        WHERE id = ?
      `,
      )
      .run(reason || "Notification skipped.", updatedAt, id);

    return this.getNotification(id);
  }

  triggerRoutine(
    routineId,
    {
      triggeredBy = "manual",
      dueAt = null,
      createdAt = nowIso(),
    } = {},
  ) {
    const routine = this.getRoutine(routineId);
    if (!routine) return null;

    const triggerId = createRoutineTriggerId();
    const workflow = routine.workflow || {};
    const runRequest = {
      ...workflow,
      url: workflow.url,
      goal: workflow.goal,
      mode: workflow.mode,
      execution: workflow.execution,
      timeoutMs: workflow.timeoutMs,
      autoConfirm: workflow.autoConfirm,
    };
    const cloudRun = this.createRun(runRequest, {
      createdAt,
      sourceType: "routine",
      sourceId: triggerId,
    });

    this.db
      .prepare(
        `
        INSERT INTO routine_triggers (
          id,
          routine_id,
          cloud_run_id,
          triggered_by,
          status,
          due_at,
          error_message,
          created_at,
          completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        triggerId,
        routine.id,
        cloudRun.id,
        triggeredBy,
        "created",
        dueAt || null,
        null,
        createdAt,
        createdAt,
      );

    this.db
      .prepare(
        `
        UPDATE routines
        SET last_triggered_at = ?,
            updated_at = ?
        WHERE id = ?
      `,
      )
      .run(createdAt, createdAt, routine.id);

    this.recordProgressEvent(cloudRun.id, {
      kind: "routine_triggered",
      message: `Routine triggered by ${triggeredBy}.`,
      event: {
        routineId: routine.id,
        triggerId,
        routineName: routine.name,
      },
      createdAt,
    });

    const notification = this.createNotificationOutbox({
      routine,
      triggerId,
      cloudRunId: cloudRun.id,
      createdAt,
    });

    return {
      routine: this.getRoutine(routine.id),
      trigger: this.getRoutineTrigger(triggerId),
      cloudRun: this.getRunForApi(cloudRun.id),
      notification,
    };
  }

  recoverInterruptedRuns({ completedAt = nowIso() } = {}) {
    const interrupted = this.db
      .prepare("SELECT id FROM cloud_runs WHERE status = 'running'")
      .all();
    const result = this.db
      .prepare(
        `
        UPDATE cloud_runs
        SET status = 'failed',
            error_message = 'Cloud run interrupted by service restart.',
            completed_at = ?
        WHERE status = 'running'
      `,
      )
      .run(completedAt);

    for (const row of interrupted) {
      this.recordProgressEvent(row.id, {
        kind: "failed",
        message: "Cloud run interrupted by service restart.",
        createdAt: completedAt,
      });
    }

    return result.changes || 0;
  }
}
