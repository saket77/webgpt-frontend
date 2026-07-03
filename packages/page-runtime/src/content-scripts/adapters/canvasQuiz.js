(function () {
  const ADAPTER_ID = "canvas.quiz";
  const registry = globalThis.WebGPTContentAdapters;
  const extractModules = globalThis.WebGPTExtractStateModules || {};
  const domUtils = extractModules.domUtils || {};

  if (!registry || typeof registry.register !== "function") {
    throw new Error(
      "content-scripts/adapters/registry.js must load before canvasQuiz.js",
    );
  }

  const normalizeText =
    domUtils.normalizeText ||
    ((value) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim());
  const lower =
    domUtils.lower || ((value) => normalizeText(value).toLowerCase());
  const textContent =
    domUtils.textContent ||
    ((el) => normalizeText(el?.innerText || el?.textContent || el?.value || ""));
  const isVisible =
    domUtils.isVisible ||
    ((el) => {
      if (!el || !(el instanceof Element)) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.width > 0 &&
        rect.height > 0
      );
    });

  function truncate(value, maxLength = 240) {
    const text = normalizeText(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trim()}...`;
  }

  function unique(items) {
    return Array.from(new Set(items.filter(Boolean)));
  }

  function cssEscape(value) {
    if (globalThis.CSS && typeof globalThis.CSS.escape === "function") {
      return globalThis.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function safeHost(url) {
    try {
      return new URL(url || location.href).hostname;
    } catch {
      return location.hostname || "";
    }
  }

  function htmlToText(html) {
    const scratch = document.createElement("div");
    scratch.innerHTML = String(html || "");
    return textContent(scratch);
  }

  function getVisibleElements(selector, root = document) {
    return Array.from(root.querySelectorAll(selector)).filter(
      (el, index, arr) =>
        el instanceof Element && isVisible(el) && arr.indexOf(el) === index,
    );
  }

  function getElements(selector, root = document) {
    return Array.from(root.querySelectorAll(selector)).filter(
      (el, index, arr) => el instanceof Element && arr.indexOf(el) === index,
    );
  }

  function elementBounds(el) {
    if (!el || !(el instanceof Element)) {
      return null;
    }

    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function center(bounds) {
    return {
      x: Number(bounds?.x || 0) + Number(bounds?.width || 0) / 2,
      y: Number(bounds?.y || 0) + Number(bounds?.height || 0) / 2,
    };
  }

  function boundsContain(outer, inner) {
    if (!outer || !inner) return false;
    const point = center(inner);
    return (
      point.x >= outer.x &&
      point.x <= outer.x + outer.width &&
      point.y >= outer.y &&
      point.y <= outer.y + outer.height
    );
  }

  function selectorCandidatesFor(el) {
    if (!el || !(el instanceof Element)) return [];

    const tag = lower(el.tagName);
    const result = [];
    const id = normalizeText(el.id);
    const name = normalizeText(el.getAttribute("name"));
    const ariaLabel = normalizeText(el.getAttribute("aria-label"));
    const title = normalizeText(el.getAttribute("title"));

    if (id) result.push(`#${cssEscape(id)}`);
    if (name) result.push(`${tag}[name="${cssEscape(name)}"]`);
    if (ariaLabel) result.push(`${tag}[aria-label="${cssEscape(ariaLabel)}"]`);
    if (title) result.push(`${tag}[title="${cssEscape(title)}"]`);

    return result;
  }

  function findControlForElement(controls, el) {
    if (!el || !(el instanceof Element)) return null;

    const selectors = new Set(selectorCandidatesFor(el));
    const tag = lower(el.tagName);
    const name = normalizeText(el.getAttribute("name"));
    const ariaLabel = normalizeText(el.getAttribute("aria-label"));
    const title = normalizeText(el.getAttribute("title"));
    const bounds = elementBounds(el);

    return (
      (controls || []).find((control) => selectors.has(control.selector)) ||
      (controls || []).find(
        (control) =>
          name &&
          control.name === name &&
          (!control.tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          ariaLabel &&
          control.ariaLabel === ariaLabel &&
          (!control.tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          title && control.title === title && (!control.tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          boundsContain(bounds, control.bounds) &&
          (!control.tag || control.tag === tag),
      ) ||
      null
    );
  }

  function findBestControlInRegion(controls, regionEl) {
    const regionBounds = elementBounds(regionEl);
    if (!regionBounds) return null;

    let best = null;
    for (const control of controls || []) {
      if (!boundsContain(regionBounds, control.bounds)) continue;

      const haystack = lower(
        [
          control.label,
          control.text,
          control.title,
          control.ariaLabel,
          control.className,
        ].join(" "),
      );
      const isButtonish =
        control.tag === "button" ||
        control.role === "button" ||
        control.controlType === "button";
      let score = Number(control.bounds?.width || 0) * Number(control.bounds?.height || 0);

      if (haystack.includes("rich content editor")) score += 50000;
      if (haystack.includes("switch to the html editor")) score += 40000;
      if (haystack.includes("accessibility checker")) score += 10000;
      if (control.tag === "div") score += 1000;
      if (isButtonish) score -= 100000;

      if (!best || score > best.score) {
        best = { control, score };
      }
    }

    return best?.control || null;
  }

  function findControlForChoice(state, inputEl) {
    const direct = findControlForElement(state.controls, inputEl);
    if (direct) return direct;

    const label = inputEl.closest("label");
    const answerRow = inputEl.closest(".answer");
    return (
      findControlForElement(state.controls, label) ||
      findBestControlInRegion(state.controls, label) ||
      findBestControlInRegion(state.controls, answerRow)
    );
  }

  function isCanvasLike(documentRef, url) {
    const host = safeHost(url);
    if (host.includes("instructure.com") || host.includes("canvaslms.com")) {
      return true;
    }

    return Boolean(
      documentRef.querySelector(
        [
          "#application",
          ".ic-app",
          ".ic-Layout-wrapper",
          "[data-automation='canvas']",
        ].join(","),
      ),
    );
  }

  function isQuizLike(documentRef, url) {
    const value = lower(url);
    if (value.includes("/quizzes/")) return true;

    return Boolean(
      documentRef.querySelector(
        [
          "#questions",
          "#question_list",
          ".question_holder",
          ".display_question.question",
          ".quiz-submission",
          ".quiz",
        ].join(","),
      ),
    );
  }

  function collectQuestionElements(documentRef) {
    const seen = new Set();
    const questions = [];

    for (const el of getVisibleElements(".display_question.question", documentRef)) {
      const id = normalizeText(el.id) || textContent(el.querySelector(".question_name"));
      if (!id || seen.has(id)) continue;
      seen.add(id);
      questions.push(el);
    }

    return questions.slice(0, 60);
  }

  function questionIdFor(questionEl) {
    const id = normalizeText(questionEl.id);
    if (id) return id;

    const anchor = questionEl
      .closest(".question_holder")
      ?.querySelector("a[name^='question_']");
    return normalizeText(anchor?.getAttribute("name"));
  }

  function questionNumberFor(questionEl, fallbackIndex) {
    const text =
      textContent(questionEl.querySelector(".question_name")) ||
      normalizeText(questionEl.getAttribute("aria-label"));
    const match = text.match(/question\s+(\d+)/i);
    return match ? Number(match[1]) : fallbackIndex + 1;
  }

  function questionTypeFor(questionEl) {
    const hiddenType = normalizeText(questionEl.querySelector(".question_type")?.textContent);
    if (hiddenType) return hiddenType;

    const classType = Array.from(questionEl.classList || []).find(
      (name) => name.endsWith("_question") && name !== "question",
    );
    return classType || "unknown_question";
  }

  function questionKindFor(questionType) {
    const type = lower(questionType);
    if (type === "matching_question") return "matching";
    if (type === "multiple_choice_question") return "single_choice";
    if (type === "true_false_question") return "true_false";
    if (type === "multiple_answers_question") return "multiple_answers";
    if (type === "short_answer_question") return "short_text";
    if (type === "essay_question") return "rich_text";
    if (type === "numerical_question") return "numeric";
    return "unknown";
  }

  function questionPromptFor(questionEl) {
    const visibleText = textContent(questionEl.querySelector(".question_text"));
    if (visibleText) return truncate(visibleText, 360);

    const storedHtml = normalizeText(
      questionEl.querySelector(".textarea_question_text")?.value,
    );
    return truncate(htmlToText(storedHtml) || textContent(questionEl), 360);
  }

  function pointsFor(questionEl) {
    const value = normalizeText(questionEl.querySelector(".question_points")?.textContent);
    return value ? Number(value) : null;
  }

  function answerLabelFor(inputEl) {
    const labelledBy = normalizeText(inputEl.getAttribute("aria-labelledby"));
    if (labelledBy) {
      const label = document.getElementById(labelledBy);
      if (label) return textContent(label);
    }

    if (inputEl.id) {
      const label = document.querySelector(`label[for="${cssEscape(inputEl.id)}"]`);
      if (label) return textContent(label);
    }

    const answer = inputEl.closest(".answer");
    return textContent(answer?.querySelector(".answer_label")) || textContent(answer);
  }

  function selectedOptionText(selectEl) {
    const selected = selectEl.selectedOptions?.[0];
    return normalizeText(selected?.textContent || selected?.label || "");
  }

  function optionTextsFor(selectEl) {
    return Array.from(selectEl.options || [])
      .map((option) => normalizeText(option.textContent || option.label))
      .filter((text) => {
        const value = lower(text).replace(/[\[\]]/g, "");
        return text && !/^(choose|select|select an answer|--.*--)$/.test(value);
      })
      .slice(0, 20);
  }

  function buildSelectTarget(state, question, selectEl) {
    const control = findControlForElement(state.controls, selectEl);
    const options = optionTextsFor(selectEl);
    const answerText = answerLabelFor(selectEl);

    return {
      targetId: control?.id || "",
      domId: normalizeText(selectEl.id),
      name: normalizeText(selectEl.getAttribute("name")),
      semanticRole: "matching_select",
      inputKind: "select",
      answerText,
      optionTexts: options,
      currentValueText: selectedOptionText(selectEl) || "[ Choose ]",
      preferredAction: "fill",
      exactValueMode: "optionText",
      verifyAfterAction: "selectedOptionChanged",
      instruction: `Use fill on this Canvas matching select with one exact option text: ${options.join(", ")}.`,
      questionId: question.id,
      questionType: question.type,
    };
  }

  function buildChoiceTarget(state, question, inputEl) {
    const control = findControlForChoice(state, inputEl);
    const type = lower(inputEl.getAttribute("type"));
    const answerText = answerLabelFor(inputEl);
    const semanticRole =
      question.kind === "true_false"
        ? "true_false_option"
        : type === "checkbox"
          ? "multiple_answer_option"
          : "single_choice_option";

    return {
      targetId: control?.id || "",
      domId: normalizeText(inputEl.id),
      name: normalizeText(inputEl.getAttribute("name")),
      semanticRole,
      inputKind: type || "choice",
      answerText,
      checked: Boolean(inputEl.checked),
      preferredAction: "click",
      exactValueMode: "answerText",
      verifyAfterAction: "checkedStateChanged",
      instruction: `Use click on the answer choice whose text is exactly "${answerText}".`,
      questionId: question.id,
      questionType: question.type,
    };
  }

  function buildTextTarget(state, question, inputEl, semanticRole, valueKind) {
    const control = findControlForElement(state.controls, inputEl);

    return {
      targetId: control?.id || "",
      domId: normalizeText(inputEl.id),
      name: normalizeText(inputEl.getAttribute("name")),
      semanticRole,
      inputKind: valueKind,
      answerText: normalizeText(inputEl.getAttribute("aria-label")) || semanticRole,
      currentValueText: normalizeText(inputEl.value),
      preferredAction: "fill",
      exactValueMode: valueKind === "numeric" ? "number" : "text",
      verifyAfterAction: "valueChangedAndCanvasSaveStatus",
      instruction: `Use fill on this Canvas ${valueKind} answer input.`,
      questionId: question.id,
      questionType: question.type,
    };
  }

  function buildRichTextTarget(state, question, questionEl) {
    const holder =
      questionEl.querySelector(".textarea-question-holder") ||
      questionEl.querySelector(".ic-RichContentEditor") ||
      questionEl.querySelector(".tox-tinymce") ||
      questionEl.querySelector("textarea[data-rich_text='true']");
    if (!holder) return null;

    const control =
      findControlForElement(state.controls, holder) ||
      findBestControlInRegion(state.controls, holder);
    const textarea = questionEl.querySelector("textarea[data-rich_text='true']");
    const hasTinyMce = Boolean(
      questionEl.querySelector(".tox-tinymce, iframe.tox-edit-area__iframe"),
    );

    return {
      targetId: control?.id || "",
      domId: normalizeText(textarea?.id || holder.id),
      name: normalizeText(textarea?.getAttribute("name")),
      semanticRole: "rich_text_answer",
      inputKind: "rich_text",
      editorKind: hasTinyMce ? "tinymce" : "textarea",
      answerText: "Rich text essay answer",
      currentValueText: truncate(normalizeText(textarea?.value), 160),
      preferredAction: "fill",
      exactValueMode: "text",
      verifyAfterAction: "richTextContentSaved",
      instruction:
        "Use fill on this Canvas rich text answer target; the runner has TinyMCE-aware fill support.",
      questionId: question.id,
      questionType: question.type,
    };
  }

  function buildAnswerTargets(state, question, questionEl) {
    const targets = [];

    if (question.kind === "matching") {
      for (const selectEl of getVisibleElements("select.question_input", questionEl)) {
        targets.push(buildSelectTarget(state, question, selectEl));
      }
      return targets;
    }

    if (
      question.kind === "single_choice" ||
      question.kind === "true_false" ||
      question.kind === "multiple_answers"
    ) {
      for (const inputEl of getElements(
        "input.question_input[type='radio'], input.question_input[type='checkbox']",
        questionEl,
      ).filter((el) => isVisible(el) || isVisible(el.closest("label,.answer")))) {
        targets.push(buildChoiceTarget(state, question, inputEl));
      }
      return targets;
    }

    if (question.kind === "short_text") {
      for (const inputEl of getVisibleElements("input.question_input[type='text']", questionEl)) {
        targets.push(buildTextTarget(state, question, inputEl, "short_text_answer", "text"));
      }
      return targets;
    }

    if (question.kind === "numeric") {
      for (const inputEl of getVisibleElements("input.question_input[type='text']", questionEl)) {
        targets.push(buildTextTarget(state, question, inputEl, "numeric_answer", "numeric"));
      }
      return targets;
    }

    if (question.kind === "rich_text") {
      const target = buildRichTextTarget(state, question, questionEl);
      if (target) targets.push(target);
    }

    return targets;
  }

  function buildQuestions(state, documentRef) {
    return collectQuestionElements(documentRef).map((questionEl, index) => {
      const id = questionIdFor(questionEl) || `canvas_question_${index + 1}`;
      const number = questionNumberFor(questionEl, index);
      const type = questionTypeFor(questionEl);
      const kind = questionKindFor(type);
      const question = {
        id,
        index,
        number,
        type,
        kind,
        prompt: questionPromptFor(questionEl),
        points: pointsFor(questionEl),
        bounds: elementBounds(questionEl),
        classes: Array.from(questionEl.classList || []),
        answerTargets: [],
      };

      question.answerTargets = buildAnswerTargets(state, question, questionEl);
      question.controlIds = unique(question.answerTargets.map((target) => target.targetId));

      return question;
    });
  }

  function questionStatuses(documentRef) {
    return getVisibleElements("#question_list li", documentRef).map((item, index) => {
      const link = item.querySelector("a");
      const iconText = textContent(item.querySelector(".icon-text"));
      const itemText = textContent(item);
      const numberMatch = itemText.match(/question\s+(\d+)/i);
      const statusText = iconText || itemText;
      const answered =
        /answered/i.test(statusText) &&
        !/(haven'?t answered|not answered|unanswered)/i.test(statusText);

      return {
        questionId: normalizeText(item.id).replace(/^list_/, ""),
        number: numberMatch ? Number(numberMatch[1]) : index + 1,
        status: answered ? "answered" : "unanswered",
        statusText: truncate(statusText, 80),
        current: item.classList.contains("current_question"),
        seen: item.classList.contains("seen"),
        href: normalizeText(link?.getAttribute("href")),
      };
    });
  }

  function saveStateText(documentRef) {
    const selectors = [
      ".save_status",
      ".last_saved",
      "#last_saved_indicator",
      ".quiz_save_status",
      ".button-container + div",
    ].join(",");
    const explicit = getVisibleElements(selectors, documentRef)
      .map((el) => textContent(el))
      .find((text) =>
        /(no new data to save|saving|saved|not saved|last checked)/i.test(text),
      );
    if (explicit) return truncate(explicit, 160);

    const bodyText = textContent(documentRef.body);
    const patterns = [
      /No new data to save\.?(?: Last checked at [^.]+)?/i,
      /Quiz saved at [0-9:apm\s]+/i,
      /Saving\.\.\./i,
      /Not saved[^.]*/i,
    ];

    for (const pattern of patterns) {
      const match = bodyText.match(pattern);
      if (match) return truncate(match[0], 160);
    }

    return "";
  }

  function quizTitle(documentRef, state) {
    const titleEl = documentRef.querySelector(
      "h1, .quiz-title, [data-testid*='title' i]",
    );
    return truncate(textContent(titleEl) || state.title || documentRef.title, 160);
  }

  function detectPageKind(documentRef, url) {
    const value = lower(`${url} ${documentRef.title} ${textContent(documentRef.body).slice(0, 2500)}`);
    if (value.includes("score for this attempt") || value.includes("take the quiz again")) {
      return "quiz_results";
    }
    if (documentRef.querySelector("#questions.assessing, .display_question.question")) {
      return "quiz_question";
    }
    return "quiz";
  }

  function findNavigationControl(state, documentRef, selector) {
    const el = getVisibleElements(selector, documentRef)[0] || null;
    const control = findControlForElement(state.controls, el);
    return control
      ? {
          targetId: control.id,
          label: control.label || control.text || "",
        }
      : null;
  }

  function buildNavigation(state, documentRef) {
    const previous = findNavigationControl(
      state,
      documentRef,
      ".button-container .previous-question, button[aria-label='Previous Question']",
    );
    const next = findNavigationControl(
      state,
      documentRef,
      ".button-container .next-question, button[aria-label='Next Question']",
    );
    const submit = findNavigationControl(
      state,
      documentRef,
      ".button-container .submit_button:not(.next-question):not(.previous-question), button[aria-label='Submit Quiz']",
    );

    return {
      previousTargetId: previous?.targetId || "",
      nextTargetId: next?.targetId || "",
      submitTargetId: submit?.targetId || "",
    };
  }

  function addNavigationHints(actionHintsByTargetId, navigation) {
    for (const [key, semanticRole] of [
      ["previousTargetId", "quiz_previous"],
      ["nextTargetId", "quiz_next"],
      ["submitTargetId", "quiz_submit"],
    ]) {
      const targetId = navigation[key];
      if (!targetId) continue;

      actionHintsByTargetId[targetId] = {
        semanticRole,
        preferredAction: "click",
        navigationAction: true,
        batchPlacement: "last",
        verifyAfterAction: "urlOrQuestionChanged",
        instruction:
          "Canvas navigation control. Click it after answer actions, not before them.",
      };
    }
  }

  function buildActionHints(questions, navigation) {
    const actionHintsByTargetId = {};

    for (const question of questions) {
      for (const target of question.answerTargets || []) {
        if (!target.targetId) continue;
        actionHintsByTargetId[target.targetId] = { ...target };
      }
    }

    addNavigationHints(actionHintsByTargetId, navigation);
    return actionHintsByTargetId;
  }

  function controlHintText(hint) {
    if (!hint) return "";

    const parts = [
      "Canvas adapter",
      hint.semanticRole ? `role: ${hint.semanticRole}` : "",
      hint.preferredAction ? `preferred action: ${hint.preferredAction}` : "",
      hint.exactValueMode ? `value mode: ${hint.exactValueMode}` : "",
      hint.editorKind ? `editor: ${hint.editorKind}` : "",
      hint.instruction || "",
    ];

    return truncate(parts.filter(Boolean).join("; "), 260);
  }

  function enhanceControls(controls, actionHintsByTargetId) {
    return (controls || []).map((control) => {
      const hint = actionHintsByTargetId[control.id];
      if (!hint) return control;

      const hintText = controlHintText(hint);

      return {
        ...control,
        label: truncate(unique([control.label, hintText]).join(" | "), 220),
        title: truncate(unique([control.title, hintText]).join(" | "), 220),
        heading: truncate(
          unique([control.heading, hint.questionText || hint.instruction]).join(" | "),
          220,
        ),
        adapterHints: {
          ...(control.adapterHints || {}),
          [ADAPTER_ID]: hint,
        },
      };
    });
  }

  function buildQuestionGroups(questions) {
    return questions.map((question) => ({
      id: `canvas_group_${question.id}`,
      kind: "quiz_question",
      adapterId: ADAPTER_ID,
      questionId: question.id,
      questionNumber: question.number,
      questionType: question.type,
      questionKind: question.kind,
      label: `Canvas question ${question.number}: ${question.kind}`,
      text: question.prompt,
      controlIds: question.controlIds,
      answerTargets: (question.answerTargets || []).map((target) => ({
        targetId: target.targetId,
        semanticRole: target.semanticRole,
        answerText: target.answerText,
        optionTexts: target.optionTexts,
        preferredAction: target.preferredAction,
        exactValueMode: target.exactValueMode,
      })),
      bounds: question.bounds,
    }));
  }

  function adapterSummaryGroup(siteAdapter) {
    return {
      id: "canvas_adapter_summary",
      kind: "site_adapter_summary",
      adapterId: ADAPTER_ID,
      label: "Canvas quiz adapter summary",
      text: siteAdapter.plannerHints.join(" "),
      primaryControlIds: siteAdapter.primaryControlIds,
    };
  }

  function sidebarGroup(statuses) {
    if (!statuses.length) return null;

    return {
      id: "canvas_question_sidebar",
      kind: "quiz_question_sidebar",
      adapterId: ADAPTER_ID,
      label: "Canvas question sidebar status",
      text: statuses
        .map((item) => `Question ${item.number}: ${item.statusText}`)
        .join("; "),
      questionStatuses: statuses,
    };
  }

  function buildPlannerHints(questions, saveText) {
    const hints = [
      "Canvas quiz adapter detected the active question and answer controls.",
      "Prefer actionHintsByTargetId when choosing action types.",
      "For Canvas matching selects, use fill with exact visible option text; do not use click plus ArrowDown or Enter.",
      "For Canvas text, numeric, and rich text answers, use fill.",
      "For Canvas radio and checkbox answers, use click on the exact answer choice.",
      "Place Next, Previous, and Submit navigation clicks after answer actions in the batch.",
    ];

    if (questions.some((question) => question.kind === "rich_text")) {
      hints.push("Rich text answers use Canvas TinyMCE; runner fill is TinyMCE-aware.");
    }

    if (saveText) {
      hints.push(`Canvas save status: ${saveText}`);
    }

    return hints;
  }

  function buildSiteAdapter(state, documentRef, url) {
    const questions = buildQuestions(state, documentRef);
    const statuses = questionStatuses(documentRef);
    const navigation = buildNavigation(state, documentRef);
    const actionHintsByTargetId = buildActionHints(questions, navigation);
    const saveText = saveStateText(documentRef);
    const currentStatus = statuses.find((item) => item.current) || null;
    const currentQuestion =
      questions.find((question) => question.number === currentStatus?.number) ||
      questions[0] ||
      null;
    const primaryControlIds = unique([
      ...(currentQuestion?.controlIds || []),
      navigation.nextTargetId,
      navigation.previousTargetId,
      navigation.submitTargetId,
    ]);
    const pageKind = detectPageKind(documentRef, url);

    return {
      id: ADAPTER_ID,
      pageKind,
      quiz: {
        title: quizTitle(documentRef, state),
        currentQuestionNumber: currentQuestion?.number || currentStatus?.number || null,
        totalQuestions: statuses.length || questions.length || null,
        saveStateText: saveText,
        inStudentView: /currently logged into student view/i.test(
          textContent(documentRef.body),
        ),
        questionStatuses: statuses,
      },
      question: currentQuestion
        ? {
            id: currentQuestion.id,
            number: currentQuestion.number,
            type: currentQuestion.type,
            kind: currentQuestion.kind,
            prompt: currentQuestion.prompt,
            answerTargets: currentQuestion.answerTargets,
            controlIds: currentQuestion.controlIds,
          }
        : null,
      questions,
      navigation,
      primaryControlIds,
      actionHintsByTargetId,
      plannerHints: buildPlannerHints(questions, saveText),
    };
  }

  registry.register({
    id: ADAPTER_ID,
    priority: 100,

    match({ url, document: documentRef }) {
      return isCanvasLike(documentRef, url) && isQuizLike(documentRef, url);
    },

    enhanceState({ state, document: documentRef, url }) {
      const siteAdapter = buildSiteAdapter(state, documentRef, url);
      const groups = [
        adapterSummaryGroup(siteAdapter),
        sidebarGroup(siteAdapter.quiz.questionStatuses || []),
        ...buildQuestionGroups(siteAdapter.questions || []),
      ].filter(Boolean);
      const pageFactSummary = [
        `Canvas quiz page kind: ${siteAdapter.pageKind}`,
        siteAdapter.question
          ? `current question ${siteAdapter.question.number}: ${siteAdapter.question.kind}`
          : "",
        siteAdapter.quiz.totalQuestions
          ? `total questions: ${siteAdapter.quiz.totalQuestions}`
          : "",
        siteAdapter.quiz.saveStateText
          ? `save status: ${siteAdapter.quiz.saveStateText}`
          : "",
      ]
        .filter(Boolean)
        .join("; ");

      return {
        ...state,
        site: {
          ...(state.site || {}),
          id: "canvas",
          mode: siteAdapter.pageKind,
        },
        pageFacts: {
          ...(state.pageFacts || {}),
          quizTitle: siteAdapter.quiz.title,
          currentQuestion: siteAdapter.quiz.currentQuestionNumber,
          totalQuestions: siteAdapter.quiz.totalQuestions,
          saveStateText: siteAdapter.quiz.saveStateText,
          detectedQuestionCount: siteAdapter.questions.length,
        },
        siteAdapter,
        visibleTextSummary: unique([
          pageFactSummary,
          ...siteAdapter.plannerHints,
          ...(state.visibleTextSummary || []),
        ]).slice(0, 60),
        groups: [...groups, ...(state.groups || [])].slice(0, 100),
        controls: enhanceControls(
          state.controls || [],
          siteAdapter.actionHintsByTargetId || {},
        ),
      };
    },
  });
})();
