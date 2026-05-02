# Contributing To WebGPT Frontend

This repository is the browser frontend for WebGPT: a Chrome extension, content-script execution layer, sidepanel UI, and planner-backend integration surface.

The planner itself is intentionally outside this repository. Contributions should keep the frontend useful with compatible backends without moving planner-specific logic into the browser extension.

## Where To Make Changes

- Put extension orchestration and browser/runtime changes in `background/`.
- Put DOM extraction and browser action execution changes in `content-scripts/`.
- Put sidepanel UI changes in `sidepanel-app/src/`.
- Put integration and contributor documentation in `docs/` or this folder.

## Supported Contribution Paths

### Backend Compatibility

Contributors can make the frontend work with more backends by:

- implementing the documented HTTP contract in another service
- adding or improving planner adapter glue in the frontend
- improving backend configuration UX and capability surfacing

The contract lives in [docs/planner-adapter-contract.md](./docs/planner-adapter-contract.md), and the default HTTP API is described by [docs/planner-http-api.openapi.yaml](./docs/planner-http-api.openapi.yaml).

### Browser-Side Intelligence

Contributors can improve how the frontend understands and acts on pages by:

- improving generic extraction in `content-scripts/extract-state/`
- improving runner behavior in `content-scripts/runner/`
- adding site-specific extraction adapters in `content-scripts/adapters/`

Start with [docs/site-adapter-authoring.md](./docs/site-adapter-authoring.md) before adding an adapter. Site adapters should enrich extracted state; they should not execute actions, hardcode answers, or call planner services directly.

## Local Workflow

### Build The Sidepanel

```bash
cd sidepanel-app
npm install
npm run build
```

### Lint The Sidepanel

```bash
cd sidepanel-app
npm run lint
```

### Manual Verification

Before opening a PR, verify the change in a loaded unpacked extension:

1. Build `sidepanel-app`
2. Reload the unpacked extension in Chrome
3. Open the sidepanel on a normal web page
4. Confirm the behavior you changed still works end to end

For backend-related changes, also verify that:

1. the backend configuration UI can point to a compatible backend
2. the simple backend example in `examples/simple-backend/` still starts
3. any route or payload changes are reflected in the contract docs and OpenAPI file

## Keep Changes Focused

- Prefer small, direct changes over new layers or abstractions.
- Keep backend-specific logic out of the generic controller when possible.
- Treat the frontend as an execution engine first, not the planner brain.
- Update docs when the contract or contributor workflow changes.
