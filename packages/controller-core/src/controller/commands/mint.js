import { addEvent } from "../../events.js";
import { getSession, saveSession } from "../../state/sessionStore.js";
import { sleep } from "../../utils/common.js";
import { BROWSER_DOM_SURFACE } from "../../runtime/surfaces.js";
import { recordStepStarted } from "./context.js";
import { recordActionResult, recordPlannedActions } from "./runActions.js";

const bindKeys = ["tabId", "documentId", "url", "observationId"];
export const CLASSIC_MINT_HANDOFF = "classic_mint_handoff";
const mintProgress = {
  exploring: "Pomerado is learning the page.",
  drafting: "Pomerado is writing the site adapter.",
  reviewing_draft: "Pomerado is reviewing the adapter draft.",
};

function sameBinding(actual, expected) {
  return Boolean(actual && expected && bindKeys.every(key => actual[key] === expected[key]));
}

export async function recordMintProgress(tabId, step, mintPhase, message = mintProgress[mintPhase]) {
  await addEvent(tabId, { kind: "adapter_mint_progress", activePlanner: "pomerado", step, mintPhase, message });
}

export function isClassicMintHandoff(command) {
  return command?.type === "extract_state" &&
    command.reason === CLASSIC_MINT_HANDOFF &&
    command.activePlanner === "classic" &&
    Number.isInteger(command.step) && command.step > 1;
}

export async function captureMint(tabId, session, runtime) {
  const { binding, observation } = await runtime.mint.capture(tabId, session.mintBinding);
  session.mintBinding = binding;
  return observation;
}

export async function saveMintRunState(tabId, session, nextSession, run, command, step = 1) {
  if (isClassicMintHandoff(command)) {
    if (nextSession.activePlanner !== "classic" || nextSession.step + 1 !== command.step) {
      throw new Error("The backend returned an inconsistent Classic planner handoff.");
    }
    delete nextSession.mintPhase;
    delete nextSession.mintBinding;
    delete nextSession.mintDispatchedOperationId;
    await saveSession(tabId, nextSession);

    await addEvent(tabId, {
      kind: "adapter_mint_handoff",
      activePlanner: "classic",
      step: command.step - 1,
      nextStep: command.step,
      message: session.activePlanner === "pomerado"
        ? "Pomerado saved the draft. Classic is continuing the run."
        : "A saved adapter draft is available. Classic is continuing the run.",
    });
    return;
  }

  const phase = run?.teaching?.phase;
  const mintPhase = Object.hasOwn(mintProgress, phase) ? phase : session.mintPhase || "exploring";
  const phaseChanged = nextSession.activePlanner === "pomerado" && session.mintPhase !== mintPhase;
  if (phaseChanged) nextSession.mintPhase = mintPhase;
  await saveSession(tabId, nextSession);

  if (phaseChanged) {
    await recordMintProgress(tabId, nextSession.step || step, mintPhase);
  }
}

export async function executeMintCommand(tabId, command, session, { plannerAdapter, runtime, stopIfRequested }) {
  if (!session.mintBinding || !runtime.mint) throw new Error("Mint requires the attached Chrome tab.");
  if (command.type === "adapter_mint_outcome") {
    return { terminal: "mint_outcome", outcome: command.outcome };
  }
  const runId = session.runId;
  const echo = {
    type: command.type, runId, step: command.step, teachingOperationId: command.teachingOperationId,
    ...(command.binding && { binding: command.binding }),
  };
  let report;
  if (command.type === "wait_for_command") {
    await sleep(Math.max(150, Math.min(1500, Number(command.retryAfterMs) || 300)));
    const stopped = await stopIfRequested(tabId, "Stopped while waiting for the mint planner.");
    if (stopped) return { terminal: "result", result: stopped };
    report = { type: "poll" };
  } else if (command.type === "extract_state") {
    if (command.binding && !sameBinding(command.binding, session.mintBinding)) {
      throw new Error("The mint planner requested a stale document.");
    }
    report = { type: "state_extracted", mintObservation: await captureMint(tabId, session, runtime) };
  } else if (command.type === "run_actions") {
    if (!sameBinding(command.binding, session.mintBinding) || typeof command.teachingOperationId !== "string" ||
        !command.teachingOperationId || command.teachingOperationId === session.mintDispatchedOperationId) {
      throw new Error("The mint planner requested an already used or stale observation.");
    }
    session.mintDispatchedOperationId = command.teachingOperationId;
    await saveSession(tabId, session);

    const step = session.step || 1;
    const actions = (Array.isArray(command.actions) ? command.actions : [])
      .map(({ type, targetId }) => ({ type, targetId }));
    if (session.chromeStepLifecycle === 1) {
      const started = await recordStepStarted(tabId, session, step, {
        surface: BROWSER_DOM_SURFACE,
        activePlanner: "pomerado",
      });
      if (started) await recordMintProgress(tabId, step, session.mintPhase || "exploring");
    }
    await recordPlannedActions(tabId, step, actions);
    const stopped = await stopIfRequested(tabId, "Stopped before executing mint actions.");
    if (stopped) return { terminal: "result", result: stopped };

    let execution;
    let postState;
    try {
      execution = await runtime.mint.runActions(tabId, session.mintBinding, command.actions);
      postState = await captureMint(tabId, session, runtime);
    } catch {
      execution = { ok: false, results: [], uncertain: true };
    }
    report = { type: "actions_executed", execution, postState };
    await recordActionResult(tabId, {
      step, actions, execution,
      message: execution.uncertain ? "The mint action result could not be verified."
        : execution.ok ? "Mint actions executed." : "The host rejected a mint action.",
    });
  } else {
    throw new Error("Unsupported mint command.");
  }

  const response = await plannerAdapter.postCommandResult({
    runId, command: echo, surface: BROWSER_DOM_SURFACE,
    browserContext: plannerAdapter.buildBrowserContext(tabId, session, session.mintBinding.url),
    ...report,
  });
  const latest = await getSession(tabId);
  if (latest.runId !== runId || latest.stopRequested || !latest.running) {
    return { terminal: "result", result: { ok: true, stopped: true } };
  }
  latest.mintBinding = session.mintBinding;
  const nextSession = plannerAdapter.syncSessionWithRun(latest, response.run);
  await saveMintRunState(tabId, latest, nextSession, response.run, response.command);
  return { nextCommand: response.command, lastState: null };
}
