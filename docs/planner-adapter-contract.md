# Planner Adapter Contract

This document describes how WebGPT frontend hosts talk to planner-capable backends.

There are two related contracts:

- The JavaScript `plannerAdapter` interface consumed by `packages/controller-core/`.
- The default HTTP API implemented by `packages/planner-http-adapter/`, described in [planner-http-api.openapi.yaml](./planner-http-api.openapi.yaml).

The extension defaults to the hosted WebGPT planner at:

```text
https://webgpt-backend-production.up.railway.app
```

If your backend already implements the default HTTP API, point the extension host at its base URL in the sidepanel Backend card or pass `--backend` to the Browserbase host CLI. If your backend uses different routes or payloads, provide a custom JavaScript adapter and pass it to `createControllerCore`.

## Controller-Facing Adapter

The controller expects an object with these methods:

```ts
type PlannerAdapter = {
  startCommandRun(args: StartCommandRunArgs): Promise<CommandResult>;
  startTemplateQueueCommand(args: StartTemplateQueueArgs): Promise<TemplateQueueCommandResult>;
  completeTemplateQueueItem(args: CompleteTemplateQueueItemArgs): Promise<TemplateQueueCompletion>;
  postCommandResult(args: CommandResultArgs): Promise<CommandResult>;
  getRun(args: { runId: string }): Promise<{ ok: true; run: RunSnapshot }>;
  provideHumanHint(args: ProvideHumanHintArgs): Promise<RunMutationResult>;
  confirmRunSuccess(args: { runId: string }): Promise<RunMutationResult>;
  rejectRunSuccess(args: { runId: string; hint?: string }): Promise<RunMutationResult>;
  fetchArtifacts(): Promise<SavedArtifactSummary[]>;
  saveSuccessfulArtifacts(args: { runId: string }): Promise<unknown>;
  stopRun(args: StopRunArgs): Promise<unknown>;

  syncSessionWithRun(session: LocalSession, run: RunSnapshot | null): LocalSession;
  buildBrowserContext(tabId: number, session: LocalSession, observedUrl?: string): BrowserContext;
  tryRunReplayPreflight(args: ReplayPreflightArgs): Promise<ReplayPreflightResult>;
};
```

The shared default implementation lives in [`packages/planner-http-adapter`](../packages/planner-http-adapter). The extension host wraps it in [`apps/extension-host/src/background/adapters/webgpt/plannerAdapter.js`](../apps/extension-host/src/background/adapters/webgpt/plannerAdapter.js) to resolve the sidepanel backend setting; the Browserbase host uses it directly with its CLI `--backend` option.

## Adapter Responsibilities

A planner adapter should:

- translate backend responses into frontend command objects
- preserve `run.step` and `run.finalResult` when the backend provides them
- build compact browser context for each planner turn
- report frontend progress through `postCommandResult`
- tolerate backend-owned fields without making the controller depend on them

The controller should remain backend-agnostic. Put route names, auth headers, response normalization, and backend-specific compatibility work inside an adapter.

## Browser Context

`buildBrowserContext(tabId, session, observedUrl)` returns the browser context sent to the backend:

```json
{
  "tabId": 123,
  "attachedTabId": 123,
  "lastKnownUrl": "https://example.com",
  "observedUrl": "https://example.com/pricing",
  "goal": "Find pricing",
  "step": 3
}
```

Backends may ignore fields they do not need, but they should treat `goal`, `step`, `surface`, and the observed URL fields as useful planner context.

For non-DOM runtimes, `surface` tells the backend which planner vocabulary to use:

```json
{
  "tabId": 123,
  "attachedTabId": 123,
  "surface": "google_sheets",
  "lastKnownUrl": "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0",
  "observedUrl": "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0",
  "url": "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0",
  "goal": "Mark row 12 complete",
  "step": 1
}
```

Microsoft Excel uses the same `surface` field with `microsoft_excel` and Excel/SharePoint URLs.

## Connector Tools In Browser State

Browser DOM state can include connector tools contributed by active site adapters. These are page-local function tools exposed by content scripts through `provideTools()`:

```json
{
  "url": "https://example.com/editor",
  "frames": {
    "0": {
      "siteAdapter": {
        "id": "example.site",
        "pageKind": "editor"
      },
      "connectorTools": [
        {
          "type": "function",
          "name": "example_fill_fields",
          "description": "Fill known Example fields on the current page.",
          "parameters": {
            "type": "object",
            "required": ["fieldValues"],
            "properties": {
              "fieldValues": {
                "type": "object"
              }
            }
          },
          "webgpt": {
            "adapterId": "example.site",
            "replayable": true,
            "mayCauseNavigation": false
          }
        }
      ]
    }
  }
}
```

Planner backends should treat connector tools as additional action tools for the current browser step. Tool metadata such as `webgpt.adapterId`, `webgpt.replayable`, and `webgpt.mayCauseNavigation` is for WebGPT routing, replay, and audit logs; it is not required in model-facing function schemas.

Connector actions are DOM-backed page operations, not runtime surface commands. They run through `run_actions`, execute in the content-script connector registry, and should reuse the same adapter logic that enriched state.

## WebMCP Tools In Browser State

When the browser exposes WebMCP, each frame can include `webMcp: { supported, tools, errors }`. A tool has its page-owned `name`, `origin`, JSON Schema `parameters`, `schemaHash`, and `readOnlyHint` / `untrustedContentHint` annotations. Backends should build model-facing schemas plus a separate private route map; the model must not be allowed to invent the owning frame, origin, page name, or schema hash.

WebMCP remains `browser_dom` work and executes through `run_actions`:

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
  "arguments": { "startDate": "2026-07-14" },
  "mayCauseNavigation": false
}
```

Only the nested `arguments` object is sent to the website. Executable arguments must be copied exactly within hard JSON/byte limits and rejected, never truncated, when invalid. Planner history and logs are separate compact derivatives and must never replace the executable action.

WebMCP calls participate in the normal ordered `run_actions` batch. Independent same-frame WebMCP, built-in, and connector actions may be mixed when all arguments and targets are already known. Starting the run authorizes all three action kinds within the user goal; WebMCP does not add a second mutation-consent command. Do not batch an action that depends on an earlier result or newly rendered state, and place any navigation-capable action last.

WebMCP results may include bounded `webMcpOutput`, `webMcpOutputMeta`, `navigationStarted`, and a read-only `extractionBatch`. Post-step `stateDelta` and `actionEffect` describe the entire batch; bounded ordered `actionResults` preserve per-action status and output evidence. `actionEffect.verificationScope: "batch"` prevents an observed aggregate delta from being misread as proof of a particular mutation. All website definitions and output are untrusted page content regardless of annotations. The complete contract and safety model are in [WebMCP integration](./webmcp.md).

## Run Snapshot

The backend `run` object is mostly opaque to the frontend. The controller currently reads:

- `step: number`
- `finalResult: any`

Recommended shape:

```json
{
  "runId": "run_123",
  "step": 4,
  "finalResult": {
    "summary": "Found the pricing page"
  }
}
```

## Frontend Result Types

The frontend host calls `postCommandResult` after each browser-side event. Compatible backends should understand these `type` values:

- `replay_preflight_requested`: asks whether a replay batch should run before normal planning.
- `state_extracted`: sends structured page or runtime state after extraction.
- `navigation_completed`: sends fresh state after a document navigation settles.
- `actions_executed`: sends action execution results and post-action state.
- `google_sheets_commands_executed`: sends Google Sheets runtime command results and post-command spreadsheet state.
- `microsoft_excel_commands_executed`: sends Microsoft Excel runtime command results and post-command workbook state.
- `navigation_detected`: reports likely navigation triggered by actions.
- `replay_batch_executed`: reports execution of a replay batch.

The exact HTTP request schema is documented in [planner-http-api.openapi.yaml](./planner-http-api.openapi.yaml).

## Backend Command Vocabulary

Backends respond with command objects consumed by [`packages/controller-core/src/controller/commands/router.js`](../packages/controller-core/src/controller/commands/router.js).

### `extract_state`

Capture current page state and send it back to the backend.

Common fields:

```json
{
  "type": "extract_state",
  "step": 1,
  "reason": "run_started",
  "meta": {}
}
```

### `navigation_completed`

Capture current page state after navigation.

```json
{
  "type": "navigation_completed",
  "step": 2,
  "reason": "navigation_completed",
  "meta": { "afterNavigation": true }
}
```

### `run_actions`

Execute browser actions through the content-script runner. Action `type` may be a built-in browser action such as `click` or `fill`, a connector tool name, or a generated WebMCP planner name exposed for the last extracted browser state.

```json
{
  "type": "run_actions",
  "step": 2,
  "actions": [
    {
      "type": "fill",
      "targetId": "el_12",
      "frameId": 0,
      "value": "example"
    }
  ],
  "plan": {
    "status": "act",
    "reasoning": "The search box is visible.",
    "summary": "Fill the search box."
  }
}
```

Actions are resolved against the extracted controls the frontend sent earlier. Use `frameId` when the target belongs to a non-primary frame.

Connector actions carry the arguments from their tool schema:

```json
{
  "type": "run_actions",
  "step": 2,
  "actions": [
    {
      "type": "example_fill_fields",
      "fieldValues": {
        "tenant_name": "Saket Mundhada"
      }
    }
  ]
}
```

Connector executors return normal action results. A useful connector result includes structured evidence such as committed values, skipped targets, failures, or an extraction batch so the backend can verify action effects.

Connector actions must not perform work across a document navigation boundary. If a connector action may navigate, it must be marked as navigation-capable by connector metadata, placed last in the batch, and followed by the normal navigation wait and fresh state extraction before any further work.

### `run_google_sheets_commands`

Execute curated Google Sheets runtime commands through the extension host's Google Sheets runtime. Browserbase host v1 does not implement this runtime.

```json
{
  "type": "run_google_sheets_commands",
  "surface": "google_sheets",
  "step": 2,
  "commands": [
    {
      "name": "write_values",
      "sheetName": "Customers",
      "range": "D12",
      "values": [["Done"]]
    }
  ],
  "plan": {
    "status": "continue",
    "reasoning": "Update the status cell for the matched customer.",
    "summary": "Mark the customer done."
  }
}
```

The current Google Sheets command vocabulary is documented in [Google Sheets surface v0](./surfaces/google-sheets-v0.md).

### `run_microsoft_excel_commands`

Execute curated Microsoft Excel runtime commands through the extension host's Microsoft Excel runtime. Browserbase host v1 does not implement this runtime.

```json
{
  "type": "run_microsoft_excel_commands",
  "surface": "microsoft_excel",
  "step": 2,
  "commands": [
    {
      "name": "write_range",
      "worksheetName": "Customers",
      "range": "D12",
      "values": [["Done"]]
    }
  ],
  "plan": {
    "status": "continue",
    "reasoning": "Update the status cell for the matched customer.",
    "summary": "Mark the customer done."
  }
}
```

The current Microsoft Excel command vocabulary is documented in [Microsoft Excel surface v0](./surfaces/microsoft-excel-v0.md).

### `run_replay_batch`

Execute saved replay steps before returning to normal planner commands.

```json
{
  "type": "run_replay_batch",
  "batch": { "steps": [] },
  "batchIndex": 0,
  "totalBatchCount": 1,
  "isFirstBatch": true,
  "mayCauseNavigation": false,
  "fileName": "replay.json"
}
```

Replay batches may include:

- Browser action steps with an `action` and `replayTarget`.
- Connector action steps with an `action.type` matching a registered connector tool and `replayTarget.kind = "connector-tool"`.
- Runtime surface steps with `surface` and `command`.

WebMCP actions are explicitly non-replayable. Replay generation omits them and replay ingestion rejects handcrafted WebMCP steps because a valid future replay would require fresh discovery, authorization, schema validation, and effect verification.

Connector replay is connector-native: the browser DOM runtime re-extracts current page state and calls the same connector executor used during normal `run_actions`. If the required adapter/tool is unavailable on the replay page, replay should fail clearly rather than silently replacing the connector action with unrelated DOM clicks.

Connector replay steps can include nested `inputBindings` so saved artifacts can template connector arguments such as `fieldValues`, `name`, `email`, `phone`, or `role`.

```json
{
  "action": {
    "type": "dotloop_add_person",
    "name": "<USER_PROVIDED_VALUE>",
    "email": "<USER_PROVIDED_VALUE>",
    "phone": "<USER_PROVIDED_VALUE>",
    "role": "<USER_PROVIDED_VALUE>",
    "inputBindings": [
      { "path": ["name"], "inputKey": "input_0", "originalValue": "Morgan Lee" },
      { "path": ["email"], "inputKey": "input_1", "originalValue": "morgan.lee@example.com" },
      { "path": ["phone"], "inputKey": "input_2", "originalValue": "215-555-0198" },
      { "path": ["role"], "inputKey": "input_3", "originalValue": "Tenant" }
    ]
  },
  "replayTarget": {
    "kind": "connector-tool",
    "snapshot": {
      "toolName": "dotloop_add_person",
      "adapterIds": ["dotloop.local"],
      "pageKind": "add_person_modal",
      "replayable": true,
      "mayCauseNavigation": false
    }
  }
}
```

### `wait_for_navigation`

Pause the loop while the browser finishes navigation.

```json
{
  "type": "wait_for_navigation",
  "step": 3,
  "observedUrl": "https://example.com/next",
  "source": "click"
}
```

### `ask_human`

Pause the run and request human guidance.

```json
{
  "type": "ask_human",
  "step": 4,
  "message": "Please choose an account before continuing."
}
```

### `done`

Tell the frontend the run appears complete and should enter success confirmation.

```json
{
  "type": "done",
  "step": 5,
  "summary": "Found the pricing page.",
  "finalResult": {
    "summary": "Found the pricing page."
  }
}
```

## HTTP API

The default adapter in [`packages/planner-http-adapter/src/api.js`](../packages/planner-http-adapter/src/api.js) uses these routes:

- `POST /runs/start-command`
- `POST /runs/:runId/command-result`
- `GET /runs/:runId`
- `POST /runs/:runId/provide-hint`
- `POST /runs/:runId/confirm-success`
- `POST /runs/:runId/reject-success`
- `POST /runs/:runId/stop`
- `POST /template-runs/start-command`
- `POST /template-runs/:templateRunId/complete-current-command`
- `GET /artifacts`
- `POST /save-successful-run`
- `POST /save-successful-execution-trace`
- `POST /save-successful-replay-artifacts`

Use [planner-http-api.openapi.yaml](./planner-http-api.openapi.yaml) as the machine-readable route and payload reference. The OpenAPI file lists the hosted WebGPT planner, a local full planner, and the local simple backend example as servers.

## Minimal Compatible Loop

The smallest useful backend can run this loop:

1. `POST /runs/start-command` returns `extract_state`.
2. `POST /runs/:runId/command-result` receives `state_extracted` and returns either `run_actions`, `ask_human`, or `done`.
3. If it returns `run_actions`, the next `command-result` receives `actions_executed`.
4. When it returns `done`, the user can confirm success through `POST /runs/:runId/confirm-success`.

For a dependency-free implementation, see [examples/simple-backend](../examples/simple-backend/README.md).

## Compatibility Checklist

A compatible backend or adapter should provide:

- a stable run ID for each run
- browser commands using the command vocabulary above
- `run.step` updates when useful
- `finalResult.summary` when a run completes
- handling for the frontend result types listed above
- successful JSON responses for artifact routes, even if artifact persistence is a no-op
- surface-aware routing when it accepts non-DOM states such as `google_sheets` and `microsoft_excel`
- connector-tool awareness when it accepts browser states with `connectorTools`
- custom action preservation for connector arguments such as `fieldKey`, `fieldValues`, booleans, and nested input bindings
- WebMCP route isolation, exact nested execution arguments, bounded result handling, verification-aware effects, and replay rejection when it accepts frames with `webMcp`

Keep backend-specific details out of the generic controller. The adapter boundary is what lets this frontend stay reusable.
