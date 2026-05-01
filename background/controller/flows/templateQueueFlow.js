import { addEvent } from "../../events.js";
import { clearLocalRunTracking } from "../session/lifecycle.js";
import {
  getEmptySession,
  getSession,
  replaceSession,
  saveSession,
} from "../../state/sessionStore.js";
import { clone } from "../../utils/common.js";

function applyTemplateQueueRunToSession(session, itemResult, plannerAdapter) {
  session.goal = itemResult.item?.goal || session.goal || "";
  session.inputValues = clone(itemResult.item?.inputValues || {});
  session.isTemplateRun = true;
  session.templateRunId = itemResult.templateRunId || session.templateRunId || "";
  session.templateQueue = itemResult.queue || session.templateQueue || null;
  session.runId = itemResult.runId || "";
  session.finalResult = null;
  session.pendingNewTab = null;
  session.replayRunning = false;
  session.userHint = "";
  session.pausedReason = "";
  session.pendingStep = null;
  session.running = false;
  session.awaitingNavigation = false;
  session.stopRequested = false;
  session.step = Number(itemResult.run?.step || 0);

  return plannerAdapter.syncSessionWithRun(session, itemResult.run);
}

export async function handleTemplateQueueDoneFlow(
  tabId,
  result,
  { continueRun, plannerAdapter },
) {
  let session = await getSession(tabId);

  const completion = await plannerAdapter.completeTemplateQueueItem({
    templateRunId: session.templateRunId,
    runId: session.runId,
    summary: result.summary || "",
    finalResult: result.finalResult || null,
  });

  await addEvent(tabId, {
    kind: "template_item_completed",
    step: result.step,
    message: `Template item ${
      Number(completion.completedItem?.index || 0) + 1
    }/${completion.queue?.totalRuns || ""} completed.`,
    item: clone(completion.completedItem || null),
    queue: clone(completion.queue || null),
  });

  if (completion.status === "finished") {
    clearLocalRunTracking(session);
    session.attachedTabId = tabId;
    session.templateQueue = completion.queue || null;
    await saveSession(tabId, session);

    await addEvent(tabId, {
      kind: "template_queue_finished",
      message: "Template queue finished.",
      queue: clone(completion.queue || null),
      results: clone(completion.results || []),
    });

    return {
      ok: true,
      completed: true,
      templateQueue: completion.queue || null,
      results: completion.results || [],
    };
  }

  session = applyTemplateQueueRunToSession(session, completion, plannerAdapter);
  session.attachedTabId = tabId;
  await saveSession(tabId, session);

  await addEvent(tabId, {
    kind: "template_item_started",
    message: `Starting template item ${
      Number(completion.item?.index || 0) + 1
    }/${completion.item?.totalRuns || completion.queue?.totalRuns || ""}.`,
    item: clone(completion.item || null),
    queue: clone(completion.queue || null),
  });

  const replayResult = await plannerAdapter.tryRunReplayPreflight({
    runId: session.runId,
    artifactFileName: session.artifactFileName,
  });
  return continueRun(tabId, replayResult.command || completion.command);
}

export async function startTemplateQueueFlow(
  tabId,
  {
    goalTemplate = "",
    inputSchema = [],
    inputValues = {},
    artifactFileName = "",
  } = {},
  { continueRun, plannerAdapter },
) {
  if (!goalTemplate || !String(goalTemplate).trim()) {
    throw new Error("Template goal is required.");
  }

  let session = getEmptySession(tabId);
  session.attachedTabId = tabId;
  session.movedFromTabId = null;
  session.movedToTabId = null;
  session.artifactFileName = String(artifactFileName || "");

  await replaceSession(tabId, session);

  const queueResult = await plannerAdapter.startTemplateQueueCommand({
    goalTemplate,
    inputSchema,
    inputValues,
    artifactFileName: session.artifactFileName,
  });

  session = await getSession(tabId);
  session = applyTemplateQueueRunToSession(session, queueResult, plannerAdapter);
  session.attachedTabId = tabId;
  session.artifactFileName = String(artifactFileName || "");
  await saveSession(tabId, session);

  await addEvent(tabId, {
    kind: "template_queue_started",
    message: `Template queue started with ${
      queueResult.queue?.totalRuns || 0
    } item${Number(queueResult.queue?.totalRuns || 0) === 1 ? "" : "s"}.`,
    queue: clone(queueResult.queue || null),
  });

  await addEvent(tabId, {
    kind: "template_item_started",
    message: `Starting template item ${
      Number(queueResult.item?.index || 0) + 1
    }/${queueResult.item?.totalRuns || queueResult.queue?.totalRuns || ""}.`,
    item: clone(queueResult.item || null),
    queue: clone(queueResult.queue || null),
  });

  const replayResult = await plannerAdapter.tryRunReplayPreflight({
    runId: session.runId,
    artifactFileName: session.artifactFileName,
  });
  return continueRun(tabId, replayResult.command || queueResult.command);
}
