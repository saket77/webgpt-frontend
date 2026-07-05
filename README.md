# WebGPT

![WebGPT icon](./apps/extension-host/src/icons/icon-128.png)

WebGPT is an open-source browser-agent runtime for AI browser agents.

It lets an AI planner observe a real browser page, extract structured page or runtime state, execute actions, pause for human confirmation, and replay successful workflows across multiple inputs.

Think of this repo as the frontend runtime system: shared in-page JavaScript, a host-agnostic controller loop, planner HTTP adapters, a Chrome extension host, and a Browserbase cloud-browser host.

Unlike one-off browser agents, WebGPT is built around a clean runtime/planner boundary:

- a runtime host owns browser execution
- the backend owns planning
- site adapters improve reliability on specific websites, including DOM-backed connector tools for high-friction page and document operations
- site adapters improve reliability on specific websites, including DOM-backed connector tools for high-friction page and document operations
- runtime adapters support non-DOM surfaces like Google Sheets and Microsoft Excel
- successful workflows can become replayable routines

## Featured Demo Series
## Featured Demo Series

[![Watch the WebGPT demo](https://i9.ytimg.com/vi_webp/J1yGDs0M-gA/mq1.webp?sqp=CJjp2M8G-oaymwEmCMACELQB8quKqQMa8AEB-AH-CIAC0AWKAgwIABABGBUgRih_MA8=&rs=AOn4CLCyBim_PHlqGOERym-W9Y5fh5O9YQ)](https://youtu.be/J1yGDs0M-gA)

The public Shorts series now shows WebGPT moving from repeatable browser routines into real work tools: websites, Microsoft Excel, Google Sheets, spreadsheet-to-browser workflows, and Dotloop PDFs.
The public Shorts series now shows WebGPT moving from repeatable browser routines into real work tools: websites, Microsoft Excel, Google Sheets, spreadsheet-to-browser workflows, and Dotloop PDFs.

## Public Demos
## Public Demos

| Demo | What it shows | Why it matters |
| --- | --- | --- |
| [1. WebGPT Routines: Philly Property Workflow](./docs/demos/demo-1-website-extraction.md) | WebGPT runs a Philadelphia property lookup and saves the successful path as a reusable routine | Browser agents should not rediscover the same workflow from zero every time |
| [2. WebGPT Works With Microsoft Excel](./docs/demos/demo-2-human-confirmation.md) | WebGPT connects to Microsoft Excel through settings, then creates a sample expense sheet with rows and a total cell | WebGPT can operate real work tools through API-backed runtime surfaces |
| [3. WebGPT Works Across Excel And Google Sheets](./docs/demos/demo-3-spreadsheet-runtime.md) | WebGPT handles spreadsheet tasks across Microsoft Excel and Google Sheets after OAuth is connected | One planner loop can work across multiple spreadsheet products |
| [4. Spreadsheet Rows Become Browser Tasks](./docs/demos/demo-4-replay-workflow.md) | WebGPT reads addresses from a spreadsheet, researches them on Philadelphia's property site, and writes results back | Shows a true cross-surface workflow: spreadsheet to browser, browser back to spreadsheet |
| [5. WebGPT Reads Dotloop PDFs](./docs/demos/demo-5-dotloop-pdf-vision.md) | WebGPT reads rendered Dotloop PDF pages with vision, maps labels to real editable overlay boxes, and fills the correct fields | WebGPT can understand PDF-like document pages without guessing at visual blanks |
| [1. WebGPT Routines: Philly Property Workflow](./docs/demos/demo-1-website-extraction.md) | WebGPT runs a Philadelphia property lookup and saves the successful path as a reusable routine | Browser agents should not rediscover the same workflow from zero every time |
| [2. WebGPT Works With Microsoft Excel](./docs/demos/demo-2-human-confirmation.md) | WebGPT connects to Microsoft Excel through settings, then creates a sample expense sheet with rows and a total cell | WebGPT can operate real work tools through API-backed runtime surfaces |
| [3. WebGPT Works Across Excel And Google Sheets](./docs/demos/demo-3-spreadsheet-runtime.md) | WebGPT handles spreadsheet tasks across Microsoft Excel and Google Sheets after OAuth is connected | One planner loop can work across multiple spreadsheet products |
| [4. Spreadsheet Rows Become Browser Tasks](./docs/demos/demo-4-replay-workflow.md) | WebGPT reads addresses from a spreadsheet, researches them on Philadelphia's property site, and writes results back | Shows a true cross-surface workflow: spreadsheet to browser, browser back to spreadsheet |
| [5. WebGPT Reads Dotloop PDFs](./docs/demos/demo-5-dotloop-pdf-vision.md) | WebGPT reads rendered Dotloop PDF pages with vision, maps labels to real editable overlay boxes, and fills the correct fields | WebGPT can understand PDF-like document pages without guessing at visual blanks |

## Public Demo Roadmap

- [x] Demo 1: WebGPT Routines: Philly Property Workflow
- [x] Demo 2: WebGPT Works With Microsoft Excel
- [x] Demo 3: WebGPT Works Across Excel And Google Sheets
- [x] Demo 4: Spreadsheet Rows Become Browser Tasks
- [x] Demo 5: WebGPT Reads Dotloop PDFs
- [x] Demo 1: WebGPT Routines: Philly Property Workflow
- [x] Demo 2: WebGPT Works With Microsoft Excel
- [x] Demo 3: WebGPT Works Across Excel And Google Sheets
- [x] Demo 4: Spreadsheet Rows Become Browser Tasks
- [x] Demo 5: WebGPT Reads Dotloop PDFs
- [ ] Demo 6: Custom backend using the OpenAPI contract
- [ ] Demo 7: Connector replay and navigation boundaries

## Why WebGPT?

Web automation agents are easiest to iterate on when the browser runtime and planner backend have a crisp boundary. WebGPT keeps that boundary explicit.

- **Browser-native execution**: runs in real browsers, including a Chrome extension host and a Browserbase cloud-browser host.
- **Backend-agnostic planning**: use the hosted WebGPT planner or point a runtime host at any backend that speaks the documented command contract.
- **Structured state**: extracts frames, controls, labels, scroll containers, URLs, titles, site-adapter hints, and runtime-specific state for planner use.
- **Connector-enabled adapters**: lets selected site adapters expose bounded page tools, such as multi-step select filling or document-field completion, without turning the site into a separate runtime.
- **Runtime surfaces**: can route non-DOM products such as Google Sheets and Microsoft Excel through dedicated runtime clients while preserving the same planner loop.
- **Human-in-the-loop recovery**: supports planner pauses, human hints, success confirmation, and rejected-success resume flows.
- **Navigation-aware loops**: detects likely navigation, waits for the new document, and resumes with fresh state.
- **OpenAPI contract**: the default HTTP planner API is documented in `docs/planner-http-api.openapi.yaml`.

## What Makes WebGPT Different?

Most browser agents combine planning, browser execution, and app-specific logic into one loop. WebGPT separates those concerns.

### Runtime hosts, not planner lock-in

Runtime hosts are responsible for browser state extraction, action execution, navigation handling, host-specific UX, runtime auth, and human confirmation.

The planner backend is swappable as long as it speaks the documented HTTP contract.

### Structured state over raw screenshots

WebGPT extracts structured browser state: URLs, frames, visible text, controls, labels, scroll containers, and adapter-provided hints.

This gives planner backends a cleaner interface than raw DOM dumps or screenshot-only reasoning.

### Site adapters for reliability

Site adapters add domain-specific state for websites where generic DOM extraction is not enough.

Most adapters are state-only: they enrich controls, groups, and planner hints so the backend can return normal browser actions. Some adapters are connector-enabled: they also expose narrowly scoped DOM-backed tools through `provideTools()` and local content-script executors. Connector tools are for operations where one planner action should reuse the adapter's page model to perform a bounded multi-step page interaction, such as committing a custom select value or filling real editable document overlay fields.
Most adapters are state-only: they enrich controls, groups, and planner hints so the backend can return normal browser actions. Some adapters are connector-enabled: they also expose narrowly scoped DOM-backed tools through `provideTools()` and local content-script executors. Connector tools are for operations where one planner action should reuse the adapter's page model to perform a bounded multi-step page interaction, such as committing a custom select value or filling real editable document overlay fields.

### Runtime adapters for non-DOM surfaces

Some apps are better controlled through APIs or app-specific state models instead of DOM clicks.

WebGPT's runtime surfaces are designed for products like Google Sheets, Microsoft Excel, and other structured workspaces.

Use a runtime when the durable state lives outside the DOM and the extension should execute API-like commands. Use a connector-enabled site adapter when the workflow is still a browser page, but the page needs a local helper to perform a reliable DOM-backed operation.

### Replayable workflows

WebGPT is designed to turn successful browser runs into reusable execution patterns, so workflows can be repeated across multiple inputs instead of starting from scratch every time.

## How It Works

```text
User goal or CLI goal
  -> runtime host
  -> controller-core
  -> page/runtime state extraction
  -> planner backend
  -> frontend command
  -> host runtime executor
  -> post-action state extraction
  -> next planner turn
```

The shared runtime packages are:

```text
@webgpt/page-runtime          In-page extractor, runner, site adapters, connector tools
@webgpt/controller-core       Host-agnostic planner command loop
@webgpt/planner-http-adapter  Default HTTP contract for compatible planner backends
```

The current hosts are:

```text
@webgpt/extension-host        Chrome extension, sidepanel, Chrome APIs, Sheets/Excel runtimes
@webgpt/browserbase-host      Local Node CLI/API host for Browserbase cloud browsers
```

For a deeper architecture map, see [Runtime Hosts](./docs/architecture/runtime-hosts.md).

Backends do not need to know how to click DOM nodes or call browser APIs directly. They return high-level commands such as:

- `extract_state`
- `run_actions`
- `run_google_sheets_commands`
- `run_microsoft_excel_commands`
- `wait_for_navigation`
- `ask_human`
- `done`
- `run_replay_batch`

The active host owns browser execution, runtime auth, runtime API calls, and lifecycle details.

## Quick Start

### 1. Build the Extension

```bash
npm install
npm run build
```

The loadable extension is generated into `apps/extension-host/dist-extension/`.

### 2. Load the Chrome Extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `apps/extension-host/dist-extension`.

### Package for Sharing

```bash
npm run package:extension
```

This rebuilds the extension and writes a lean loadable extension zip using the
manifest version, for example `../webgpt-extension-frontend-v1.0.2.zip`.
To choose a different output path:

```bash
npm run package:extension -- --output ../webgpt-extension-frontend-store.zip
```

Run `npm run smoke:extension` after building to verify the generated extension has the expected manifest, service worker, sidepanel assets, and content scripts.

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

## Browserbase Cloud Host

WebGPT also has a local Browserbase host in `apps/browserbase-host/`.

This is not a second planner and it does not use Browserbase Agents, Stagehand, or Director. Browserbase provides the cloud browser. WebGPT still owns the page-runtime scripts, state extraction, action runner, connector tools, controller loop, replay flow, and planner backend contract.

The Browserbase host:

1. creates a Browserbase session with `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID`
2. connects to the cloud browser with Playwright CDP
3. opens the requested URL
4. injects the same `@webgpt/page-runtime` scripts used by the extension
5. calls the same planner backend through `@webgpt/planner-http-adapter`
6. executes planner commands through `@webgpt/controller-core`
7. prints a Browserbase Live View URL, planner run ID, final result, and local JSONL event log

Dry-run the CLI wiring without spending Browserbase time:

```bash
npm run smoke:cloud
```

Run the eProcure bench against a running planner backend:

```bash
export BROWSERBASE_API_KEY=your_browserbase_key
export BROWSERBASE_PROJECT_ID=your_browserbase_project_id
npm run cloud:run -- --eprocure --backend http://localhost:3000
```

`--eprocure` expands to:

```text
https://eprocure.gov.in/eprocure/app?page=FrontEndLatestActiveTendersOrgwise&service=page&org=
```

with the default goal:

```text
Extract today's active tenders and return title, reference number, closing date, and bid opening date.
```

Run an arbitrary public page goal:

```bash
npm run cloud:run -- \
  --url "https://example.com" \
  --goal "Summarize the visible page state" \
  --backend http://localhost:3000
```

The CLI prints the Browserbase session ID, Live View URL when Browserbase returns one, planner run ID, status, final result, and a local JSONL event log path under `.webgpt-cloud-runs/`.

Browserbase host v1 supports public browser DOM runs, page-runtime site adapters, connector tools, replay batches where possible, ask-human pauses, and planner done/success results. It does not yet include scheduled routines, Browserbase Context auth persistence, email summaries, Google Sheets runtime commands, or Microsoft Excel runtime commands.

Because it runs from a CLI, the Browserbase host also acts as a browser-agent bench harness. Codex can run a real website task, inspect `.webgpt-cloud-runs/*.jsonl` plus backend artifacts, and help improve page-runtime or planner behavior without manually reloading the Chrome extension.

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
packages/page-runtime/       In-page extractor, runner, connector tools, and site adapters
packages/controller-core/    Planner command loop and host-agnostic controller ports
packages/planner-http-adapter/ Shared default WebGPT planner HTTP adapter
apps/extension-host/         Chrome extension host, service worker, sidepanel, icons, Chrome adapters
apps/browserbase-host/       Local Browserbase cloud-browser host and CLI bench runner
docs/                        Planner contracts, OpenAPI spec, adapter docs
examples/                    Minimal compatible backend examples
scripts/                     Build, smoke, and packaging scripts
```

## Site Adapters

Site adapters enrich extracted state for specific websites. State-only adapters only describe the page. Connector-enabled adapters can additionally expose bounded page tools that the planner calls through `run_actions`; those tools execute in the content script and reuse the same DOM detection logic as the adapter.

Use site adapters when generic DOM extraction needs domain context, stable target mapping, planner hints, or a small DOM-backed connector tool. Do not use them for API-backed products whose useful state is not reliably represented in the DOM.

Start here:

- [Site adapter authoring guide](./docs/site-adapter-authoring.md)

Examples:

```text
packages/page-runtime/src/content-scripts/adapters/canvasQuiz.js
packages/page-runtime/src/content-scripts/adapters/greenhouse.js
packages/page-runtime/src/content-scripts/adapters/dotloop.js
```

## Runtime Surfaces

Runtime surfaces are a sibling extension point to site adapters. Use them when a product is better controlled through a durable API or browser capability than through generic DOM clicks.

The first non-DOM runtimes are Google Sheets and Microsoft Excel:

```text
apps/extension-host/src/background/runtime/googleSheets.js
apps/extension-host/src/background/runtime/microsoftExcel.js
```

Google Sheets detects Sheets tabs, requests Sheets access through Chrome identity, extracts spreadsheet state, executes curated Sheets API commands, and routes Sheets replay steps through the same controller loop.

Microsoft Excel detects Excel workbooks opened in Microsoft 365 / SharePoint, requests Microsoft Graph access through Chrome identity and PKCE, resolves the workbook to a Graph drive item, extracts workbook state, executes curated Excel commands, and routes Excel replay steps through the same controller loop.

Start here:

- [Runtime authoring guide](./docs/runtime-authoring.md)
- [Google Sheets surface v0](./docs/surfaces/google-sheets-v0.md)
- [Microsoft Excel surface v0](./docs/surfaces/microsoft-excel-v0.md)

## Development Commands

Frontend workspace:

```bash
npm install
npm run build
npm run smoke:extension
npm run smoke:cloud
npm test
```

Browserbase cloud bench:

```bash
npm run cloud:run -- --eprocure --backend http://localhost:3000
```

Sidepanel lint:

```bash
cd apps/extension-host/sidepanel-app
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
