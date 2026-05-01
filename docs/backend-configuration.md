# Backend Configuration

The extension frontend ships with a default WebGPT-compatible planner adapter and points to `http://localhost:3000` by default.

That default keeps local development simple, but the backend URL can now be configured in two stronger ways:

1. Pass an explicit `baseUrl` when creating the default WebGPT planner adapter.
2. Persist a backend URL override in `chrome.storage.local`.

The resolution order is:

1. `createWebGptPlannerAdapter({ baseUrl })`
2. Stored override from `chrome.storage.local`
3. Built-in fallback `http://localhost:3000`

## Default Local Development

If you run the planner server locally on port `3000`, no configuration is needed.

The default fallback lives in [`background/config.js`](../background/config.js).

## Persisted Backend Override

The extension stores the backend override under `chrome.storage.local`, so the configured URL survives service worker restarts and browser reloads.

The storage-backed resolver lives in [`background/settings/backendConfig.js`](../background/settings/backendConfig.js).

The stored value must be an absolute `http` or `https` URL.

Examples:

- `http://localhost:8787`
- `https://planner.example.com`

Trailing slashes are normalized away when saved.

## Background Message API

The background message bridge exposes a small config API for future UI or debugging use:

- `WEBGPT_GET_BACKEND_CONFIG`
- `WEBGPT_SET_BACKEND_CONFIG`
- `WEBGPT_RESET_BACKEND_CONFIG`

These handlers live in [`background/messages.js`](../background/messages.js).

### Read Current Config

```js
chrome.runtime.sendMessage({ type: "WEBGPT_GET_BACKEND_CONFIG" }, console.log);
```

Example response:

```json
{
  "ok": true,
  "config": {
    "baseUrl": "http://localhost:3000",
    "source": "default",
    "overrideBaseUrl": "",
    "defaultBaseUrl": "http://localhost:3000"
  }
}
```

If a stored override is active, `source` becomes `"storage"`.

### Set Backend URL

```js
chrome.runtime.sendMessage(
  {
    type: "WEBGPT_SET_BACKEND_CONFIG",
    baseUrl: "http://localhost:8787",
  },
  console.log,
);
```

### Reset To Default Localhost

```js
chrome.runtime.sendMessage(
  { type: "WEBGPT_RESET_BACKEND_CONFIG" },
  console.log,
);
```

## Code-Level Override

If you assemble a custom controller, you can pin the backend URL in code by creating the default WebGPT planner adapter with an explicit `baseUrl`.

The assembly point lives in [`background/controller/index.js`](../background/controller/index.js).

```js
import { createController } from "./background/controller/index.js";
import { createWebGptPlannerAdapter } from "./background/adapters/webgpt/plannerAdapter.js";

const controller = createController({
  plannerAdapter: createWebGptPlannerAdapter({
    baseUrl: "https://planner.example.com",
  }),
});
```

An explicit `baseUrl` wins over any stored override.

## Compatibility Note

Changing the backend URL only changes where the frontend sends requests. The backend still needs to implement the WebGPT-compatible planner contract and command vocabulary.

That contract will be documented separately in the planner adapter contract documentation.
