# WebGPT Sidepanel App

This is the React sidepanel UI for the WebGPT Chrome extension.

It provides:

- the run controls for starting, stopping, and resuming browser-agent runs
- backend URL configuration
- human hint and success confirmation flows
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
