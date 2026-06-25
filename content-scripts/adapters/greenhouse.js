(function () {
  const ADAPTER_ID = "greenhouse.application";
  const APPLICATION_TARGET_ID = `site:${ADAPTER_ID}:application`;
  const EEOC_SECTION_TARGET_ID = `site:${ADAPTER_ID}:section:eeoc`;
  const EEOC_FIELD_SPECS = [
    { fieldKey: "gender", label: "Gender" },
    { fieldKey: "hispanic_ethnicity", label: "Are you Hispanic/Latino?" },
    { fieldKey: "veteran_status", label: "Veteran Status" },
    { fieldKey: "disability_status", label: "Disability Status" },
  ];
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
    if (root.closest(".education--container, .education--form")) return "education";
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

    for (const education of getElements(".education--form", form)) {
      for (const root of getElements(".select", education)) {
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
    const connectorTool =
      !answered &&
      !sensitiveOptional &&
      kind === "combobox" &&
      ["application", "education"].includes(sectionKind(root)) &&
      fieldWrapperSelectInput(root) === input
        ? "greenhouse_fill_select"
        : "";
    const connectorArgs = connectorTool ? { fieldKey } : null;
    const batchPlacement = connectorTool
      ? "can_batch"
      : kind === "combobox"
        ? "after_batchable_plain_fields"
        : !sensitiveOptional && !uploadBoundary
          ? "can_batch"
          : "";
    const verifyAfterAction = connectorTool
      ? "adapter_group_current_value"
      : "";
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
      connectorTool
        ? `connector action available: ${connectorTool} with fieldKey ${fieldKey}; batch-safe when value is known`
        : "",
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
      connectorTool,
      connectorArgs,
      batchPlacement,
      verifyAfterAction,
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

  function isConnectorFillSelectField(field) {
    return Boolean(
      field &&
        field.connectorTool === "greenhouse_fill_select" &&
        field.connectorArgs?.fieldKey,
    );
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
      const connectorSelect = isConnectorFillSelectField(field);
      const shouldOpenCombobox =
        isCombobox &&
        !connectorSelect &&
        !field.answered &&
        !field.autocompleteOpen &&
        !field.needsAutocompleteCommit &&
        !(field.options || []).length;

      if (connectorSelect) {
        const connectorHint = {
          semanticRole: "greenhouse_connector_select",
          preferredAction: field.connectorTool,
          connectorTool: field.connectorTool,
          connectorArgs: field.connectorArgs,
          exactValueMode: "connectorValue",
          safeFillTarget: !field.sensitiveOptional,
          observeAfterAction: false,
          batchPlacement: "can_batch",
          stableFieldTargetId: field.targetId,
          machineKey: field.fieldKey,
          answerText: field.label,
          optionTexts: [],
          verifyAfterAction: "adapter_group_current_value",
          instruction:
            `Prefer connector tool greenhouse_fill_select with fieldKey="${field.fieldKey}" for this closed Greenhouse React select. It opens, searches when needed, matches the requested value against live options, and commits in one action; batch it with other independent safe fills when the value is known. Use click/open/observe only as a fallback if the connector tool is unavailable or fails.`,
        };

        if (
          field.openTargetId &&
          isActionableControl(controlsById.get(field.openTargetId))
        ) {
          addHint(actionHintsByTargetId, field.openTargetId, connectorHint);
        }

        if (
          field.fillTargetId &&
          isActionableControl(controlsById.get(field.fillTargetId))
        ) {
          addHint(actionHintsByTargetId, field.fillTargetId, {
            ...connectorHint,
            semanticRole: "greenhouse_connector_select_input",
          });
        }
      }

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
        !connectorSelect &&
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
      preferredAction: isConnectorFillSelectField(field)
        ? field.connectorTool
        : field.uploadBoundary
          ? "extract"
          : "",
      connectorTool: field.connectorTool,
      connectorArgs: field.connectorArgs,
      batchPlacement: field.batchPlacement,
      verifyAfterAction: field.verifyAfterAction,
      bounds: field.bounds,
    }));
  }

  function eeocSectionGroups(fields) {
    const eeocFields = fields.filter(
      (field) =>
        field.sectionKind === "eeoc" &&
        EEOC_FIELD_SPECS.some((spec) => spec.fieldKey === field.fieldKey),
    );
    if (!eeocFields.length) return [];

    const fieldKeys = eeocFields.map((field) => field.fieldKey);
    const blankLabels = eeocFields
      .filter((field) => !field.answered)
      .map((field) => field.label);
    const answeredLabels = eeocFields
      .filter((field) => field.answered)
      .map((field) => `${field.label}: ${field.currentValue}`);

    return [
      {
        id: "greenhouse_eeoc_section",
        kind: "greenhouse_application_section",
        adapterId: ADAPTER_ID,
        targetId: EEOC_SECTION_TARGET_ID,
        sectionKind: "eeoc",
        label: "Voluntary Self-Identification / EEOC",
        text: [
          "Greenhouse EEOC section detected",
          `connector action available: greenhouse_fill_eeoc with fieldValues for ${fieldKeys.join(", ")}`,
          "Use only explicit values from runContext.myInfo or USER_GOAL; omit unknown EEOC fields instead of inventing answers",
          blankLabels.length
            ? `blank sensitive EEOC fields: ${blankLabels.join(" | ")}`
            : "no blank sensitive EEOC fields detected",
          answeredLabels.length
            ? `answered sensitive EEOC fields: ${answeredLabels.join(" | ")}`
            : "",
        ]
          .filter(Boolean)
          .join(" | "),
        preferredAction: "greenhouse_fill_eeoc",
        connectorTool: "greenhouse_fill_eeoc",
        connectorFieldKeys: fieldKeys,
        batchPlacement: "can_batch_sensitive_explicit_only",
        verifyAfterAction: "adapter_group_current_value",
        currentValue: `${eeocFields.filter((field) => field.answered).length}/${eeocFields.length} answered`,
        answered: eeocFields.every((field) => field.answered),
        fieldTargets: eeocFields.map((field) => field.targetId),
        controlIds: unique(eeocFields.flatMap((field) => field.controlIds || [])),
      },
    ];
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
      "Batch every independent safe Greenhouse fill in the same step when values are known: text/url/tel/email fills plus connector-select fills. Do not let a connector-select field block other safe fills.",
      "For connector-enabled Greenhouse React select/combobox fields, prefer greenhouse_fill_select(fieldKey, value). The connector opens the menu, searches when the desired option is not immediately visible, matches against live options, and commits; do not pre-open the menu just to inspect finite options. Use click/open/observe only when the connector tool is unavailable or failed.",
      "For Greenhouse React select/combobox fields without a connector, click the closed control opener first, preferably the Toggle flyout button or inner .select__control target, to open the in-field listbox. Then observe and click the matching visible option. Fill search text only if the menu is open and the desired option is not visible. Do not treat typed search text as a committed Greenhouse selection.",
      "For the Greenhouse EEOC section, prefer greenhouse_fill_eeoc(fieldValues) when runContext.myInfo or USER_GOAL has explicit values for gender, Hispanic/Latino, veteran status, or disability status. Omit unknown EEOC fields; do not invent answers or choose decline/prefer-not-to-answer unless explicit.",
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
      ...eeocSectionGroups(fields),
      ...fieldGroups(sortFieldsForPlanner(fields)),
      ...optionGroups(fields),
    ].slice(0, 140);
    siteAdapter.visibleTextSummary = buildVisibleTextSummary(fields, siteAdapter);
    return siteAdapter;
  }

  // ---------------------------------------------------------------------------
  // Connector tool: greenhouse_fill_select
  // First pass: single-select React-select dropdowns in normal application questions
  // plus education rows. EEOC uses greenhouse_fill_eeoc.
  // ---------------------------------------------------------------------------

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const SELECT_STOP_WORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "am",
    "be",
    "do",
    "does",
    "had",
    "has",
    "have",
    "i",
    "in",
    "of",
    "or",
    "past",
    "the",
    "to",
  ]);

  function choiceKey(value) {
    return canonicalSelectText(value);
  }

  function canonicalSelectText(value) {
    return lower(value)
      .replace(/['’]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function selectTokens(value) {
    return canonicalSelectText(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token && !SELECT_STOP_WORDS.has(token));
  }

  function fieldValueAliases(fieldKey, value) {
    const key = canonicalSelectText(value);
    const aliases = [];

    if (/^school--/.test(fieldKey) && /\bvirginia\b/.test(key) && /\btech\b/.test(key)) {
      aliases.push(
        "Virginia Tech",
        "Virginia Polytechnic Institute and State University",
        "Virginia",
      );
    }

    if (/^degree--/.test(fieldKey) && /\b(bachelor|bachelors|bs|bsc|science)\b/.test(key)) {
      aliases.push(
        "Bachelor's Degree",
        "Bachelors Degree",
        "Bachelor of Science",
        "Bachelor",
      );
    }

    if (fieldKey === "disability_status") {
      if (/\bno\b/.test(key) && /\bdisab/.test(key)) {
        aliases.push(
          "No, I do not have a disability and have not had one in the past",
          "No disability",
          "No",
        );
      } else if (/\byes\b/.test(key) && /\bdisab/.test(key)) {
        aliases.push(
          "Yes, I have a disability, or have had one in the past",
          "Yes disability",
          "Yes",
        );
      } else if (/prefer|decline|dont want|do not want/.test(key)) {
        aliases.push("I do not want to answer");
      }
    }

    if (fieldKey === "veteran_status") {
      if (/not.*protected.*veteran|no.*veteran|not.*veteran/.test(key)) {
        aliases.push(
          "I am not a protected veteran",
          "Not a protected veteran",
          "No",
        );
      } else if (/protected.*veteran/.test(key)) {
        aliases.push("I identify as one or more of the classifications of protected veteran");
      } else if (/prefer|decline|dont want|do not want/.test(key)) {
        aliases.push("I do not wish to answer");
      }
    }

    if (fieldKey === "hispanic_ethnicity") {
      if (/^(no|not hispanic|not latino)|\bno\b/.test(key)) aliases.push("No");
      if (/^(yes|hispanic|latino)|\byes\b/.test(key)) aliases.push("Yes");
      if (/prefer|decline|dont want|do not want/.test(key)) {
        aliases.push("I do not wish to answer", "I do not want to answer");
      }
    }

    if (fieldKey === "gender") {
      if (/\bmale\b/.test(key) && !/\bfemale\b/.test(key)) aliases.push("Male");
      if (/\bfemale\b/.test(key) || /\bwoman\b/.test(key)) aliases.push("Female");
      if (/prefer|decline|dont want|do not want/.test(key)) {
        aliases.push("I do not wish to answer", "I do not want to answer");
      }
    }

    return unique(aliases);
  }

  function searchQueriesFor(fieldKey, value) {
    const aliases = fieldValueAliases(fieldKey, value);
    const tokens = selectTokens(value);
    const queries = [value, ...aliases];

    if (/^degree--/.test(fieldKey)) queries.push("Bachelor");
    if (/^school--/.test(fieldKey) && tokens.includes("virginia")) queries.push("Virginia");
    if (fieldKey === "disability_status" && tokens.includes("no")) queries.push("No");
    if (fieldKey === "veteran_status" && tokens.includes("veteran")) queries.push("veteran");

    return unique(
      queries
        .map((query) => normalizeText(query))
        .filter((query) => query.length > 0)
        .slice(0, 6),
    );
  }

  function scoreComboboxOption(optionText, value, fieldKey) {
    const optionKey = canonicalSelectText(optionText);
    const wantedKey = canonicalSelectText(value);
    if (!optionKey || !wantedKey) return 0;
    if (optionKey === wantedKey) return 1000;
    if (fieldKey === "gender" && wantedKey === "male") {
      return optionKey === "male" ? 1000 : 0;
    }

    const aliases = fieldValueAliases(fieldKey, value);
    for (const alias of aliases) {
      const aliasKey = canonicalSelectText(alias);
      if (!aliasKey) continue;
      if (optionKey === aliasKey) return 980;
      if (optionKey.startsWith(aliasKey)) return 940;
      if (optionKey.includes(aliasKey)) return 900;
      if (aliasKey.includes(optionKey) && optionKey.length >= 5) return 850;
    }

    if (optionKey.startsWith(wantedKey)) return 820;
    if (wantedKey.length >= 4 && optionKey.includes(wantedKey)) return 780;

    const wantedTokens = selectTokens(value);
    const optionTokens = new Set(selectTokens(optionText));
    const overlap = wantedTokens.filter((token) => optionTokens.has(token));
    let score = overlap.length * 120;

    if (/^degree--/.test(fieldKey) && optionTokens.has("bachelors")) score += 350;
    if (/^degree--/.test(fieldKey) && optionTokens.has("bachelor")) score += 350;
    if (/^degree--/.test(fieldKey) && optionTokens.has("degree")) score += 90;
    if (
      fieldKey === "disability_status" &&
      wantedTokens.includes("no") &&
      wantedTokens.some((token) => token.startsWith("disab")) &&
      optionTokens.has("no") &&
      [...optionTokens].some((token) => token.startsWith("disab"))
    ) {
      score += 500;
    }
    if (
      fieldKey === "veteran_status" &&
      wantedTokens.includes("veteran") &&
      (wantedTokens.includes("no") || wantedTokens.includes("not")) &&
      optionTokens.has("not") &&
      optionTokens.has("veteran")
    ) {
      score += 500;
    }
    if (
      /^school--/.test(fieldKey) &&
      wantedTokens.includes("virginia") &&
      wantedTokens.includes("tech") &&
      optionTokens.has("virginia") &&
      (optionTokens.has("tech") || optionTokens.has("polytechnic"))
    ) {
      score += 520;
    }

    return score;
  }

  function valuesEquivalent(optionText, value, fieldKey) {
    return scoreComboboxOption(optionText, value, fieldKey) >= 500;
  }

  function fieldWrapperSelectInput(root) {
    const input =
      root.querySelector(".select__control input.select__input") ||
      root.querySelector(".select-shell input[role='combobox']");
    if (!input || !isComboboxInput(input)) return null;
    const fieldKey = normalizeText(input.id);
    if (!fieldKey || fieldKey === "false") return null;
    return input;
  }

  function connectorSelectFields(documentRef) {
    const fields = [];
    const seen = new Set();

    for (const root of collectFieldRoots(documentRef || document)) {
      const input = findPrimaryInput(root);
      if (!input || fieldWrapperSelectInput(root) !== input) continue;
      if (sectionKind(root) === "eeoc") continue;
      if (!["application", "education"].includes(sectionKind(root))) continue;
      if (isSensitiveOptionalField(root, questionText(root))) continue;

      const fieldKey = normalizeText(input.id);
      if (!fieldKey || fieldKey === "false" || seen.has(fieldKey)) continue;
      seen.add(fieldKey);
      fields.push({
        fieldKey,
        label:
          questionText(root) || directLabelForInput(root, input) || fieldKey,
      });
    }

    return fields;
  }

  function eeocSelectFields(documentRef) {
    const form = applicationForm(documentRef);
    const container = form?.querySelector(".eeoc__container");
    if (!container) return [];

    return EEOC_FIELD_SPECS.map((spec) => {
      const input = container.querySelector(`#${cssEscape(spec.fieldKey)}`);
      if (!input || !isComboboxInput(input)) return null;
      const root =
        input.closest(".eeoc__question__wrapper") ||
        input.closest(".field-wrapper") ||
        input.closest(".select") ||
        container;
      return {
        ...spec,
        label:
          questionText(root) ||
          directLabelForInput(root, input) ||
          spec.label,
      };
    }).filter(Boolean);
  }

  function provideTools({ document: documentRef }) {
    const fields = connectorSelectFields(documentRef || document);
    const eeocFields = eeocSelectFields(documentRef || document);
    const tools = [];

    if (fields.length) {
      const mapping = fields
        .map((field) => `${field.fieldKey} = "${truncate(field.label, 90)}"`)
        .join("; ");

      tools.push({
        type: "function",
        name: "greenhouse_fill_select",
        description: truncate(
          "Fill a Greenhouse single-select dropdown in ONE step: opens the menu, matches the value " +
            "against visible options, searches the dropdown when needed, and commits it. Prefer this over separate click/observe/click " +
            "turns for these selects. It is safe to call multiple times in one step for independent " +
            "fields when values are known. fieldKey -> label: " +
            mapping,
          900,
        ),
        strict: false,
        parameters: {
          type: "object",
          properties: {
            fieldKey: {
              type: "string",
              enum: fields.map((field) => field.fieldKey),
              description: "Which Greenhouse select to fill (field key).",
            },
            value: {
              type: "string",
              description:
                'The user/My Info value to select. It may be semantic rather than exact visible text, e.g. "No disability", "Virginia Tech", or "Bachelors in science". The connector searches and best-fits against live options.',
            },
          },
          required: ["fieldKey", "value"],
          additionalProperties: false,
        },
      });
    }

    if (eeocFields.length) {
      const mapping = eeocFields
        .map((field) => `${field.fieldKey} = "${truncate(field.label, 90)}"`)
        .join("; ");
      const fieldValueProperties = {};
      for (const field of eeocFields) {
        fieldValueProperties[field.fieldKey] = {
          type: "string",
          description: `Explicit answer for ${field.label}. Omit when unknown.`,
        };
      }

      tools.push({
        type: "function",
        name: "greenhouse_fill_eeoc",
        description: truncate(
          "Fill multiple Greenhouse EEOC self-identification selects in ONE step. Use only " +
            "explicit sensitive values from runContext.myInfo or USER_GOAL. Omit fields that are " +
            "unknown; do not invent values or choose decline/prefer-not-to-answer unless explicit. " +
            "The connector opens each menu, matches the requested value against live options, and " +
            "commits it. fieldKey -> label: " +
            mapping,
          1100,
        ),
        strict: false,
        parameters: {
          type: "object",
          properties: {
            fieldValues: {
              type: "object",
              properties: fieldValueProperties,
              additionalProperties: false,
              description:
                "Object keyed by Greenhouse EEOC fieldKey. Include only explicit values.",
            },
          },
          required: ["fieldValues"],
          additionalProperties: false,
        },
      });
    }

    return tools;
  }

  function locateSelectByFieldKey(fieldKey, options = {}) {
    const form = applicationForm(document);
    if (!form) return null;
    const scope = options.scopeSelector
      ? form.querySelector(options.scopeSelector)
      : form;
    if (!scope) return null;

    let input = document.getElementById(fieldKey);
    if (
      !(input instanceof Element) ||
      !scope.contains(input) ||
      !isComboboxInput(input)
    ) {
      input = null;
      const rootSelector =
        options.rootSelector ||
        (options.scopeSelector
          ? `${options.scopeSelector} .eeoc__question__wrapper, ${options.scopeSelector} .field-wrapper`
          : ".application--questions .field-wrapper");
      for (const root of getElements(rootSelector, form)) {
        const candidate = fieldWrapperSelectInput(root);
        if (candidate && normalizeText(candidate.id) === normalizeText(fieldKey)) {
          input = candidate;
          break;
        }
      }
    }

    if (!input) return null;

    const container =
      input.closest(".select") || input.closest(".select-shell") || input.parentElement;
    const control =
      container?.querySelector(".select__control") ||
      input.closest(".select__control");

    return { input, container, control };
  }

  function readComboboxOptions(input, container) {
    const listboxId = normalizeText(input?.getAttribute("aria-controls"));
    let listbox = listboxId ? document.getElementById(listboxId) : null;
    if (!listbox && input?.id) {
      listbox = document.getElementById(`react-select-${input.id}-listbox`);
    }
    const scope = listbox || container || document;
    return getVisibleElements("[role='option']", scope)
      .map((el) => ({ el, text: normalizeText(el.textContent) }))
      .filter((option) => option.text);
  }

  function optionsSignature(options) {
    return (options || []).map((option) => choiceKey(option.text)).join("|");
  }

  async function waitForComboboxOptions(input, container, previousSignature = "") {
    let latest = readComboboxOptions(input, container);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const signature = optionsSignature(latest);
      if (latest.length && (!previousSignature || signature !== previousSignature)) {
        return latest;
      }
      await delay(100);
      latest = readComboboxOptions(input, container);
    }
    return latest;
  }

  function nativeSetInputValue(input, value) {
    const descriptor =
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value") ||
      Object.getOwnPropertyDescriptor(input, "value");
    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
  }

  function inputLikeEvent(type, init = {}) {
    try {
      return new InputEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        ...init,
      });
    } catch {
      return new Event(type, { bubbles: true, cancelable: true });
    }
  }

  function dispatchReactSelectInput(input, value) {
    input.focus?.();
    nativeSetInputValue(input, "");
    input.dispatchEvent(inputLikeEvent("input", { inputType: "deleteContentBackward" }));

    let nextValue = "";
    for (const char of String(value || "")) {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: char, bubbles: true, cancelable: true }),
      );
      input.dispatchEvent(
        inputLikeEvent("beforeinput", { data: char, inputType: "insertText" }),
      );
      nextValue += char;
      nativeSetInputValue(input, nextValue);
      input.dispatchEvent(inputLikeEvent("input", { data: char, inputType: "insertText" }));
      input.dispatchEvent(
        new KeyboardEvent("keyup", { key: char, bubbles: true, cancelable: true }),
      );
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function searchComboboxOptions(input, container, fieldKey, value) {
    const startingSignature = optionsSignature(readComboboxOptions(input, container));
    let latest = readComboboxOptions(input, container);

    for (const query of searchQueriesFor(fieldKey, value)) {
      dispatchReactSelectInput(input, query);
      latest = await waitForComboboxOptions(input, container, startingSignature);
      if (matchComboboxOption(latest, value, fieldKey)) return latest;
    }

    return latest;
  }

  function matchComboboxOption(options, value, fieldKey = "") {
    let best = null;
    let secondScore = 0;

    for (const option of options || []) {
      const score = scoreComboboxOption(option.text, value, fieldKey);
      if (!best || score > best.score) {
        secondScore = best?.score || 0;
        best = { ...option, score };
      } else if (score > secondScore) {
        secondScore = score;
      }
    }

    if (!best || best.score < 450) return null;
    if (best.score < 900 && secondScore && best.score - secondScore < 80) return null;
    return best;
  }

  function committedSelectValue(container) {
    if (!container) return "";
    const visible = normalizeText(
      container.querySelector(".select__single-value")?.textContent || "",
    );
    if (visible) return visible;
    return normalizeText(
      Array.from(
        container.querySelectorAll("input[type='hidden'], input[aria-hidden='true']"),
      )
        .map((input) => input.value || input.getAttribute("value"))
        .filter(Boolean)
        .join(", "),
    );
  }

  async function waitForCommittedSelectValue(container) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const value = committedSelectValue(container);
      if (value) return value;
      await delay(100);
    }
    return committedSelectValue(container);
  }

  function closeCombobox(input) {
    try {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keyup", { key: "Escape", bubbles: true, cancelable: true }),
      );
      input.blur?.();
    } catch {
      /* ignore */
    }
  }

  async function fillSelectByFieldKey(fieldKey, value, ctx, locateOptions = {}) {
    const click = ctx?.primitives?.clickElement;

    if (!fieldKey || !value) {
      return { ok: false, detail: "greenhouse_fill_select requires fieldKey and value." };
    }
    if (typeof click !== "function") {
      return { ok: false, detail: "greenhouse_fill_select runner primitives unavailable." };
    }

    const located = locateSelectByFieldKey(fieldKey, locateOptions);
    if (!located?.control || !located.input) {
      return { ok: false, detail: `No Greenhouse select found for fieldKey ${fieldKey}.` };
    }
    const { input, container, control } = located;

    const already = committedSelectValue(container);
    if (already && valuesEquivalent(already, value, fieldKey)) {
      return {
        ok: true,
        committed: true,
        value: already,
        detail: `${fieldKey} already set to "${already}".`,
      };
    }

    // Open the menu (clicking .select__control opens the React-select listbox).
    await click(control);
    input.focus?.();
    await delay(150);

    let options = await waitForComboboxOptions(input, container);
    if (!options.length) {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
      await delay(150);
      options = await waitForComboboxOptions(input, container);
    }
    if (!options.length) {
      const toggle = container?.querySelector(
        ".select__indicators button[aria-label='Toggle flyout']",
      );
      if (toggle) {
        await click(toggle);
        input.focus?.();
        await delay(150);
        options = await waitForComboboxOptions(input, container);
      }
    }
    if (!options.length) {
      options = await searchComboboxOptions(input, container, fieldKey, value);
      if (!options.length) {
        closeCombobox(input);
        return {
          ok: false,
          recoverable: true,
          continueBatch: true,
          detail: `Opened ${fieldKey} but no options were visible after searching.`,
          options: [],
        };
      }
    }

    let match = matchComboboxOption(options, value, fieldKey);
    if (!match) {
      options = await searchComboboxOptions(input, container, fieldKey, value);
      match = matchComboboxOption(options, value, fieldKey);
    }
    if (!match) {
      closeCombobox(input);
      return {
        ok: false,
        recoverable: true,
        continueBatch: true,
        detail: `No option matching "${value}" for ${fieldKey}.`,
        options: options.map((option) => option.text).slice(0, 12),
      };
    }

    await click(match.el);
    await delay(250);

    const committedValue = (await waitForCommittedSelectValue(container)) || match.text;
    const committed = valuesEquivalent(committedValue, match.text, fieldKey);
    return {
      ok: true,
      committed,
      value: committedValue,
      detail: committed
        ? `Set ${fieldKey} to "${match.text}".`
        : `Clicked option "${match.text}" for ${fieldKey}; verify on next observation.`,
    };
  }

  async function greenhouseFillSelect(action, ctx) {
    const fieldKey = normalizeText(action?.fieldKey);
    const value = normalizeText(action?.value);
    return fillSelectByFieldKey(fieldKey, value, ctx);
  }

  function eeocFieldValuesFromAction(action) {
    const source =
      action?.fieldValues &&
      typeof action.fieldValues === "object" &&
      !Array.isArray(action.fieldValues)
        ? action.fieldValues
        : action || {};
    const fieldValues = {};

    for (const spec of EEOC_FIELD_SPECS) {
      const value = normalizeText(source[spec.fieldKey]);
      if (value) fieldValues[spec.fieldKey] = value;
    }

    return fieldValues;
  }

  async function greenhouseFillEeoc(action, ctx) {
    const requestedFieldValues = eeocFieldValuesFromAction(action);
    const entries = Object.entries(requestedFieldValues);

    if (!entries.length) {
      return {
        ok: false,
        detail:
          "greenhouse_fill_eeoc requires at least one explicit EEOC fieldValues entry.",
      };
    }

    const results = [];
    const committedFieldValues = {};
    const failed = [];

    for (const [fieldKey, value] of entries) {
      const result = await fillSelectByFieldKey(fieldKey, value, ctx, {
        scopeSelector: ".eeoc__container",
      });
      results.push({
        fieldKey,
        requestedValue: value,
        ok: result.ok !== false,
        committed: Boolean(result.committed),
        value: result.value || "",
        detail: result.detail || "",
        options: result.options || undefined,
      });

      if (result.ok === false) {
        failed.push(fieldKey);
      } else {
        committedFieldValues[fieldKey] = result.value || value;
      }
    }

    const committedCount = Object.keys(committedFieldValues).length;
    return {
      ok: committedCount > 0,
      recoverable: failed.length > 0,
      continueBatch: failed.length > 0,
      committed: failed.length === 0,
      fieldValues: committedFieldValues,
      failed,
      results,
      detail: failed.length
        ? `Filled ${committedCount} EEOC field(s); ${failed.length} field(s) need fallback.`
        : `Filled ${committedCount} EEOC field(s).`,
    };
  }

  if (
    globalThis.WebGPTConnectorTools &&
    typeof globalThis.WebGPTConnectorTools.register === "function"
  ) {
    globalThis.WebGPTConnectorTools.register(
      "greenhouse_fill_select",
      greenhouseFillSelect,
    );
    globalThis.WebGPTConnectorTools.register(
      "greenhouse_fill_eeoc",
      greenhouseFillEeoc,
    );
  }

  registry.register({
    id: ADAPTER_ID,
    priority: 84,
    provideTools,
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
