# Runtime Hosts

WebGPT is split into shared runtime packages and host apps.

The shared packages define what WebGPT is:

```text
@webgpt/page-runtime
  In-page JavaScript: extractor, runner, connector tools, site adapters.

@webgpt/controller-core
  Host-agnostic planner command loop: start, extract, act, replay, pause, done.

@webgpt/planner-http-adapter
  Default HTTP adapter for WebGPT-compatible planner backends.
```

The host apps define where WebGPT runs:

```text
@webgpt/extension-host
  Chrome extension host with sidepanel UX, Chrome APIs, runtime auth, and extension packaging.

@webgpt/browserbase-host
  Local Node CLI/API host that runs WebGPT inside Browserbase cloud browsers.
```

## Host-Agnostic Loop

Both hosts use the same loop:

```text
goal
  -> runtime host
  -> @webgpt/controller-core
  -> state extraction through host runtime
  -> planner backend through @webgpt/planner-http-adapter
  -> command execution through host runtime
  -> post-action state extraction
  -> next planner command
```

The backend stays responsible for planning. The active host stays responsible for browser execution, lifecycle, auth gates, and local event reporting.

## Extension Host

The extension host lives in `apps/extension-host`.

It owns:

- Chrome MV3 manifest and service worker
- sidepanel UI
- Chrome tab/frame discovery
- content-script injection with `chrome.scripting.executeScript`
- extension bridge script `apps/extension-host/src/content-scripts/agent.js`
- Chrome session storage and sidepanel event broadcasting
- Google Sheets and Microsoft Excel runtime auth/execution
- extension packaging into `apps/extension-host/dist-extension`

The extension host source imports shared WebGPT packages by package name:

```js
import { createControllerCore } from "@webgpt/controller-core";
import { EXTENSION_CONTENT_SCRIPT_FILES } from "@webgpt/page-runtime";
import { createWebGptPlannerAdapter } from "@webgpt/planner-http-adapter";
```

The build script copies shared package source into `dist-extension/background/` and rewrites those bare package imports to local dist paths so Chrome can load the unpacked extension without workspace-aware module resolution.

## Browserbase Host

The Browserbase host lives in `apps/browserbase-host`.

It owns:

- Browserbase session creation
- Playwright CDP connection
- initial URL navigation
- direct page-runtime injection into Playwright frames
- an in-memory session store
- console and JSONL event logging
- Browserbase Live View URL reporting
- CLI/API entrypoint for cloud runs and bench tests

The Browserbase host does not inject `agent.js`. It calls `WebGPTExtractState` and `WebGPTRunner` directly through Playwright `frame.evaluate`.

Live runs require:

```text
BROWSERBASE_API_KEY
BROWSERBASE_PROJECT_ID
```

These can be supplied through the shell or ignored `.env.local` files at the repository root or `apps/browserbase-host/.env.local`.

## Host Feature Matrix

| Feature | Extension Host | Browserbase Host V1 |
| --- | --- | --- |
| Browser DOM state extraction | yes | yes |
| Built-in DOM actions | yes | yes |
| Page-runtime site adapters | yes | yes |
| Connector tools | yes | yes |
| Replay batches | yes | partial |
| Human hint / ask-human pause | sidepanel UX | terminal status + Live View |
| Success confirmation | sidepanel UX | auto-confirm by default, configurable |
| Browserbase Live View | no | yes |
| Chrome sidepanel | yes | no |
| Chrome user session cookies | yes | no |
| Browserbase Context auth persistence | no | not yet |
| Google Sheets runtime | yes | no |
| Microsoft Excel runtime | yes | no |
| Scheduler | no | not yet |
| Email summaries | no | not yet |

## Page Runtime Sharing

`@webgpt/page-runtime` is the important shared boundary.

Both hosts inject the same canonical `PAGE_RUNTIME_SCRIPT_FILES` order. That means a site adapter or connector tool added under `packages/page-runtime/src/content-scripts/adapters/` is available in both hosts as long as it is pure page JavaScript.

Page-runtime files must not rely on unguarded `chrome.*`. Chrome-specific bridge behavior belongs in `apps/extension-host/src/content-scripts/agent.js`.

Node hosts that need file paths should use:

```js
import { resolvePageRuntimeScriptPath } from "@webgpt/page-runtime/node";
```

Browser-safe consumers should use:

```js
import { PAGE_RUNTIME_SCRIPT_FILES } from "@webgpt/page-runtime";
```

## Keeping Hosts Movable

The host apps are intentionally shaped like external apps even while they live in this monorepo.

Rules:

- Host apps import shared WebGPT code through `@webgpt/*` package names.
- Host apps do not reach into `packages/*/src` with relative imports.
- Shared packages do not import host-specific modules.
- Chrome APIs stay in `apps/extension-host`.
- Browserbase and Playwright APIs stay in `apps/browserbase-host`.
- Node-only helpers live behind explicit package subpaths such as `@webgpt/page-runtime/node`.

This keeps it boring to move a host into a private repo later: copy the host app, keep the `@webgpt/*` dependencies, install, and run.

## Bench Testing

The Browserbase host doubles as an integration bench harness:

```bash
npm run cloud:run -- --url "https://example.com" --goal "Extract the page title" --backend http://localhost:3000
```

Default eProcure bench:

```bash
npm run cloud:run -- --eprocure --backend http://localhost:3000
```

This lets Codex or a developer run real browser-agent tests against real websites, inspect `.webgpt-cloud-runs/*.jsonl` plus backend planner artifacts, and improve the page runtime without manually reloading the Chrome extension.
