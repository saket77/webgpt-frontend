# `@webgpt-mundhada/page-runtime`

This package is WebGPT's workflow-neutral page execution boundary. It publishes
the shared extractor and runner once, plus one isolated artifact for every site
adapter in the canonical runtime. A host can load zero, one, or several
adapters without adopting a job, procurement, document, or other workflow.

The package keeps four kinds of artifact:

1. optional `assets/webmcp.js`
2. `assets/runtime-prelude.js`
3. zero or more selected `assets/adapters/*.js`
4. `assets/runtime-tail.js`

Adapters are always returned in canonical runtime order, regardless of caller
input. The existing extension and Browserbase hosts continue to use
`PAGE_RUNTIME_SCRIPT_FILES`; that full 30-source order is unchanged.
The extension appends its Chrome-only `content-scripts/agent.js` bridge from an
extension-owned inventory; that bridge is not part of this package.

The archive contains the complete adapter catalog and canonical `src/` tree as
well as the integrity-checked `dist/` artifacts. Selection happens when a host
calls the reader: only the requested adapter layers are returned for injection.
This is selective composition, not a separate package or archive per workflow.

There is no application-runtime or application-layers API. Names such as
`ashby.application` and `greenhouse.application` identify page adapters; job
workflow routing, profile binding, action confirmation, and compatibility tool
aliases belong to consumers outside this package. Application connector tools
accept exact caller-provided values keyed by live fields and leave omitted
fields unchanged; they do not infer answers from profile, work-authorization,
EEOC, résumé, job-description, or workflow policy.

## Build, verify, and pack

From the workspace root:

```sh
npm run build:page-runtime
npm run test:page-runtime
npm run test:page-runtime:tarball
npm run pack:page-runtime
```

Generated `dist/` files and `.tgz` archives are not committed. The tarball test
installs the archive in a clean temporary consumer and exercises both a generic
zero-adapter runtime and a multi-adapter runtime.

## Node host API

```js
import { PAGE_RUNTIME_ABI } from "@webgpt-mundhada/page-runtime/catalog";
import { readPageRuntime } from "@webgpt-mundhada/page-runtime/node";

const runtime = await readPageRuntime({
  adapterIds: [
    "greenhouse.application",
    "eprocure.latest_active_tenders",
  ],
  expectedRuntimeAbi: PAGE_RUNTIME_ABI,
  includeWebMcp: false,
});
```

The current runtime ABI is `webgpt-page-runtime-iife-v1`.

`listPageRuntimeAdapters()` from the catalog subpath returns a defensive,
deeply frozen snapshot for candidate selection.

`readPageRuntime()` verifies the release manifest and every selected artifact
before returning source. Its result is
`{ runtimeAbi, releaseVersion, adapters, layers, compositionHash }`, where
`layers` contains `prelude`, canonical `adapters`, and `tail`. Optional WebMCP
source is verified separately and prepended to `layers.prelude`. Passing no
adapter IDs returns the generic extractor and runner. `matchHints` are
serializable candidate-selection hints only; the adapter's runtime `match()`
remains authoritative after loading.

An external host needs only the installed package. It must not read files from
the `webgpt-frontend` checkout or assemble content-script paths itself.

This package does not own workflows, profile data, planning, history, protected
action confirmation, or privileged host capabilities such as local file access.
