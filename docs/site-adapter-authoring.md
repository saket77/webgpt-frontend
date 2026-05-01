# Site Adapter Authoring Guide

This guide explains how content-script site adapters work in the WebGPT frontend and how the first adapter, `canvas.quiz`, was built to improve Canvas quiz runs with the WebGPT backend.

It is written for two readers:

- humans who want to understand or contribute site adapters
- AI agents that are given DOM samples and asked to produce a useful adapter

The current adapter layer is extraction-only. A site adapter does not click, fill, navigate, or solve anything. It reads the page, enriches the generic extracted state, and gives the backend clearer semantics.

## Mental Model

The frontend is still a generic execution engine:

1. The generic extractor builds controls, groups, headings, visible text, scroll state, and page metadata.
2. A site adapter recognizes a specific page family.
3. The adapter maps site-specific DOM concepts back to generic control IDs.
4. The adapter adds structured hints to the state.
5. The backend ranks and sanitizes the state, then plans actions.
6. The frontend runner executes the planner's normal `run_actions` commands.

The adapter should make the planner see the page the way a human operator would see it, without replacing the generic extraction and runner systems.

## Current Files

Content-script adapter code lives here:

```text
FrontEnd/content-scripts/adapters/
  registry.js
  canvasQuiz.js
```

The adapter scripts are injected before `extractState.js` in:

```text
FrontEnd/background/runtime/browser.js
```

The generic extractor calls the adapter registry in:

```text
FrontEnd/content-scripts/extractState.js
```

Compatible backends should consume adapter hints during:

```text
control ranking
planner-input sanitization
planner context selection
action planning
```

## Adapter Contract

Each adapter registers one object:

```js
registry.register({
  id: "canvas.quiz",
  priority: 100,

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

Return `true` only when the adapter is confident this is the right site and page family.

Good match rules combine:

- hostname or URL path signals
- stable page-level DOM markers
- stable domain containers

For Canvas quizzes, the adapter checks that the page is Canvas-like and quiz-like. Canvas-like can come from hosts such as `instructure.com` or Canvas app wrappers. Quiz-like can come from `/quizzes/`, `#questions`, `#question_list`, or `.display_question.question`.

### `enhanceState({ state, document, url })`

Return an enriched state object. The adapter should:

- read stable DOM structures
- infer domain concepts
- map domain targets to existing generic `state.controls` IDs
- add `siteAdapter`
- add compact `adapterHints` to mapped controls
- add high-signal groups and visible text facts

The adapter should not:

- execute actions
- hardcode answers
- call the backend
- mutate the page
- rely on one run's generated IDs unless those IDs are stable site conventions

## Why Pass `state` Into `enhanceState`

Passing `state` is intentional. The adapter is not redoing generic extraction. It is using the DOM to understand site semantics and using the generic `state` to find the actual control IDs the backend and runner already understand.

For example, Canvas matching questions expose a semantic relationship:

```text
HTML -> select with options Structure, Styling, Behavior
CSS -> select with options Structure, Styling, Behavior
JavaScript -> select with options Structure, Styling, Behavior
```

The adapter can identify that relationship from the Canvas DOM, then map each `<select>` back to the generic extracted control ID. The planner can then choose a normal `fill` action using the existing runner pipeline.

Without `state`, the adapter would either create a parallel control model or force the runner to understand Canvas-specific selectors. That would make adapters heavier and less pluggable.

## State Shape Added By An Adapter

The most important top-level field is `siteAdapter`.

Recommended shape:

```js
{
  site: {
    id: "canvas",
    mode: "quiz_question"
  },
  pageFacts: {
    quizTitle: "Practice Quiz",
    currentQuestion: 1,
    totalQuestions: 10,
    saveStateText: "No new data to save",
    detectedQuestionCount: 1
  },
  siteAdapter: {
    id: "canvas.quiz",
    pageKind: "quiz_question",
    quiz: {},
    question: {},
    questions: [],
    navigation: {},
    primaryControlIds: [],
    actionHintsByTargetId: {},
    plannerHints: []
  }
}
```

### `siteAdapter.quiz`

Use this for page-level facts:

```js
{
  title: "Practice Quiz",
  currentQuestionNumber: 1,
  totalQuestions: 10,
  saveStateText: "No new data to save",
  inStudentView: false,
  questionStatuses: [
    {
      questionId: "question_123",
      number: 1,
      status: "unanswered",
      statusText: "Haven't Answered Yet",
      current: true,
      seen: true,
      href: "/courses/..."
    }
  ]
}
```

Question status is high value. It lets the planner know whether navigation or submission is safe.

### `siteAdapter.question`

Use this for the active item the user is working on:

```js
{
  id: "question_123",
  number: 1,
  type: "matching_question",
  kind: "matching",
  prompt: "Match the concept to the correct definition:",
  answerTargets: [],
  controlIds: ["el_10", "el_11", "el_12"]
}
```

The adapter can also include `questions` for all visible or known questions, but keep the payload compact.

### `siteAdapter.actionHintsByTargetId`

This is the strongest planner-facing field. Keys are generic control IDs from `state.controls`.

```js
{
  "el_10": {
    "semanticRole": "matching_select",
    "inputKind": "select",
    "answerText": "HTML",
    "optionTexts": ["Styling", "Structure", "Behavior"],
    "preferredAction": "fill",
    "exactValueMode": "optionText",
    "verifyAfterAction": "selectedOptionChanged"
  }
}
```

Important fields:

- `semanticRole`: domain role, such as `matching_select`, `single_choice_option`, or `quiz_next`
- `preferredAction`: planner should prefer this action type for the target
- `exactValueMode`: tells the planner how values should be expressed
- `answerText`: visible label or prompt for the target
- `optionTexts`: valid choices for selects or choice groups
- `editorKind`: rich editor implementation, such as `tinymce`
- `navigationAction`: true for Next, Previous, Submit, or other navigation controls
- `batchPlacement`: often `last` for navigation
- `verifyAfterAction`: what should change after execution

### Control-Level `adapterHints`

For every target mapped to a generic control, add compact control-level hints:

```js
{
  id: "el_10",
  label: "HTML | Canvas adapter; role: matching_select; preferred action: fill",
  adapterHints: {
    "canvas.quiz": {
      "semanticRole": "matching_select",
      "preferredAction": "fill",
      "exactValueMode": "optionText"
    }
  }
}
```

This gives the backend two paths to the same meaning:

- frame-level `siteAdapter.actionHintsByTargetId`
- control-level `control.adapterHints`

That redundancy is useful because ranking, sanitization, and planner prompts each see slightly different parts of the state.

## How `canvas.quiz` Was Built

The Canvas quiz adapter followed a repeatable pattern.

### 1. Identify Stable Page Signatures

The adapter does not match only one school or one quiz. It looks for Canvas and quiz structure:

- Canvas app wrappers or known Canvas hostnames
- `/quizzes/` URL path
- `#questions`
- `#question_list`
- `.question_holder`
- `.display_question.question`

This avoids overfitting to one run while still keeping the adapter scoped.

### 2. Find Domain Containers

Canvas quiz pages have two especially useful regions:

- `#questions`: current question and answer controls
- `#question_list`: sidebar status for every question

The sidebar is important because the visible question can look complete while another question remains unanswered. The adapter pushes sidebar status into a high-priority group so it survives backend group caps.

### 3. Parse Question Metadata

For each `.display_question.question`, the adapter extracts:

- question ID from the element ID or anchor name
- question number from `.question_name`
- Canvas question type from `.question_type` or CSS class
- normalized question kind
- prompt from `.question_text` or hidden original text
- point value from `.question_points`

Canvas question type is normalized into planner-friendly kinds:

```text
matching_question          -> matching
multiple_choice_question   -> single_choice
true_false_question        -> true_false
multiple_answers_question  -> multiple_answers
short_answer_question      -> short_text
essay_question             -> rich_text
numerical_question         -> numeric
```

### 4. Extract Answer Targets By Question Kind

The adapter uses different DOM rules for each kind:

- matching: visible `select.question_input`
- single choice: radio `input.question_input`
- true or false: radio `input.question_input`
- multiple answers: checkbox `input.question_input`
- short text: text `input.question_input`
- numeric: text `input.numerical_question_input`
- rich text: Canvas RCE/TinyMCE holder or `textarea[data-rich_text='true']`

This is where the adapter adds the strongest execution hints. Matching selects prefer `fill` with exact option text. Canvas rich text prefers `fill` with `editorKind: "tinymce"` because the runner already has TinyMCE-aware fill support.

### 5. Map DOM Targets To Generic Controls

The adapter does not invent executable targets. It maps each DOM target back to `state.controls`.

Mapping strategies, from strongest to weakest:

- exact selector, such as `#id`
- tag plus `name`
- tag plus `aria-label`
- tag plus `title`
- bounds containment
- nearest label or answer row for hidden or stylized choices

This is the key to keeping the adapter pluggable. The backend still plans against normal WebGPT control IDs, and the runner still executes normal WebGPT actions.

### 6. Add Navigation Hints

Canvas quiz navigation is semantically different from answer controls. The adapter marks Previous, Next, and Submit as:

```js
{
  semanticRole: "quiz_next",
  preferredAction: "click",
  navigationAction: true,
  batchPlacement: "last",
  verifyAfterAction: "urlOrQuestionChanged"
}
```

The planner prompt is taught to place navigation after answer actions.

### 7. Keep The Payload Smaller But More Useful

When any frame has a `siteAdapter`, the backend uses smaller limits:

- controls: 50 instead of 200
- scrollable containers: 10 instead of 50
- sanitized groups: 10 instead of 20

The adapter makes this safe by boosting only the meaningful controls and placing domain groups first.

## Backend Integration

The backend treats adapter hints as high-confidence semantics.

### Ranking

`rankControlsByGoalAndPlan.js` collects IDs from:

- `siteAdapter.primaryControlIds`
- `siteAdapter.actionHintsByTargetId`
- `siteAdapter.question.controlIds`
- `siteAdapter.question.answerTargets`
- `siteAdapter.questions`
- `siteAdapter.navigation`
- `control.adapterHints`

Those controls get a large boost before generic token matching.

### Sanitization

`sanitizePlannerInput.js` preserves compact versions of:

- `siteAdapter`
- `control.adapterHints`
- adapter groups

Only sanitized, bounded fields should reach the planner. If a new adapter field is important to planning, make sure it is preserved there.

### Planner Prompt

`plannerEngineService.js` tells the planner:

- `siteAdapter` may be present
- `actionHintsByTargetId` is high-confidence page semantics
- prefer `preferredAction`
- honor `exactValueMode`
- place navigation actions after answer actions when `batchPlacement` says so

## Authoring A New Adapter From User DOM Samples

When an end user gives DOM details and context, produce the adapter in this order.

### 1. Ask For Or Identify The Page Story

Capture:

- site name and URL pattern
- what the user is trying to accomplish
- what page state means "ready"
- what page state means "done"
- what can go wrong
- what controls are answer/input controls
- what controls are navigation or submission controls
- what status indicators matter

For Canvas quizzes, the story was: answer the current quiz question, click Next, repeat until all questions are answered, then submit only when safe.

### 2. Ask For DOM Samples That Cover Variation

Useful samples include:

- one page-level wrapper
- one current item container
- one sidebar or status region
- one navigation region
- examples of each input type
- before and after an answer is selected
- before and after navigation
- any "saving", "saved", validation, or warning indicators

Do not build from one happy-path button if the page has status and persistence behavior.

### 3. Define Stable Match Rules

Prefer:

- hostname families
- URL path families
- site-owned wrapper classes
- stable IDs
- stable ARIA roles and labels
- stable hidden metadata

Avoid:

- full one-off URLs
- generated IDs unless the site consistently uses the same pattern
- exact text that may be localized
- selectors that depend on layout-only wrappers

### 4. Define A Domain Model

Before writing selectors, name the concepts:

```text
pageKind
primary item
item status
input targets
navigation targets
save or persistence status
blocking warnings
completion condition
```

Then map those concepts into `siteAdapter`.

### 5. Map Domain Targets To Generic Controls

For each target, decide how to find the generic control ID:

- direct element selector
- label association
- `name`
- ARIA label
- title
- region bounds
- parent row or card

If a target cannot be mapped to a generic control, include it in domain facts only. Do not create fake executable target IDs.

### 6. Emit Action Hints

Choose hints based on runner behavior, not just DOM type.

Examples:

- native selects should usually prefer `fill`, not synthetic keyboard events
- text inputs should prefer `fill`
- rich text editors should prefer `fill` and identify the editor kind
- radios and checkboxes should prefer `click`
- navigation should prefer `click` and `batchPlacement: "last"`
- destructive or final actions should include status preconditions in `plannerHints`

### 7. Put High-Signal Facts In Multiple Places

Use:

- `siteAdapter` for structured facts
- `control.adapterHints` for per-control facts
- `groups` for domain regions and status
- `visibleTextSummary` for short planner-readable facts
- `pageFacts` for compact page-level facts

This is intentional. Different backend steps compress different parts of the state.

### 8. Validate Against A Real Run

After implementation:

1. Run `node --check` on changed JS files.
2. Run the extension flow and inspect `planner-artifacts/run-debug`.
3. Confirm extracted state has `siteAdapter`.
4. Confirm meaningful controls are still present after ranking.
5. Confirm `siteAdapter.actionHintsByTargetId` points to real control IDs.
6. Confirm planner input is smaller and more semantic.
7. Confirm planned actions follow `preferredAction`.
8. Confirm page status changes after execution.

## AI Agent Adapter Prompt

Use this prompt when asking an AI agent to draft a new extraction adapter:

```text
You are adding a WebGPT frontend content-script site adapter.

Given the DOM samples and user workflow, produce an extraction-only adapter.
Do not execute actions and do not hardcode answers.

Return:
1. match({ url, document }) rules
2. enhanceState({ state, document, url }) strategy
3. stable selectors and fallback selectors
4. domain model for siteAdapter
5. target-to-control mapping strategy
6. actionHintsByTargetId fields
7. groups and visibleTextSummary additions
8. backend fields that must survive sanitization
9. validation checklist

Assume the generic extractor runs first and provides state.controls.
The adapter must map site-specific DOM targets back to existing control IDs.
```

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

  function buildSiteAdapter(state, documentRef, url) {
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

    enhanceState({ state, document: documentRef, url }) {
      const siteAdapter = buildSiteAdapter(state, documentRef, url);

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

## Canvas-Specific Lessons

The Canvas adapter worked because it fixed structural ambiguity, not because it solved the quiz.

Important lessons:

- Matching questions need `fill` on the select with exact visible option text.
- Synthetic `ArrowDown` and `Enter` events are not reliable for native select changes.
- Canvas rich text should be surfaced as a fillable answer target with `editorKind: "tinymce"`.
- Sidebar question status should be highlighted because it controls whether Submit is safe.
- Navigation controls should be marked as navigation and placed last in action batches.
- Save or persistence text should be exposed because "answered" in the sidebar is not always enough proof of saved state.
- Adapter groups should be placed before generic groups so they survive backend group limits.

## Common Pitfalls

- Do not make adapters imperative. They describe the page; they do not operate it.
- Do not create target IDs the runner cannot resolve.
- Do not send huge DOM blobs to the backend.
- Do not hide generic controls unless the backend and runner can still execute every needed target.
- Do not depend only on visible button text when status or save state determines correctness.
- Do not assume `click` is the right action for all interactive elements.
- Do not add important fields only to `siteAdapter` without checking backend sanitization.
- Do not overfit selectors to one user's generated IDs when stable semantic selectors exist.

The best adapter is small, boring, and semantic. It should make the generic state feel like the site owner's own task model.
