# Planner Adapter Contract

This document describes how the WebGPT browser frontend talks to planner-capable backends.

There are two related contracts:

- The JavaScript `plannerAdapter` interface consumed by `background/controller/`.
- The default HTTP API implemented by `background/adapters/webgpt/`, described in [planner-http-api.openapi.yaml](./planner-http-api.openapi.yaml).

If your backend already implements the default HTTP API, point the extension at its base URL in the sidepanel Backend card. If your backend uses different routes or payloads, provide a custom JavaScript adapter and pass it to `createController`.

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

The default implementation is assembled in [`background/adapters/webgpt/plannerAdapter.js`](../background/adapters/webgpt/plannerAdapter.js).

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

Backends may ignore fields they do not need, but they should treat `goal`, `step`, and the observed URL fields as useful planner context.

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

The frontend calls `postCommandResult` after each browser-side event. Compatible backends should understand these `type` values:

- `replay_preflight_requested`: asks whether a replay batch should run before normal planning.
- `state_extracted`: sends structured page state after extraction.
- `navigation_completed`: sends fresh state after a document navigation settles.
- `actions_executed`: sends action execution results and post-action state.
- `navigation_detected`: reports likely navigation triggered by actions.
- `replay_batch_executed`: reports execution of a replay batch.

The exact HTTP request schema is documented in [planner-http-api.openapi.yaml](./planner-http-api.openapi.yaml).

## Backend Command Vocabulary

Backends respond with command objects consumed by [`background/controller/commands/router.js`](../background/controller/commands/router.js).

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

Execute browser actions through the content-script runner.

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

The default adapter in [`background/adapters/webgpt/api.js`](../background/adapters/webgpt/api.js) uses these routes:

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

Use [planner-http-api.openapi.yaml](./planner-http-api.openapi.yaml) as the machine-readable route and payload reference.

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

Keep backend-specific details out of the generic controller. The adapter boundary is what lets this frontend stay reusable.
