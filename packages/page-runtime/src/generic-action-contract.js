// The local runner's action vocabulary. Keep this separate from backend planner
// tools: those tools can also describe host operations this runner cannot perform.
function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") deepFreeze(child);
  }
  return Object.freeze(value);
}

function action(name, description, properties, required = []) {
  return {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  };
}

const targetId = {
  type: "string",
  description: "Control ID from the current observation; never a CSS selector.",
};

export const GENERIC_ACTION_CONTRACT = deepFreeze({
  schemaVersion: "webgpt.generic-actions.v1",
  actions: [
    action("click", "Click an observed control. Observe again if this reveals new targets or navigates.", {
      targetId,
    }, ["targetId"]),
    action("fill", "Fill an observed input or editable control. For a native select, use an available option value or label; for a custom combobox, observe suggestions and click the desired option to commit it.", {
      targetId,
      value: { type: "string", description: "Exact input text or native option value/label. Omission clears the control.", default: "" },
    }, ["targetId"]),
    action("press", "Press a key or key combination on an observed control, or the active element when targetId is omitted. Enter may submit a form and requires the corresponding authorization.", {
      targetId,
      key: { type: "string", description: "Key or combination such as Enter, Tab, Escape or Control+A.", default: "Enter" },
    }),
    action("scroll", "Scroll vertically within an observed container, a control's scrollable ancestor, or the inferred page container. Observe afterward to discover newly visible controls.", {
      targetId: { type: "string", description: "Current control ID or sc_ scrollable-container ID; omitted to infer a container." },
      amount: { type: "number", description: "Vertical pixel distance; omitted or zero uses 800.", default: 800 },
      direction: { type: "string", enum: ["up", "down"], default: "down" },
    }),
    action("wait", "Wait for a known transient update, then obtain a fresh observation. Do not use waits as evidence that a task succeeded.", {
      ms: { type: "number", description: "Milliseconds; omitted or zero uses 1000.", default: 1000 },
    }),
    action("goto", "Navigate the current page to a URL. End this batch at navigation and observe the destination before executing more actions.", {
      url: { type: "string", description: "Non-empty destination URL." },
    }, ["url"]),
    action("extract", "Extract visible collection items from observed controls or a scrollable container, using current state and resolved DOM targets.", {
      targetId: { type: "string", description: "Current control or scrollable-container ID." },
      controlIds: { type: "array", items: { type: "string" }, description: "Current control IDs to extract; a non-empty list takes precedence over targetId." },
      context: { type: "object", description: "Optional caller-provided extraction provenance; does not route execution." },
      frameId: { type: "number", description: "Legacy extraction provenance only; does not select or route to a frame." },
    }),
  ],
  executionGuidance: {
    invocation: "session.runActions({ observationId, actions: [{ type: name, ...parameters }], description })",
    batchingPreference: "maximize-safe-same-turn",
    capabilityScheduling: "sequential",
    fingerprintHandling: "chain-fresh-receipt-fingerprints",
    description: "Describe the logical purpose of each batch. Required during teaching; this annotation is not a browser-action argument.",
    batching: "Batch actions whose targets and values are already known from the same current observation. Inspect the fresh returned observation before a dependent batch; do not invent targets revealed by earlier actions.",
    selection: "Use fill for native select options. Custom comboboxes commonly need fill, a fresh observation, then option click; typing alone may not commit a selection.",
    replanAt: [
      "navigation",
      "newly-revealed-dependency",
      "recoverable-browser-fallback",
      "missing-user-input",
      "authorization-boundary",
    ],
  },
});
