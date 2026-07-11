# WebGPT Sidepanel App

This is the React sidepanel UI for `@webgpt/extension-host`, the WebGPT Chrome extension host.

It provides:

- the run controls for starting, stopping, and resuming browser-agent runs
- backend URL configuration
- human hint and success confirmation flows
- run-start consent for planner-selected DOM, connector, and website-provided WebMCP actions
- event-log visibility for the active tab session
- saved artifact and template-run screens

## Development

```bash
npm install
npm run build
```

Useful commands:

```bash
npm run lint
npm run dev
```

The extension host copies the built app from this package's `dist/` directory into
`apps/extension-host/dist-extension/sidepanel-app/dist/`. The `dist/` folder is generated output and is ignored by Git.

The Browserbase host does not use this sidepanel; it exposes a local Node CLI/API workflow instead.
