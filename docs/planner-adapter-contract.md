# Planner Adapter Contract

This document describes the contract between the extension frontend and a compatible planner backend.

There are two ways to be compatible with the frontend:

1. Implement the same HTTP contract as the default WebGPT backend.
2. Provide a custom `plannerAdapter` object that translates another planner-capable backend into the controller contract.

If your backend already matches the default HTTP routes and response shapes, no frontend code changes are required. Point the frontend at your backend URL and it should work.

If your backend uses different routes or different payloads, you can still integrate by creating a custom planner adapter and passing it to [`createController`](../background/controller/index.js). That adapter must translate your backend's planner responses into the controller-facing contract documented here; it does not make an arbitrary non-planner backend compatible.

## Contract Layers

The planner integration has two layers:

1. The `plannerAdapter` interface consumed by the controller.
2. The default WebGPT HTTP wire contract implemented by [`background/adapters/webgpt/api.js`](../background/adapters/webgpt/api.js).

The controller only knows the adapter surface. The default WebGPT adapter translates that surface into HTTP calls.

## Planner Adapter Surface

The controller currently expects a `plannerAdapter` with the following methods:

### Required Transport Methods

- `startCommandRun`
- `startTemplateQueueCommand`
- `completeTemplateQueueItem`
- `postCommandResult`
- `getRun`
- `provideHumanHint`
- `confirmRunSuccess`
- `rejectRunSuccess`
- `fetchArtifacts`
- `saveSuccessfulArtifacts`
- `stopRun`

### Required Helper Methods

- `syncSessionWithRun`
- `buildBrowserContext`
- `tryRunReplayPreflight`

The default implementation is assembled in [`background/adapters/webgpt/plannerAdapter.js`](../background/adapters/webgpt/plannerAdapter.js).

## Helper Method Semantics

These helper methods are part of the contract because the controller uses them directly.

### `syncSessionWithRun(session, run)`

The controller expects this helper to merge useful backend run fields into the local session.

The default implementation currently uses only:

- `run.step`
- `run.finalResult`

That means a compatible backend should treat these run fields as the important frontend-facing fields.

The default behavior is defined in [`background/adapters/webgpt/runContext.js`](../background/adapters/webgpt/runContext.js).

### `buildBrowserContext(tabId, session, observedUrl)`

The controller sends browser context to the backend with this shape:

```json
{
  "tabId": 123,
  "attachedTabId": 123,
  "lastKnownUrl": "https://example.com",
  "observedUrl": "https://example.com/page",
  "goal": "Find pricing",
  "step": 3
}
```

This helper is used for:

- normal step execution
- navigation detection
- human hint resume
- replay reporting

### `tryRunReplayPreflight({ runId, artifactFileName })`

This is a planner-adapter convenience method, not a separate backend route.

The default WebGPT adapter implements it by sending `postCommandResult({ type: "replay_preflight_requested" })` and then reading the returned command.

Expected return shape:

```json
{
  "skipped": false,
  "command": { "type": "run_replay_batch" },
  "run": { "step": 0 }
}
```

## Run Snapshot Shape

The frontend stores its own local session state, but it also accepts a backend `run` snapshot.

The backend `run` object is treated as mostly opaque except for:

- `step: number`
- `finalResult: any`

Everything else may exist for backend purposes, but the current controller does not rely on it.

Recommended backend run shape:

```json
{
  "runId": "run_123",
  "step": 4,
  "finalResult": {
    "summary": "Found the pricing page"
  }
}
```

## Default HTTP Contract

This section documents the routes used by the default WebGPT planner adapter.

### `POST /runs/start-command`

Purpose: begin a run and return the first planner command.

Request body:

```json
{
  "goal": "Find pricing",
  "inputValues": {},
  "isTemplateRun": false,
  "state": null,
  "userHint": "",
  "browserContext": {},
  "artifactFileName": ""
}
```

Required response fields:

- `ok: true`
- `runId: string`
- `command: object`

Optional response fields:

- `run: object`

Example response:

```json
{
  "ok": true,
  "runId": "run_123",
  "run": { "step": 0 },
  "command": {
    "type": "extract_state",
    "step": 1,
    "reason": "run_started"
  }
}
```

### `POST /template-runs/start-command`

Purpose: begin a template queue and return the first item command.

Request body:

```json
{
  "goalTemplate": "Find pricing for {{company}}",
  "inputSchema": [],
  "inputValues": {},
  "artifactFileName": ""
}
```

Required response fields:

- `ok: true`
- `templateRunId: string`
- `runId: string`
- `command: object`

Optional but strongly expected fields:

- `queue: object`
- `item: object`
- `run: object`

### `POST /template-runs/:templateRunId/complete-current-command`

Purpose: mark the current template item done and return the next item or finished queue state.

Request body:

```json
{
  "runId": "run_123",
  "summary": "Completed item",
  "finalResult": {}
}
```

Required response fields:

- `ok: true`
- `status: "finished" | string`

Optional but used by the frontend when present:

- `templateRunId`
- `queue`
- `completedItem`
- `results`
- `item`
- `runId`
- `run`
- `command`

### `GET /runs/:runId`

Purpose: fetch the latest run snapshot.

Required response fields:

- `ok: true`
- `run: object`

### `POST /runs/:runId/command-result`

Purpose: submit the latest browser-side result and receive the next command.

Request body:

```json
{
  "type": "state_extracted",
  "step": null,
  "command": {},
  "state": null,
  "execution": null,
  "postState": null,
  "userHint": "",
  "browserContext": {},
  "artifactFileName": "",
  "navigationInfo": {},
  "batchResult": null,
  "navigationInterrupted": false
}
```

Required response fields:

- `ok: true`
- `command: object`

Optional but strongly recommended fields:

- `run: object`
- `runId: string`
- `extractedData: object`

Example response:

```json
{
  "ok": true,
  "runId": "run_123",
  "run": { "step": 1 },
  "command": {
    "type": "run_actions",
    "step": 1,
    "actions": []
  }
}
```

### `POST /runs/:runId/provide-hint`

Purpose: resume a paused run with human input.

Request body:

```json
{
  "hint": "Click the pricing tab",
  "state": {},
  "browserContext": {}
}
```

Required response fields:

- `ok: true`

Optional but recommended fields:

- `run: object`

### `POST /runs/:runId/confirm-success`

Purpose: accept the run’s completion.

Required response fields:

- `ok: true`

Optional but recommended fields:

- `run: object`

### `POST /runs/:runId/reject-success`

Purpose: reject completion and resume the run with a new hint.

Request body:

```json
{
  "hint": "You found the wrong pricing section"
}
```

Required response fields:

- `ok: true`

Optional but recommended fields:

- `run: object`

### `POST /runs/:runId/stop`

Purpose: stop or delete a backend run.

Request body:

```json
{
  "reason": "stop_requested",
  "message": "User requested stop.",
  "deleteRun": false
}
```

Required response fields:

- `ok: true`

### `GET /artifacts`

Purpose: list saved successful artifacts.

Required response fields:

- `ok: true`
- `artifacts: array`

### `POST /save-successful-run`
### `POST /save-successful-execution-trace`
### `POST /save-successful-replay-artifacts`

Purpose: persist artifacts after a successful non-template run.

Request body:

```json
{
  "runId": "run_123"
}
```

Required response fields:

- anything parseable as JSON and not an error response

The frontend currently forwards these results to the UI/event log but does not impose a strict field-level schema beyond successful HTTP/JSON handling.

## Frontend-to-Backend Result Types

The frontend reports progress to `postCommandResult` with a `type` field. A compatible backend must understand these values.

### `replay_preflight_requested`

Sent before a template or replay-capable run begins so the backend can return either:

- a replay command like `run_replay_batch`
- or a normal next command
- or a replay-skipped response embedded in the returned command

### `state_extracted`

Sent after normal page state extraction.

Payload usually includes:

- `state`
- `userHint`
- `browserContext`

### `navigation_completed`

Sent after the frontend resumes from a completed browser navigation and extracts fresh state.

Payload is similar to `state_extracted`, but the backend can use the type to distinguish navigation resumption from the initial extract.

### `actions_executed`

Sent after browser actions run successfully and a post-action state is captured.

Payload usually includes:

- `command`
- `execution`
- `postState`
- `browserContext`

### `navigation_detected`

Sent when the frontend detects or strongly infers that actions triggered navigation.

Payload usually includes:

- synthetic or partial `execution`
- `browserContext`
- `navigationInfo`

### `replay_batch_executed`

Sent after a replay batch runs.

Payload usually includes:

- `command`
- `batchResult`
- `navigationInterrupted`
- `navigationInfo`

## Backend-to-Frontend Command Vocabulary

The backend responds with commands that the controller understands. These commands are consumed by [`background/controller/commands/router.js`](../background/controller/commands/router.js).

### `extract_state`

Meaning: capture current page state and send it back to the backend.

Used by:

- initial run start
- normal loop continuation

Common fields:

- `type: "extract_state"`
- `step: number`
- `reason: string`
- `meta: object` optional
- `replay: object` optional

### `navigation_completed`

Meaning: capture state after navigation has settled.

The controller handles this similarly to `extract_state`, but it marks the extract as navigation-related.

Common fields:

- `type: "navigation_completed"`
- `step: number`
- `reason: "navigation_completed"`
- `meta: { afterNavigation: true }` optional but recommended

### `run_actions`

Meaning: execute browser actions.

Required fields:

- `type: "run_actions"`
- `actions: array`

Strongly recommended fields:

- `step: number`
- `plan: object`

Action items may contain a backend-selected `frameId`, which the runtime uses to choose the target frame.

### `run_replay_batch`

Meaning: execute replay steps before normal planner-driven actions.

Common fields:

- `type: "run_replay_batch"`
- `batch: { steps: array }`
- `batchIndex: number`
- `totalBatchCount: number`
- `isFirstBatch: boolean`
- `mayCauseNavigation: boolean`
- `fileName: string`

### `wait_for_navigation`

Meaning: enter navigation wait mode without extracting state immediately.

Common fields:

- `type: "wait_for_navigation"`
- `step: number`
- `observedUrl: string` optional
- `url: string` optional
- `source: string` optional

### `ask_human`

Meaning: pause the run and request human guidance.

Common fields:

- `type: "ask_human"`
- `step: number`
- `message: string` optional
- `plan: object` optional

If both `message` and `plan.reasoning` are absent, the frontend falls back to a generic prompt.

### `done`

Meaning: the backend believes the task is complete and wants the frontend to enter success confirmation.

Common fields:

- `type: "done"`
- `step: number`
- `summary: string` optional
- `plannerSummary: string` optional
- `finalResult: any` optional
- `plan: object` optional

If `finalResult` is present, it will be stored in the local session and surfaced during success confirmation.

## Optional Fields The Frontend Uses When Present

The frontend tolerates some missing fields, but these are useful and should be included when available:

- `command.plan`
- `command.summary`
- `command.plannerSummary`
- `command.replay`
- `run.step`
- `run.finalResult`
- `extractedData`

## Minimal Mock Backend Loop

If you want the smallest possible compatible backend for testing, one happy-path loop is enough.

### Step 1: Start Command

Return this from `POST /runs/start-command`:

```json
{
  "ok": true,
  "runId": "demo_run",
  "run": { "step": 0 },
  "command": {
    "type": "extract_state",
    "step": 1,
    "reason": "run_started"
  }
}
```

### Step 2: State Extracted

When the frontend calls `POST /runs/demo_run/command-result` with `type: "state_extracted"`, return:

```json
{
  "ok": true,
  "runId": "demo_run",
  "run": {
    "step": 1,
    "finalResult": {
      "summary": "Mock backend completed after one extract"
    }
  },
  "command": {
    "type": "done",
    "step": 1,
    "summary": "Mock backend completed after one extract",
    "finalResult": {
      "summary": "Mock backend completed after one extract"
    }
  }
}
```

### Step 3: Success Confirmation

When the frontend calls `POST /runs/demo_run/confirm-success`, return:

```json
{
  "ok": true,
  "run": {
    "step": 1,
    "finalResult": {
      "summary": "Mock backend completed after one extract"
    }
  }
}
```

That is enough to prove the frontend can run end-to-end with a compatible backend even if there is no real planner yet.

## Compatibility Summary

To be compatible with this frontend, a backend must provide:

1. the planner adapter surface directly, or the equivalent WebGPT HTTP routes through a translating adapter
2. run snapshots containing at least `step` and optionally `finalResult`
3. support for frontend result `type` values posted to `command-result`
4. backend commands using the command vocabulary documented above

Whether you match the default HTTP contract directly or use a custom adapter, the underlying backend still needs to be planner-capable enough to produce the command vocabulary and run semantics described here.
