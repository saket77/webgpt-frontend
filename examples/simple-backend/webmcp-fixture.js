const WEB_MCP_MODE = "webmcp";

const READ_ONLY_TOOL_NAME = "fixture_echo_payload";
const MUTATION_TOOL_NAME = "fixture_set_profile";
const BEFORE_MUTATION_TOOL_NAME = "fixture_before_mutation";
const AFTER_MUTATION_TOOL_NAME = "fixture_after_mutation";

const MUTATION_PROFILE_NAME = "WebMCP Fixture User";
const MUTATION_STATUS =
  "Mutation complete: ordinary input and tool registration changed.";
const NESTED_MARKER = "webmcp-nested-value-preserved";

function hashText(value) {
  const text = String(value || "");
  let hashA = 2166136261;
  let hashB = 3339675911;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 16777619);
    hashB ^= code + index;
    hashB = Math.imul(hashB, 2246822519);
  }

  return [hashA, hashB]
    .map((hash) => (hash >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

function buildReadOnlyArguments() {
  return {
    marker: "webgpt-webmcp-exact-arguments-v1",
    longText: `BEGIN|${"0123456789abcdef".repeat(128)}|END`,
    nested: {
      level1: {
        level2: {
          level3: {
            marker: NESTED_MARKER,
            metadata: {
              source: "simple-backend-fixture",
              sequence: [1, 2, 3, 5, 8, 13, 21],
            },
          },
        },
      },
    },
    items: Array.from({ length: 32 }, (_, index) => ({
      index,
      label: `fixture-item-${String(index).padStart(2, "0")}`,
      enabled: index % 2 === 0,
    })),
  };
}

const READ_ONLY_ARGUMENTS = buildReadOnlyArguments();
const READ_ONLY_JSON = JSON.stringify(READ_ONLY_ARGUMENTS);
const READ_ONLY_EXPECTATION = Object.freeze({
  digest: hashText(READ_ONLY_JSON),
  serializedLength: READ_ONLY_JSON.length,
  serializedBytes: Buffer.byteLength(READ_ONLY_JSON, "utf8"),
  longTextLength: READ_ONLY_ARGUMENTS.longText.length,
  itemCount: READ_ONLY_ARGUMENTS.items.length,
  nestedMarker: NESTED_MARKER,
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stateFrameEntries(state) {
  if (!state || typeof state !== "object") return [];

  if (state.frames && typeof state.frames === "object") {
    return Object.entries(state.frames);
  }

  return [[String(state.frameId || 0), state]];
}

function findWebMcpTool(state, name) {
  for (const [frameKey, frame] of stateFrameEntries(state)) {
    const tools = Array.isArray(frame?.webMcp?.tools)
      ? frame.webMcp.tools
      : [];
    const tool = tools.find((candidate) => candidate?.name === name);
    if (!tool) continue;

    const keyedFrameId = Number(frameKey);
    const frameId = Number.isInteger(frame?.frameId)
      ? frame.frameId
      : Number.isInteger(keyedFrameId)
        ? keyedFrameId
        : 0;

    return { frameId, tool };
  }

  return null;
}

function buildWebMcpAction(state, toolName, args, { type } = {}) {
  const match = findWebMcpTool(state, toolName);
  if (!match) {
    throw new Error(
      `WebMCP fixture tool ${toolName} was not discovered in extracted state.`,
    );
  }

  const annotations = match.tool.annotations || {};
  const origin = String(match.tool.origin || "");
  const schemaHash = String(match.tool.schemaHash || "");
  if (
    !origin ||
    !schemaHash ||
    typeof annotations.readOnlyHint !== "boolean" ||
    typeof annotations.untrustedContentHint !== "boolean"
  ) {
    throw new Error(
      `WebMCP fixture tool ${toolName} is missing route metadata.`,
    );
  }

  return {
    type: type || `simple_webmcp_${toolName}`,
    executor: "webmcp",
    frameId: match.frameId,
    webMcp: {
      name: toolName,
      origin,
      schemaHash,
      readOnlyHint: annotations.readOnlyHint,
      untrustedContentHint: annotations.untrustedContentHint,
    },
    arguments: cloneJson(args),
    mayCauseNavigation: !annotations.readOnlyHint,
  };
}

function findWebMcpOutput(execution, toolName) {
  for (const entry of execution?.results || []) {
    const result = entry?.result || entry;
    const executedToolName =
      result?.webMcp?.name || entry?.action?.webMcp?.name || "";
    if (executedToolName && executedToolName !== toolName) continue;
    if (result && Object.hasOwn(result, "webMcpOutput")) {
      return result.webMcpOutput;
    }
  }

  return null;
}

function validateReadOnlyExecution(execution) {
  if (!execution?.ok) {
    return {
      ok: false,
      error: execution?.error || "The read-only WebMCP action failed.",
    };
  }

  const output = findWebMcpOutput(execution, READ_ONLY_TOOL_NAME);
  if (!output || typeof output !== "object") {
    return { ok: false, error: "The read-only tool returned no structured output." };
  }

  for (const [key, expected] of Object.entries(READ_ONLY_EXPECTATION)) {
    if (output[key] !== expected) {
      return {
        ok: false,
        error: `Exact-argument oracle mismatch for ${key}: expected ${expected}, received ${output[key]}.`,
        output,
      };
    }
  }

  return { ok: true, output };
}

function validateMutationExecution(execution, postState) {
  if (!execution?.ok) {
    return {
      ok: false,
      error: execution?.error || "The mutating WebMCP action failed.",
    };
  }

  const output = findWebMcpOutput(execution, MUTATION_TOOL_NAME);
  if (
    output?.profileName !== MUTATION_PROFILE_NAME ||
    output?.status !== MUTATION_STATUS ||
    output?.activeTool !== AFTER_MUTATION_TOOL_NAME
  ) {
    return {
      ok: false,
      error: "The mutation tool output did not match the deterministic oracle.",
      output,
    };
  }

  const frames = stateFrameEntries(postState).map(([, frame]) => frame);
  const currentValues = frames.flatMap((frame) =>
    (Array.isArray(frame?.controls) ? frame.controls : []).map(
      (control) => control?.currentValue,
    ),
  );
  if (!currentValues.includes(MUTATION_PROFILE_NAME)) {
    return {
      ok: false,
      error: "Post-action state did not expose the mutated ordinary input value.",
      output,
    };
  }

  const toolNames = frames.flatMap((frame) =>
    (Array.isArray(frame?.webMcp?.tools) ? frame.webMcp.tools : []).map(
      (tool) => tool?.name,
    ),
  );
  if (
    !toolNames.includes(AFTER_MUTATION_TOOL_NAME) ||
    toolNames.includes(BEFORE_MUTATION_TOOL_NAME)
  ) {
    return {
      ok: false,
      error: "Post-action state did not expose the expected WebMCP tool swap.",
      output,
      toolNames,
    };
  }

  return { ok: true, output, toolNames };
}

function renderWebMcpFixturePage() {
  const expectedJson = JSON.stringify(READ_ONLY_EXPECTATION);
  const constantsJson = JSON.stringify({
    readOnlyToolName: READ_ONLY_TOOL_NAME,
    mutationToolName: MUTATION_TOOL_NAME,
    beforeMutationToolName: BEFORE_MUTATION_TOOL_NAME,
    afterMutationToolName: AFTER_MUTATION_TOOL_NAME,
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>WebGPT WebMCP deterministic fixture</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { max-width: 880px; margin: 40px auto; padding: 0 20px 60px; line-height: 1.45; }
      section { border: 1px solid #8886; border-radius: 12px; padding: 18px; margin: 16px 0; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #8882; padding: 12px; border-radius: 8px; }
      input { box-sizing: border-box; width: 100%; padding: 10px; font: inherit; }
      dt { font-weight: 700; }
      dd { margin: 0 0 8px; }
      .ok { color: #16833b; }
      .error { color: #c03221; }
    </style>
  </head>
  <body>
    <h1>WebGPT WebMCP deterministic fixture</h1>
    <p>
      This page exposes one read-only exact-payload tool and one mutating tool.
      The values below are an independent, visible oracle for the WebGPT run.
    </p>

    <section aria-labelledby="support-heading">
      <h2 id="support-heading">WebMCP support</h2>
      <p id="webmcp-support">Checking <code>document.modelContext</code>…</p>
      <p>Registered tools: <code id="registered-tools">none yet</code></p>
    </section>

    <section aria-labelledby="expected-heading">
      <h2 id="expected-heading">Expected exact-payload oracle</h2>
      <dl>
        <dt>Serialized UTF-8 bytes</dt>
        <dd id="expected-payload-bytes">${READ_ONLY_EXPECTATION.serializedBytes}</dd>
        <dt>Digest</dt>
        <dd><code id="expected-payload-digest">${READ_ONLY_EXPECTATION.digest}</code></dd>
        <dt>Long text length</dt>
        <dd id="expected-long-text-length">${READ_ONLY_EXPECTATION.longTextLength}</dd>
        <dt>Array item count</dt>
        <dd id="expected-item-count">${READ_ONLY_EXPECTATION.itemCount}</dd>
      </dl>
    </section>

    <section aria-labelledby="observed-heading">
      <h2 id="observed-heading">Last observed tool call</h2>
      <p id="last-call-kind">No tool has run.</p>
      <pre id="last-call-output">Waiting for WebGPT.</pre>
    </section>

    <section aria-labelledby="mutation-heading">
      <h2 id="mutation-heading">Mutation state</h2>
      <label for="profile-name">Fixture profile name</label>
      <input id="profile-name" name="profileName" value="Before WebMCP mutation">
      <p id="mutation-status" role="status">Mutation has not run.</p>
    </section>

    <script>
      (() => {
        const EXPECTED = ${expectedJson};
        const NAMES = ${constantsJson};
        let beforeMutationController = null;
        let toolRegistrationSwapped = false;

        function hashText(value) {
          const text = String(value || "");
          let hashA = 2166136261;
          let hashB = 3339675911;
          for (let index = 0; index < text.length; index += 1) {
            const code = text.charCodeAt(index);
            hashA ^= code;
            hashA = Math.imul(hashA, 16777619);
            hashB ^= code + index;
            hashB = Math.imul(hashB, 2246822519);
          }
          return [hashA, hashB]
            .map((hash) => (hash >>> 0).toString(16).padStart(8, "0"))
            .join("");
        }

        function byteLength(value) {
          return new TextEncoder().encode(String(value || "")).length;
        }

        function showCall(kind, output) {
          document.getElementById("last-call-kind").textContent = kind;
          document.getElementById("last-call-output").textContent =
            JSON.stringify(output, null, 2);
        }

        async function refreshToolList() {
          const tools = await document.modelContext.getTools();
          const localTools = tools.filter(
            (tool) => !tool.window || tool.window === window,
          );
          document.getElementById("registered-tools").textContent =
            localTools.map((tool) => tool.name).sort().join(", ") || "none";
        }

        function markerTool(name, marker) {
          return {
            name,
            title: name,
            description: "Read the deterministic tool-registration marker.",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: async () => ({ marker }),
          };
        }

        async function registerTools() {
          const modelContext = document.modelContext;
          if (!modelContext || typeof modelContext.registerTool !== "function") {
            const support = document.getElementById("webmcp-support");
            support.className = "error";
            support.textContent =
              "WebMCP is unavailable. Enable Chrome's WebMCP testing flag and reload.";
            return;
          }

          await modelContext.registerTool({
            name: NAMES.readOnlyToolName,
            title: "Echo an exact long and nested payload",
            description:
              "Verify that execution arguments remain exact even when prompt history is compacted.",
            inputSchema: {
              type: "object",
              properties: {
                marker: { type: "string" },
                longText: { type: "string" },
                nested: { type: "object" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      index: { type: "integer" },
                      label: { type: "string" },
                      enabled: { type: "boolean" },
                    },
                  },
                },
              },
              required: ["marker", "longText", "nested", "items"],
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: async (input) => {
              const serialized = JSON.stringify(input);
              const output = {
                digest: hashText(serialized),
                serializedLength: serialized.length,
                serializedBytes: byteLength(serialized),
                longTextLength: String(input.longText || "").length,
                itemCount: Array.isArray(input.items) ? input.items.length : -1,
                nestedMarker:
                  input.nested?.level1?.level2?.level3?.marker || "missing",
              };
              showCall("Read-only exact-payload tool completed.", output);
              return output;
            },
          });

          beforeMutationController = new AbortController();
          await modelContext.registerTool({
            name: NAMES.mutationToolName,
            title: "Mutate an input and replace a registered tool",
            description:
              "Set the ordinary profile input, change visible status, and swap the fixture marker tool.",
            inputSchema: {
              type: "object",
              properties: {
                profileName: { type: "string" },
                status: { type: "string" },
              },
              required: ["profileName", "status"],
            },
            annotations: { readOnlyHint: false, untrustedContentHint: true },
            execute: async ({ profileName, status }) => {
              const profileInput = document.getElementById("profile-name");
              profileInput.value = profileName;
              profileInput.dispatchEvent(new Event("input", { bubbles: true }));
              profileInput.dispatchEvent(new Event("change", { bubbles: true }));
              document.getElementById("mutation-status").textContent = status;

              if (!toolRegistrationSwapped) {
                beforeMutationController.abort();
                await modelContext.registerTool(
                  markerTool(NAMES.afterMutationToolName, "after-mutation"),
                );
                toolRegistrationSwapped = true;
              }

              await refreshToolList();
              const output = {
                profileName,
                status,
                activeTool: NAMES.afterMutationToolName,
              };
              showCall("Mutating profile/tool-registration call completed.", output);
              return output;
            },
          });

          await modelContext.registerTool(
            markerTool(NAMES.beforeMutationToolName, "before-mutation"),
            { signal: beforeMutationController.signal },
          );

          const support = document.getElementById("webmcp-support");
          support.className = "ok";
          support.textContent =
            "WebMCP is available and the deterministic tools are registered.";
          await refreshToolList();
          modelContext.addEventListener?.("toolchange", () => {
            refreshToolList().catch(() => {});
          });

          if (
            EXPECTED.longTextLength <= 500 ||
            EXPECTED.itemCount <= 20
          ) {
            throw new Error("Fixture payload no longer exceeds history compaction thresholds.");
          }
        }

        registerTools().catch((error) => {
          const support = document.getElementById("webmcp-support");
          support.className = "error";
          support.textContent = "Fixture registration failed: " + error.message;
        });
      })();
    </script>
  </body>
</html>`;
}

module.exports = {
  AFTER_MUTATION_TOOL_NAME,
  BEFORE_MUTATION_TOOL_NAME,
  MUTATION_PROFILE_NAME,
  MUTATION_STATUS,
  MUTATION_TOOL_NAME,
  READ_ONLY_ARGUMENTS,
  READ_ONLY_EXPECTATION,
  READ_ONLY_TOOL_NAME,
  WEB_MCP_MODE,
  buildReadOnlyArguments,
  buildWebMcpAction,
  findWebMcpTool,
  hashText,
  renderWebMcpFixturePage,
  validateMutationExecution,
  validateReadOnlyExecution,
};
