# `@webgpt/planner-http-adapter`

Shared HTTP client and host adapter for WebGPT planner services. It keeps
extension and cloud hosts on one request contract while allowing callers to
provide their own backend URL, access-token resolver, headers, and `fetch`
implementation.

## Public API

```js
import {
  createWebGptApiClient,
  createWebGptPlannerAdapter,
  createReplayPreflight,
  buildBrowserContext,
  syncSessionWithRun,
} from "@webgpt/planner-http-adapter";
```

`createWebGptApiClient()` exposes the established run, replay, artifact, and
template-queue calls. Its `preparePlannerContext()` method validates the exact
`webgpt.planner-context.v1` request and response schema and supports abort
signals and caller-supplied authorization.

For planner-context requests, prefer `resolveAccessToken` over a fixed
`accessToken`; the resolver runs for each request and can read the current value
from a trusted secret store. A supplied `fetchImpl` receives the complete
request, including the `Authorization` header, and therefore must be controlled
by the host rather than page content, model output, or an untrusted plugin.

This low-level client deliberately does not enforce transport policy. The host
must require HTTPS for remote planner services and may permit plain HTTP only
for an explicit loopback address such as `http://localhost:3000`. Reject
credential-bearing URLs, never put bearer values in command arguments or logs,
keep secrets out of packages and browser/model-visible state, and verify that
the selected backend actually exposes the optional planner-context route. See the
workspace [Security Policy](../../SECURITY.md) and
[Planner Adapter Contract](../../docs/planner-adapter-contract.md).

Stable client failures use `WEBGPT_PLANNER_CONTEXT_ABORTED`,
`WEBGPT_PLANNER_CONTEXT_HTTP_ERROR`,
`WEBGPT_PLANNER_CONTEXT_NETWORK_ERROR`, and
`WEBGPT_PLANNER_CONTEXT_SCHEMA_ERROR`. On an HTTP failure, the error also
retains the response status and the server's stable planner-context code when
available.

The package contains transport and host-composition helpers only. Browser
execution, page-runtime code, workflow policy, and server implementation stay
outside this package.

## Verification

From the `webgpt-frontend` workspace root:

```sh
npm test --workspace @webgpt/planner-http-adapter
```

The package targets Node.js 20 or newer and is distributed under the MIT
license.
