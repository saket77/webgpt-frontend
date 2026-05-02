# WebGPT Frontend

This repository contains the Chrome extension frontend for WebGPT.

The frontend is the browser-side execution engine. It does not own planning logic. Instead, it:

- observes the current page and extracts structured state
- executes browser actions inside content scripts
- manages session and tab lifecycle in the extension background worker
- renders the sidepanel UI
- talks to a compatible planner backend through a documented adapter contract

## Folder Layout

- `background/` contains the extension service worker, controller flow, browser runtime bridge, and backend adapter plumbing.
- `content-scripts/` contains the in-page extraction and action execution code.
- `sidepanel-app/` contains the React sidepanel UI.
- `docs/` contains frontend-facing integration documentation.
- `examples/` contains small compatible backend examples.

## Compatible Backends

This frontend is designed to work with any backend that can produce the browser-command vocabulary the extension understands.

There are two integration layers:

- The controller-facing JavaScript `plannerAdapter` interface.
- The default HTTP adapter, documented in [docs/planner-http-api.openapi.yaml](./docs/planner-http-api.openapi.yaml).

Start with [docs/planner-adapter-contract.md](./docs/planner-adapter-contract.md) for the conceptual contract, or run [examples/simple-backend](./examples/simple-backend/README.md) for a tiny compatible server.

## Local Development

### 1. Build the Sidepanel App

```bash
cd sidepanel-app
npm install
npm run build
```

The built `sidepanel-app/dist/` files are treated as generated output and are
not intended to be tracked as source.

### 2. Load the Extension

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Choose "Load unpacked"
4. Select this repository folder

### 3. Point the Extension at a Backend

Open the sidepanel and use the Backend card on the Run page.

Examples:

- `http://localhost:8787` for [the simple demo backend](./examples/simple-backend/README.md)
- `http://localhost:3000` if you run a compatible backend on the built-in fallback port

## Extension Points

### Compatible Backends

Bring any backend that can speak the WebGPT planner command contract.

Start with [examples/simple-backend](./examples/simple-backend/README.md) if you want the smallest possible compatible server.

### Site Adapters

Site adapters let contributors teach the content-script extractor about specific websites without changing the planner backend or runner.

The first example is the Canvas quiz adapter in `content-scripts/adapters/canvasQuiz.js`.

See [docs/site-adapter-authoring.md](./docs/site-adapter-authoring.md) for the adapter contract and authoring recipe.

## Key Docs

- [docs/planner-adapter-contract.md](./docs/planner-adapter-contract.md)
- [docs/planner-http-api.openapi.yaml](./docs/planner-http-api.openapi.yaml)
- [docs/site-adapter-authoring.md](./docs/site-adapter-authoring.md)
- [examples/simple-backend/README.md](./examples/simple-backend/README.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [LICENSE](./LICENSE)
