# CLAUDE.md — WebGPT

Guide for working in this repo. WebGPT is an open-source Chrome runtime for AI browser agents:
**user intent → LLM planner → high-level commands → deterministic browser execution.** The split
is strict — the **extension owns browser execution** (DOM extraction, action execution, navigation,
sidepanel UX, OAuth, human-in-the-loop) and a **swappable backend owns planning** over an HTTP
contract. Site adapters only *enrich* extracted state; they never execute actions or call the planner.

## Two repos
- **Frontend** (this repo, `webgpt-frontend/`) — Chrome extension, MV3. Service worker at
  `background/service-worker.js`. Latest work is on branch `develop`.
- **Backend** (`webgpt-backend/`) — active planner server at
  `web-agent-chrome-extension/BackEnd/planner-server/` (Express 5, OpenAI SDK, CommonJS,
  `node --test`). `web-agent/` there is legacy/archived.

## Control loop (one run)
```
sidepanel → WEBGPT_START_AGENT(goal, inputValues, myInfo, surface)
  → background controller startAgent → startAgentFlow (background/controller/flows/runFlow.js)
    → POST /runs/start-command → { runId, command }
    → continueRunFlow → driveCommand loop (background/controller/commands/{driver,router}.js):
        extract_state → runtime.extractStateFromTab → POST /runs/{id}/command-result → next command
        run_actions   → runtime.runActionsInTab → settle ~1s → re-extract → command-result → next
        done | ask_human | access_required | wait_for_navigation → terminal / pause
```
- Command types: `extract_state`, `run_actions`, `wait_for_navigation`, `run_google_sheets_commands`,
  `run_microsoft_excel_commands`, `run_replay_batch`, `ask_human`, `done`.
- `MAX_STEPS = 20`, settle delays in `background/config.js`. Session state in `chrome.storage.session`
  (`background/state/sessionStore.js`). Sidepanel↔background IPC via `chrome.runtime.sendMessage`
  message types in `background/messages.js`.

## Action schema (ground truth — targetId-based, NOT selectors)
The planner returns actions that reference the synthetic control id, not a CSS selector:
```json
{ "type": "click", "frameId": 0, "targetId": "el_163", "controlIds": ["el_163"],
  "context": { "inputLabel": "...", "inputValue": "No", "targetFields": ["question_..."] } }
```
Types: `click`, `fill` (value), `scroll`, `press`, `wait` (ms), `goto` (url), `extract`.

## Content scripts (the deterministic executors)
- **Injected programmatically** (NOT declared in `manifest.json`) from `background/runtime/browser.js`
  (`CONTENT_SCRIPT_FILES`, `injectContentScripts`), file-by-file in dependency order, into all frames.
  Modules are IIFEs on `globalThis.WebGPTExtractStateModules` / `window.WebGPTRunnerModules` — **order
  matters**; keep new files in the right place in that list.
- **Bridge**: `content-scripts/agent.js` (`chrome.runtime.onMessage`): `WEBGPT_EXTRACT_STATE`,
  `WEBGPT_RUN_ACTIONS`, `WEBGPT_RUN_REPLAY`, `PING_WEBGPT`.
- **Extract**: `extractState.js` → `extract-state/controlBuilders.js` `buildControls()` assigns
  synthetic `el_*` ids + a best-effort stable `selector` + rich descriptor + bounds. The same `state`
  is sent back with the planner's actions so the runner can resolve `targetId`s.
- **Execute**: `runner/actions.js` → `resolver.js` **re-resolves** the live element at act-time:
  stable-selector → semantic score (`controlScoring.js`, threshold ~35) → recorded bounds →
  brittle-selector fallback (survives DOM churn between extract and act). DOM ops in `primitives.js`
  (synthetic pointer/mouse sequence for click; native value setter + input/change for fill; special
  handling for `<select>` and rich-text editors).

## Site adapters — enrich only
`content-scripts/adapters/registry.js` contract: `{ id, match({url,document}), priority, enhanceState({state,document,url}) }`.
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
- Sidepanel: `cd sidepanel-app && npm install && npm run build` → load the repo root as an unpacked
  extension at `chrome://extensions` (Developer mode). Lint: `npm run lint`.
- Backend (local): `cd ../webgpt-backend/web-agent-chrome-extension/BackEnd/planner-server && npm start`
  (needs `OPENAI_API_KEY`); point the sidepanel Backend card at `http://localhost:3000`. Tests: `npm test`.
- Frontend tests: in `test/` (run with `node --test`).

## Conventions
- Reuse the existing mechanisms — the command/router loop, the `el_*` extract → resolver targeting
  model, and the adapter `registry` pattern — rather than introducing new ones.
- New content-script files must be added to `CONTENT_SCRIPT_FILES` in `background/runtime/browser.js`
  in correct dependency order.
- Known leftover to clean up eventually: a `console.log("yes this one")` / `SYSENG-118923` debug check
  in `content-scripts/extract-state/controlBuilders.js` ships in the injected script.
