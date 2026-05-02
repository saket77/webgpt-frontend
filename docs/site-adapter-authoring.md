# Site Adapter Authoring Guide

Site adapters let the WebGPT content-script extractor add site-specific semantics while keeping the runner and planner contract generic.

An adapter is extraction-only. It reads the page, enriches the extracted state, and maps site-specific concepts back to normal WebGPT control IDs. It must not click, fill, navigate, solve tasks, call backend services, or hardcode answers.

## Mental Model

The frontend loop stays generic:

1. The generic extractor builds controls, groups, headings, visible text, scroll state, and page metadata.
2. A site adapter recognizes a page family.
3. The adapter maps domain concepts to existing `state.controls` IDs.
4. The adapter adds compact hints to the extracted state.
5. A compatible backend plans normal browser commands.
6. The frontend runner executes those normal commands.

Adapters make page state easier to understand without creating a second execution model.

## Current Files

Adapter code lives in:

```text
content-scripts/adapters/
  registry.js
  canvasQuiz.js
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

Each adapter registers one object:

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

- execute actions
- mutate the page
- call a backend
- create fake executable target IDs
- remove generic controls needed by the runner
- include large DOM blobs or user data that is not needed for planning

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
- `preferredAction`: planner-preferred action type, such as `click` or `fill`
- `exactValueMode`: how values should be expressed, such as `text` or `optionText`
- `answerText`: visible label or prompt associated with the target
- `optionTexts`: valid choices for selects or choice groups
- `editorKind`: rich editor implementation, such as `tinymce`
- `navigationAction`: true for Next, Previous, Submit, or other navigation controls
- `batchPlacement`: often `last` for navigation controls
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

If a site target cannot be mapped to a generic control, include it as a non-executable page fact only.

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

The adapter does not answer quiz questions. It only makes the page structure explicit so a compatible backend can plan against ordinary `fill`, `click`, and navigation commands.

## Authoring Workflow

When adding a new adapter:

1. Define the page family and workflow.
2. Collect DOM samples that cover meaningful variation.
3. Choose stable match rules.
4. Define the domain model you want in `siteAdapter`.
5. Map each domain target to generic controls.
6. Add compact action hints.
7. Add high-signal facts to `siteAdapter`, `adapterHints`, groups, or `visibleTextSummary`.
8. Verify that the extracted state stays compact and executable.

Useful DOM samples include:

- page-level wrapper
- one primary item or task container
- navigation or submission region
- each relevant input type
- before and after status changes
- save, validation, warning, or completion indicators

## Minimal Adapter Skeleton

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

## Common Pitfalls

- Do not make adapters imperative; they describe the page.
- Do not create target IDs the runner cannot resolve.
- Do not send raw page HTML or large DOM snapshots.
- Do not depend only on visible button text when status determines correctness.
- Do not assume `click` is the right action for every interactive element.
- Do not hide generic controls unless the runner can still execute every needed target.
- Do not overfit selectors to one generated page instance.

The best adapter is small, boring, and semantic. It should make generic extracted state feel like the site owner's own task model.
