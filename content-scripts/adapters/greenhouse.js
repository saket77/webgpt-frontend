(function () {
  const ADAPTER_ID = "greenhouse.application";
  const APPLICATION_TARGET_ID = `site:${ADAPTER_ID}:application`;
  const registry = globalThis.WebGPTContentAdapters;
  const extractModules = globalThis.WebGPTExtractStateModules || {};
  const domUtils = extractModules.domUtils || {};

  if (!registry || typeof registry.register !== "function") {
    throw new Error(
      "content-scripts/adapters/registry.js must load before greenhouse.js",
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
    return Array.from(new Set((items || []).filter(Boolean)));
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

  function stableKey(value, fallback = "item") {
    const key = lower(value)
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 90);
    return key || fallback;
  }

  function getElements(selector, root = document) {
    return Array.from(root.querySelectorAll(selector)).filter(
      (el, index, arr) => el instanceof Element && arr.indexOf(el) === index,
    );
  }

  function getVisibleElements(selector, root = document) {
    return getElements(selector, root).filter(isVisible);
  }

  function elementBounds(el) {
    if (!el || !(el instanceof Element)) return null;
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
    const id = normalizeText(el.id);
    const name = normalizeText(el.getAttribute("name"));
    const ariaLabel = normalizeText(el.getAttribute("aria-label"));
    const title = normalizeText(el.getAttribute("title"));
    const result = [];

    if (id) result.push(`#${cssEscape(id)}`);
    if (name) result.push(`${tag}[name="${cssEscape(name)}"]`);
    if (ariaLabel) result.push(`${tag}[aria-label="${cssEscape(ariaLabel)}"]`);
    if (title) result.push(`${tag}[title="${cssEscape(title)}"]`);

    return result;
  }

  function isUniqueSelector(selector) {
    if (!selector) return false;
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function ownStableSelector(el) {
    for (const candidate of selectorCandidatesFor(el)) {
      if (isUniqueSelector(candidate)) return candidate;
    }
    return "";
  }

  function anchoredComboboxSelector(input) {
    const id = normalizeText(input?.id);
    if (!id) return "";
    const idSel = `#${cssEscape(id)}`;
    if (!isUniqueSelector(idSel)) return "";

    const candidates = [
      `.select__control:has(${idSel})`,
      `.select-shell:has(${idSel}) .select__indicators button[aria-label='Toggle flyout']`,
      `.select__container:has(${idSel}) .select__control`,
    ];
    for (const selector of candidates) {
      if (isUniqueSelector(selector)) return selector;
    }
    return "";
  }

  // Greenhouse React-select openers/options often have no stable generic selector
  // (every field renders an identical `button[aria-label="Toggle flyout"]`), so the
  // runner falls back to recorded bounds and resolves the wrong toggle in dense
  // sections like the EEOC self-identification block. Anchor a unique selector on
  // the field's stable input id so the runner resolves the correct control
  // deterministically regardless of scroll position or el_* id drift.
  function uniqueComboboxSelector(el, input) {
    return ownStableSelector(el) || anchoredComboboxSelector(input);
  }

  function findControlBySelector(controls, selectors, bounds, tag) {
    const matches = (controls || []).filter((control) =>
      selectors.has(control.selector),
    );
    if (matches.length === 1) return matches[0];

    return (
      matches.find(
        (control) =>
          boundsContain(bounds, control.bounds) &&
          (!control.tag || !tag || control.tag === tag),
      ) ||
      matches.find((control) => boundsContain(control.bounds, bounds)) ||
      null
    );
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
      findControlBySelector(controls, selectors, bounds, tag) ||
      (controls || []).find(
        (control) =>
          name &&
          control.name === name &&
          (!control.tag || !tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          ariaLabel &&
          control.ariaLabel === ariaLabel &&
          (!control.tag || !tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          title && control.title === title && (!control.tag || !tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          boundsContain(bounds, control.bounds) &&
          (!control.tag || !tag || control.tag === tag),
      ) ||
      null
    );
  }

  function controlsInRegion(controls, regionEl) {
    const regionBounds = elementBounds(regionEl);
    if (!regionBounds) return [];

    return (controls || []).filter((control) =>
      boundsContain(regionBounds, control.bounds),
    );
  }

  function controlByIdMap(controls) {
    const result = new Map();
    for (const control of controls || []) {
      if (control?.id) result.set(control.id, control);
    }
    return result;
  }

  function isActionableControl(control) {
    if (!control) return false;

    const tag = lower(control.tag);
    const role = lower(control.role);
    const controlType = lower(control.controlType);
    const className = lower(control.className);
    const selector = lower(control.selector);
    const ariaLabel = lower(control.ariaLabel);

    if (["input", "textarea", "select", "button"].includes(tag)) return true;
    if (tag === "label") return true;
    if (["button", "option", "radio", "checkbox"].includes(role)) return true;
    if (tag === "div" && /\bselect__control\b/.test(className)) return true;
    if (tag === "div" && selector.includes(".select__control")) return true;
    if (ariaLabel === "toggle flyout") return true;
    if (
      ["button", "textbox", "combobox", "select", "radio", "checkbox", "file"].includes(
        controlType,
      )
    ) {
      return true;
    }

    return false;
  }

  function actionableControlIds(controlIds, controlsById, maxCount = Infinity) {
    return unique(controlIds || [])
      .filter((id) => isActionableControl(controlsById.get(id)))
      .slice(0, maxCount);
  }

  function applicationForm(documentRef) {
    return (
      documentRef.querySelector("form#application-form") ||
      documentRef.querySelector("form.application--form")
    );
  }

  function isGreenhousePage(documentRef, url) {
    const form = applicationForm(documentRef);
    if (!form) return false;

    const host = lower(safeHost(url));
    if (host === "job-boards.greenhouse.io" || host === "boards.greenhouse.io") {
      return true;
    }

    return Boolean(
      host.endsWith(".greenhouse.io") ||
        form.querySelector(".application--questions, .application--submit"),
    );
  }

  function fieldTargetId(fieldKey) {
    return `site:${ADAPTER_ID}:field:${stableKey(fieldKey, "field")}`;
  }

  function optionTargetId(fieldKey, optionText) {
    return `${fieldTargetId(fieldKey)}:option:${stableKey(optionText, "option")}`;
  }

  function cleanLabel(value) {
    return truncate(normalizeText(value).replace(/\s*\*\s*$/, ""), 260);
  }

  function labelElementForInput(root, input) {
    const id = normalizeText(input?.id);
    if (id) {
      const label = root.querySelector(`label[for="${cssEscape(id)}"]`);
      if (label) return label;
    }

    const labelledBy = normalizeText(input?.getAttribute("aria-labelledby"));
    for (const labelId of labelledBy.split(/\s+/).filter(Boolean)) {
      const label = document.getElementById(labelId);
      if (label && root.contains(label)) return label;
    }

    return input?.closest("label") || null;
  }

  function directLabelForInput(root, input) {
    return cleanLabel(textContent(labelElementForInput(root, input)));
  }

  function primaryInputSelector() {
    return [
      "textarea",
      "select",
      "input:not([type='hidden']):not([aria-hidden='true']):not([tabindex='-1'])",
    ].join(",");
  }

  function isNonFileInput(input) {
    if (!input || !(input instanceof Element)) return false;
    return lower(input.getAttribute("type")) !== "file";
  }

  function labeledInputForRoot(root, options = {}) {
    const includeFile = options.includeFile !== false;

    for (const label of getElements("label[for]", root)) {
      const id = normalizeText(label.getAttribute("for"));
      if (!id) continue;

      const input = root.querySelector(`#${cssEscape(id)}`);
      if (
        input?.matches(primaryInputSelector()) &&
        (includeFile || isNonFileInput(input))
      ) {
        return input;
      }
    }

    return null;
  }

  function visibleNonFileInput(root) {
    const candidates = getVisibleElements(primaryInputSelector(), root).filter(
      isNonFileInput,
    );

    return (
      candidates.find((input) => input.tagName === "TEXTAREA") ||
      labeledInputForRoot(root, { includeFile: false }) ||
      candidates[0] ||
      null
    );
  }

  function findPrimaryInput(root) {
    const visibleTextInput = visibleNonFileInput(root);
    if (visibleTextInput) return visibleTextInput;
    const file = root.querySelector("input[type='file']");
    if (file) return file;
    const labeled = labeledInputForRoot(root);
    if (labeled) return labeled;
    return root.querySelector(primaryInputSelector());
  }

  function isGenericUploadControlLabel(value) {
    return /^(attach|upload|dropbox|google drive|enter manually)$/i.test(
      normalizeText(value),
    );
  }

  function fieldLevelLabel(root) {
    return getElements("label", root).find((label) => {
      const text = cleanLabel(textContent(label));
      return text && !isGenericUploadControlLabel(text);
    });
  }

  function questionText(root) {
    const input = findPrimaryInput(root);
    const label =
      fieldLevelLabel(root) ||
      labelElementForInput(root, input) ||
      root.querySelector("label") ||
      root.querySelector("legend") ||
      root.querySelector("[role='heading']") ||
      root.querySelector("h2, h3, h4");

    return (
      cleanLabel(textContent(label)) ||
      cleanLabel(input?.getAttribute("aria-label")) ||
      cleanLabel(textContent(root))
    );
  }

  function descriptionText(root) {
    const input = findPrimaryInput(root);
    const describedBy = normalizeText(input?.getAttribute("aria-describedby"));
    const descriptions = [];

    for (const id of describedBy.split(/\s+/).filter(Boolean)) {
      if (!/-description$/.test(id)) continue;
      const el = document.getElementById(id);
      if (el && root.contains(el)) descriptions.push(textContent(el));
    }

    descriptions.push(
      ...getElements(".question-description, .body__secondary", root).map(
        textContent,
      ),
    );

    return truncate(unique(descriptions).join(" "), 360);
  }

  function isComboboxInput(input) {
    if (!input || !(input instanceof Element)) return false;
    return (
      lower(input.getAttribute("role")) === "combobox" ||
      lower(input.getAttribute("aria-autocomplete")) === "list" ||
      lower(input.getAttribute("aria-haspopup")) === "true" ||
      lower(input.getAttribute("aria-haspopup")) === "listbox" ||
      input.classList.contains("select__input")
    );
  }

  function isRequiredField(root) {
    const input = findPrimaryInput(root);
    if (
      input?.required ||
      lower(input?.getAttribute("aria-required")) === "true"
    ) {
      return true;
    }

    const required = Array.from(
      root.querySelectorAll("[required], [aria-required='true']"),
    ).some((el) => lower(el.getAttribute("aria-hidden")) !== "true");
    if (required) return true;

    return /\*$/.test(normalizeText(textContent(root.querySelector("label"))));
  }

  function isFileField(root) {
    if (visibleNonFileInput(root)) return false;
    if (root.querySelector("input[type='file']")) return true;

    return getElements("button, label, input", root).some((el) =>
      /\b(upload|attach|resume|cv)\b/i.test(textContent(el)),
    );
  }

  function inputKind(input) {
    if (!input) return "";
    if (input.tagName === "TEXTAREA") return "long_text";
    if (input.tagName === "SELECT") return "select";
    return lower(input.getAttribute("type")) || "text";
  }

  function fieldKind(root, input, optionCount) {
    if (isFileField(root)) return "file";
    if (isComboboxInput(input)) return "combobox";
    if (input?.tagName === "TEXTAREA") return "long_text";
    if (input?.tagName === "SELECT") return "select";
    if (root.querySelector("input[type='radio']")) return "single_select";
    if (root.querySelector("input[type='checkbox']") && optionCount > 1) {
      return "multi_select";
    }
    if (root.querySelector("input[type='checkbox']")) return "checkbox";
    if (optionCount > 0) return "single_select";
    return inputKind(input) || "field";
  }

  function textValueForField(input) {
    if (!input || !(input instanceof Element)) return "";
    if (["checkbox", "radio", "file"].includes(lower(input.getAttribute("type")))) {
      return "";
    }
    return truncate(input.value || input.getAttribute("value") || "", 360);
  }

  function selectValueForField(input) {
    if (!input || input.tagName !== "SELECT") return "";
    return Array.from(input.selectedOptions || [])
      .map((option) => normalizeText(option.label || option.textContent))
      .filter(Boolean)
      .filter((value) => !/^select/i.test(value))
      .join(", ");
  }

  function reactSelectValueForField(root) {
    const selectors = [
      ".select__single-value",
      ".select__multi-value__label",
      "[class*='single-value']",
      "[class*='singleValue']",
      "[class*='multi-value__label']",
      "[class*='multiValue__label']",
    ].join(",");
    const visibleValues = getVisibleElements(selectors, root)
      .map(textContent)
      .filter(Boolean)
      .filter((value) => !/^select/i.test(value));

    if (visibleValues.length) return truncate(unique(visibleValues).join(", "), 360);

    const hiddenValues = getElements(
      "input[type='hidden'], input[aria-hidden='true']",
      root,
    )
      .map((input) => normalizeText(input.value || input.getAttribute("value")))
      .filter(Boolean);

    return truncate(unique(hiddenValues).join(", "), 360);
  }

  function fileValueForField(root) {
    const input = root.querySelector("input[type='file']");
    const files = Array.from(input?.files || [])
      .map((file) => file.name)
      .filter(Boolean);
    return files.join(", ");
  }

  function selectedFromInput(input) {
    if (!input) return false;
    if (["checkbox", "radio"].includes(lower(input.type))) {
      return Boolean(input.checked);
    }
    return false;
  }

  function optionWrapperForInput(input, root) {
    return (
      input.closest("label") ||
      input.closest("[role='radio']") ||
      input.closest("[role='checkbox']") ||
      input.parentElement?.parentElement ||
      root
    );
  }

  function addOption(
    options,
    optionEl,
    label,
    selected = false,
    controlId = "",
    selector = "",
  ) {
    const optionText = truncate(label || textContent(optionEl), 160);
    if (!optionText || optionText.length > 180) return;

    const existingIndex = options.findIndex(
      (option) => lower(option.optionText) === lower(optionText),
    );
    const next = {
      optionEl,
      optionText,
      selected: Boolean(selected),
      controlIds: controlId ? [controlId] : [],
      selector: selector || "",
    };

    if (existingIndex < 0) {
      options.push(next);
      return;
    }

    const existing = options[existingIndex];
    options[existingIndex] = {
      ...existing,
      selected: existing.selected || next.selected,
      controlIds: unique([...(existing.controlIds || []), ...next.controlIds]),
      selector: existing.selector || next.selector,
    };
  }

  function collectChoiceOptionInfos(root, controls) {
    const options = [];

    for (const input of getElements("input[type='radio'], input[type='checkbox']", root)) {
      const wrapper = optionWrapperForInput(input, root);
      const label = directLabelForInput(root, input) || textContent(wrapper);
      const labelEl = labelElementForInput(root, input);
      const control =
        findControlForElement(controls, input) ||
        findControlForElement(controls, labelEl) ||
        findControlForElement(controls, wrapper);
      addOption(options, wrapper, label, selectedFromInput(input), control?.id || "");
    }

    return options.slice(0, 30);
  }

  function linkedListboxes(input, root) {
    const ids = unique(
      [
        normalizeText(input?.getAttribute("aria-controls")),
        normalizeText(input?.getAttribute("aria-owns")),
      ]
        .join(" ")
        .split(/\s+/),
    );

    return ids
      .map((id) => document.getElementById(id))
      .filter((el) => el instanceof Element && root.contains(el));
  }

  function collectComboboxOptionInfos(root, input, controls) {
    const options = [];
    const linked = linkedListboxes(input, root);
    const optionElements = linked.length
      ? linked.flatMap((listbox) => getVisibleElements("[role='option']", listbox))
      : getVisibleElements("[role='option']", root);

    for (const el of optionElements) {
      const text = truncate(textContent(el), 160);
      if (!text) continue;
      const control = findControlForElement(controls, el);
      addOption(
        options,
        el,
        text,
        false,
        control?.id || "",
        uniqueComboboxSelector(el, input),
      );
    }

    return options.slice(0, 8);
  }

  function nativeSelectOptionTexts(input) {
    if (!input || input.tagName !== "SELECT") return [];
    return Array.from(input.options || [])
      .map((option) => normalizeText(option.label || option.textContent))
      .filter(Boolean)
      .filter((value) => !/^select/i.test(value))
      .slice(0, 20);
  }

  function selectedValueFromOptions(options) {
    return (options || [])
      .filter((option) => option.selected)
      .map((option) => option.optionText)
      .join(", ");
  }

  function isComboboxOpen(input, root) {
    if (!isComboboxInput(input)) return false;
    if (lower(input.getAttribute("aria-expanded")) === "true") return true;
    return linkedListboxes(input, root).some(
      (listbox) =>
        isVisible(listbox) ||
        getVisibleElements("[role='option']", listbox).length > 0,
    );
  }

  function comboboxOpenElements(root, input) {
    return unique([
      root.querySelector(".select__indicators button[aria-label='Toggle flyout']"),
      root.querySelector(".select__indicators button"),
      root.querySelector(".select__control"),
      input,
    ]).filter((el) => el instanceof Element);
  }

  function findComboboxOpenControl(controls, root, input) {
    for (const el of comboboxOpenElements(root, input)) {
      const control = findControlForElement(controls, el);
      if (isActionableControl(control)) return { control, element: el };
    }

    return { control: null, element: null };
  }

  function isSensitiveOptionalField(root, question) {
    if (root.closest(".eeoc__container")) return true;

    const text = lower(question);
    return (
      /\b(gender|hispanic|latino|race|ethnicity|veteran|disability)\b/.test(text) ||
      /\bvoluntary self-identification\b/.test(text)
    );
  }

  function isProfileField(question) {
    const text = lower(question);
    return (
      /\b(first name|last name|full name|preferred name|email|phone|linkedin|github|portfolio|website|location|address|country|city)\b/.test(
        text,
      ) ||
      /where .*work/.test(text)
    );
  }

  function isUploadBoundaryField(question) {
    return /\b(resume|cv|cover letter|upload|attach)\b/i.test(question);
  }

  function fieldKeyFor(root, input, question, index) {
    return (
      normalizeText(root.getAttribute("data-field-path")) ||
      normalizeText(input?.id) ||
      normalizeText(input?.getAttribute("name")) ||
      `question_${stableKey(question, `field_${index + 1}`)}`
    );
  }

  function sectionKind(root) {
    if (root.closest(".eeoc__container")) return "eeoc";
    return "application";
  }

  function collectFieldRoots(documentRef) {
    const form = applicationForm(documentRef);
    if (!form) return [];

    const roots = [];
    const seen = new Set();

    function addRoot(root) {
      if (!root || !(root instanceof Element)) return;
      if (!form.contains(root)) return;
      if (seen.has(root)) return;
      if (!findPrimaryInput(root) && !isFileField(root)) return;
      if (!questionText(root)) return;
      seen.add(root);
      roots.push(root);
    }

    for (const section of getElements(".application--questions", form)) {
      for (const root of getElements(".field-wrapper", section)) {
        addRoot(root);
      }

      for (const root of getElements(
        [
          "fieldset.phone-input .phone-input__country .select__container",
          "fieldset.phone-input .phone-input__phone > .text-input-wrapper > .input-wrapper",
          "fieldset.phone-input .phone-input__phone .input-wrapper",
        ].join(","),
        section,
      )) {
        if (!root.closest(".field-wrapper")) addRoot(root);
      }
    }

    for (const eeoc of getElements(".eeoc__container", form)) {
      for (const root of getElements(".eeoc__question__wrapper, .field-wrapper", eeoc)) {
        addRoot(root);
      }
    }

    return roots.sort(
      (a, b) => Number(elementBounds(a)?.y || 0) - Number(elementBounds(b)?.y || 0),
    );
  }

  function collectField(state, root, index) {
    const input = findPrimaryInput(root);
    const question = questionText(root);
    const fieldKey = fieldKeyFor(root, input, question, index);
    const controls = controlsInRegion(state.controls || [], root);
    const kindBeforeOptions = fieldKind(root, input, 0);
    const options =
      kindBeforeOptions === "combobox"
        ? collectComboboxOptionInfos(root, input, state.controls || [])
        : collectChoiceOptionInfos(root, controls);
    const kind = fieldKind(root, input, options.length);
    const selectedValue = selectedValueFromOptions(options);
    const optionTexts =
      kind === "select" ? nativeSelectOptionTexts(input) : options.map((option) => option.optionText);
    const searchValue = kind === "combobox" ? textValueForField(input) : "";
    const committedComboboxValue =
      kind === "combobox" ? reactSelectValueForField(root) : "";
    const rawValue =
      kind === "file"
        ? fileValueForField(root)
        : kind === "select"
          ? selectValueForField(input)
          : kind === "combobox"
            ? committedComboboxValue
            : options.length
              ? selectedValue
              : textValueForField(input);
    const autocompleteOpen = isComboboxOpen(input, root);
    const needsAutocompleteCommit = Boolean(
      kind === "combobox" &&
        !committedComboboxValue &&
        (autocompleteOpen || searchValue),
    );
    const answered = Boolean(rawValue) && !needsAutocompleteCommit;
    const currentValue =
      rawValue ||
      (kind === "combobox" && searchValue
        ? `search text: ${searchValue}`
        : "") ||
      (options.length || optionTexts.length ? "unanswered" : "");
    const fillControl =
      findControlForElement(state.controls || [], input) ||
      controls.find((control) =>
        ["input", "textarea", "select"].includes(lower(control?.tag)),
      ) ||
      null;
    const openMatch =
      kind === "combobox"
        ? findComboboxOpenControl(state.controls || [], root, input)
        : { control: null, element: null };
    const openControl = openMatch.control;
    const openTargetSelector = openMatch.element
      ? uniqueComboboxSelector(openMatch.element, input)
      : "";
    const required = isRequiredField(root);
    const sensitiveOptional = isSensitiveOptionalField(root, question);
    const profileField = isProfileField(question);
    const uploadBoundary = kind === "file";
    const safeMyInfoFill = Boolean(
      !answered &&
        profileField &&
        fillControl?.id &&
        !sensitiveOptional &&
        !uploadBoundary,
    );
    const description = descriptionText(root);
    const textFacts = [
      question,
      description ? `description: ${description}` : "",
      rawValue ? `current value: ${currentValue}` : "currentValue: blank",
      kind === "combobox" && searchValue && !rawValue
        ? "typed search text is not a committed selection"
        : "",
      `answered: ${answered ? "true" : "false"}`,
      required ? "required: true" : "required: false",
      needsAutocompleteCommit
        ? "autocomplete options visible; click the matching option to commit"
        : "",
      safeMyInfoFill
        ? "safe profile/contact field; fill from My Info when available"
        : "",
      sensitiveOptional
        ? "sensitive optional EEOC field; answer from explicit runContext.myInfo value when available, otherwise leave blank unless explicitly requested"
        : "",
      uploadBoundary ? "upload/file boundary; do not upload unless requested" : "",
    ];
    const fieldControlIds = unique(
      [
        openControl?.id,
        fillControl?.id,
        ...controls.map((control) => control.id),
      ].filter(Boolean),
    );

    return {
      id: `greenhouse_field_${stableKey(fieldKey, `field_${index + 1}`)}`,
      kind: "greenhouse_application_field",
      adapterId: ADAPTER_ID,
      targetId: fieldTargetId(fieldKey),
      fieldKey,
      fieldKind: kind,
      sectionKind: sectionKind(root),
      required,
      label: question,
      description,
      text: textFacts.filter(Boolean).join(" | "),
      currentValue,
      selectedValue,
      answered,
      blank: !rawValue,
      sensitiveOptional,
      profileField,
      safeMyInfoFill,
      uploadBoundary,
      autocompleteOpen,
      needsAutocompleteCommit,
      fillTargetId: fillControl?.id || "",
      openTargetId: openControl?.id || "",
      openTargetSelector,
      controlIds: fieldControlIds,
      optionTexts,
      optionTargets: options.map((option) => optionTargetId(fieldKey, option.optionText)),
      options,
      bounds: elementBounds(root),
    };
  }

  function sortFieldsForPlanner(fields) {
    return fields.slice().sort((a, b) => {
      const aNeedsCommit = a.needsAutocompleteCommit ? 0 : 1;
      const bNeedsCommit = b.needsAutocompleteCommit ? 0 : 1;
      if (aNeedsCommit !== bNeedsCommit) return aNeedsCommit - bNeedsCommit;
      const aBatchableText = a.safeMyInfoFill && isBatchableTextField(a) ? 0 : 1;
      const bBatchableText = b.safeMyInfoFill && isBatchableTextField(b) ? 0 : 1;
      if (aBatchableText !== bBatchableText) return aBatchableText - bBatchableText;
      const aMissingRequired = a.required && !a.answered && !a.uploadBoundary ? 0 : 1;
      const bMissingRequired = b.required && !b.answered && !b.uploadBoundary ? 0 : 1;
      if (aMissingRequired !== bMissingRequired) {
        return aMissingRequired - bMissingRequired;
      }
      const aSafeProfile = a.safeMyInfoFill ? 0 : 1;
      const bSafeProfile = b.safeMyInfoFill ? 0 : 1;
      if (aSafeProfile !== bSafeProfile) return aSafeProfile - bSafeProfile;
      const aAnswered = a.answered ? 1 : 0;
      const bAnswered = b.answered ? 1 : 0;
      if (aAnswered !== bAnswered) return aAnswered - bAnswered;
      return Number(a.bounds?.y || 0) - Number(b.bounds?.y || 0);
    });
  }

  function isBatchableTextField(field) {
    return ["email", "number", "tel", "text", "url"].includes(lower(field?.fieldKind));
  }

  function addHint(actionHintsByTargetId, targetId, hint) {
    if (!targetId) return;
    actionHintsByTargetId[targetId] = {
      ...(actionHintsByTargetId[targetId] || {}),
      ...hint,
    };
  }

  function buildActionHints(fields, submitTargetId, uploadTargetIds, controlsById) {
    const actionHintsByTargetId = {};

    for (const field of fields) {
      if (field.uploadBoundary) {
        for (const targetId of actionableControlIds(field.controlIds, controlsById, 3)) {
          addHint(actionHintsByTargetId, targetId, {
            semanticRole: "greenhouse_file_upload_boundary",
            preferredAction: "extract",
            avoidAction: true,
            stableFieldTargetId: field.targetId,
            machineKey: field.fieldKey,
            answerText: field.label,
            instruction:
              "Greenhouse upload/file control. Do not upload files unless USER_GOAL explicitly asks and runtime upload support exists.",
          });
        }
        continue;
      }

      const isCombobox = field.fieldKind === "combobox";
      const isSelect = field.fieldKind === "select";
      const shouldOpenCombobox =
        isCombobox &&
        !field.answered &&
        !field.autocompleteOpen &&
        !field.needsAutocompleteCommit &&
        !(field.options || []).length;

      if (
        shouldOpenCombobox &&
        field.openTargetId &&
        isActionableControl(controlsById.get(field.openTargetId))
      ) {
        addHint(actionHintsByTargetId, field.openTargetId, {
          semanticRole: "greenhouse_combobox_control_opener",
          preferredAction: "click",
          exactValueMode: "openMenu",
          safeFillTarget: !field.sensitiveOptional,
          observeAfterAction: true,
          batchPlacement: "after_batchable_plain_fields_click_then_observe",
          stableFieldTargetId: field.targetId,
          machineKey: field.fieldKey,
          answerText: field.label,
          optionTexts: field.optionTexts || [],
          instruction:
            "Closed Greenhouse React select/combobox field. Click the Toggle flyout button or inner .select__control area to open the in-field listbox, observe, then click the exact matching visible option to commit it. Do not click the outer field wrapper and do not fill search text before opening this menu.",
        });
      }

      if (
        field.fillTargetId &&
        isActionableControl(controlsById.get(field.fillTargetId)) &&
        !shouldOpenCombobox
      ) {
        const instruction = isCombobox
          ? "Greenhouse React select/combobox field. If the matching option is visible, click that option to commit it. Otherwise fill search text, observe the in-field listbox, then click the exact matching visible option. Do not treat typed search text or a focused option as selected."
          : field.safeMyInfoFill
            ? "This Greenhouse profile/contact field is blank and safe to fill from My Info when a value is present. Do not invent missing values."
            : field.sensitiveOptional
              ? "Sensitive optional Greenhouse EEOC field. Fill from an explicit matching runContext.myInfo value when the goal asks to use My Info or fill the application; otherwise leave blank unless USER_GOAL explicitly asks for a decline/prefer-not-to-answer value."
              : isSelect
                ? "Fill this Greenhouse native select using the exact visible option text from the user's goal or My Info."
                : "Fill this Greenhouse application field using My Info or explicit goal text. Do not invent missing personal, legal, or sensitive answers.";

        addHint(actionHintsByTargetId, field.fillTargetId, {
          semanticRole: isCombobox
            ? "greenhouse_combobox"
            : isSelect
              ? "greenhouse_select"
              : "greenhouse_text_field",
          preferredAction: "fill",
          exactValueMode: isSelect ? "optionText" : isCombobox ? "searchText" : "literal",
          safeFillTarget: !field.sensitiveOptional,
          observeAfterAction: isCombobox,
          batchPlacement: isCombobox
            ? "after_batchable_plain_fields_fill_then_observe"
            : "can_batch",
          stableFieldTargetId: field.targetId,
          machineKey: field.fieldKey,
          answerText: field.label,
          optionTexts: field.optionTexts || [],
          instruction,
        });
      }

      for (const option of field.options || []) {
        const targetIds = actionableControlIds(option.controlIds, controlsById);
        const instruction = field.sensitiveOptional
          ? "Sensitive optional Greenhouse EEOC option. Click when this option matches an explicit value in runContext.myInfo and the goal asks to use My Info or fill the application. If My Info lacks this value, click only when USER_GOAL explicitly asks for this value or a decline/prefer-not-to-answer answer."
          : field.fieldKind === "combobox"
            ? "Click this visible Greenhouse combobox option if it matches the desired field value. After one click, observe the next state and move on if the field shows the value."
            : option.selected
              ? "This Greenhouse option is already selected in adapter state; do not click it again unless the user asked to change it."
              : "Click this Greenhouse option only if it is the desired answer. After one click, observe the next state and do not repeat it if adapter state shows it selected.";

        for (const targetId of targetIds) {
          addHint(actionHintsByTargetId, targetId, {
            semanticRole:
              field.fieldKind === "combobox"
                ? "greenhouse_combobox_option"
                : "greenhouse_application_option",
            preferredAction: "click",
            stableFieldTargetId: optionTargetId(field.fieldKey, option.optionText),
            machineKey: field.fieldKey,
            checked:
              field.fieldKind === "combobox" ? undefined : Boolean(option.selected),
            answerText: option.optionText,
            verifyAfterAction:
              field.fieldKind === "combobox"
                ? "adapter_group_current_value"
                : "adapter_group_selected_value",
            instruction,
          });
        }
      }
    }

    for (const targetId of uploadTargetIds || []) {
      addHint(actionHintsByTargetId, targetId, {
        semanticRole: "greenhouse_file_upload_boundary",
        preferredAction: "extract",
        avoidAction: true,
        instruction:
          "Greenhouse upload control. File upload is unsupported in this runtime; do not click when the goal says not to upload.",
      });
    }

    addHint(actionHintsByTargetId, submitTargetId, {
      semanticRole: "greenhouse_submit_application_boundary",
      preferredAction: "click",
      navigationAction: true,
      avoidAction: true,
      instruction:
        "Final Greenhouse Submit application boundary. Do not click when USER_GOAL says not to submit; for fill-only goals, return done after requested non-file fields are handled and intentional blanks are summarized.",
    });

    return actionHintsByTargetId;
  }

  function fieldGroups(fields) {
    return fields.map((field) => ({
      id: field.id,
      kind: field.kind,
      adapterId: field.adapterId,
      targetId: field.targetId,
      fieldKey: field.fieldKey,
      fieldKind: field.fieldKind,
      sectionKind: field.sectionKind,
      required: field.required,
      label: field.label,
      description: field.description,
      text: field.text,
      currentValue: field.currentValue,
      selectedValue: field.selectedValue,
      answered: field.answered,
      blank: field.blank,
      sensitiveOptional: field.sensitiveOptional,
      profileField: field.profileField,
      safeMyInfoFill: field.safeMyInfoFill,
      uploadBoundary: field.uploadBoundary,
      autocompleteOpen: field.autocompleteOpen,
      needsAutocompleteCommit: field.needsAutocompleteCommit,
      fillTargetId: field.fillTargetId,
      openTargetId: field.openTargetId,
      controlIds: field.controlIds,
      optionTexts: field.optionTexts,
      optionTargets: field.optionTargets,
      preferredAction: field.uploadBoundary ? "extract" : "",
      bounds: field.bounds,
    }));
  }

  function optionGroups(fields) {
    const groups = [];

    for (const field of fields) {
      for (const option of field.options || []) {
        groups.push({
          id: `greenhouse_option_${stableKey(field.fieldKey)}_${stableKey(
            option.optionText,
            "option",
          )}`,
          kind: "greenhouse_application_option",
          adapterId: ADAPTER_ID,
          targetId: optionTargetId(field.fieldKey, option.optionText),
          fieldTargetId: field.targetId,
          fieldKey: field.fieldKey,
          fieldKind: field.fieldKind,
          label: `${field.label}: ${option.optionText}`,
          text:
            field.fieldKind === "combobox"
              ? `visible in-field combobox option: ${option.optionText}`
              : `${option.optionText} is ${
                  option.selected ? "selected" : "not selected"
                }`,
          optionText: option.optionText,
          checked:
            field.fieldKind === "combobox" ? false : Boolean(option.selected),
          currentValue:
            field.fieldKind === "combobox"
              ? `available option: ${option.optionText}`
              : option.selected
                ? `selected: ${option.optionText}`
                : `unselected: ${option.optionText}`,
          selectedValue:
            field.fieldKind === "combobox" || !option.selected
              ? ""
              : option.optionText,
          controlIds: unique(option.controlIds || []),
          bounds: elementBounds(option.optionEl),
        });
      }
    }

    return groups;
  }

  function applicationGroup(fields, siteAdapter) {
    const answered = fields
      .filter((field) => field.answered && !field.selectedValue)
      .map((field) => `${field.label}: ${field.currentValue}`)
      .slice(0, 10);
    const selected = fields
      .filter((field) => field.selectedValue)
      .map((field) => `${field.label}: ${field.selectedValue}`)
      .slice(0, 10);
    const missingRequired = fields
      .filter(
        (field) =>
          field.required &&
          !field.answered &&
          !field.uploadBoundary &&
          !field.sensitiveOptional,
      )
      .map((field) => field.label)
      .slice(0, 16);
    const blankProfileFields = fields
      .filter((field) => field.safeMyInfoFill)
      .map((field) => field.label)
      .slice(0, 16);
    const blankSensitiveFields = fields
      .filter((field) => field.sensitiveOptional && !field.answered)
      .map((field) => field.label)
      .slice(0, 12);
    const uploadBoundaries = fields
      .filter((field) => field.uploadBoundary && !field.answered)
      .map((field) => field.label)
      .slice(0, 8);
    const currentValue = missingRequired.length
      ? `missing required: ${missingRequired.join(", ")}`
      : blankProfileFields.length
        ? `safe profile/contact fields blank: ${blankProfileFields.join(", ")}`
        : "required fields handled; optional sensitive/upload/submit boundaries may remain";

    return {
      id: "greenhouse_application_summary",
      kind: "greenhouse_application_summary",
      adapterId: ADAPTER_ID,
      targetId: APPLICATION_TARGET_ID,
      label: "Greenhouse application state",
      text: [
        `${fields.length} Greenhouse form fields detected inside #application-form`,
        `${siteAdapter.applicationQuestionCount} application--questions sections detected`,
        selected.length ? `selected: ${selected.join(" | ")}` : "",
        answered.length ? `answered: ${answered.join(" | ")}` : "",
        missingRequired.length
          ? `required fields still missing: ${missingRequired.join(" | ")}`
          : "no required non-file/non-EEOC field is visibly missing",
        blankProfileFields.length
          ? `optional or required profile/contact fields blank and safe to fill from My Info when values are present: ${blankProfileFields.join(" | ")}`
          : "",
      blankSensitiveFields.length
        ? `sensitive optional EEOC fields blank: ${blankSensitiveFields.join(" | ")}`
        : "",
        uploadBoundaries.length
          ? `upload/file boundaries present: ${uploadBoundaries.join(" | ")}`
          : "",
        siteAdapter.submitTargetId ? "submit application boundary present" : "",
      ]
        .filter(Boolean)
        .join(". "),
      currentValue,
      primaryControlIds: siteAdapter.primaryControlIds,
      preferredAction: "extract",
    };
  }

  function fieldPrimaryControlIds(field, controlsById) {
    if (field.uploadBoundary) {
      return actionableControlIds(field.controlIds, controlsById, 3);
    }

    const ids = [];
    if (field.openTargetId) ids.push(field.openTargetId);
    if (field.fillTargetId) ids.push(field.fillTargetId);
    for (const option of field.options || []) {
      ids.push(...(option.controlIds || []));
    }

    return actionableControlIds(ids, controlsById);
  }

  function controlHintText(hint) {
    if (!hint) return "";
    return truncate(
      [
        "Greenhouse adapter",
        hint.semanticRole ? `role: ${hint.semanticRole}` : "",
        hint.preferredAction ? `preferred action: ${hint.preferredAction}` : "",
        hint.exactValueMode ? `value mode: ${hint.exactValueMode}` : "",
        hint.avoidAction ? "avoid unless explicitly requested" : "",
        hint.checked === true ? "state: selected" : "",
        hint.checked === false ? "state: not selected" : "",
        hint.safeFillTarget ? "safe fill target" : "",
        hint.observeAfterAction ? "observe after action" : "",
        hint.batchPlacement ? `batch: ${hint.batchPlacement}` : "",
        hint.answerText ? `target: ${hint.answerText}` : "",
        hint.instruction || "",
      ]
        .filter(Boolean)
        .join("; "),
      280,
    );
  }

  function enhanceControls(controls, actionHintsByTargetId, selectorOverrides = {}) {
    return (controls || []).map((control) => {
      const hint = actionHintsByTargetId?.[control.id];
      const overrideSelector = selectorOverrides?.[control.id];
      if (!hint && !overrideSelector) return control;

      const enhanced = { ...control };
      if (hint) {
        const hintText = controlHintText(hint);
        enhanced.label = truncate(unique([control.label, hintText]).join(" | "), 240);
        enhanced.title = truncate(unique([control.title, hintText]).join(" | "), 240);
        enhanced.heading = truncate(
          unique([control.heading, hint.instruction]).join(" | "),
          240,
        );
        enhanced.adapterHints = {
          ...(control.adapterHints || {}),
          [ADAPTER_ID]: hint,
        };
      }
      // Override the runner-facing selector so resolveElement() locks onto the
      // correct field control instead of one of many identical Toggle-flyout
      // buttons. Kept off the planner-facing siteAdapter payload to avoid bloat.
      if (overrideSelector) enhanced.selector = overrideSelector;
      return enhanced;
    });
  }

  function findSubmitTargetId(state, form) {
    const submitEl =
      form.querySelector(".application--submit button[type='submit']") ||
      form.querySelector(".application--submit button") ||
      form.querySelector("button[type='submit']");

    return (
      findControlForElement(state.controls || [], submitEl)?.id ||
      (state.controls || []).find((control) =>
        /^submit application$/i.test(control.label || control.text || ""),
      )?.id ||
      ""
    );
  }

  function findUploadTargetIds(state, form) {
    const formControls = controlsInRegion(state.controls || [], form);
    return formControls
      .filter((control) => {
        const tag = lower(control?.tag);
        const controlType = lower(control?.controlType);
        const haystack = [
          control?.label,
          control?.text,
          control?.title,
          control?.ariaLabel,
          control?.placeholder,
        ].join(" ");

        if (!/\b(upload|attach|resume|cv|cover letter)\b/i.test(haystack)) {
          return false;
        }

        return (
          ["button", "input", "label"].includes(tag) ||
          ["button", "file"].includes(controlType)
        );
      })
      .map((control) => control.id)
      .filter(Boolean);
  }

  function buildPlannerHints(fields, siteAdapter) {
    const missingRequired = fields
      .filter(
        (field) =>
          field.required &&
          !field.answered &&
          !field.uploadBoundary &&
          !field.sensitiveOptional,
      )
      .map((field) => field.label)
      .slice(0, 12);
    const blankProfileFields = fields
      .filter((field) => field.safeMyInfoFill)
      .map((field) => field.label)
      .slice(0, 12);
    const blankSensitiveFields = fields
      .filter((field) => field.sensitiveOptional && !field.answered)
      .map((field) => field.label)
      .slice(0, 12);

    return [
      "Greenhouse adapter active: use only fields inside form#application-form, especially .application--questions, .field-wrapper, .eeoc__container, and .application--submit.",
      "Batch all visible non-combobox safeFillTarget Greenhouse profile/contact text fills in the same step before opening another React select. A combobox can take two turns, but it should not block independent plain text fills before the wait/observe.",
      "For Greenhouse React select/combobox fields, click the closed control opener first, preferably the Toggle flyout button or inner .select__control target, to open the in-field listbox. Then observe and click the matching visible option. Fill search text only if the menu is open and the desired option is not visible. Do not treat typed search text as a committed Greenhouse selection.",
      "For Greenhouse EEOC fields, explicit values in runContext.myInfo are user-provided answers. Use those values when USER_GOAL asks to use My Info or fill the application. If My Info lacks a matching value, leave that EEOC field blank unless USER_GOAL explicitly asks for a decline/prefer-not-to-answer option.",
      "If a Greenhouse field group says currentValue blank and answered false, treat it as not filled. If it says selected/current value, do not repeat the same action.",
      missingRequired.length
        ? `Greenhouse required non-file/non-EEOC fields still missing: ${missingRequired.join(" | ")}.`
        : "No Greenhouse required non-file/non-EEOC field is visibly missing. Check optional profile blanks, sensitive EEOC, upload, and submit boundaries before deciding done.",
      blankProfileFields.length
        ? `Greenhouse profile/contact fields are blank but safe to fill from runContext.myInfo when values are present: ${blankProfileFields.join(" | ")}.`
        : "",
      blankSensitiveFields.length
        ? `Greenhouse EEOC fields are sensitive optional fields and blank: ${blankSensitiveFields.join(" | ")}. Answer them from explicit runContext.myInfo values when USER_GOAL asks to use My Info or fill the application. If My Info has no matching value, leave them blank unless USER_GOAL explicitly asks for decline/prefer-not-to-answer; mention blanks in done summaries.`
        : "",
      siteAdapter.uploadTargetIds.length
        ? "Greenhouse upload/autofill controls are file-upload boundaries. Leave them alone when the user says do not upload."
        : "",
      siteAdapter.submitTargetId
        ? `Greenhouse Submit application target ${siteAdapter.submitTargetId} is final submission. If USER_GOAL says do not submit, do not click it.`
        : "",
    ].filter(Boolean);
  }

  function buildVisibleTextSummary(fields, siteAdapter) {
    const missing = fields
      .filter(
        (field) =>
          field.required &&
          !field.answered &&
          !field.uploadBoundary &&
          !field.sensitiveOptional,
      )
      .map((field) => field.label)
      .slice(0, 12);
    const blankProfileFields = fields
      .filter((field) => field.safeMyInfoFill)
      .map((field) => field.label)
      .slice(0, 12);
    const blankSensitiveFields = fields
      .filter((field) => field.sensitiveOptional && !field.answered)
      .map((field) => field.label)
      .slice(0, 12);

    return [
      `Greenhouse application adapter: ${fields.length} fields detected inside #application-form.`,
      missing.length
        ? `Greenhouse missing required fields: ${missing.join(" | ")}`
        : "Greenhouse required non-file/non-EEOC fields appear handled; optional profile, sensitive EEOC, upload, and submit boundaries still need policy-aware review.",
      blankProfileFields.length
        ? `Greenhouse profile/contact fields blank and safe from My Info: ${blankProfileFields.join(" | ")}`
        : "",
      blankSensitiveFields.length
        ? `Greenhouse sensitive optional EEOC fields blank: ${blankSensitiveFields.join(" | ")}`
        : "",
      siteAdapter.submitTargetId
        ? `Greenhouse submit boundary target: ${siteAdapter.submitTargetId}`
        : "",
    ].filter(Boolean);
  }

  function buildSiteAdapter(state, documentRef) {
    const form = applicationForm(documentRef);
    const fields = collectFieldRoots(documentRef)
      .map((root, index) => collectField(state, root, index))
      .filter((field) => field.label);
    const controlsById = controlByIdMap(state.controls || []);
    const submitTargetId = findSubmitTargetId(state, form);
    const uploadTargetIds = findUploadTargetIds(state, form);
    const applicationQuestionCount = getElements(".application--questions", form).length;
    const actionHintsByTargetId = buildActionHints(
      fields,
      submitTargetId,
      uploadTargetIds,
      controlsById,
    );
    const primaryControlIds = unique([
      ...fields.flatMap((field) => fieldPrimaryControlIds(field, controlsById)),
      ...actionableControlIds(uploadTargetIds, controlsById, 4),
      submitTargetId,
    ]).slice(0, 120);
    const selectorOverrides = {};
    for (const field of fields) {
      if (field.openTargetId && field.openTargetSelector) {
        selectorOverrides[field.openTargetId] = field.openTargetSelector;
      }
      for (const option of field.options || []) {
        if (!option.selector) continue;
        for (const controlId of option.controlIds || []) {
          if (controlId) selectorOverrides[controlId] = option.selector;
        }
      }
    }
    const pageKind = fields.length ? "application_form" : "job_posting";
    const siteAdapter = {
      id: ADAPTER_ID,
      pageKind,
      applicationTargetId: APPLICATION_TARGET_ID,
      applicationQuestionCount,
      detectedFieldCount: fields.length,
      answeredFieldCount: fields.filter((field) => field.answered).length,
      missingRequiredCount: fields.filter(
        (field) =>
          field.required &&
          !field.answered &&
          !field.uploadBoundary &&
          !field.sensitiveOptional,
      ).length,
      submitTargetId,
      uploadTargetIds,
      primaryControlIds,
      actionHintsByTargetId,
      selectorOverrides,
    };

    siteAdapter.plannerHints = buildPlannerHints(fields, siteAdapter);
    siteAdapter.groups = [
      applicationGroup(fields, siteAdapter),
      ...fieldGroups(sortFieldsForPlanner(fields)),
      ...optionGroups(fields),
    ].slice(0, 140);
    siteAdapter.visibleTextSummary = buildVisibleTextSummary(fields, siteAdapter);
    return siteAdapter;
  }

  registry.register({
    id: ADAPTER_ID,
    priority: 84,
    match({ document: documentRef, url }) {
      return isGreenhousePage(documentRef, url);
    },
    enhanceState({ state, document: documentRef }) {
      const siteAdapter = buildSiteAdapter(state, documentRef);

      return {
        ...state,
        plannerContext: {
          ...(state.plannerContext || {}),
          mode: siteAdapter.pageKind,
          greenhousePageKind: siteAdapter.pageKind,
          greenhouseDetectedFieldCount: siteAdapter.detectedFieldCount,
          greenhouseAnsweredFieldCount: siteAdapter.answeredFieldCount,
          greenhouseMissingRequiredCount: siteAdapter.missingRequiredCount,
          greenhouseSubmitTargetId: siteAdapter.submitTargetId,
        },
        siteAdapter: {
          id: siteAdapter.id,
          pageKind: siteAdapter.pageKind,
          applicationTargetId: siteAdapter.applicationTargetId,
          applicationQuestionCount: siteAdapter.applicationQuestionCount,
          detectedFieldCount: siteAdapter.detectedFieldCount,
          answeredFieldCount: siteAdapter.answeredFieldCount,
          missingRequiredCount: siteAdapter.missingRequiredCount,
          submitTargetId: siteAdapter.submitTargetId,
          uploadTargetIds: siteAdapter.uploadTargetIds,
          primaryControlIds: siteAdapter.primaryControlIds,
          actionHintsByTargetId: siteAdapter.actionHintsByTargetId,
          plannerHints: siteAdapter.plannerHints,
        },
        visibleTextSummary: [
          ...(siteAdapter.visibleTextSummary || []),
          ...siteAdapter.plannerHints,
          ...(state.visibleTextSummary || []),
        ].slice(0, 80),
        groups: [...siteAdapter.groups, ...(state.groups || [])],
        controls: enhanceControls(
          state.controls || [],
          siteAdapter.actionHintsByTargetId || {},
          siteAdapter.selectorOverrides || {},
        ),
      };
    },
  });
})();
