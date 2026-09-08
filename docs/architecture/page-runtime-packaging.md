# Page-runtime packaging

`@webgpt/page-runtime` is the selective distribution boundary for WebGPT page
extraction, site adaptation, and page-local execution. It is deliberately
workflow-neutral: Ashby and Greenhouse are site adapters, not the definition of
the package, and eProcure, Canvas, Yelp, DocuSign, Dotloop, NCM, and InvestorGain
use the same packaging contract.

## Layer model

The publisher emits one release containing shared layers and the complete site
adapter catalog:

```text
dist/
├── manifest.json
└── assets/
    ├── webmcp.js                 optional
    ├── runtime-prelude.js
    ├── adapters/
    │   ├── canvas.quiz.js
    │   ├── ashby.application.js
    │   ├── eprocure.latest_active_tenders.js
    │   └── ...one file per canonical adapter
    └── runtime-tail.js
```

A host requests zero or more adapter IDs and chooses whether to include WebMCP.
The reader returns source in this order:

```text
[webmcp] -> prelude -> selected adapters in canonical order -> tail
```

Zero adapters is a valid generic runtime. Input order never changes composition
order, and duplicate or unknown IDs fail closed. The source separator remains
`"\n;\n"`, preserving the established IIFE load boundary identified by the
`webgpt-page-runtime-iife-v1` ABI.

The release archive deliberately contains the complete adapter catalog, built
artifacts, and canonical source tree. Adapter selection is a load-time boundary:
`readPageRuntime()` returns only the selected adapter layers for injection, but
publishing does not create a workflow-specific archive for each selection. The
source tree remains available because the extension and Browserbase workspace
hosts consume the same canonical page scripts.

`PAGE_RUNTIME_SCRIPT_FILES` remains the page-runtime aggregate shared by the
extension and Browserbase. It is derived from the declarations in `layers.js`:
optional WebMCP, the prelude, every adapter in canonical order, and the tail.
The extension owns a separate inventory that appends its Chrome-only
`content-scripts/agent.js` bridge after those 30 shipped package sources.

## Adapter catalog boundary

The package catalog records only site-runtime facts:

- adapter ID and priority
- canonical source and artifact paths
- runtime ABI and release version
- serializable `matchHints` for inexpensive host-side candidate selection

`matchHints` include URL and, where useful, DOM clues. They are not a second
implementation of adapter matching. After candidate assets load, each adapter's
existing `match()` is the final authority. The catalog does not contain workflow
capabilities, résumé or EEOC concepts, profile bindings, application operations,
submit policy, or workflow-specific aliases.

The package has no `application-runtime`, `application-layers`, application
router, profile binder, or job-tool compatibility API. An adapter ID may include
the word `application` because it describes a page kind; that does not make the
package application-workflow-specific.

Adapter behavior stays in the adapter: `match`, `enhanceState`, dynamic
`provideTools`, and any registered page-local `WebGPTConnectorTools` executor.
Workflows consume the state and operations those adapters expose. Hosts retain
browser/session ownership and privileged capabilities.

## Integrity and host preflight

Node hosts call:

```js
readPageRuntime({ adapterIds, expectedRuntimeAbi, includeWebMcp })
```

from `@webgpt/page-runtime/node`. Before returning source, the reader validates
the installed package identity, complete adapter catalog, canonical metadata,
ABI, path containment, and SHA-256 digest of every selected artifact. It returns
`{ runtimeAbi, releaseVersion, adapters, layers, compositionHash }`. The
`adapters` descriptors and `layers.adapters` sources use canonical order;
`layers` also contains the verified `prelude` and `tail`.

Stable failure codes are exported as `PAGE_RUNTIME_ERROR_CODES`:

- `PAGE_RUNTIME_INVALID_ARGUMENT`
- `PAGE_RUNTIME_MANIFEST_MISSING`
- `PAGE_RUNTIME_MANIFEST_INVALID`
- `PAGE_RUNTIME_UNKNOWN_ADAPTER`
- `PAGE_RUNTIME_ABI_MISMATCH`
- `PAGE_RUNTIME_ASSET_MISSING`
- `PAGE_RUNTIME_INTEGRITY_MISMATCH`

Hosts should complete package verification before browser navigation, CDP
creation, or page mutation. Planning, conversation history, `actionEffect`,
`stateDelta`, workflows, and protected-action confirmation remain outside the
page-runtime package.

The external-host loading chain is intentionally package-only:

```text
host -> import @webgpt/page-runtime/node
     -> select catalog candidates
     -> readPageRuntime({ adapterIds, expectedRuntimeAbi, includeWebMcp })
     -> verify manifest, containment, and SHA-256 digests
     -> inject prelude + selected adapters + tail
     -> let each loaded adapter's match() make the final page-local decision
```

An external host must not import `packages/page-runtime/src/*` from a sibling
WebGPT checkout. Repository tests may compare packaged output with canonical
source, but production loading uses the installed package boundary.

## Local release workflow

```sh
npm run build:page-runtime
npm run test:page-runtime
npm run test:page-runtime:tarball
npm run pack:page-runtime
```

The clean-consumer tarball test verifies package contents and loads both a
zero-adapter runtime and a multi-adapter runtime. Generated `dist/` files and
archives remain outside version control.
