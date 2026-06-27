# Runtime Authoring Guide

Runtime surfaces let WebGPT operate against something other than the generic browser DOM while keeping the same sidepanel, controller loop, backend adapter, replay flow, and success-confirmation UX.

A runtime owns how work is observed and executed for one surface. The backend still owns planning. The frontend runtime should expose state and execute a small command vocabulary; it should not decide what the user wants or hide business logic in the extension.

## Mental Model

The frontend loop stays the same:

1. The sidepanel starts a run and sends `surface` to the backend.
2. The backend returns `extract_state`.
3. `background/runtime/index.js` routes extraction to the active runtime.
4. The backend plans against that runtime's state and command vocabulary.
5. The backend returns a surface-specific command.
6. The frontend command router executes through the runtime.
7. The frontend extracts fresh state and posts the result back.
8. Replay, templates, extracted data, and success confirmation keep using the normal backend contract.

This is different from a connector-enabled site adapter. A site adapter still starts from browser DOM state and page-local interactions. A connector-enabled adapter can expose a bounded DOM-backed tool for a specific page operation, but it still lives inside `run_actions` and the content-script runner. A runtime can have its own state shape, auth, API calls, replay steps, and command vocabulary.

## Current Files

Runtime code lives in:

```text
background/runtime/
  browser.js        Browser DOM runtime: content-script extraction, DOM action execution, DOM replay
  googleSheets.js   Google Sheets runtime: Chrome identity auth, Sheets API extraction, Sheets command execution
  microsoftExcel.js Microsoft Excel runtime: Microsoft auth, Graph extraction, Excel command execution
  index.js          Runtime facade used by the controller
  surfaces.js       Surface IDs and active-tab detection
```

Runtime commands are dispatched from:

```text
background/controller/commands/router.js
background/controller/commands/runActions.js
background/controller/commands/runGoogleSheetsCommands.js
background/controller/commands/runMicrosoftExcelCommands.js
background/controller/commands/replayBatch.js
```

The sidepanel decides pre-run permissions and passes `surface` through:

```text
sidepanel-app/src/controllers/useAgentRunController.ts
sidepanel-app/src/components/agent/PreRunDisclosureModal.tsx
background/messages.js
background/adapters/webgpt/api.js
```

## Runtime Interface

`background/runtime/index.js` is the facade the controller talks to. A new runtime should fit this shape:

```js
{
  async extractStateFromTab(tabId, options) {},
  async runReplayActionsInTab(tabId, replaySteps) {},

  // Surface-specific methods are okay when paired with a command executor.
  async runExampleCommandsInTab(tabId, state, commands) {},

  // Optional pre-run auth/config hooks.
  async getExampleAuthStatus() {},
  async connectExample() {},
}
```

The facade should route by a stable surface ID:

```js
export const EXAMPLE_SURFACE = "example_surface";
```

Surface IDs are part of the frontend/backend contract. Use stable snake_case names and avoid product names that could become ambiguous.

## State Contract

Each runtime's `extractStateFromTab` returns a compact planner-readable object. It should include:

- `surface`
- `goal`
- `step`
- `timestamp`
- `url` or other stable location
- the minimum facts needed for the planner to choose the next command
- bounded data, never an unbounded dump

Browser DOM returns aggregate frame state with `frames`. Google Sheets returns spreadsheet state:

```json
{
  "surface": "google_sheets",
  "spreadsheetId": "sheet-id",
  "spreadsheetTitle": "CRM",
  "activeSheetName": "Customers",
  "activeRange": "B12",
  "sheetTabs": [],
  "visibleGrid": {
    "range": "'Customers'!A1:T50",
    "rowCount": 50,
    "columnCount": 20,
    "values": []
  }
}
```

Prefer structured state over prose. The backend can summarize, trim, and rank from structure more reliably than from loose text.

## Command Contract

Each non-DOM runtime should have a small curated command vocabulary. Keep commands close to the public API or durable primitive underneath the runtime.

Good runtime commands:

- read a bounded range
- write a rectangular value block
- append a row
- find rows in a bounded range
- format a bounded range
- select or reveal a range in the UI

Risky runtime commands:

- "do the whole workflow"
- commands that bundle planning decisions
- commands that require hidden backend-only auth
- commands that mutate large or unbounded data
- commands that depend on fragile visual coordinates

For Google Sheets v0, see [Google Sheets surface v0](./surfaces/google-sheets-v0.md).
For Microsoft Excel v0, see [Microsoft Excel surface v0](./surfaces/microsoft-excel-v0.md).

If the command is still a page-local DOM operation, prefer a connector-enabled site adapter. For example, a custom select helper or "fill these visible document placeholders" tool belongs in a site adapter because it needs the live page DOM. A spreadsheet write belongs in a runtime because the useful state is the workbook grid and the durable executor is an API client.

## Adding A Runtime

1. Define the surface ID and detection rule in `background/runtime/surfaces.js`.
2. Add a runtime file in `background/runtime/`.
3. Implement `extractStateFromTab`.
4. Implement the smallest useful command executor.
5. Add a command handler under `background/controller/commands/`.
6. Route the command in `background/controller/commands/router.js`.
7. Add runtime routing in `background/runtime/index.js`.
8. Thread auth/config checks through `useAgentRunController.ts` only if the runtime needs pre-run permission.
9. Add the surface to backend payloads through the existing `surface` field.
10. Document the surface vocabulary in `docs/surfaces/`.

## Auth Guidance

Prefer extension-owned user auth when the platform supports it. Google Sheets uses `chrome.identity.getAuthToken`, so the token stays in Chrome's extension identity cache and the backend does not manage Google tokens.

If a future runtime needs OAuth that Chrome cannot own directly, prefer a normal user-approved OAuth flow. Do not scrape tokens from product pages, bypass CSP, or ask users to paste privileged session tokens unless the integration is explicitly designed around personal API tokens.

Runtime auth should be explicit in the UI:

- check auth before starting a run
- show a pre-run connect modal
- call the platform auth flow only after user confirmation
- fail with a clear configuration/auth error

## Replay And Templates

Replay steps should include `surface` and the runtime command:

```json
{
  "surface": "google_sheets",
  "commandName": "write_values",
  "command": {
    "name": "write_values",
    "sheetName": "Customers",
    "range": "D12",
    "values": [["Done"]]
  }
}
```

`background/runtime/index.js` can route replay batches to the right runtime when all steps belong to that surface. Mixed replay batches should stay conservative until there is an explicit cross-runtime replay coordinator.

Templates do not need a separate frontend flow. They pass `surface` into the same start command and then execute the commands returned by the backend.

Connector-enabled site adapters have a different replay shape. They replay through the browser DOM runtime by calling the registered connector executor after current page state is re-extracted. Runtime replay should be reserved for commands whose target surface is not the DOM, such as Sheets or Excel API operations.

## Google Sheets Runtime

The Google Sheets runtime is the first non-DOM runtime:

- detects Sheets tabs by URL
- requests Google Sheets access through Chrome identity
- reads spreadsheet metadata and a bounded `A1:T50` planning snapshot
- executes `read_values`, `add_sheet`, `write_values`, `append_values`, `find_rows`, `format_range`, and `set_active_range`
- posts `google_sheets_commands_executed` back through the normal command-result route
- supports Sheets replay artifacts through the runtime replay hook

The important architectural split is:

- frontend: auth, API calls, state extraction, command execution
- backend: planner routing, surface spec, command choice, canonical history, summarization, replay artifact creation

That lets this open frontend stay powerful without baking proprietary planning logic into the extension.

## Microsoft Excel Runtime

The Microsoft Excel runtime follows the same seam for Excel workbooks opened in Microsoft 365 / SharePoint:

- detects likely Excel web workbook tabs on SharePoint, Office, and Microsoft 365 URLs
- requests Microsoft Graph access through `chrome.identity.launchWebAuthFlow`
- uses auth code + PKCE and stores tokens in extension storage, not the backend
- resolves the open workbook URL into a Graph `driveItem`
- reads workbook metadata, worksheets, and a bounded `A1:T50` planning snapshot
- executes `read_range`, `add_sheet`, `write_range`, `append_rows`, `find_rows`, `format_range`, `set_active_range`, and `list_worksheets`
- posts `microsoft_excel_commands_executed` back through the normal command-result route
- supports Excel replay artifacts through the runtime replay hook

The important difference from Google Sheets is workbook resolution: the runtime must translate the current Excel/SharePoint URL into a Graph drive/item identity before workbook APIs can run.

## Runtime Vs Site Adapter

Use a state-only site adapter when:

- the site is still fundamentally a DOM workflow
- generic controls can still be clicked/filled
- you only need better extraction hints
- the backend should keep returning ordinary `run_actions`

Use a connector-enabled site adapter when:

- the site is still fundamentally a DOM workflow
- a bounded page-local operation needs multiple low-level DOM steps
- the adapter already has reliable selectors or field grouping logic
- replay should call the same DOM-backed connector executor
- the tool can finish within the current document, or stop cleanly at a navigation boundary

Use a runtime when:

- DOM state is not the real product state
- the product has a durable API or browser capability
- actions should be data operations rather than clicks
- auth/config needs a different pre-run path
- replay should use API commands

Google Sheets is a runtime because the visible page is not a normal DOM app for useful cell work. Canvas quiz pages are state-only site adapters because the browser still clicks and fills ordinary page controls. Greenhouse and Dotloop are connector-enabled site adapters because their special tools are DOM-backed helpers around page widgets and modals, not API surfaces.
