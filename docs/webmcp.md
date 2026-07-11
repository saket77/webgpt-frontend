# WebMCP Integration

WebGPT can consume semantic tools that a website exposes through WebMCP. These tools stay inside the existing `browser_dom` surface: WebMCP adds a second page-action vocabulary beside generic DOM actions and WebGPT connector tools; it is not a new runtime surface or a backend MCP server.

The implementation follows the browser's imperative API: discover live handles through `document.modelContext.getTools()` and invoke one with `document.modelContext.executeTool(tool, JSON.stringify(arguments))`. See Chrome's [WebMCP overview](https://developer.chrome.com/docs/ai/webmcp), [imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api), and [DevTools panel](https://developer.chrome.com/docs/devtools/application/webmcp).

## Integrated Loop

```text
extract DOM state + discover current-frame WebMCP tools
  -> backend builds model schemas and a private execution route map
  -> planner emits an ordered same-frame batch of independent actions
  -> backend creates bounded actions with exact nested arguments
  -> host routes the action to its owning frame
  -> page runtime re-discovers and validates the live tool
  -> executeTool receives only JSON.stringify(action.arguments)
  -> host executes WebMCP, DOM, and connector actions in planner order
  -> host re-extracts page state once after the batch
  -> backend computes DOM, value, and tool-set deltas
  -> backend classifies the verified action effect
  -> canonical history is stored and a separate compact planner view is derived
```

`packages/page-runtime/src/content-scripts/webMcp.js` is shared by the extension and Browserbase hosts. Each frame filters discovery to tools owned by its own `window`, preventing duplicate or misrouted same-origin iframe tools.

## State Contract

Every extracted frame may contain:

```json
{
  "webMcp": {
    "supported": true,
    "tools": [
      {
        "source": "webmcp",
        "name": "getAvailability",
        "title": "Get availability",
        "description": "List available slots",
        "origin": "https://example.test",
        "parameters": { "type": "object", "properties": {} },
        "annotations": {
          "readOnlyHint": true,
          "untrustedContentHint": true
        },
        "schemaHash": "0123456789abcdef"
      }
    ],
    "errors": []
  }
}
```

The backend generates a deterministic model-facing name that includes frame identity and a digest. The page-owned name is never changed and is kept only in a private route map. Route metadata is not model-writable.

Discovery limits are 32 tools per frame in the page bridge and 32 accepted tools across the backend catalog, a 32 KiB schema per tool, 128 characters for page tool names, and 1,200 characters for descriptions.

Generic control state also carries bounded `currentValue` and `selectedValues` evidence for ordinary inputs, textareas, and selects. Password, file, and hidden input values are excluded both from explicit values and generic text fallback.

## Action And Result Contracts

A planner-selected WebMCP call becomes:

```json
{
  "type": "webmcp_f0_getAvailability_0123456789abcdef",
  "executor": "webmcp",
  "frameId": 0,
  "webMcp": {
    "name": "getAvailability",
    "origin": "https://example.test",
    "schemaHash": "0123456789abcdef",
    "readOnlyHint": true,
    "untrustedContentHint": true
  },
  "arguments": {
    "startDate": "2026-07-14"
  },
  "mayCauseNavigation": false
}
```

Only `arguments` is serialized and passed to the website. Fields such as `type`, `executor`, `frameId`, `origin`, and `schemaHash` are WebGPT routing data and never enter the site's execution payload.

WebMCP participates in the normal ordered `run_actions` batch. Independent same-frame WebMCP, DOM, and connector actions may be mixed when every argument and target is already known. A later action that depends on an earlier result or newly rendered state belongs in the next planner step. Any action that may navigate must be last; a confirmed navigation result stops the remaining tail rather than executing against a changing document.

The executor returns bounded evidence:

```json
{
  "ok": true,
  "webMcp": {
    "name": "getAvailability",
    "origin": "https://example.test",
    "schemaHash": "0123456789abcdef",
    "readOnlyHint": true,
    "untrustedContentHint": true
  },
  "webMcpOutput": { "slots": ["14:00", "15:00"] },
  "webMcpOutputMeta": { "truncated": false, "byteLength": 28 },
  "extractionBatch": {
    "frameId": 0,
    "targetId": "webmcp:https://example.test:getAvailability",
    "extractedCount": 1
  }
}
```

Read-only output enters the existing canonical extraction pipeline. Mutation output is also retained in bounded execution evidence so identifiers such as booking confirmation IDs remain available. A `null` WebMCP return is represented as `navigationStarted: true` and uses the normal navigation-resume path.

## Exact Execution Versus Compact History

Executable payloads and planner context have different requirements:

- `pendingStepContext.actions` and the frontend command keep an exact JSON-safe copy of executable arguments.
- Oversized or invalid executable arguments are rejected; they are never trimmed or truncated.
- Per-action input is capped at 64 KiB, all actions in one plan at 256 KiB, nesting at 12 levels, collection size at 1,000 items or keys, and traversal at 10,000 nodes.
- Page output is normalized as untrusted data and capped at 64 KiB. Read-only extraction text is capped again before entering canonical extraction.
- Canonical history stores bounded structured WebMCP metadata and output summaries, not raw output.
- Planner-facing `actionResults` retains at most 20 ordered result records per batch; the exact executable actions remain separate.
- `sanitizePlannerHistory()` derives a smaller prompt view, including a compact preview of arguments and confirmation IDs when available.

This separation applies to WebMCP and ordinary custom/connector executions. Prompt compaction must never run on the action that will be executed.

## Delta And Action Effects

After execution, WebGPT compares the pre- and post-action frame state once for the whole batch:

- `webMcpTools` reports added, removed, or schema/annotation-changed tools by page identity.
- `untargetedFieldUpdates` reports independently observed group/control value changes for targetless semantic tools.
- `actionEffect` is the aggregate interpretation of the batch, and `verificationScope: "batch"` makes clear that one post-state delta cannot assign causality to an individual mutation;
- bounded ordered `actionResults` preserve each action's success, failure, not-executed status, and compact WebMCP output summary;
- read-only WebMCP result evidence uses `verification: "tool_output"`;
- an independently observed page, value, navigation, or tool-set change gives the aggregate effect `verification: "observed"`;
- a successful mutation callback without independent state evidence gives the aggregate effect `reported_change_unverified` with `verification: "reported"`;
- failed and unexecuted actions remain explicit even when an earlier action in the same batch produced useful evidence.

Callback completion alone is deliberately not proof that a requested mutation took effect.

## Safety And Replay Policy

- Tool descriptions, schemas, annotations, and output are website-provided and always treated as untrusted page content. `untrustedContentHint` is metadata, not a trust upgrade.
- Immediately before execution, the page runtime re-discovers the current-frame handle and matches page name, origin, schema hash, `readOnlyHint`, and `untrustedContentHint`. Drift fails closed.
- Starting a run authorizes planner-selected DOM, connector, and WebMCP actions that remain within the user goal. WebMCP mutations do not add a second confirmation or cloud opt-in.
- WebMCP actions are not saved or accepted as replay steps. A future replay design would need fresh discovery, authorization, schema validation, and effect verification.

## Automated Verification

```bash
# Frontend
node --test \
  test/webMcpSource.test.js \
  test/controlValueExtraction.test.js \
  test/controllerCore.test.mjs \
  test/browserbaseHost.test.mjs
npm test
npm run build
npm run smoke:extension

# Backend
cd ../webgpt-backend/web-agent-chrome-extension/BackEnd/planner-server
node --test \
  test/webMcpTools.test.js \
  test/webMcpPostStepEffects.test.js \
  test/webMcpHistoryReplay.test.js \
  test/planFromToolCalls.test.js \
  test/connectorActionNormalization.test.js
npm test
```

The dependency-free local fixture is documented in [`examples/simple-backend/README.md`](../examples/simple-backend/README.md).

## Manual Chrome Test

1. Use Chrome and open a page that exposes `document.modelContext` or `navigator.modelContext`. The Google Chrome Labs demos work with the extension without enabling `chrome://flags/#enable-webmcp-testing`; enable that flag only when testing a page that relies on Chrome's native experimental API instead of providing compatible page support.
2. Build WebGPT with `npm run build`, then reload `apps/extension-host/dist-extension` at `chrome://extensions`.
3. Start the planner backend and point the sidepanel Backend card at it.
4. Open Google's [booking explainer demo](https://googlechromelabs.github.io/webmcp-tools/demos/explainer/) or [pizza-maker demo](https://googlechromelabs.github.io/webmcp-tools/demos/pizza-maker/).
5. Verify discovery independently with `await (document.modelContext || navigator.modelContext).getTools()`. DevTools → Application → WebMCP may depend on native Chrome support.
6. Run a read goal first. Confirm the history records extraction with `tool_output` verification.
7. Run a booking/pizza mutation. Confirm WebGPT invokes the exact tool under the existing run consent, re-extracts state, and records `observed` or `reported` verification truthfully.

Browserbase uses the same bridge, but support still depends on the page or remote Chrome environment exposing `document.modelContext` or `navigator.modelContext`; the local extension test is the authoritative smoke test.
