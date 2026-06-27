# WebGPT

![WebGPT icon](./icons/icon-128.png)

WebGPT is an open-source Chrome runtime for AI browser agents.

It lets an AI planner observe the current browser tab, extract structured page or runtime state, execute browser actions, pause for human confirmation, and replay successful workflows across multiple inputs.
WebGPT is an open-source Chrome runtime for AI browser agents.

It lets an AI planner observe the current browser tab, extract structured page or runtime state, execute browser actions, pause for human confirmation, and replay successful workflows across multiple inputs.

Think of this repo as the browser-side runtime: sidepanel UI, tab/session orchestration, DOM extraction, runtime surfaces, action execution, replay support, and the HTTP adapter contract that lets planner backends plug in cleanly.

Unlike one-off browser agents, WebGPT is built around a clean runtime/planner boundary:

- the Chrome extension owns browser execution
- the backend owns planning
- site adapters improve reliability on specific websites, including DOM-backed connector tools for high-friction page operations
- runtime adapters support non-DOM surfaces like Google Sheets and Microsoft Excel
- successful workflows can become replayable routines

## Featured Demo

[![Watch the WebGPT demo](https://i9.ytimg.com/vi_webp/J1yGDs0M-gA/mq1.webp?sqp=CJjp2M8G-oaymwEmCMACELQB8quKqQMa8AEB-AH-CIAC0AWKAgwIABABGBUgRih_MA8=&rs=AOn4CLCyBim_PHlqGOERym-W9Y5fh5O9YQ)](https://youtu.be/J1yGDs0M-gA)

## Demo Tracks

These are the public demo tracks for showing what WebGPT can do. The first four now have companion docs and public video coverage; upcoming tracks focus on connector-enabled adapters and compatible backend authoring.

| Demo | What it shows | Why it matters |
| --- | --- | --- |
| [1. Website extraction](./docs/demos/demo-1-website-extraction.md) | WebGPT reads a normal website, extracts visible information, and summarizes the result | Shows baseline browser-agent usefulness |
| [2. Human-confirmed form filling](./docs/demos/demo-2-human-confirmation.md) | WebGPT fills fields, pauses before a sensitive final action, and resumes after user confirmation | Shows safety and human-in-the-loop control |
| [3. Spreadsheet runtime](./docs/demos/demo-3-spreadsheet-runtime.md) | WebGPT works with Google Sheets or Microsoft Excel through runtime-specific state and commands | Shows WebGPT is more than DOM clicking |
| [4. Replay across inputs](./docs/demos/demo-4-replay-workflow.md) | WebGPT turns a successful run into a repeatable routine across multiple inputs | Shows the workflow layer, not just one-off automation |

## Public Demo Roadmap

- [x] Demo 1: Website extraction
- [x] Demo 2: Human-confirmed form filling
- [x] Demo 3: Google Sheets / Microsoft Excel runtime workflow
- [x] Demo 4: Replay a saved workflow across multiple inputs
- [ ] Demo 5: Connector-enabled site adapter workflow
- [ ] Demo 6: Custom backend using the OpenAPI contract
- [ ] Demo 7: Connector replay and navigation boundaries

## Why WebGPT?

Web automation agents are easiest to iterate on when the browser runtime and planner backend have a crisp boundary. WebGPT keeps that boundary explicit.

- **Browser-native execution**: runs as a Chrome extension, using content scripts to inspect and operate on the current page.
- **Backend-agnostic planning**: use the hosted WebGPT planner or point the extension at any backend that speaks the documented command contract.
- **Structured state**: extracts frames, controls, labels, scroll containers, URLs, titles, site-adapter hints, and runtime-specific state for planner use.
- **Connector-enabled adapters**: lets selected site adapters expose bounded page tools, such as multi-step select filling or document-field completion, without turning the site into a separate runtime.
- **Runtime surfaces**: can route non-DOM products such as Google Sheets and Microsoft Excel through dedicated runtime clients while preserving the same planner loop.
- **Human-in-the-loop recovery**: supports planner pauses, human hints, success confirmation, and rejected-success resume flows.
- **Navigation-aware loops**: detects likely navigation, waits for the new document, and resumes with fresh state.
- **OpenAPI contract**: the default HTTP planner API is documented in `docs/planner-http-api.openapi.yaml`.

## What Makes WebGPT Different?

Most browser agents combine planning, browser execution, and app-specific logic into one loop. WebGPT separates those concerns.

### Browser runtime, not planner lock-in

The extension is responsible for browser state extraction, action execution, navigation handling, sidepanel UX, runtime auth, and human confirmation.

The planner backend is swappable as long as it speaks the documented HTTP contract.

### Structured state over raw screenshots

WebGPT extracts structured browser state: URLs, frames, visible text, controls, labels, scroll containers, and adapter-provided hints.

This gives planner backends a cleaner interface than raw DOM dumps or screenshot-only reasoning.

### Site adapters for reliability

Site adapters add domain-specific state for websites where generic DOM extraction is not enough.

Most adapters are state-only: they enrich controls, groups, and planner hints so the backend can return normal browser actions. Some adapters are connector-enabled: they also expose narrowly scoped DOM-backed tools through `provideTools()` and local content-script executors. Connector tools are for operations where one planner action should reuse the adapter's page model to perform a bounded multi-step page interaction, such as committing a custom select value or filling a known set of document placeholders.

### Runtime adapters for non-DOM surfaces

Some apps are better controlled through APIs or app-specific state models instead of DOM clicks.

WebGPT's runtime surfaces are designed for products like Google Sheets, Microsoft Excel, and other structured workspaces.

Use a runtime when the durable state lives outside the DOM and the extension should execute API-like commands. Use a connector-enabled site adapter when the workflow is still a browser page, but the page needs a local helper to perform a reliable DOM-backed operation.

### Replayable workflows

WebGPT is designed to turn successful browser runs into reusable execution patterns, so workflows can be repeated across multiple inputs instead of starting from scratch every time.

## How It Works

```text
User goal
  -> sidepanel UI
  -> background controller
  -> runtime state extraction
  -> planner backend
  -> frontend command
  -> runtime executor
  -> post-action state extraction
  -> next planner turn
```

Backends do not need to know how to click DOM nodes or call browser APIs directly. They return high-level commands such as:

- `extract_state`
- `run_actions`
- `run_google_sheets_commands`
- `run_microsoft_excel_commands`
- `wait_for_navigation`
- `ask_human`
- `done`
- `run_replay_batch`

The extension owns browser execution, runtime auth, runtime API calls, and lifecycle details.

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

### Package for Sharing

```bash
node scripts/package-extension.mjs
```

This rebuilds the sidepanel and writes a lean loadable extension zip using the
manifest version, for example `../webgpt-extension-frontend-v1.0.2.zip`.
To choose a different output path:

```bash
node scripts/package-extension.mjs --output ../webgpt-extension-frontend-store.zip
```

### Package for Sharing

```bash
node scripts/package-extension.mjs
```

This rebuilds the sidepanel and writes a lean loadable extension zip using the
manifest version, for example `../webgpt-extension-frontend-v1.0.2.zip`.
To choose a different output path:

```bash
node scripts/package-extension.mjs --output ../webgpt-extension-frontend-store.zip
```

### 3. Choose a Backend

Open the WebGPT sidepanel and use the Backend card to choose a compatible planner backend.

WebGPT defaults to the hosted planner:

```text
https://webgpt-backend-production.up.railway.app
```

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
- `google_sheets_commands_executed`
- `microsoft_excel_commands_executed`
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
background/        Extension service worker, runtime surfaces, controller flows, session state, backend adapters
content-scripts/  DOM state extraction, action resolution, DOM action execution, site adapters
sidepanel-app/    React sidepanel UI
docs/             Planner contracts, OpenAPI spec, adapter docs
examples/         Minimal compatible backend examples
icons/            Extension icons
```

## Site Adapters

Site adapters enrich extracted state for specific websites. State-only adapters only describe the page. Connector-enabled adapters can additionally expose bounded page tools that the planner calls through `run_actions`; those tools execute in the content script and reuse the same DOM detection logic as the adapter.

Use site adapters when generic DOM extraction needs domain context, stable target mapping, planner hints, or a small DOM-backed connector tool. Do not use them for API-backed products whose useful state is not reliably represented in the DOM.

Start here:

- [Site adapter authoring guide](./docs/site-adapter-authoring.md)

Examples:

```text
content-scripts/adapters/canvasQuiz.js
content-scripts/adapters/greenhouse.js
content-scripts/adapters/dotloop.js
```

## Runtime Surfaces

Runtime surfaces are a sibling extension point to site adapters. Use them when a product is better controlled through a durable API or browser capability than through generic DOM clicks.

The first non-DOM runtimes are Google Sheets and Microsoft Excel:

```text
background/runtime/googleSheets.js
background/runtime/microsoftExcel.js
```

Google Sheets detects Sheets tabs, requests Sheets access through Chrome identity, extracts spreadsheet state, executes curated Sheets API commands, and routes Sheets replay steps through the same controller loop.

Microsoft Excel detects Excel workbooks opened in Microsoft 365 / SharePoint, requests Microsoft Graph access through Chrome identity and PKCE, resolves the workbook to a Graph drive item, extracts workbook state, executes curated Excel commands, and routes Excel replay steps through the same controller loop.

Start here:

- [Runtime authoring guide](./docs/runtime-authoring.md)
- [Google Sheets surface v0](./docs/surfaces/google-sheets-v0.md)
- [Microsoft Excel surface v0](./docs/surfaces/microsoft-excel-v0.md)

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
- Prefer structured page/runtime state over screenshots or raw HTML dumps.
- Keep content scripts and runtimes responsible for execution, not planning.
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
