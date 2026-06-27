(function () {
  const ADAPTER_ID = "ashby.application";
  const APPLICATION_TARGET_ID = `site:${ADAPTER_ID}:application`;
  const registry = globalThis.WebGPTContentAdapters;
  const extractModules = globalThis.WebGPTExtractStateModules || {};
  const domUtils = extractModules.domUtils || {};

  if (!registry || typeof registry.register !== "function") {
    throw new Error(
      "content-scripts/adapters/registry.js must load before ashby.js",
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
    const type = lower(control.type);

    if (["input", "textarea", "select", "button"].includes(tag)) return true;
    if (tag === "label" && !/^(hidden|text|email|url|tel|number)$/.test(type)) {
      return true;
    }
    if (["button", "option", "radio", "checkbox"].includes(role)) return true;
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

  function findBestControlInRegion(controls, regionEl, options = {}) {
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
          control.placeholder,
        ].join(" "),
      );
      let score =
        Number(control.bounds?.width || 0) * Number(control.bounds?.height || 0);

      if (options.text && haystack.includes(lower(options.text))) score += 50000;
      if (options.preferInput && ["input", "textarea"].includes(control.tag)) {
        score += 100000;
      }
      if (options.preferButton && control.tag === "button") score += 100000;
      if (control.enabled) score += 1000;
      if (control.visible) score += 1000;

      if (!best || score > best.score) best = { control, score };
    }

    return best?.control || null;
  }

  function isAshbyPage(documentRef, url) {
    const host = lower(safeHost(url));
    if (host === "ashbyhq.com" || host.endsWith(".ashbyhq.com")) return true;

    return Boolean(
      documentRef.querySelector(
        [
          ".ashby-application-form-container",
          ".ashby-job-posting-right-pane",
          ".ashby-job-posting-heading",
          ".ashby-application-form-submit-button",
        ].join(","),
      ),
    );
  }

  function fieldTargetId(fieldPath) {
    return `site:${ADAPTER_ID}:field:${stableKey(fieldPath, "field")}`;
  }

  function optionTargetId(fieldPath, optionText) {
    return `${fieldTargetId(fieldPath)}:option:${stableKey(optionText, "option")}`;
  }

  function isRequiredField(root) {
    return Boolean(
      root.querySelector("[required]") ||
        root.querySelector("[aria-required='true']") ||
        root.querySelector("[class*='required']"),
    );
  }

  function questionText(root) {
    const label =
      root.querySelector(".ashby-application-form-question-title") ||
      root.querySelector("legend") ||
      root.querySelector("label") ||
      root.querySelector("[role='heading']");

    return truncate(textContent(label), 220) || truncate(textContent(root), 160);
  }

  function inputKind(input) {
    if (!input) return "";
    if (input.tagName === "TEXTAREA") return "long_text";
    if (input.tagName === "SELECT") return "select";
    return lower(input.getAttribute("type")) || "text";
  }

  function findPrimaryInput(root) {
    return root.querySelector(
      "textarea, select, input:not([type='hidden']):not([type='radio']):not([type='checkbox'])",
    );
  }

  function isComboboxInput(input) {
    if (!input || !(input instanceof Element)) return false;
    return (
      lower(input.getAttribute("role")) === "combobox" ||
      lower(input.getAttribute("aria-autocomplete")) === "list" ||
      lower(input.getAttribute("aria-haspopup")) === "listbox"
    );
  }

  function fieldHasCombobox(root, controls = []) {
    const input = findPrimaryInput(root);
    if (isComboboxInput(input)) return true;

    return (controls || []).some((control) => {
      const role = lower(control?.role);
      const controlType = lower(control?.controlType);
      return role === "combobox" || controlType === "combobox";
    });
  }

  function fieldKind(root, optionCount, hasCombobox = false) {
    if (root.querySelector("input[type='file']")) return "file";
    if (hasCombobox) return "combobox";
    if (root.querySelector("textarea")) return "long_text";
    if (root.querySelector("select")) return "select";
    if (root.querySelector("input[type='radio']")) return "single_select";
    if (optionCount > 0 && lower(textContent(root)).includes("select all")) {
      return "multi_select";
    }
    if (root.querySelector("input[type='checkbox']") && optionCount > 2) {
      return "multi_select";
    }
    if (optionCount > 0) return "single_select";
    const input = root.querySelector("input:not([type='hidden'])");
    return inputKind(input) || "field";
  }

  function isSensitiveOptionalField(question) {
    const text = lower(question);
    return (
      /\b(current age|gender identity|ethnicity|ethnicities)\b/.test(text) ||
      /which of the following communities do you belong to/.test(text) ||
      /\b(disability|neurodivergent|veteran|refugee|immigrant)\b/.test(text)
    );
  }

  function isOptionalProfileField(question) {
    const text = lower(question);
    return /\b(linkedin|github|portfolio|personal website|website url|website|phone)\b/.test(
      text,
    );
  }

  function isOneOfThreeAnswerField(question) {
    const text = lower(question);
    return (
      /describe a choice you made when shipping a product/.test(text) ||
      /describe a time you challenged and changed a product request/.test(text) ||
      /something.*professional context.*gone deep/.test(text) ||
      /gone deep on purely because you couldn't let it go/.test(text)
    );
  }

  function selectedFromAttribute(el) {
    if (!el || !(el instanceof Element)) return null;

    for (const attr of ["aria-checked", "aria-selected", "aria-pressed"]) {
      const value = lower(el.getAttribute(attr));
      if (value === "true") return true;
      if (value === "false") return false;
    }

    const state = lower(el.getAttribute("data-state"));
    if (["checked", "selected", "active", "on", "true"].includes(state)) {
      return true;
    }
    if (["unchecked", "unselected", "inactive", "off", "false"].includes(state)) {
      return false;
    }

    return null;
  }

  function selectedFromClasses(el) {
    if (!el || !(el instanceof Element)) return null;
    const classes = Array.from(el.classList || []);
    if (classes.some((name) => lower(name) === "true")) return true;
    if (classes.some((name) => lower(name) === "false")) return false;
    if (
      classes.some((name) =>
        /(^|[_-])(selected|checked|active|pressed|chosen|current)([_-]|$)/i.test(
          name,
        ),
      )
    ) {
      return true;
    }
    return null;
  }

  function selectedFromInput(input) {
    if (!input) return null;
    if (["checkbox", "radio"].includes(lower(input.type))) {
      return Boolean(input.checked);
    }
    return null;
  }

  function isOptionSelected(optionEl) {
    if (!optionEl || !(optionEl instanceof Element)) return false;

    const ownAttribute = selectedFromAttribute(optionEl);
    if (ownAttribute !== null) return ownAttribute;

    const ownClass = selectedFromClasses(optionEl);
    if (ownClass !== null) return ownClass;

    const checkedInput = optionEl.querySelector(
      "input[type='radio']:checked, input[type='checkbox']:checked",
    );
    if (checkedInput) return true;

    const uncheckedInput = optionEl.querySelector(
      "input[type='radio'], input[type='checkbox']",
    );
    const inputSelection = selectedFromInput(uncheckedInput);
    if (inputSelection !== null) return inputSelection;

    for (const child of getElements(
      "[aria-checked], [aria-selected], [aria-pressed], [data-state]",
      optionEl,
    )) {
      const selected = selectedFromAttribute(child);
      if (selected === true) return true;
    }

    for (const child of getElements("*", optionEl).slice(0, 20)) {
      const selected = selectedFromClasses(child);
      if (selected === true) return true;
    }

    return false;
  }

  function directLabelForInput(root, input) {
    return textContent(labelElementForInput(root, input));
  }

  function labelElementForInput(root, input) {
    const id = normalizeText(input.id);
    if (id) {
      const label = root.querySelector(`label[for="${cssEscape(id)}"]`);
      if (label) return label;
    }

    return input.closest("label");
  }

  function optionWrapperForInput(input, root) {
    return (
      input.closest("label") ||
      input.closest("[role='radio']") ||
      input.closest("[role='checkbox']") ||
      input.closest("[class*='_option']") ||
      input.parentElement?.parentElement ||
      root
    );
  }

  function isCompositeOptionText(options, optionText) {
    const text = lower(optionText);
    const existing = (options || [])
      .map((option) => lower(option.optionText))
      .filter(Boolean);

    if (existing.length < 2 || !text) return false;

    if (text === existing.slice(0, 2).join(" ")) return true;

    const contained = existing.filter((value) => text.includes(value));
    if (contained.length < 2) return false;

    const longest = Math.max(...contained.map((value) => value.length));
    return text.length >= longest + 3;
  }

  function isCompositeControlText(control) {
    const label = lower(control?.label || control?.ariaLabel);
    const text = lower(control?.text);
    if (!label || !text || label === text) return false;
    return text.includes(label) && text.length >= label.length + 12;
  }

  function addOption(options, optionEl, label, selected = null, controlId = "") {
    const optionText = truncate(label || textContent(optionEl), 160);
    if (!optionText || optionText.length > 180) return;
    if (isCompositeOptionText(options, optionText)) return;

    const existingIndex = options.findIndex(
      (option) => lower(option.optionText) === lower(optionText),
    );
    const next = {
      optionEl,
      optionText,
      selected: selected === null ? isOptionSelected(optionEl) : Boolean(selected),
      controlIds: controlId ? [controlId] : [],
    };

    if (existingIndex < 0) {
      options.push(next);
      return;
    }

    const existing = options[existingIndex];
    const controlIds = unique([...(existing.controlIds || []), ...next.controlIds]);
    if (
      existing.optionEl &&
      optionEl &&
      existing.optionEl.contains(optionEl) &&
      existing.optionEl !== optionEl
    ) {
      options[existingIndex] = { ...next, controlIds };
    } else if (next.selected && !existing.selected) {
      options[existingIndex] = { ...existing, selected: true, controlIds };
    } else {
      options[existingIndex] = { ...existing, controlIds };
    }
  }

  function isOptionControl(control, question) {
    const text = truncate(control?.label || control?.text || control?.ariaLabel, 180);
    if (!text) return false;
    if (lower(text) === lower(question)) return false;
    if (text.length > 120) return false;
    if (/upload|submit application|autofill from resume/i.test(text)) return false;
    if (isCompositeControlText(control)) return false;

    const role = lower(control?.role);
    const tag = lower(control?.tag);
    const controlType = lower(control?.controlType);

    if (role === "option") return false;
    if (["input", "textarea", "select"].includes(tag)) return false;
    if (["textbox", "combobox", "select"].includes(role)) return false;
    if (["textbox", "combobox", "select"].includes(controlType)) return false;

    return (
      ["button", "label"].includes(control?.tag) ||
      ["button", "tile", "checkbox", "radio"].includes(control?.containerKind) ||
      ["button", "checkbox", "radio"].includes(control?.controlType)
    );
  }

  function isComboboxExpanded(input) {
    if (!input || !(input instanceof Element)) return false;
    return lower(input.getAttribute("aria-expanded")) === "true";
  }

  function isComboboxPopupControl(control) {
    const role = lower(control?.role);
    const controlType = lower(control?.controlType);
    if (["option", "listbox"].includes(role)) return true;
    if (["option", "listbox"].includes(controlType)) return true;

    const haystack = lower([control?.label, control?.text].join(" "));
    return (
      isCompositeControlText(control) &&
      (/,\s*[a-z ]+,\s*united states/.test(haystack) || haystack.includes("dismiss"))
    );
  }

  function comboboxPopupIds(input) {
    if (!input || !(input instanceof Element)) return [];

    return unique(
      [
        normalizeText(input.getAttribute("aria-controls")),
        normalizeText(input.getAttribute("aria-owns")),
      ]
        .join(" ")
        .split(/\s+/),
    );
  }

  function comboboxLinkedListboxes(input) {
    return comboboxPopupIds(input)
      .map((id) => document.getElementById(id))
      .filter((el) => el instanceof Element);
  }

  function comboboxLinkedOptionElements(input) {
    if (!input || !(input instanceof Element)) return [];

    const elements = [];

    for (const listbox of comboboxLinkedListboxes(input)) {
      elements.push(...getVisibleElements("[role='option']", listbox));
    }

    return unique(elements);
  }

  function isComboboxLinkedListboxVisible(input) {
    return comboboxLinkedListboxes(input).some(
      (listbox) =>
        isVisible(listbox) ||
        getVisibleElements("[role='option']", listbox).length > 0,
    );
  }

  function collectComboboxOptionInfos(input, controls) {
    const options = [];

    for (const el of comboboxLinkedOptionElements(input)) {
      const text = truncate(textContent(el), 160);
      if (!text || text.length > 160) continue;
      const control = findControlForElement(controls, el);
      addOption(options, el, text, false, control?.id || "");
    }

    return options.slice(0, 5);
  }

  function findOptionElementForControl(root, control, options) {
    const text = lower(control?.label || control?.text || control?.ariaLabel);
    const byText = options
      .map((option) => option.optionEl)
      .filter(Boolean)
      .find((el) => lower(textContent(el)) === text);
    if (byText) return byText;

    const controlBounds = control?.bounds || null;
    if (!controlBounds) return null;

    return (
      getElements(
        "button, label, [role='radio'], [role='checkbox'], [aria-checked], [aria-selected], [class*='_option']",
        root,
      ).find((el) => boundsContain(elementBounds(el), controlBounds)) || null
    );
  }

  function collectOptionInfos(root, controls, question) {
    const options = [];

    const yesNoButtons = getVisibleElements("button", root).filter((button) =>
      ["yes", "no"].includes(lower(textContent(button))),
    );
    if (yesNoButtons.length >= 2) {
      const checkbox = root.querySelector("input[type='checkbox']");
      for (const button of yesNoButtons.slice(0, 2)) {
        const buttonText = textContent(button);
        const control = findControlForElement(controls, button);
        let selected = null;
        if (checkbox?.checked && lower(buttonText) === "yes") selected = true;
        if (checkbox?.checked && lower(buttonText) === "no") selected = false;
        addOption(options, button, buttonText, selected, control?.id || "");
      }
    }

    for (const input of getElements("input[type='radio'], input[type='checkbox']", root)) {
      if (!isVisible(input) && !directLabelForInput(root, input)) continue;
      const wrapper = optionWrapperForInput(input, root);
      const label = directLabelForInput(root, input) || textContent(wrapper);
      const labelEl = labelElementForInput(root, input);
      const control =
        findControlForElement(controls, input) ||
        findControlForElement(controls, labelEl) ||
        findControlForElement(controls, wrapper);
      addOption(options, wrapper, label, input.checked, control?.id || "");
    }

    for (const el of getVisibleElements(
      [
        "[role='radio']",
        "[role='checkbox']",
        "[aria-checked]",
        "[aria-selected]",
        "button",
        "label",
        "[class*='_option']",
      ].join(","),
      root,
    )) {
      if (el.matches("input, textarea, select")) continue;
      const text = truncate(textContent(el), 160);
      if (!text || lower(text) === lower(question) || text.length > 160) continue;
      if (/upload|submit application|drag and drop/i.test(text)) continue;
      if (el.querySelector(".ashby-application-form-question-title")) continue;
      const control = findControlForElement(controls, el);
      addOption(options, el, text, null, control?.id || "");
    }

    for (const control of controls || []) {
      if (!isOptionControl(control, question)) continue;
      const optionText = truncate(
        control.label || control.text || control.ariaLabel,
        160,
      );
      const optionEl = findOptionElementForControl(root, control, options);
      addOption(options, optionEl || root, optionText, optionEl ? null : false, control.id);
    }

    return options.slice(0, 40);
  }

  function selectedValueFromOptions(options) {
    return (options || [])
      .filter((option) => option.selected)
      .map((option) => option.optionText)
      .join(", ");
  }

  function textValueForField(root) {
    const input = root.querySelector(
      "textarea, input:not([type='hidden']):not([type='file']):not([type='radio']):not([type='checkbox'])",
    );
    if (!input) return "";
    return truncate(input.value || input.getAttribute("value") || "", 360);
  }

  function selectValueForField(root) {
    const select = root.querySelector("select");
    if (!select) return "";
    return Array.from(select.selectedOptions || [])
      .map((option) => normalizeText(option.label || option.textContent))
      .filter(Boolean)
      .join(", ");
  }

  function fileValueForField(root) {
    const input = root.querySelector("input[type='file']");
    if (!input) return "";
    const files = Array.from(input.files || [])
      .map((file) => file.name)
      .filter(Boolean);
    return files.join(", ");
  }

  function applicationScopes(documentRef) {
    const scopes = unique([
      documentRef.querySelector(".ashby-job-posting-right-pane"),
      ...getElements(".ashby-survey-form-container", documentRef),
      ...getElements(".ashby-application-form-container", documentRef),
    ].filter(Boolean));

    return scopes.length ? scopes : [documentRef];
  }

  function collectFieldRoots(documentRef) {
    const roots = [];
    const seen = new Set();

    for (const scope of applicationScopes(documentRef)) {
      for (const el of getElements(
        [
          ".ashby-application-form-field-entry",
          "[data-field-path]",
          "fieldset",
        ].join(","),
        scope,
      )) {
        const root =
          el.closest(".ashby-application-form-field-entry") ||
          el.closest("[data-field-path]") ||
          el;
        if (!root || seen.has(root)) continue;
        if (!scope.contains(root)) continue;
        if (!questionText(root)) continue;
        seen.add(root);
        roots.push(root);
      }
    }

    return roots;
  }

  function collectField(state, root, index) {
    const regionControls = controlsInRegion(state.controls || [], root);
    const question = questionText(root);
    const input = findPrimaryInput(root);
    const hasCombobox = fieldHasCombobox(root, regionControls);
    const controls = hasCombobox
      ? regionControls
      : regionControls.filter((control) => !isComboboxPopupControl(control));
    const fieldPath =
      normalizeText(root.getAttribute("data-field-path")) ||
      normalizeText(root.closest("[data-field-path]")?.getAttribute("data-field-path")) ||
      `question_${stableKey(question, `field_${index + 1}`)}`;
    const entryId =
      normalizeText(root.getAttribute("data-field-entry-id")) ||
      normalizeText(root.closest("[data-field-entry-id]")?.getAttribute("data-field-entry-id"));
    const options = hasCombobox
      ? collectComboboxOptionInfos(input, state.controls || [])
      : collectOptionInfos(root, controls, question);
    const kind = fieldKind(root, options.length, hasCombobox);
    const isCombobox = kind === "combobox";
    const selectedValue = isCombobox ? "" : selectedValueFromOptions(options);
    const textValue = textValueForField(root);
    const autocompleteOpen = Boolean(
      isCombobox &&
        (isComboboxExpanded(input) || isComboboxLinkedListboxVisible(input)),
    );
    const needsAutocompleteCommit = Boolean(
      isCombobox && textValue && autocompleteOpen,
    );
    const rawValue =
      kind === "file"
        ? fileValueForField(root)
        : kind === "select"
          ? selectValueForField(root)
          : isCombobox
            ? textValue
            : options.length
              ? selectedValue
              : textValue;
    const answered = Boolean(rawValue) && !needsAutocompleteCommit;
    const currentValue =
      rawValue ||
      (options.length ? "unanswered" : "");
    const fillControl =
      findControlForElement(state.controls || [], input) ||
      findBestControlInRegion(state.controls || [], root, {
        preferInput: !options.length || kind === "combobox",
      });
    const fieldControlIds = unique(
      [
        fillControl?.id,
        ...controls.map((control) => control.id),
      ].filter(Boolean),
    );
    const sensitiveOptional = isSensitiveOptionalField(question);
    const optionalProfile = isOptionalProfileField(question);
    const oneOfThreeAnswer = isOneOfThreeAnswerField(question);
    const blankFillable = Boolean(
      !answered &&
        fillControl?.id &&
        kind !== "file" &&
        !sensitiveOptional &&
        !oneOfThreeAnswer,
    );
    const safeMyInfoFill = Boolean(blankFillable && optionalProfile);
    const textFacts = [
      question,
      rawValue ? `current value: ${currentValue}` : "currentValue: blank",
      `answered: ${answered ? "true" : "false"}`,
      needsAutocompleteCommit
        ? "autocomplete options visible; click the matching option to commit"
        : "",
      safeMyInfoFill
        ? "safe optional profile field; fill from My Info when available"
        : "",
      sensitiveOptional
        ? "sensitive optional field; leave blank unless explicitly requested"
        : "",
      oneOfThreeAnswer
        ? "1-of-3 answer choice; fill only if USER_GOAL selected this prompt"
        : "",
    ];

    return {
      id: `ashby_field_${stableKey(fieldPath, `field_${index + 1}`)}`,
      kind: "ashby_application_field",
      adapterId: ADAPTER_ID,
      targetId: fieldTargetId(fieldPath),
      fieldPath,
      fieldEntryId: entryId,
      fieldKind: kind,
      required: isRequiredField(root),
      label: question,
      text: textFacts.filter(Boolean).join(" | "),
      currentValue,
      selectedValue,
      answered,
      blank: !rawValue,
      sensitiveOptional,
      optionalProfile,
      oneOfThreeAnswer,
      blankFillable,
      safeMyInfoFill,
      autocompleteOpen,
      needsAutocompleteCommit,
      fillTargetId: fillControl?.id || "",
      controlIds: fieldControlIds,
      optionTargets: options.map((option) => optionTargetId(fieldPath, option.optionText)),
      optionTexts: options.map((option) => option.optionText),
      options,
      controls,
      bounds: elementBounds(root),
    };
  }

  function selectedOptionGroups(fields) {
    const groups = [];

    for (const field of fields) {
      for (const option of field.options || []) {
        const targetId = optionTargetId(field.fieldPath, option.optionText);
        const controlIds = unique(option.controlIds || []);

        groups.push({
          id: `ashby_option_${stableKey(field.fieldPath)}_${stableKey(
            option.optionText,
            "option",
          )}`,
          kind: "ashby_application_option",
          adapterId: ADAPTER_ID,
          targetId,
          fieldTargetId: field.targetId,
          fieldPath: field.fieldPath,
          fieldKind: field.fieldKind,
          label: `${field.label}: ${option.optionText}`,
          text:
            field.fieldKind === "combobox"
              ? `visible autocomplete option: ${option.optionText}`
              : `${option.optionText} is ${
                  option.selected ? "selected" : "not selected"
                }`,
          optionText: option.optionText,
          checked:
            field.fieldKind === "combobox" ? false : Boolean(option.selected),
          selectedValue:
            field.fieldKind === "combobox" || !option.selected
              ? ""
              : option.optionText,
          currentValue:
            field.fieldKind === "combobox"
              ? `available option: ${option.optionText}`
              : option.selected
                ? `selected: ${option.optionText}`
                : `unselected: ${option.optionText}`,
          controlIds,
          bounds: elementBounds(option.optionEl),
        });
      }
    }

    return groups;
  }

  function fieldGroups(fields) {
    return fields.map((field) => ({
      id: field.id,
      kind: field.kind,
      adapterId: field.adapterId,
      targetId: field.targetId,
      fieldPath: field.fieldPath,
      fieldEntryId: field.fieldEntryId,
      fieldKind: field.fieldKind,
      required: field.required,
      label: field.label,
      text: field.text,
      currentValue: field.currentValue,
      selectedValue: field.selectedValue,
      answered: field.answered,
      blank: field.blank,
      sensitiveOptional: field.sensitiveOptional,
      optionalProfile: field.optionalProfile,
      oneOfThreeAnswer: field.oneOfThreeAnswer,
      blankFillable: field.blankFillable,
      safeMyInfoFill: field.safeMyInfoFill,
      autocompleteOpen: field.autocompleteOpen,
      needsAutocompleteCommit: field.needsAutocompleteCommit,
      fillTargetId: field.fillTargetId,
      controlIds: field.controlIds,
      optionTexts: field.optionTexts,
      optionTargets: field.optionTargets,
      preferredAction: field.fieldKind === "file" ? "extract" : "",
      bounds: field.bounds,
    }));
  }

  function applicationGroup(fields, siteAdapter) {
    const selected = fields
      .filter((field) => field.selectedValue)
      .map((field) => `${field.label}: ${field.selectedValue}`)
      .slice(0, 12);
    const answered = fields
      .filter((field) => field.answered && !field.selectedValue)
      .map((field) => `${field.label}: ${field.currentValue}`)
      .slice(0, 8);
    const missingRequired = fields
      .filter(
        (field) =>
          field.required && !field.answered && field.fieldKind !== "file",
      )
      .map((field) => field.label)
      .slice(0, 12);
    const requiredUploadBoundaries = fields
      .filter(
        (field) =>
          field.required && !field.answered && field.fieldKind === "file",
      )
      .map((field) => field.label)
      .slice(0, 6);
    const blankProfileFields = fields
      .filter((field) => field.safeMyInfoFill)
      .map((field) => field.label)
      .slice(0, 12);
    const blankSensitiveFields = fields
      .filter((field) => field.sensitiveOptional && !field.answered)
      .map((field) => field.label)
      .slice(0, 12);
    const blankOneOfThreeFields = fields
      .filter((field) => field.oneOfThreeAnswer && !field.answered)
      .map((field) => field.label)
      .slice(0, 12);
    const currentValue = missingRequired.length
      ? `missing required: ${missingRequired.join(", ")}`
      : blankProfileFields.length
        ? `safe profile fields blank: ${blankProfileFields.join(", ")}`
        : "required fields handled; sensitive optional or explicitly skipped fields may remain";

    return {
      id: "ashby_application_summary",
      kind: "ashby_application_summary",
      adapterId: ADAPTER_ID,
      targetId: APPLICATION_TARGET_ID,
      label: "Ashby application state",
      text: [
        `${fields.length} Ashby application fields detected`,
        selected.length ? `selected: ${selected.join(" | ")}` : "",
        answered.length ? `answered: ${answered.join(" | ")}` : "",
        missingRequired.length
          ? `missing required or unsupported: ${missingRequired.join(" | ")}`
          : "no required text/choice field is visibly missing",
        blankProfileFields.length
          ? `optional non-sensitive profile fields blank and safe to fill from My Info when values are present: ${blankProfileFields.join(" | ")}`
          : "",
        blankSensitiveFields.length
          ? `sensitive optional diversity fields blank: ${blankSensitiveFields.join(" | ")}`
          : "",
        blankOneOfThreeFields.length
          ? `1-of-3 answer choice fields blank; fill only the prompt USER_GOAL selected: ${blankOneOfThreeFields.join(" | ")}`
          : "",
        requiredUploadBoundaries.length
          ? `required upload/file boundaries present: ${requiredUploadBoundaries.join(" | ")}`
          : "",
        siteAdapter.uploadTargetIds?.length
          ? "resume upload/autofill boundary present"
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

  function sortFieldsForPlanner(fields) {
    return fields.slice().sort((a, b) => {
      const aNeedsCommit = a.needsAutocompleteCommit ? 0 : 1;
      const bNeedsCommit = b.needsAutocompleteCommit ? 0 : 1;
      if (aNeedsCommit !== bNeedsCommit) return aNeedsCommit - bNeedsCommit;
      const aMissing = a.required && !a.answered ? 0 : 1;
      const bMissing = b.required && !b.answered ? 0 : 1;
      if (aMissing !== bMissing) return aMissing - bMissing;
      const aAnswered = a.answered ? 1 : 0;
      const bAnswered = b.answered ? 1 : 0;
      if (aAnswered !== bAnswered) return aAnswered - bAnswered;
      return Number(a.bounds?.y || 0) - Number(b.bounds?.y || 0);
    });
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
      if (field.fieldKind === "file") {
        for (const targetId of actionableControlIds(field.controlIds, controlsById, 2)) {
          addHint(actionHintsByTargetId, targetId, {
            semanticRole: "ashby_file_upload_boundary",
            preferredAction: "extract",
            avoidAction: true,
            stableFieldTargetId: field.targetId,
            machineKey: field.fieldPath,
            answerText: field.label,
            instruction:
              "Ashby resume/file upload control. The browser runtime cannot upload files; if the user said do not upload, leave this alone.",
          });
        }
        continue;
      }

      if (field.fillTargetId && (!field.options?.length || field.fieldKind === "combobox")) {
        const isCombobox = field.fieldKind === "combobox";
        if (isActionableControl(controlsById.get(field.fillTargetId))) {
          const textFieldInstruction = field.safeMyInfoFill
            ? "This optional Ashby profile field is blank and safe to fill from My Info when a value is present. Do not invent missing values."
            : field.oneOfThreeAnswer
              ? "This is a 1-of-3 Ashby long-answer prompt. Fill it only if USER_GOAL selected this prompt; otherwise leave it blank."
              : "Fill this Ashby application field using the user's My Info or explicit goal text. Do not invent missing personal, legal, or sensitive answers.";
          addHint(actionHintsByTargetId, field.fillTargetId, {
            semanticRole: isCombobox
              ? "ashby_autocomplete_combobox"
              : "ashby_application_text_field",
            preferredAction: "fill",
            exactValueMode: isCombobox ? "searchText" : "literal",
            safeFillTarget: true,
            observeAfterAction: isCombobox,
            batchPlacement: isCombobox ? "fill_then_observe" : "can_batch",
            stableFieldTargetId: field.targetId,
            machineKey: field.fieldPath,
            answerText: field.label,
            instruction: isCombobox
              ? "This Ashby field is an autocomplete combobox. Fill the city/country search text, observe the listbox, then click the exact matching visible option to commit it. Typing alone or pressing Enter may not commit the answer."
              : textFieldInstruction,
          });
        }
      }

      for (const option of field.options || []) {
        const targetIds = actionableControlIds(option.controlIds, controlsById);
        const isComboboxOption = field.fieldKind === "combobox";
        const optionInstruction = option.selected
          ? "This Ashby option is already selected in adapter state; do not click it again unless the user asked to change it."
          : field.sensitiveOptional
            ? "Sensitive optional Ashby diversity option. Click only if USER_GOAL explicitly asks to answer this survey with this value."
            : "Click this Ashby option only if it is the desired answer. After one click, observe the next state and do not repeat it if adapter state shows it selected.";

        for (const targetId of targetIds) {
          addHint(actionHintsByTargetId, targetId, {
            semanticRole: isComboboxOption
              ? "ashby_autocomplete_option"
              : "ashby_application_option",
            preferredAction: "click",
            stableFieldTargetId: optionTargetId(field.fieldPath, option.optionText),
            machineKey: field.fieldPath,
            checked: isComboboxOption ? undefined : Boolean(option.selected),
            answerText: option.optionText,
            verifyAfterAction: isComboboxOption
              ? "adapter_group_current_value"
              : "adapter_group_selected_value",
            instruction: isComboboxOption
              ? "Click this visible Ashby autocomplete listbox option if it matches the desired field value. For city/country goals, an option that adds state/province but keeps the same city and country is a valid match. After one click, observe the next state and move on if the field value is filled and the listbox is closed."
              : optionInstruction,
          });
        }
      }
    }

    for (const targetId of uploadTargetIds || []) {
      addHint(actionHintsByTargetId, targetId, {
        semanticRole: "ashby_file_upload_boundary",
        preferredAction: "extract",
        avoidAction: true,
        instruction:
          "Ashby upload control. File upload is unsupported in this runtime; do not click when the goal says not to upload.",
      });
    }

    addHint(actionHintsByTargetId, submitTargetId, {
      semanticRole: "ashby_submit_application_boundary",
      preferredAction: "click",
      navigationAction: true,
      avoidAction: true,
      instruction:
        "Final Submit Application boundary. Do not click when the user says not to submit; for fill/draft-only goals, report done after requested fields are filled and only upload/submit remain.",
    });

    return actionHintsByTargetId;
  }

  function fieldPrimaryControlIds(field, controlsById) {
    if (field.fieldKind === "file") {
      return actionableControlIds(field.controlIds, controlsById, 2);
    }

    const ids = [];
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
        "Ashby adapter",
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

  function enhanceControls(controls, actionHintsByTargetId) {
    return (controls || []).map((control) => {
      const hint = actionHintsByTargetId?.[control.id];
      if (!hint) return control;

      const hintText = controlHintText(hint);
      return {
        ...control,
        label: truncate(unique([control.label, hintText]).join(" | "), 240),
        title: truncate(unique([control.title, hintText]).join(" | "), 240),
        heading: truncate(unique([control.heading, hint.instruction]).join(" | "), 240),
        adapterHints: {
          ...(control.adapterHints || {}),
          [ADAPTER_ID]: hint,
        },
      };
    });
  }

  function findSubmitTargetId(state, documentRef) {
    const submitEl =
      documentRef.querySelector(".ashby-application-form-submit-button") ||
      getVisibleElements("button", documentRef).find((button) =>
        /^submit application$/i.test(textContent(button)),
      );
    return (
      findControlForElement(state.controls || [], submitEl)?.id ||
      (state.controls || []).find((control) =>
        /^submit application$/i.test(control.label || control.text || ""),
      )?.id ||
      ""
    );
  }

  function findUploadTargetIds(state) {
    return (state.controls || [])
      .filter((control) => {
        const tag = lower(control?.tag);
        const controlType = lower(control?.controlType);
        const conciseText = normalizeText(control?.text).length <= 180
          ? control?.text
          : "";
        const haystack = [
          control?.label,
          conciseText,
          control?.title,
          control?.ariaLabel,
          control?.placeholder,
        ].join(" ");
        if (
          !/upload file|upload your resume|autofill from resume|no file chosen/i.test(
            haystack,
          )
        ) {
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

  function buildPlannerHints(fields, submitTargetId, uploadTargetIds) {
    const selected = fields
      .filter((field) => field.selectedValue)
      .map((field) => `${field.label}: ${field.selectedValue}`)
      .slice(0, 10);
    const missingRequired = fields
      .filter(
        (field) =>
          field.required && !field.answered && field.fieldKind !== "file",
      )
      .map((field) => field.label)
      .slice(0, 10);
    const requiredUploadBoundaries = fields
      .filter(
        (field) =>
          field.required && !field.answered && field.fieldKind === "file",
      )
      .map((field) => field.label)
      .slice(0, 6);
    const blankProfileFields = fields
      .filter((field) => field.safeMyInfoFill)
      .map((field) => field.label)
      .slice(0, 10);
    const blankSensitiveFields = fields
      .filter((field) => field.sensitiveOptional && !field.answered)
      .map((field) => field.label)
      .slice(0, 10);
    const blankOneOfThreeFields = fields
      .filter((field) => field.oneOfThreeAnswer && !field.answered)
      .map((field) => field.label)
      .slice(0, 10);

    return [
      "Ashby adapter active: use Ashby application groups and adapter control labels as high-confidence field state.",
      "Batch independent visible Ashby safeFillTarget fills and independent yes/no option clicks in one step when their targets are already present. For autocomplete/combobox fields, fill the search text, observe, then click the matching visible listbox option as the next step. For city/country goals, an option that adds state/province but keeps the same city and country is a valid match.",
      "If an Ashby option group/control says state selected or currentValue selected, treat that option as already chosen and do not click it again.",
      "After clicking an Ashby option, observe the next state; if adapter state shows the option selected, move on instead of extracting or clicking the same tile again.",
      selected.length ? `Currently selected Ashby options: ${selected.join(" | ")}.` : "",
      missingRequired.length
        ? `Ashby required fields still missing or unsupported: ${missingRequired.join(" | ")}.`
        : "No required Ashby text/choice field is visibly missing. Check optional profile blanks, sensitive optional fields, explicit exclusions, upload, and submit before deciding done.",
      blankProfileFields.length
        ? `Optional non-sensitive Ashby profile fields are blank but safe to fill from runContext.myInfo when values are present: ${blankProfileFields.join(" | ")}.`
        : "",
      blankSensitiveFields.length
        ? `Sensitive optional Ashby diversity fields are blank: ${blankSensitiveFields.join(" | ")}. Leave them blank unless USER_GOAL explicitly asks to answer the survey with provided values; mention them as left blank in done summaries.`
        : "",
      blankOneOfThreeFields.length
        ? `Ashby 1-of-3 long-answer choices are blank: ${blankOneOfThreeFields.join(" | ")}. Fill only the one USER_GOAL selected; blank alternates are not blockers.`
        : "",
      requiredUploadBoundaries.length
        ? `Ashby required upload/file boundaries are present but not normal fill targets: ${requiredUploadBoundaries.join(" | ")}. Treat them according to USER_GOAL and runtime upload support.`
        : "",
      uploadTargetIds.length
        ? "Ashby resume upload/autofill controls are file-upload boundaries. The runtime cannot upload files; leave them alone when the user says do not upload."
        : "",
      submitTargetId
        ? `Ashby Submit Application target ${submitTargetId} is final submission. If USER_GOAL says do not submit, do not click it; for fill-only goals it is okay to return done once requested non-file fields are handled and intentionally blank optional/sensitive fields are summarized.`
        : "",
      "Ashby diversity survey fields are sensitive and often optional; answer them only when the user explicitly provided those demographics and asked to fill them.",
    ].filter(Boolean);
  }

  function buildVisibleTextSummary(fields, siteAdapter) {
    const selected = fields
      .filter((field) => field.selectedValue)
      .map((field) => `${field.label}: ${field.selectedValue}`)
      .slice(0, 12);
    const missing = fields
      .filter(
        (field) =>
          field.required && !field.answered && field.fieldKind !== "file",
      )
      .map((field) => field.label)
      .slice(0, 12);
    const requiredUploadBoundaries = fields
      .filter(
        (field) =>
          field.required && !field.answered && field.fieldKind === "file",
      )
      .map((field) => field.label)
      .slice(0, 6);
    const blankProfileFields = fields
      .filter((field) => field.safeMyInfoFill)
      .map((field) => field.label)
      .slice(0, 12);
    const blankSensitiveFields = fields
      .filter((field) => field.sensitiveOptional && !field.answered)
      .map((field) => field.label)
      .slice(0, 12);
    const blankOneOfThreeFields = fields
      .filter((field) => field.oneOfThreeAnswer && !field.answered)
      .map((field) => field.label)
      .slice(0, 12);

    return [
      `Ashby application adapter: ${fields.length} fields detected.`,
      selected.length ? `Ashby selected options: ${selected.join(" | ")}` : "",
      missing.length
        ? `Ashby missing required/unsupported fields: ${missing.join(" | ")}`
        : "Ashby required text/choice fields appear handled; optional profile, sensitive optional, upload, and submit boundaries still need policy-aware review.",
      blankProfileFields.length
        ? `Ashby optional profile fields blank and safe from My Info: ${blankProfileFields.join(" | ")}`
        : "",
      blankSensitiveFields.length
        ? `Ashby sensitive optional diversity fields blank: ${blankSensitiveFields.join(" | ")}`
        : "",
      blankOneOfThreeFields.length
        ? `Ashby blank 1-of-3 answer choices: ${blankOneOfThreeFields.join(" | ")}`
        : "",
      requiredUploadBoundaries.length
        ? `Ashby required upload/file boundaries present: ${requiredUploadBoundaries.join(" | ")}`
        : "",
      siteAdapter.submitTargetId
        ? `Ashby submit boundary target: ${siteAdapter.submitTargetId}`
        : "",
    ].filter(Boolean);
  }

  function buildSiteAdapter(state, documentRef, url) {
    const fields = collectFieldRoots(documentRef)
      .map((root, index) => collectField(state, root, index))
      .filter((field) => field.label);
    const submitTargetId = findSubmitTargetId(state, documentRef);
    const uploadTargetIds = findUploadTargetIds(state);
    const controlsById = controlByIdMap(state.controls || []);
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
    const pageKind = documentRef.querySelector(".ashby-application-form-container")
      ? "application_form"
      : "job_posting";
    const siteAdapter = {
      id: ADAPTER_ID,
      pageKind,
      applicationTargetId: APPLICATION_TARGET_ID,
      detectedFieldCount: fields.length,
      answeredFieldCount: fields.filter((field) => field.answered).length,
      missingRequiredCount: fields.filter((field) => field.required && !field.answered)
        .length,
      submitTargetId,
      uploadTargetIds,
      primaryControlIds,
      actionHintsByTargetId,
    };
    siteAdapter.plannerHints = buildPlannerHints(fields, submitTargetId, uploadTargetIds);
    siteAdapter.groups = [
      applicationGroup(fields, siteAdapter),
      ...fieldGroups(sortFieldsForPlanner(fields)),
      ...selectedOptionGroups(fields),
    ].slice(0, 140);
    siteAdapter.visibleTextSummary = buildVisibleTextSummary(fields, siteAdapter);
    return siteAdapter;
  }

  registry.register({
    id: ADAPTER_ID,
    priority: 85,
    match({ document: documentRef, url }) {
      return isAshbyPage(documentRef, url);
    },
    enhanceState({ state, document: documentRef, url }) {
      const siteAdapter = buildSiteAdapter(state, documentRef, url);

      return {
        ...state,
        plannerContext: {
          ...(state.plannerContext || {}),
          mode: siteAdapter.pageKind,
          ashbyPageKind: siteAdapter.pageKind,
          ashbyDetectedFieldCount: siteAdapter.detectedFieldCount,
          ashbyAnsweredFieldCount: siteAdapter.answeredFieldCount,
          ashbyMissingRequiredCount: siteAdapter.missingRequiredCount,
          ashbySubmitTargetId: siteAdapter.submitTargetId,
        },
        siteAdapter: {
          id: siteAdapter.id,
          pageKind: siteAdapter.pageKind,
          applicationTargetId: siteAdapter.applicationTargetId,
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
        ),
      };
    },
  });
})();
