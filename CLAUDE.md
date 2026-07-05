# CLAUDE.md — WebGPT

Guide for working in this repo. WebGPT is an open-source browser-agent runtime:
**user intent → LLM planner → high-level commands → deterministic browser execution.** The split
is strict: a **runtime host owns execution** (DOM extraction, action execution, navigation,
host UX, OAuth/auth gates, human-in-the-loop) and a **swappable backend owns planning** over an HTTP
contract. Site adapters enrich extracted state; connector-enabled adapters may also expose bounded
DOM-backed tools through the local page-runtime connector registry. Site adapters never call the planner.

## Two repos
- **Frontend** (this repo, `webgpt-frontend/`) — npm workspace for shared runtime packages and
  external-app-shaped hosts:
  - `packages/page-runtime` (`@webgpt/page-runtime`) — in-page extractor, runner, site adapters, connector tools.
  - `packages/controller-core` (`@webgpt/controller-core`) — host-agnostic planner command loop.
  - `packages/planner-http-adapter` (`@webgpt/planner-http-adapter`) — default backend HTTP contract.
  - `apps/extension-host` (`@webgpt/extension-host`) — Chrome extension, sidepanel, Chrome APIs, Sheets/Excel runtimes.
  - `apps/browserbase-host` (`@webgpt/browserbase-host`) — local Node Browserbase cloud-browser host and CLI bench runner.
- **Backend** (`webgpt-backend/`) — active default planner server at
  `web-agent-chrome-extension/BackEnd/planner-server/` (Express 5, OpenAI SDK, CommonJS,
  `node --test`). `web-agent/` there is legacy/archived.

## Control loop (one run)
```
sidepanel or cloud CLI → runtime host startAgent(goal, inputValues, myInfo, surface)
  → controller-core startAgent → startAgentFlow (packages/controller-core/src/controller/flows/runFlow.js)
    → POST /runs/start-command → { runId, command }
    → continueRunFlow → driveCommand loop (packages/controller-core/src/controller/commands/{driver,router}.js):
        extract_state → runtime.extractStateFromTab → POST /runs/{id}/command-result → next command
        run_actions   → runtime.runActionsInTab → settle ~1s → re-extract → command-result → next
        done | ask_human | access_required | wait_for_navigation → terminal / pause
```
- Command types: `extract_state`, `run_actions`, `wait_for_navigation`, `run_google_sheets_commands`,
  `run_microsoft_excel_commands`, `run_replay_batch`, `ask_human`, `done`.
- `MAX_STEPS = 20`, settle delays in `packages/controller-core/src/config.js`, configured by each host.
- Extension host session state uses `chrome.storage.session`
  (`apps/extension-host/src/background/state/sessionStore.js`). Sidepanel↔background IPC uses
  `chrome.runtime.sendMessage` message types in `apps/extension-host/src/background/messages.js`.
- Browserbase host session state is in-memory for a single CLI/API run; events are written to
  `.webgpt-cloud-runs/*.jsonl`.

## Action schema (ground truth — targetId-based, NOT selectors)
The planner returns actions that reference the synthetic control id, not a CSS selector:
```json
{ "type": "click", "frameId": 0, "targetId": "el_163", "controlIds": ["el_163"],
  "context": { "inputLabel": "...", "inputValue": "No", "targetFields": ["question_..."] } }
```
Types: `click`, `fill` (value), `scroll`, `press`, `wait` (ms), `goto` (url), `extract`.

## Content scripts (the deterministic executors)
- **Injected programmatically** (NOT declared in `manifest.json`) by the active host, file-by-file in
  dependency order, into all frames. Extension host injects through Chrome scripting APIs from
  `apps/extension-host/src/background/runtime/browser.js`; Browserbase host injects through Playwright
  frame evaluation from `apps/browserbase-host/src/browserbaseRuntime.js`.
  The canonical order lives in `packages/page-runtime/src/manifest.js`.
  Modules are IIFEs on `globalThis.WebGPTExtractStateModules` / `window.WebGPTRunnerModules` — **order
  matters**; keep new files in the right place in that list.
- **Extension bridge only**: `apps/extension-host/src/content-scripts/agent.js`
  (`chrome.runtime.onMessage`): `WEBGPT_EXTRACT_STATE`, `WEBGPT_RUN_ACTIONS`, `WEBGPT_RUN_REPLAY`,
  `PING_WEBGPT`. Browserbase host does not inject this bridge.
- **Extract**: `packages/page-runtime/src/content-scripts/extractState.js` →
  `extract-state/controlBuilders.js` `buildControls()` assigns
  synthetic `el_*` ids + a best-effort stable `selector` + rich descriptor + bounds. The same `state`
  is sent back with the planner's actions so the runner can resolve `targetId`s.
- **Execute**: `packages/page-runtime/src/content-scripts/runner/actions.js` → `resolver.js`
  **re-resolves** the live element at act-time:
  stable-selector → semantic score (`controlScoring.js`, threshold ~35) → recorded bounds →
  brittle-selector fallback (survives DOM churn between extract and act). DOM ops in `primitives.js`
  (synthetic pointer/mouse sequence for click; native value setter + input/change for fill; special
  handling for `<select>` and rich-text editors).

## Site adapters and connector tools
`packages/page-runtime/src/content-scripts/adapters/registry.js` contract: `{ id, match({url,document}), priority, enhanceState({state,document,url}) }`.
Priority-sorted (higher first), composable (each gets the previous adapter's output), errors caught
per-adapter. State-only adapters **annotate existing `el_*` controls** via `enhanceControls(...)` and add
`siteAdapter` / `groups` / `plannerContext`; they must **not** mint fake click/fill targets (the runner
resolves `targetId` against extracted `state.controls`).

Connector-enabled adapters can also expose `provideTools()` schemas and register local
`WebGPTConnectorTools` executors. Those tools still run through `run_actions`; they are page-local
DOM helpers, not separate runtime surfaces. Because they live in `packages/page-runtime`, pure page-JS
adapters and connector tools are shared by both extension host and Browserbase host. They must not use
unguarded `chrome.*`.

## Backend (planner server)
- Endpoints: `POST /runs/start-command`, `POST /runs/{id}/command-result`, `/provide-hint`,
  `/confirm-success`, `/reject-success`, `/stop`; `POST /template-runs/...` for batch/templated runs.
- LLM: OpenAI SDK, model `OPENAI_PLANNER_MODEL` (`reasoning.effort` default `medium`). Planner prompt
  under `src/services/planner-input/`. Run artifacts logged to `planner-artifacts/` (useful ground
  truth for debugging the action schema and prompts).
- Philosophy (`.memories`): prefer rich, durable planner context over hard enforcement; treat
  `WORKFLOW_STATE` as task memory; don't overfit to one site; add guardrails only for safety/invalid actions.

## Current architecture focus
Keep hosts external-app-shaped. `apps/extension-host` and `apps/browserbase-host` should consume shared
WebGPT code through package imports (`@webgpt/page-runtime`, `@webgpt/controller-core`,
`@webgpt/planner-http-adapter`) rather than relative `packages/.../src` imports. The extension build
copies package sources into `dist-extension` and rewrites bare package imports to local dist paths for
Chrome.

Browserbase host v1 supports browser DOM runs, page-runtime adapters, connector tools, replay where
possible, ask-human terminal status, Browserbase Live View, and JSONL logs. It does not yet support
Browserbase Context persistence, scheduler/email, Google Sheets runtime commands, or Microsoft Excel
runtime commands.

## Run / build / test
- Frontend: `npm install && npm run build` → load `apps/extension-host/dist-extension` as an unpacked
  extension at `chrome://extensions` (Developer mode). Smoke: `npm run smoke:extension`. Tests: `npm test`.
- Browserbase cloud dry-run: `npm run smoke:cloud`.
- Browserbase cloud run: `npm run cloud:run -- --url "<url>" --goal "<goal>" --backend http://localhost:3000`.
  Default eProcure bench: `npm run cloud:run -- --eprocure --backend http://localhost:3000`.
  Live runs need `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID`, loaded from the environment or ignored
  `.env.local` files.
- Sidepanel lint: `cd apps/extension-host/sidepanel-app && npm run lint`.
- Backend (local): `cd ../webgpt-backend/web-agent-chrome-extension/BackEnd/planner-server && npm start`
  (needs `OPENAI_API_KEY`); point the sidepanel Backend card at `http://localhost:3000`. Tests: `npm test`.
- Frontend tests: in `test/` (run with `npm test` or `node --test`).

## Conventions
- Reuse the existing mechanisms — the command/router loop, the `el_*` extract → resolver targeting
  model, and the adapter `registry` pattern — rather than introducing new ones.
- New page-runtime content-script files must be added to `PAGE_RUNTIME_SCRIPT_FILES` in
  `packages/page-runtime/src/manifest.js`
  in correct dependency order.
- Keep shared code host-agnostic. `packages/page-runtime` must not contain unguarded `chrome.*`;
  Chrome bridge behavior belongs in `apps/extension-host/src/content-scripts/agent.js`.
- When a feature is complete or the user says "good job", "done", "donezo", or similar, perform a docs
  impact check before finalizing. Update README, CLAUDE, CONTRIBUTING, OpenAPI, docs, and relevant skills
  when behavior changed; otherwise state why no docs change was needed.
- Known leftover to clean up eventually: a `console.log("yes this one")` / `SYSENG-118923` debug check
  in `packages/page-runtime/src/content-scripts/extract-state/controlBuilders.js` ships in the injected script.
