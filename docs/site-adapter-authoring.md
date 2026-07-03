# Site Adapter Authoring Guide

Site adapters let WebGPT add site-specific semantics while keeping the runner and planner contract generic.

There are two adapter styles:

- **State-only adapters** read the page, enrich extracted state, and map site concepts back to normal WebGPT control IDs.
- **Connector-enabled adapters** do the same state enrichment and also expose narrowly scoped DOM-backed tools through `provideTools()` plus a local `WebGPTConnectorTools` executor.

State-only adapters are still the default. Connector tools are for page operations where the adapter already understands the live DOM and a single planner action should perform a bounded multi-step interaction, such as opening a custom select, choosing the matching option, or filling a known set of document placeholders.

## Mental Model

The frontend loop stays generic:

1. The generic extractor builds controls, groups, headings, visible text, scroll state, and page metadata.
2. A site adapter recognizes a page family.
3. The adapter maps domain concepts to existing `state.controls` IDs.
4. The adapter adds compact hints to the extracted state.
5. If needed, the adapter exposes connector tool schemas through `provideTools()`.
6. A compatible backend plans normal browser actions or connector tool actions.
7. The frontend runner executes normal actions directly, or dispatches connector actions to the registered content-script executor.

Adapters make page state easier to understand. Connector-enabled adapters can also make one page-local operation easier to execute, but they should still reuse the same page model and selectors used for state enrichment.

If a workflow needs a different state model, auth flow, API executor, or durable non-DOM command vocabulary, use a runtime surface instead. See [Runtime authoring guide](./runtime-authoring.md).

## Connector Build Pipeline

Use this checklist when turning a state-only site adapter into a connector-enabled adapter:

1. Map page regions and stable field keys in `enhanceState()`, using the same DOM helpers the executor will use later.
2. Separate normal fillable fields, sensitive/compliance fields, file/upload boundaries, and submit/navigation boundaries.
3. Add compact groups for actionable batches, such as `*_fill_application_fields(fieldValues)` and `*_fill_eeoc(fieldValues)`, instead of exposing long policy or help text.
4. Set `preferredAction`, `connectorTool`, `connectorArgs`, `batchPlacement`, and `verifyAfterAction` on field groups and relevant control hints.
5. Expose `provideTools()` only when the current page has the matching live fields, with small schemas keyed by stable field keys.
6. Register local `WebGPTConnectorTools` executors that reuse the adapter's field model, fill all requested values, return `fieldValues` and `fieldTargets`, and mark partial failures as recoverable when fallback controls can still work.
7. Filter planner noise from generic `visibleTextSummary` or generic groups when the adapter replaces it with compact actionable facts.
8. Add source tests that pin injection order, tool schemas, executor registration, batch hints, sensitive-field policy, and state-delta verification keys.

## Current Files

Adapter code lives in:

```text
content-scripts/adapters/
  registry.js
  canvasQuiz.js
  greenhouse.js
  dotloop.js
  connectorTools.js
```

Adapter scripts are injected before `content-scripts/extractState.js` by:

```text
background/runtime/browser.js
```

The generic extractor calls the registry from:

```text
content-scripts/extractState.js
```

## Adapter Contract

Each adapter registers one object. `match()` and `enhanceState()` are the core contract; `provideTools()` is optional and only used by connector-enabled adapters.

```js
registry.register({
  id: "example.site",
  priority: 50,

  match({ url, document }) {
    return true;
  },

  enhanceState({ state, document, url }) {
    return {
      ...state,
      siteAdapter: {},
    };
  },

  provideTools({ state, document, url }) {
    return [];
  },
});
```

### `match({ url, document })`

Return `true` only when the adapter is confident it owns the current page family.

Good match rules combine:

- hostname or URL path signals
- stable page-level DOM markers
- stable site-owned containers
- durable ARIA roles, labels, or hidden metadata

Avoid generated IDs, layout-only wrappers, exact one-off URLs, and text that may be localized.

### `enhanceState({ state, document, url })`

Return a new enriched state object. The adapter should:

- read stable DOM structures
- infer domain concepts
- map site targets to existing generic control IDs
- add `siteAdapter`
- add compact `adapterHints` to mapped controls
- add high-signal groups or visible text facts when useful

The adapter should not:

- mutate the page during `match()`, `enhanceState()`, or `provideTools()`
- call a backend
- create fake executable target IDs
- remove generic controls needed by the runner
- include large DOM blobs or user data that is not needed for planning

Connector-enabled adapters may mutate the page only inside their registered connector executor, after the planner has returned an action with the connector tool name.

### `provideTools({ state, document, url })`

Return function-tool schemas for currently available connector actions. The registry places these schemas on `state.connectorTools`; the backend merges them with the base browser tools for the next planning step.

Only expose a tool when the current state is ready for it. For example, a document-field fill tool should only appear on the document editor page, and an add-person tool should only appear when the Add Person modal is open.

Good connector tools:

- operate on the current document and frame
- reuse the adapter's existing DOM recognition and selector helpers
- take explicit, bounded arguments
- return structured evidence such as committed values, skipped fields, or extraction batches
- fail clearly when the expected page/modal is not active

Avoid connector tools that:

- make planning decisions hidden from the backend
- bundle unrelated workflows
- call product APIs or backend services
- rely on credentials scraped from the page
- perform work before and after a navigation in one executor

Connector tool schemas may include adapter-owned metadata for the runtime and replay layers. Keep model-facing schemas small and stable.

```js
function provideTools({ state }) {
  const fields = collectKnownFields(state);
  if (!fields.length) return [];

  return [
    {
      type: "function",
      name: "example_fill_fields",
      description: "Fill known Example fields visible on the current page.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["fieldValues"],
        properties: {
          fieldValues: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(
              fields.map((field) => [field.key, { type: "string" }]),
            ),
          },
        },
      },
      webgpt: {
        adapterId: ADAPTER_ID,
        replayable: true,
        mayCauseNavigation: false,
      },
    },
  ];
}
```

### Connector Executors

Connector executors register in the content-script world:

```js
globalThis.WebGPTConnectorTools.register("example_fill_fields", async (action, ctx) => {
  const { fieldValues } = action;
  const { primitives } = ctx;
  // Reuse the same DOM helpers that enhanceState/provideTools use.
  return {
    ok: true,
    committed: true,
    fieldValues,
    detail: "Filled Example fields.",
  };
});
```

The runner passes the current enriched state, runner primitives, resolver, and DOM utilities through `ctx`. Executors should use those primitives instead of hand-rolled event simulation when possible.

Connector results should be structured:

- `ok`: whether the tool succeeded enough for the planner to continue
- `committed`: whether the intended page state is believed to be committed
- `recoverable` / `continueBatch`: whether the runner may continue after partial failure
- domain evidence such as `fieldValues`, `person`, `filled`, `skipped`, `failed`, or `extractionBatch`

Connector replay is connector-native: a saved replay action calls the same registered executor after the content script re-extracts current state. If the connector tool is unavailable on the replay page, replay should fail clearly rather than silently degrade to unrelated DOM clicks.

Connector actions must not cross a document navigation boundary. If a connector action can trigger navigation, mark it with connector metadata and make it the final action in its batch; any post-navigation work must happen after the normal navigation wait and fresh state extraction.

## Recommended State Additions

The strongest top-level field is `siteAdapter`.

```js
{
  siteAdapter: {
    id: "example.site",
    pageKind: "example_page",
    primaryControlIds: ["el_10"],
    actionHintsByTargetId: {
      "el_10": {
        semanticRole: "primary_search_input",
        inputKind: "text",
        preferredAction: "fill",
        exactValueMode: "text",
        verifyAfterAction: "valueChanged"
      }
    },
    plannerHints: [
      "Example page detected the primary search input."
    ]
  }
}
```

### `siteAdapter.primaryControlIds`

List the generic control IDs that matter most for the page workflow.

### `siteAdapter.actionHintsByTargetId`

Keys must be generic control IDs from `state.controls`. Values should be compact planner-facing hints.

Useful hint fields include:

- `semanticRole`: domain role, such as `search_input`, `quiz_next`, or `matching_select`
- `preferredAction`: planner-preferred action type, such as `click`, `fill`, or a connector tool name
- `exactValueMode`: how values should be expressed, such as `text` or `optionText`
- `answerText`: visible label or prompt associated with the target
- `optionTexts`: valid choices for selects or choice groups
- `editorKind`: rich editor implementation, such as `tinymce`
- `navigationAction`: true for Next, Previous, Submit, or other navigation controls
- `batchPlacement`: often `last` for navigation controls
- `connectorTool`: connector tool name when the target is best handled by `provideTools()`
- `verifyAfterAction`: what should change after execution

### Control-Level `adapterHints`

For every mapped control, also add compact control-level hints:

```js
{
  id: "el_10",
  label: "Search | adapter: example.site; preferred action: fill",
  adapterHints: {
    "example.site": {
      "semanticRole": "primary_search_input",
      "preferredAction": "fill",
      "exactValueMode": "text"
    }
  }
}
```

This redundancy is intentional. Different backend implementations may rank, trim, and prompt from different parts of the state.

## Mapping DOM Targets To Generic Controls

Adapters should map site DOM elements back to controls already extracted by the generic extractor.

Good mapping strategies, strongest to weakest:

- exact selector, such as `#id`
- tag plus `name`
- tag plus `aria-label`
- tag plus `title`
- associated label text
- row or card containment
- bounds containment

If a state-only target cannot be mapped to a generic control, include it as a non-executable page fact only. Connector-enabled adapters can also expose non-control work through a connector tool, but the tool must still be tied to a clear page state such as an active modal, field group, or editor page.

## Canvas Quiz Adapter

`content-scripts/adapters/canvasQuiz.js` is the first included adapter. It recognizes Canvas-like quiz pages and extracts:

- quiz title and question status
- current question metadata
- answer targets for visible questions
- navigation controls such as Previous, Next, and Submit
- save or persistence status text when present

It normalizes Canvas question types into planner-friendly kinds:

```text
matching_question          -> matching
multiple_choice_question   -> single_choice
true_false_question        -> true_false
multiple_answers_question  -> multiple_answers
short_answer_question      -> short_text
essay_question             -> rich_text
numerical_question         -> numeric
```

The Canvas adapter is state-only. It does not answer quiz questions. It only makes the page structure explicit so a compatible backend can plan against ordinary `fill`, `click`, and navigation commands.

## Connector-Enabled Examples

`content-scripts/adapters/greenhouse.js` and `content-scripts/adapters/dotloop.js` are connector-enabled adapters.

Greenhouse exposes connector tools for custom select/EEOC flows where the adapter already knows the field roots and React select behavior. Dotloop exposes tools for document-field filling and Add Person modal completion. In both cases, the connector tools reuse the same detection logic as `enhanceState()` so state, planning hints, execution, replay evidence, and action effects describe the same page concepts.

## Authoring Workflow

When adding a new adapter:

1. Define the page family and workflow.
2. Collect DOM samples that cover meaningful variation.
3. Choose stable match rules.
4. Define the domain model you want in `siteAdapter`.
5. Map each domain target to generic controls.
6. Add compact action hints.
7. Add high-signal facts to `siteAdapter`, `adapterHints`, groups, or `visibleTextSummary`.
8. If a bounded page-local operation needs a connector, define `provideTools()` and register the executor.
9. Verify that the extracted state stays compact and executable.

Useful DOM samples include:

- page-level wrapper
- one primary item or task container
- navigation or submission region
- each relevant input type
- before and after status changes
- save, validation, warning, or completion indicators

## Minimal State-Only Adapter Skeleton

```js
(function () {
  const ADAPTER_ID = "example.site";
  const registry = globalThis.WebGPTContentAdapters;

  if (!registry || typeof registry.register !== "function") {
    throw new Error("content-scripts/adapters/registry.js must load first");
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function matchUrl(url) {
    try {
      const parsed = new URL(url || location.href);
      return parsed.hostname.includes("example.com");
    } catch {
      return false;
    }
  }

  function findControlForElement(controls, el) {
    if (!el) return null;

    if (el.id) {
      const selector = `#${CSS.escape(el.id)}`;
      const exact = controls.find((control) => control.selector === selector);
      if (exact) return exact;
    }

    const name = normalizeText(el.getAttribute("name"));
    const tag = normalizeText(el.tagName).toLowerCase();
    return controls.find((control) => control.name === name && control.tag === tag) || null;
  }

  function buildSiteAdapter(state, documentRef) {
    const targetEl = documentRef.querySelector("input[name='example']");
    const targetControl = findControlForElement(state.controls || [], targetEl);
    const actionHintsByTargetId = {};

    if (targetControl) {
      actionHintsByTargetId[targetControl.id] = {
        semanticRole: "example_input",
        inputKind: "text",
        preferredAction: "fill",
        exactValueMode: "text",
        verifyAfterAction: "valueChanged",
      };
    }

    return {
      id: ADAPTER_ID,
      pageKind: "example_page",
      primaryControlIds: targetControl ? [targetControl.id] : [],
      actionHintsByTargetId,
      plannerHints: ["Example adapter detected the primary input."],
    };
  }

  function enhanceControls(controls, actionHintsByTargetId) {
    return (controls || []).map((control) => {
      const hint = actionHintsByTargetId[control.id];
      if (!hint) return control;

      return {
        ...control,
        adapterHints: {
          ...(control.adapterHints || {}),
          [ADAPTER_ID]: hint,
        },
      };
    });
  }

  registry.register({
    id: ADAPTER_ID,
    priority: 50,

    match({ url, document: documentRef }) {
      return matchUrl(url) && Boolean(documentRef.querySelector("input[name='example']"));
    },

    enhanceState({ state, document: documentRef }) {
      const siteAdapter = buildSiteAdapter(state, documentRef);

      return {
        ...state,
        siteAdapter,
        visibleTextSummary: [
          ...siteAdapter.plannerHints,
          ...(state.visibleTextSummary || []),
        ],
        controls: enhanceControls(
          state.controls || [],
          siteAdapter.actionHintsByTargetId || {},
        ),
      };
    },
  });
})();
```

## Minimal Connector-Enabled Addition

Add this only when the adapter needs a bounded DOM-backed tool:

```js
function provideTools({ state }) {
  const ready = Boolean(state.siteAdapter?.pageKind === "example_page");
  if (!ready) return [];

  return [
    {
      type: "function",
      name: "example_fill_primary_input",
      description: "Fill the Example primary input using the adapter's DOM model.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: {
          value: { type: "string" },
        },
      },
      webgpt: {
        adapterId: ADAPTER_ID,
        replayable: true,
        mayCauseNavigation: false,
      },
    },
  ];
}

async function exampleFillPrimaryInput(action, ctx) {
  const input = document.querySelector("input[name='example']");
  if (!input) {
    return {
      ok: false,
      recoverable: true,
      detail: "Example primary input is not visible.",
    };
  }

  await ctx.primitives.fillElement(input, action.value || "");
  input.dispatchEvent(new Event("change", { bubbles: true }));

  return {
    ok: true,
    committed: true,
    value: action.value || "",
    detail: "Filled Example primary input.",
  };
}

globalThis.WebGPTConnectorTools.register(
  "example_fill_primary_input",
  exampleFillPrimaryInput,
);
```

## Validation Checklist

Before opening a PR:

- Run `node --check` on changed content-script files.
- Build the sidepanel app with `npm run build`.
- Load the extension unpacked in Chrome.
- Confirm the adapter only matches its intended page family.
- Confirm `siteAdapter.actionHintsByTargetId` keys are real generic control IDs.
- Confirm required controls remain executable by the runner.
- Confirm the payload stays compact and does not include unnecessary DOM or user data.
- Confirm navigation or destructive controls are clearly marked.
- For connector-enabled adapters, confirm tools only appear on ready page states.
- For connector-enabled adapters, confirm executor results include committed/skipped/failed evidence as appropriate.
- For connector-enabled adapters, confirm replay either reuses the connector executor or fails clearly when the page state is wrong.

## Common Pitfalls

- Do not make `enhanceState()` imperative; it describes the page.
- Do not hide broad workflow logic inside connector executors.
- Do not create target IDs the runner cannot resolve.
- Do not send raw page HTML or large DOM snapshots.
- Do not depend only on visible button text when status determines correctness.
- Do not assume `click` is the right action for every interactive element.
- Do not hide generic controls unless the runner can still execute every needed target.
- Do not overfit selectors to one generated page instance.
- Do not let one connector action perform work across a navigation boundary.

The best adapter is small, boring, and semantic. It should make generic extracted state feel like the site owner's own task model.
