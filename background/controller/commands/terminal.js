export function buildDoneTerminal(command, session) {
  const plan = command.plan || {};
  const resolvedSummary = command.summary || plan.summary || "";

  return {
    terminal: "done",
    step: command.step || session.step,
    plan,
    summary: resolvedSummary,
    plannerSummary: command.plannerSummary || "",
    finalResult: command.finalResult || null,
  };
}

export function buildAskHumanTerminal(command, session) {
  const plan = {
    ...(command.plan || {}),
    reasoning:
      command.message ||
      command.plan?.reasoning ||
      "Planner requested human guidance.",
  };

  return {
    terminal: "ask_human",
    step: command.step || session.step,
    plan,
  };
}
