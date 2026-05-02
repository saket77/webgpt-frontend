# WebGPT

![WebGPT icon](./icons/icon-128.png)

WebGPT is a Chrome extension frontend for AI-powered browser automation. It observes the active tab, extracts structured page state, sends that state to a compatible planner backend, and safely executes the browser commands returned by that backend.

Think of this repo as the browser-side runtime: sidepanel UI, tab/session orchestration, DOM extraction, action execution, replay support, and the HTTP adapter contract that lets planner backends plug in cleanly.

## Demo Video

Add the recorded demo here before publishing the repo:

[![Watch the WebGPT demo](https://i9.ytimg.com/vi_webp/2dVeTRBqNMU/mq2.webp?sqp=COzm2M8G-oaymwEmCMACELQB8quKqQMa8AEB-AH-CIAC0AWKAgwIABABGFggYChlMA8=&rs=AOn4CLCoW8cF8KR4H7XTugO1OiItfuEOfg)](https://youtu.be/2dVeTRBqNMU)


## Why WebGPT?

Web automation agents are easiest to iterate on when the browser runtime and planner backend have a crisp boundary. WebGPT keeps that boundary explicit.

- **Browser-native execution**: runs as a Chrome extension, using content scripts to inspect and operate on the current page.
- **Backend-agnostic planning**: use the hosted WebGPT planner or point the extension at any backend that speaks the documented command contract.
- **Structured page state**: extracts frames, controls, labels, scroll containers, URLs, titles, and site-adapter hints for planner use.
- **Human-in-the-loop recovery**: supports planner pauses, human hints, success confirmation, and rejected-success resume flows.
- **Navigation-aware loops**: detects likely navigation, waits for the new document, and resumes with fresh state.
- **OpenAPI contract**: the default HTTP planner API is documented in `docs/planner-http-api.openapi.yaml`.

## How It Works

```text
User goal
  -> sidepanel UI
  -> background controller
  -> content-script state extraction
  -> planner backend
  -> browser command
  -> content-script action runner
  -> post-action state extraction
  -> next planner turn
```

Backends do not need to know how to click DOM nodes directly. They return high-level browser commands such as:

- `extract_state`
- `run_actions`
- `wait_for_navigation`
- `ask_human`
- `done`
- `run_replay_batch`

The extension owns browser execution and lifecycle details.

## Quick Start

### 1. Build the Sidepanel

```bash
cd sidepanel-app
npm install
npm run build
```

The built sidepanel files are generated into `sidepanel-app/dist/`.

### 2. Load the Chrome Extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.

### 3. Choose a Backend

Open the WebGPT sidepanel and use the Backend card to choose a compatible planner backend.

Common options:

```text
https://webgpt-backend-production.up.railway.app
http://localhost:3000
http://localhost:8787
```

Use `http://localhost:8787` with the included simple backend.

## Run the Simple Backend

The simple backend is a tiny dependency-free server for testing the frontend contract. It does not plan or call an LLM; it returns one hardcoded action batch so you can verify the browser runtime.

```bash
cd examples/simple-backend
npm start
```

It listens on:

```text
http://127.0.0.1:8787
```

Configure the demo action:

```bash
WEBGPT_SIMPLE_TARGET_ID=el_45 \
WEBGPT_SIMPLE_FILL_TEXT="example search text" \
WEBGPT_SIMPLE_DELAY_MS=1000 \
PORT=8787 \
npm start
```

## Planner HTTP API

The default HTTP adapter is documented in:

- [Planner adapter contract](./docs/planner-adapter-contract.md)
- [OpenAPI spec](./docs/planner-http-api.openapi.yaml)

The most important loop is:

1. `POST /runs/start-command` starts a run and returns the first command.
2. `POST /runs/{runId}/command-result` sends browser-side progress and receives the next command.
3. `POST /runs/{runId}/provide-hint` records human guidance and resumes the normal extraction loop.
4. `POST /runs/{runId}/confirm-success` or `POST /runs/{runId}/reject-success` handles final user confirmation.

Command-result requests are discriminated by `type`, including:

- `state_extracted`
- `actions_executed`
- `navigation_detected`
- `navigation_completed`
- `replay_preflight_requested`
- `replay_batch_executed`

Command responses use the standard envelope:

```json
{
  "ok": true,
  "runId": "run_123",
  "run": {
    "runId": "run_123",
    "step": 2,
    "finalResult": null
  },
  "command": {
    "type": "run_actions",
    "step": 2,
    "actions": []
  },
  "extractedData": null
}
```

## Project Layout

```text
background/        Extension service worker, controller flows, session state, backend adapters
content-scripts/  DOM state extraction, action resolution, action execution, site adapters
sidepanel-app/    React sidepanel UI
docs/             Planner contracts, OpenAPI spec, adapter docs
examples/         Minimal compatible backend examples
icons/            Extension icons
```

## Site Adapters

Site adapters enrich extracted state for specific websites without giving those adapters authority to execute actions or call planner services directly.

Use them when generic DOM extraction needs domain context, stable target mapping, or planner hints.

Start here:

- [Site adapter authoring guide](./docs/site-adapter-authoring.md)

The Canvas quiz adapter is an example:

```text
content-scripts/adapters/canvasQuiz.js
```

## Development Commands

Sidepanel:

```bash
cd sidepanel-app
npm install
npm run build
npm run lint
```

Simple backend:

```bash
cd examples/simple-backend
npm start
```

Validate the OpenAPI YAML quickly:

```bash
ruby -e 'require "yaml"; YAML.load_file("docs/planner-http-api.openapi.yaml"); puts "YAML OK"'
```

## Design Principles

- Keep the browser controller backend-agnostic.
- Keep planner-specific routes and compatibility inside adapters.
- Prefer structured page state over screenshots or raw HTML dumps.
- Keep content scripts responsible for browser execution, not planning.
- Use the OpenAPI contract as the source of truth for compatible HTTP backends.
- Make human intervention explicit: hints, pauses, confirmations, and resume flows should be visible in the session history.

## Security

WebGPT executes actions in the active browser tab, so changes to extraction, target resolution, or action execution should be reviewed carefully.

Please read:

- [Security notes](./SECURITY.md)
- [Contributing guide](./CONTRIBUTING.md)

## Acknowledgments

WebGPT is built in the same open-source browser-agent ecosystem as projects like [Nanobrowser](https://github.com/nanobrowser/nanobrowser) and [Browser Use](https://github.com/browser-use/browser-use). Those projects are useful references for README structure, demo-first communication, and practical browser automation workflows.

## License

See [LICENSE](./LICENSE).
