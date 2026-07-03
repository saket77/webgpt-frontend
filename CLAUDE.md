# CLAUDE.md — WebGPT

Guide for working in this repo. WebGPT is an open-source Chrome runtime for AI browser agents:
**user intent → LLM planner → high-level commands → deterministic browser execution.** The split
is strict — the **extension owns browser execution** (DOM extraction, action execution, navigation,
sidepanel UX, OAuth, human-in-the-loop) and a **swappable backend owns planning** over an HTTP
contract. Site adapters only *enrich* extracted state; they never execute actions or call the planner.

## Two repos
- **Frontend** (this repo, `webgpt-frontend/`) — npm workspace for the shared page runtime,
  host-agnostic controller core, and Chrome extension host. The MV3 service worker source is at
  `apps/extension-host/src/background/service-worker.js`; the loadable build is
  `apps/extension-host/dist-extension`.
- **Backend** (`webgpt-backend/`) — active planner server at
  `web-agent-chrome-extension/BackEnd/planner-server/` (Express 5, OpenAI SDK, CommonJS,
  `node --test`). `web-agent/` there is legacy/archived.

## Control loop (one run)
```
sidepanel → WEBGPT_START_AGENT(goal, inputValues, myInfo, surface)
  → extension-host controller startAgent → startAgentFlow (packages/controller-core/src/controller/flows/runFlow.js)
    → POST /runs/start-command → { runId, command }
    → continueRunFlow → driveCommand loop (packages/controller-core/src/controller/commands/{driver,router}.js):
        extract_state → runtime.extractStateFromTab → POST /runs/{id}/command-result → next command
        run_actions   → runtime.runActionsInTab → settle ~1s → re-extract → command-result → next
        done | ask_human | access_required | wait_for_navigation → terminal / pause
```
- Command types: `extract_state`, `run_actions`, `wait_for_navigation`, `run_google_sheets_commands`,
  `run_microsoft_excel_commands`, `run_replay_batch`, `ask_human`, `done`.
- `MAX_STEPS = 20`, settle delays in `packages/controller-core/src/config.js`, configured by the
  extension host. Session state uses `chrome.storage.session`
  (`apps/extension-host/src/background/state/sessionStore.js`). Sidepanel↔background IPC via
  `chrome.runtime.sendMessage` message types in `apps/extension-host/src/background/messages.js`.

## Action schema (ground truth — targetId-based, NOT selectors)
The planner returns actions that reference the synthetic control id, not a CSS selector:
```json
{ "type": "click", "frameId": 0, "targetId": "el_163", "controlIds": ["el_163"],
  "context": { "inputLabel": "...", "inputValue": "No", "targetFields": ["question_..."] } }
```
Types: `click`, `fill` (value), `scroll`, `press`, `wait` (ms), `goto` (url), `extract`.

## Content scripts (the deterministic executors)
- **Injected programmatically** (NOT declared in `manifest.json`) from
  `apps/extension-host/src/background/runtime/browser.js`, file-by-file in dependency order, into all frames.
  The canonical order lives in `packages/page-runtime/src/manifest.js`.
  Modules are IIFEs on `globalThis.WebGPTExtractStateModules` / `window.WebGPTRunnerModules` — **order
  matters**; keep new files in the right place in that list.
- **Bridge**: `apps/extension-host/src/content-scripts/agent.js` (`chrome.runtime.onMessage`): `WEBGPT_EXTRACT_STATE`,
  `WEBGPT_RUN_ACTIONS`, `WEBGPT_RUN_REPLAY`, `PING_WEBGPT`.
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

## Site adapters — enrich only
`packages/page-runtime/src/content-scripts/adapters/registry.js` contract: `{ id, match({url,document}), priority, enhanceState({state,document,url}) }`.
Priority-sorted (higher first), composable (each gets the previous adapter's output), errors caught
per-adapter. Adapters **annotate existing `el_*` controls** via `enhanceControls(...)` and add
`siteAdapter` / `groups` / `plannerContext`; they must **not** mint new click/fill targets (the runner
resolves `targetId` against extracted `state.controls`). Examples: `ashby.js` (85), `greenhouse.js` (84),
`yelp.js`, `ncmMovieCalendar.js`, `canvasQuiz.js`, `docusign.js`, `dotloop.js`.

## Backend (planner server)
- Endpoints: `POST /runs/start-command`, `POST /runs/{id}/command-result`, `/provide-hint`,
  `/confirm-success`, `/reject-success`, `/stop`; `POST /template-runs/...` for batch/templated runs.
- LLM: OpenAI SDK, model `OPENAI_PLANNER_MODEL` (`reasoning.effort` default `medium`). Planner prompt
  under `src/services/planner-input/`. Run artifacts logged to `planner-artifacts/` (useful ground
  truth for debugging the action schema and prompts).
- Philosophy (`.memories`): prefer rich, durable planner context over hard enforcement; treat
  `WORKFLOW_STATE` as task memory; don't overfit to one site; add guardrails only for safety/invalid actions.

## Current focus
**Job-application autofill.** In flight (uncommitted on `develop`): the **MyInfo** profile feature
(stored in `chrome.storage.local` as `webgpt_my_info_v1` via `background/settings/myInfoConfig.js`,
injected per-run as `myInfo` and surfaced in the sidepanel `MyInfoCard`), the **Ashby + Greenhouse
ATS adapters**, and a **`role="option"` combobox extraction** fix in `controlBuilders.js` that makes
each visible dropdown option an individually targetable control.

## Run / build / test
- Frontend: `npm install && npm run build` → load `apps/extension-host/dist-extension` as an unpacked
  extension at `chrome://extensions` (Developer mode). Smoke: `npm run smoke:extension`. Tests: `npm test`.
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
- Known leftover to clean up eventually: a `console.log("yes this one")` / `SYSENG-118923` debug check
  in `packages/page-runtime/src/content-scripts/extract-state/controlBuilders.js` ships in the injected script.
