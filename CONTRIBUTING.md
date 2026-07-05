# Contributing To WebGPT Frontend

This repository is the frontend runtime workspace for WebGPT: shared browser-agent packages, a Chrome extension host, a Browserbase cloud-browser host, sidepanel UI, and planner-backend integration surfaces.

The planner itself is intentionally outside this repository. Contributions should keep the frontend useful with compatible backends without moving planner-specific logic into the browser extension.

## Where To Make Changes

- Put reusable DOM extraction, browser action execution, connector tools, and site adapters in `packages/page-runtime/src/`.
- Put host-agnostic planner loop and command-flow changes in `packages/controller-core/src/`.
- Put shared planner HTTP contract code in `packages/planner-http-adapter/src/`.
- Put Chrome extension orchestration, browser/runtime adapters, settings, auth, and service-worker changes in `apps/extension-host/src/`.
- Put Browserbase cloud host orchestration and Playwright runtime code in `apps/browserbase-host/src/`.
- Put sidepanel UI changes in `apps/extension-host/sidepanel-app/src/`.
- Put integration and contributor documentation in `docs/` or this folder.

## Package Boundaries

The host apps should behave like external consumers of the shared packages:

- `apps/extension-host` imports shared WebGPT code through `@webgpt/controller-core`, `@webgpt/page-runtime`, and `@webgpt/planner-http-adapter`.
- `apps/browserbase-host` imports shared WebGPT code through the same package names.
- Do not add new `apps/* -> packages/*/src` relative imports in host source.
- Keep Node-only helpers behind explicit subpaths such as `@webgpt/page-runtime/node`.

The Chrome extension build copies shared package source into `apps/extension-host/dist-extension` and rewrites package imports to local dist paths. Source code should still use package imports.

## Supported Contribution Paths

### Backend Compatibility

Contributors can make the frontend work with more backends by:

- implementing the documented HTTP contract in another service
- adding or improving planner adapter glue in the frontend
- improving backend configuration UX and capability surfacing

The contract lives in [docs/planner-adapter-contract.md](./docs/planner-adapter-contract.md), and the default HTTP API is described by [docs/planner-http-api.openapi.yaml](./docs/planner-http-api.openapi.yaml).

### Browser-Side Intelligence

Contributors can improve how the frontend understands and acts on pages by:

- improving generic extraction in `packages/page-runtime/src/content-scripts/extract-state/`
- improving runner behavior in `packages/page-runtime/src/content-scripts/runner/`
- adding state-only or connector-enabled site adapters in `packages/page-runtime/src/content-scripts/adapters/`

Start with [docs/site-adapter-authoring.md](./docs/site-adapter-authoring.md) before adding an adapter. State-only adapters should enrich extracted state without mutating the page. Connector-enabled adapters may expose narrowly scoped DOM-backed tools through `provideTools()` and `WebGPTConnectorTools`, but those executors must reuse the adapter's page model, avoid hidden planning decisions, and never call planner services directly.

## Local Workflow

### Build The Extension

```bash
npm install
npm run build
```

### Lint The Sidepanel

```bash
cd apps/extension-host/sidepanel-app
npm run lint
```

### Manual Verification

Before opening a PR, verify the change in a loaded unpacked extension:

1. Run `npm run build`
2. Reload the unpacked extension in Chrome
3. Open the sidepanel on a normal web page
4. Confirm the behavior you changed still works end to end

Load `apps/extension-host/dist-extension` as the unpacked extension. Run `npm run smoke:extension` before manual verification to catch missing service-worker, sidepanel, icon, or content-script build outputs.

### Browserbase Cloud Host Smoke

The cloud host is a local CLI/API app for proving WebGPT can run inside Browserbase cloud browsers while using the same planner backend:

```bash
npm run smoke:cloud
```

Live Browserbase runs require `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, and a compatible backend. The Browserbase host loads ignored `.env.local` files from the repository root and from `apps/browserbase-host/`.

```bash
npm run cloud:run -- --eprocure --backend http://localhost:3000
```

Keep cloud host changes behind host adapters. The Browserbase host should reuse `@webgpt/page-runtime`, `@webgpt/controller-core`, and `@webgpt/planner-http-adapter`; it should not import Chrome extension settings, sidepanel code, or Chrome APIs.

Browserbase host v1 supports browser DOM state, page-runtime adapters, connector tools, replay batches where possible, ask-human terminal status, Browserbase Live View, and JSONL logs. Google Sheets, Microsoft Excel, Browserbase Contexts, scheduler, and email summaries are not included in v1.

For backend-related changes, also verify that:

1. the backend configuration UI can point to a compatible backend
2. the simple backend example in `examples/simple-backend/` still starts
3. any route or payload changes are reflected in the contract docs and OpenAPI file

## Documentation Impact

Before treating a feature as done, check whether the change affects:

- `README.md` for user-facing workflow, architecture, commands, or project layout
- `CLAUDE.md` for future-agent operating guidance
- `docs/planner-adapter-contract.md` or `docs/planner-http-api.openapi.yaml` for backend payloads or command vocabulary
- `docs/runtime-authoring.md`, `docs/site-adapter-authoring.md`, or `docs/surfaces/*` for runtime/adapter behavior
- `SECURITY.md` for credentials, cloud execution, host permissions, or sensitive logs
- user skills under `~/.codex/skills` when the repeatable workflow changed

If no docs update is needed, say why in the final handoff.

## Keep Changes Focused

- Prefer small, direct changes over new layers or abstractions.
- Keep backend-specific logic out of the generic controller when possible.
- Treat the frontend as an execution engine first, not the planner brain.
- Update docs when the contract or contributor workflow changes.
