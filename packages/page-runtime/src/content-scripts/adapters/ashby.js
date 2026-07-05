(function () {
  const ADAPTER_ID = "ashby.application";
  const APPLICATION_TARGET_ID = `site:${ADAPTER_ID}:application`;
  const APPLICATION_FIELDS_TOOL = "ashby_fill_application_fields";
  const EEOC_TOOL = "ashby_fill_eeoc";
  const EEOC_SECTION_TARGET_ID = `site:${ADAPTER_ID}:section:eeoc`;
  const EEOC_FIELD_SPECS = [
    { fieldKey: "gender", label: "Gender" },
    { fieldKey: "race", label: "Race" },
    { fieldKey: "veteran_status", label: "Veteran Status" },
    { fieldKey: "disability_status", label: "Disability Status" },
  ];
  const ASHBY_APPLICATION_CONNECTOR_BATCH_HINT =
    "On an Ashby application form, when both non-file application values and explicit EEOC values are known, emit both connector actions in the same planner step: ashby_fill_application_fields followed by ashby_fill_eeoc. Do not split EEOC into a later step unless a value is genuinely unknown.";
  const ASHBY_RACE_INDIAN_HINT =
    "For Ashby's U.S. EEOC Race options, Indian/India/South Asian maps to Asian (Not Hispanic or Latino), not American Indian or Alaska Native.";
  const ASHBY_APPLICATION_SYNTHESIS_HINT =
    "For normal non-file, non-EEOC Ashby application questions, fill every answerable field by default. If a value is not explicitly present, synthesize a concise honest answer from runContext.myInfo, resume details, and visible job context; include explicit profile fields and synthesized normal answers in the same connector call instead of splitting them into a later pass. Generated text must use complete sentences and never be truncated mid-word or mid-sentence. Do not synthesize sensitive EEOC answers or file attachments.";
  const ASHBY_FILL_KNOWN_VALUES_HINT =
    "Strong batching rule for Ashby: do not stop, ask, or defer the whole form just because a few fields are unknown. Fill every field with a known, visible, My Info-supported, or safely synthesized value in the same connector action/step; omit only genuinely unknown unsafe, sensitive, file, or legal values and summarize those blanks after the known fields are handled.";
  const US_STATE_NAMES = {
    al: "Alabama",
    ak: "Alaska",
    az: "Arizona",
    ar: "Arkansas",
    ca: "California",
    co: "Colorado",
    ct: "Connecticut",
    de: "Delaware",
    dc: "District of Columbia",
    fl: "Florida",
    ga: "Georgia",
    hi: "Hawaii",
    id: "Idaho",
    il: "Illinois",
    in: "Indiana",
    ia: "Iowa",
    ks: "Kansas",
    ky: "Kentucky",
    la: "Louisiana",
    me: "Maine",
    md: "Maryland",
    ma: "Massachusetts",
    mi: "Michigan",
    mn: "Minnesota",
    ms: "Mississippi",
    mo: "Missouri",
    mt: "Montana",
    ne: "Nebraska",
    nv: "Nevada",
    nh: "New Hampshire",
    nj: "New Jersey",
    nm: "New Mexico",
    ny: "New York",
    nc: "North Carolina",
    nd: "North Dakota",
    oh: "Ohio",
    ok: "Oklahoma",
    or: "Oregon",
    pa: "Pennsylvania",
    ri: "Rhode Island",
    sc: "South Carolina",
    sd: "South Dakota",
    tn: "Tennessee",
    tx: "Texas",
    ut: "Utah",
    vt: "Vermont",
    va: "Virginia",
    wa: "Washington",
    wv: "West Virginia",
    wi: "Wisconsin",
    wy: "Wyoming",
  };
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

  function eeocFieldSpecFor(question, fieldPath = "") {
    const label = lower(question);
    const key = lower(fieldPath);
    const haystack = `${label} ${key}`;

    if (/^gender\b/.test(label) || /\bgender\b/.test(key)) {
      if (!/\bgender identity\b/.test(label)) return EEOC_FIELD_SPECS[0];
    }
    if (/^race\b/.test(label) || /\brace\b/.test(key)) {
      return EEOC_FIELD_SPECS[1];
    }
    if (/\bveteran status\b/.test(haystack) || /\bveteran_status\b/.test(key)) {
      return EEOC_FIELD_SPECS[2];
    }
    if (
      /\bdisability status\b/.test(haystack) ||
      /\bself-identification of disability\b/.test(haystack) ||
      /\bdisability_status\b/.test(key)
    ) {
      return EEOC_FIELD_SPECS[3];
    }

    return null;
  }

  function sectionKindForField(question, fieldPath) {
    return eeocFieldSpecFor(question, fieldPath) ? "eeoc" : "application";
  }

  function fieldPathFor(root, input, question, index) {
    return (
      normalizeText(root.getAttribute("data-field-path")) ||
      normalizeText(root.closest("[data-field-path]")?.getAttribute("data-field-path")) ||
      normalizeText(input?.id) ||
      normalizeText(input?.getAttribute("name")) ||
      `question_${stableKey(question, `field_${index + 1}`)}`
    );
  }

  function fieldEntryIdFor(root) {
    return (
      normalizeText(root.getAttribute("data-field-entry-id")) ||
      normalizeText(root.closest("[data-field-entry-id]")?.getAttribute("data-field-entry-id"))
    );
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

  function isUploadBoundaryField(root, question = "") {
    if (root.querySelector("input[type='file']")) return true;

    const input = findPrimaryInput(root);
    if (
      input &&
      !["file", "hidden"].includes(lower(input.getAttribute("type"))) &&
      ["INPUT", "TEXTAREA", "SELECT"].includes(input.tagName)
    ) {
      return false;
    }

    const haystack = lower(
      [
        question,
        ...getElements("button, label, input", root).map((el) =>
          [
            textContent(el),
            el.getAttribute("aria-label"),
            el.getAttribute("title"),
            el.getAttribute("placeholder"),
          ].join(" "),
        ),
      ].join(" "),
    );

    return /\b(resume|cv|cover letter|file|upload|attach|attachment)\b/.test(
      haystack,
    );
  }

  function fieldKind(root, optionCount, hasCombobox = false) {
    if (isUploadBoundaryField(root, questionText(root))) return "file";
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

  function yesNoButtonsForRoot(root) {
    const byValue = new Map();
    for (const button of getVisibleElements("button", root)) {
      const key = lower(textContent(button));
      if (!["yes", "no"].includes(key) || byValue.has(key)) continue;
      byValue.set(key, button);
    }

    return ["yes", "no"].map((key) => byValue.get(key)).filter(Boolean);
  }

  function isYesNoFieldRoot(root) {
    return yesNoButtonsForRoot(root).length >= 2;
  }

  function isActiveYesNoButton(button) {
    return selectedFromAttribute(button) === true || selectedFromClasses(button) === true;
  }

  function yesNoSelectedValue(root) {
    const activeButton = yesNoButtonsForRoot(root).find(isActiveYesNoButton);
    if (activeButton) return textContent(activeButton);

    const checkbox = root.querySelector("input[type='checkbox']");
    if (checkbox?.checked) {
      const yesButton = yesNoButtonsForRoot(root).find(
        (button) => lower(textContent(button)) === "yes",
      );
      if (yesButton) return textContent(yesButton);
    }

    return "";
  }

  function yesNoOptionSelected(root, button) {
    const selectedValue = yesNoSelectedValue(root);
    return Boolean(selectedValue) && lower(selectedValue) === lower(textContent(button));
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

  function floatingPortalOptionElements() {
    return getVisibleElements("[data-floating-ui-portal] [role='option']", document);
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

    for (const el of unique([
      ...comboboxLinkedOptionElements(input),
      ...floatingPortalOptionElements(),
    ])) {
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

    const yesNoButtons = yesNoButtonsForRoot(root);
    if (yesNoButtons.length >= 2) {
      for (const button of yesNoButtons) {
        const buttonText = textContent(button);
        const control = findControlForElement(controls, button);
        addOption(
          options,
          button,
          buttonText,
          yesNoOptionSelected(root, button),
          control?.id || "",
        );
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
        if (
          !findPrimaryInput(root) &&
          !root.querySelector(
            "input[type='radio'], input[type='checkbox'], input[type='file'], button, select, textarea",
          )
        ) {
          continue;
        }
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
    const fieldPath = fieldPathFor(root, input, question, index);
    const entryId = fieldEntryIdFor(root);
    const eeocSpec = eeocFieldSpecFor(question, fieldPath);
    const sectionKind = eeocSpec ? "eeoc" : sectionKindForField(question, fieldPath);
    const options = hasCombobox
      ? collectComboboxOptionInfos(input, state.controls || [])
      : collectOptionInfos(root, controls, question);
    const kind = fieldKind(root, options.length, hasCombobox);
    const isCombobox = kind === "combobox";
    const uploadBoundary = kind === "file";
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
    const sensitiveOptional = sectionKind === "eeoc" || isSensitiveOptionalField(question);
    const optionalProfile = isOptionalProfileField(question);
    const oneOfThreeAnswer = isOneOfThreeAnswerField(question);
    const blankFillable = Boolean(
      !answered &&
        fillControl?.id &&
        !uploadBoundary &&
        !sensitiveOptional &&
        !oneOfThreeAnswer,
    );
    const connectorTool = uploadBoundary
      ? ""
      : sectionKind === "eeoc"
        ? EEOC_TOOL
        : APPLICATION_FIELDS_TOOL;
    const connectorArgs =
      connectorTool === EEOC_TOOL
        ? { fieldKey: eeocSpec?.fieldKey || fieldPath }
        : connectorTool
          ? { fieldPath }
          : null;
    const batchPlacement =
      connectorTool === EEOC_TOOL
        ? "can_batch_sensitive_explicit_only"
        : connectorTool
          ? "can_batch"
          : "";
    const verifyAfterAction = connectorTool ? "adapter_group_current_value" : "";
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
        ? sectionKind === "eeoc"
          ? `sensitive optional EEOC field; answer from explicit runContext.myInfo value with ${EEOC_TOOL}, otherwise omit`
          : "sensitive optional field; leave blank unless explicitly requested"
        : "",
      oneOfThreeAnswer
        ? "1-of-3 answer choice; fill only if USER_GOAL selected this prompt"
        : "",
      connectorTool === APPLICATION_FIELDS_TOOL
        ? `connector action available: ${APPLICATION_FIELDS_TOOL} with fieldValues.${fieldPath}`
        : "",
      connectorTool === EEOC_TOOL
        ? `connector action available: ${EEOC_TOOL} with fieldValues.${eeocSpec?.fieldKey || fieldPath}`
        : "",
    ];

    return {
      id: `ashby_field_${stableKey(fieldPath, `field_${index + 1}`)}`,
      kind: "ashby_application_field",
      adapterId: ADAPTER_ID,
      targetId: fieldTargetId(fieldPath),
      fieldPath,
      fieldEntryId: entryId,
      eeocFieldKey: eeocSpec?.fieldKey || "",
      sectionKind,
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
      uploadBoundary,
      connectorTool,
      connectorArgs,
      batchPlacement,
      verifyAfterAction,
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
      fieldKey: field.sectionKind === "eeoc" ? field.eeocFieldKey || field.fieldPath : field.fieldPath,
      fieldPath: field.fieldPath,
      fieldEntryId: field.fieldEntryId,
      eeocFieldKey: field.eeocFieldKey,
      sectionKind: field.sectionKind,
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
      uploadBoundary: field.uploadBoundary,
      connectorTool: field.connectorTool,
      connectorArgs: field.connectorArgs,
      batchPlacement: field.batchPlacement,
      verifyAfterAction: field.verifyAfterAction,
      autocompleteOpen: field.autocompleteOpen,
      needsAutocompleteCommit: field.needsAutocompleteCommit,
      fillTargetId: field.fillTargetId,
      controlIds: field.controlIds,
      optionTexts: field.optionTexts,
      optionTargets: field.optionTargets,
      preferredAction: field.connectorTool || (field.fieldKind === "file" ? "extract" : ""),
      bounds: field.bounds,
    }));
  }

  function applicationFillGroups(fields) {
    const fillableFields = fields.filter(
      (field) => field.connectorTool === APPLICATION_FIELDS_TOOL,
    );
    if (!fillableFields.length) return [];

    const fieldPaths = fillableFields.map((field) => field.fieldPath);
    const blankLabels = fillableFields
      .filter((field) => !field.answered)
      .map((field) => field.label)
      .slice(0, 18);
    const answeredLabels = fillableFields
      .filter((field) => field.answered)
      .map((field) => `${field.label}: ${field.currentValue}`)
      .slice(0, 12);

    return [
      {
        id: "ashby_application_fill_batch",
        kind: "ashby_application_section",
        adapterId: ADAPTER_ID,
        targetId: `${APPLICATION_TARGET_ID}:batch:non_file_fields`,
        sectionKind: "application",
        label: "Ashby Non-File Application Fields",
        text: [
          "Ashby non-file application fields detected",
          `connector action available: ${APPLICATION_FIELDS_TOOL} with fieldValues for ${fieldPaths.join(", ")}`,
          `Use this one connector action for profile/contact/text/choice/autocomplete fields. Include all visible blank normal fields in this call. ${ASHBY_APPLICATION_SYNTHESIS_HINT}`,
          blankLabels.length
            ? `blank non-file fields: ${blankLabels.join(" | ")}`
            : "no blank non-file application fields detected",
          answeredLabels.length ? `answered fields: ${answeredLabels.join(" | ")}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
        preferredAction: APPLICATION_FIELDS_TOOL,
        connectorTool: APPLICATION_FIELDS_TOOL,
        connectorFieldKeys: fieldPaths,
        batchPlacement: "can_batch",
        verifyAfterAction: "adapter_group_current_value",
        currentValue: `${fillableFields.filter((field) => field.answered).length}/${fillableFields.length} answered`,
        answered: fillableFields.every((field) => field.answered),
        fieldTargets: fillableFields.map((field) => field.targetId),
        controlIds: unique(fillableFields.flatMap((field) => field.controlIds || [])),
      },
    ];
  }

  function eeocSectionGroups(fields) {
    const eeocFields = fields.filter(
      (field) => field.sectionKind === "eeoc" && field.eeocFieldKey,
    );
    if (!eeocFields.length) return [];

    const fieldKeys = eeocFields.map((field) => field.eeocFieldKey);
    const blankLabels = eeocFields
      .filter((field) => !field.answered)
      .map((field) => field.label);
    const answeredLabels = eeocFields
      .filter((field) => field.answered)
      .map((field) => `${field.label}: ${field.currentValue}`);

    return [
      {
        id: "ashby_eeoc_section",
        kind: "ashby_application_section",
        adapterId: ADAPTER_ID,
        targetId: EEOC_SECTION_TARGET_ID,
        sectionKind: "eeoc",
        label: "Ashby EEOC Self-Identification",
        text: [
          "Ashby EEOC section detected",
          `connector action available: ${EEOC_TOOL} with fieldValues for ${fieldKeys.join(", ")}`,
          "Use one ashby_fill_eeoc call for all explicit EEOC values present in runContext.myInfo or USER_GOAL; omit only unknown EEOC fields instead of inventing answers",
          ASHBY_RACE_INDIAN_HINT,
          blankLabels.length
            ? `blank sensitive EEOC fields: ${blankLabels.join(" | ")}`
            : "no blank sensitive EEOC fields detected",
          answeredLabels.length
            ? `answered sensitive EEOC fields: ${answeredLabels.join(" | ")}`
            : "",
        ]
          .filter(Boolean)
          .join(" | "),
        preferredAction: EEOC_TOOL,
        connectorTool: EEOC_TOOL,
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
          field.required &&
          !field.answered &&
          field.fieldKind !== "file" &&
          !field.sensitiveOptional,
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

      if (field.connectorTool) {
        const connectorInstruction =
          field.connectorTool === EEOC_TOOL
            ? `Prefer connector tool ${EEOC_TOOL} with fieldValues.${field.eeocFieldKey || field.fieldPath} for this Ashby EEOC field. Use only explicit sensitive values from runContext.myInfo or USER_GOAL; omit unknown fields.`
            : `Prefer connector tool ${APPLICATION_FIELDS_TOOL} with fieldValues.${field.fieldPath} for this Ashby non-file field. It fills text, choices, native selects, and autocomplete/combobox values in one action; batch all answerable non-file values in one call, including concise synthesized answers for normal questions. Do not fill/click this individual Ashby control directly while connector tools are expected.`;
        const connectorHint = {
          semanticRole:
            field.connectorTool === EEOC_TOOL
              ? "ashby_eeoc_connector_field"
              : "ashby_application_connector_field",
          preferredAction: field.connectorTool,
          connectorTool: field.connectorTool,
          connectorArgs: field.connectorArgs,
          exactValueMode: "connectorValue",
          avoidAction: true,
          safeFillTarget: false,
          observeAfterAction: false,
          batchPlacement: field.batchPlacement,
          stableFieldTargetId: field.targetId,
          machineKey:
            field.connectorTool === EEOC_TOOL
              ? field.eeocFieldKey || field.fieldPath
              : field.fieldPath,
          answerText: field.label,
          optionTexts: field.optionTexts || [],
          verifyAfterAction: field.verifyAfterAction,
          instruction: connectorInstruction,
        };

        for (const targetId of actionableControlIds(field.controlIds, controlsById, 4)) {
          addHint(actionHintsByTargetId, targetId, connectorHint);
        }
      }

      if (
        !field.connectorTool &&
        field.fillTargetId &&
        (!field.options?.length || field.fieldKind === "combobox")
      ) {
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
        const isConnectorManagedOption = Boolean(field.connectorTool && !isComboboxOption);
        const optionInstruction = option.selected
          ? "This Ashby option is already selected in adapter state; do not click it again unless the user asked to change it."
          : field.connectorTool === EEOC_TOOL
            ? `Sensitive optional Ashby EEOC option. Prefer ${EEOC_TOOL}; click only as fallback when this option matches an explicit value.`
            : field.connectorTool === APPLICATION_FIELDS_TOOL
              ? `Ashby option fallback. Prefer ${APPLICATION_FIELDS_TOOL} with fieldValues.${field.fieldPath}; click only if the connector is unavailable or failed.`
              : field.sensitiveOptional
                ? "Sensitive optional Ashby diversity option. Click only if USER_GOAL explicitly asks to answer this survey with this value."
            : "Click this Ashby option only if it is the desired answer. After one click, observe the next state and do not repeat it if adapter state shows it selected.";

        for (const targetId of targetIds) {
          addHint(actionHintsByTargetId, targetId, {
            semanticRole: isComboboxOption
              ? "ashby_autocomplete_option"
              : isConnectorManagedOption
                ? "ashby_connector_managed_option"
              : "ashby_application_option",
            preferredAction: isConnectorManagedOption
              ? field.connectorTool
              : "click",
            connectorTool: isConnectorManagedOption ? field.connectorTool : undefined,
            connectorArgs: isConnectorManagedOption
              ? {
                  ...(field.connectorArgs || {}),
                  value: option.optionText,
                }
              : undefined,
            exactValueMode: isConnectorManagedOption
              ? "connectorValue"
              : undefined,
            safeFillTarget: isConnectorManagedOption ? false : undefined,
            avoidAction: isConnectorManagedOption ? true : undefined,
            batchPlacement: isConnectorManagedOption ? field.batchPlacement : undefined,
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
      if (overrideSelector) enhanced.selector = overrideSelector;
      return enhanced;
    });
  }

  function optionSelectorForField(field, option) {
    if (!field?.fieldPath || !option?.optionEl) return "";
    const rootSelector = `[data-field-path="${cssEscape(field.fieldPath)}"]`;
    const tag = lower(option.optionEl.tagName);

    if (tag === "button") return `${rootSelector} button`;
    if (tag === "label") return `${rootSelector} label`;

    const role = lower(option.optionEl.getAttribute("role"));
    if (["radio", "checkbox", "option"].includes(role)) {
      return `${rootSelector} [role="${role}"]`;
    }

    if (option.optionEl.matches("[class*='_option']")) {
      return `${rootSelector} [class*='_option']`;
    }

    return "";
  }

  function buildSelectorOverrides(fields) {
    const overrides = {};
    for (const field of fields || []) {
      for (const option of field.options || []) {
        const selector = optionSelectorForField(field, option);
        if (!selector) continue;
        for (const controlId of option.controlIds || []) {
          if (controlId) overrides[controlId] = selector;
        }
      }
    }
    return overrides;
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

  function buildPlannerHints(fields, submitTargetId, uploadTargetIds, pageKind = "") {
    const selected = fields
      .filter((field) => field.selectedValue)
      .map((field) => `${field.label}: ${field.selectedValue}`)
      .slice(0, 10);
    const missingRequired = fields
      .filter(
        (field) =>
          field.required &&
          !field.answered &&
          field.fieldKind !== "file" &&
          !field.sensitiveOptional,
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
      pageKind === "application_form" ? ASHBY_APPLICATION_CONNECTOR_BATCH_HINT : "",
      ASHBY_FILL_KNOWN_VALUES_HINT,
      `Prefer ${APPLICATION_FIELDS_TOOL}(fieldValues) for all answerable non-file, non-EEOC Ashby fields in one connector action. It can fill text inputs, textareas, native selects, radio/checkbox choices, and Ashby autocomplete/combobox fields including location-style infinite dropdowns. Do not split explicit profile fields and synthesized normal answers across steps. ${ASHBY_APPLICATION_SYNTHESIS_HINT}`,
      `Prefer ${EEOC_TOOL}(fieldValues) for Ashby EEOC self-identification fields in one connector action. Include every explicit sensitive value available from runContext.myInfo or USER_GOAL in that single call; omit only genuinely unknown fields instead of inventing answers or choosing decline. ${ASHBY_RACE_INDIAN_HINT}`,
      "Ashby connector-managed fields are not normal fill/click targets. If an Ashby connector tool is missing from the callable tool list, do not directly fill/click those managed controls; report the missing connector tool or ask for review.",
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
        ? `Sensitive optional Ashby diversity fields are blank: ${blankSensitiveFields.join(" | ")}. Use ${EEOC_TOOL} for EEOC values that are explicitly present; otherwise leave unknown sensitive fields blank and mention them in done summaries.`
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
      "Ashby EEOC/policy copy is not actionable for the planner; rely on Ashby field groups, optionTexts, and connector tool schemas for the actual controls.",
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
          field.required &&
          !field.answered &&
          field.fieldKind !== "file" &&
          !field.sensitiveOptional,
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
      "Ashby progress rule: unknown fields are not blockers; fill all known/supported/safely synthesized fields first and summarize intentional blanks.",
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

  function isAshbyPolicyNoiseText(value) {
    const text = lower(value);
    if (!text) return false;

    return (
      /\bequal employment opportunity\b/.test(text) ||
      /\bcompletion is voluntary\b/.test(text) ||
      /\badverse treatment\b/.test(text) ||
      /\baffirmative action\b/.test(text) ||
      /\bconfidential file\b/.test(text) ||
      /\bfederal laws\b|\bexecutive orders\b|\bregulations\b/.test(text) ||
      /\bself-identification of veteran status\b/.test(text) ||
      /\bdisabled veteran\b|\brecently separated veteran\b/.test(text) ||
      /\bactive duty wartime\b|\bcampaign badge veteran\b/.test(text) ||
      /\barmed forces service medal veteran\b/.test(text) ||
      (text.length > 100 &&
        (/\ba person (of|having origins)\b/.test(text) ||
          /\bnot hispanic or latino\b/.test(text)))
    );
  }

  function filterPlannerNoiseList(items) {
    return (items || []).filter((item) => !isAshbyPolicyNoiseText(item));
  }

  function filterPlannerNoiseGroups(groups) {
    return (groups || []).filter(
      (group) =>
        !isAshbyPolicyNoiseText(
          [group?.label, group?.text, group?.heading].join(" "),
        ),
    );
  }

  function filterPlannerNoiseControls(controls) {
    return (controls || []).filter((control) => {
      if (control?.adapterHints?.[ADAPTER_ID]) return true;
      return !isAshbyPolicyNoiseText(
        [
          control?.label,
          control?.text,
          control?.title,
          control?.heading,
          control?.ariaLabel,
          control?.description,
        ].join(" "),
      );
    });
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
    const selectorOverrides = buildSelectorOverrides(fields);
    const pageKind = documentRef.querySelector(".ashby-application-form-container")
      ? "application_form"
      : "job_posting";
    const siteAdapter = {
      id: ADAPTER_ID,
      pageKind,
      applicationTargetId: APPLICATION_TARGET_ID,
      detectedFieldCount: fields.length,
      answeredFieldCount: fields.filter((field) => field.answered).length,
      missingRequiredCount: fields.filter(
        (field) =>
          field.required &&
          !field.answered &&
          field.fieldKind !== "file" &&
          !field.sensitiveOptional,
      ).length,
      submitTargetId,
      uploadTargetIds,
      primaryControlIds,
      actionHintsByTargetId,
      selectorOverrides,
    };
    siteAdapter.plannerHints = buildPlannerHints(
      fields,
      submitTargetId,
      uploadTargetIds,
      pageKind,
    );
    siteAdapter.groups = [
      applicationGroup(fields, siteAdapter),
      ...applicationFillGroups(fields),
      ...eeocSectionGroups(fields),
      ...fieldGroups(sortFieldsForPlanner(fields)),
      ...selectedOptionGroups(fields),
    ].slice(0, 140);
    siteAdapter.visibleTextSummary = buildVisibleTextSummary(fields, siteAdapter);
    return siteAdapter;
  }

  // ---------------------------------------------------------------------------
  // Connector tools: ashby_fill_application_fields and ashby_fill_eeoc.
  // Keep these executors on the same DOM model as enhanceState so planner state
  // and runner behavior agree after a fresh extraction.
  // ---------------------------------------------------------------------------

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const SELECT_STOP_WORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "do",
    "does",
    "had",
    "has",
    "have",
    "i",
    "in",
    "is",
    "of",
    "or",
    "past",
    "the",
    "to",
  ]);

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

  function isLocationFieldKey(fieldKey = "") {
    return /location|city|country|state|where/.test(canonicalSelectText(fieldKey));
  }

  function locationAliasesFor(value) {
    const key = canonicalSelectText(value);
    if (!key) return [];

    const aliases = [];
    if (/\bunited states\b|\busa\b|\bus\b|\bamerica\b/.test(key)) {
      aliases.push("United States", "USA", "US");
    }
    if (/\bindia\b/.test(key)) aliases.push("India");

    const tokens = key.split(" ").filter(Boolean);
    for (let index = 0; index < tokens.length; index += 1) {
      const stateName = US_STATE_NAMES[tokens[index]];
      if (!stateName) continue;

      const before = tokens.slice(0, index).join(" ");
      const after = tokens.slice(index + 1).join(" ");
      const expanded = [before, stateName, after].filter(Boolean).join(" ");
      aliases.push(expanded);
      if (before) {
        aliases.push(`${before}, ${stateName}, United States`);
        aliases.push(`${before} ${stateName} united states`);
      }
    }

    return unique(aliases);
  }

  function fieldValueAliases(fieldKey, value) {
    const key = canonicalSelectText(value);
    const aliases = [];

    if (isLocationFieldKey(fieldKey)) {
      aliases.push(...locationAliasesFor(value));
    }

    if (/\bvirginia\b/.test(key) && /\btech\b/.test(key)) {
      aliases.push(
        "Virginia Tech",
        "Virginia Polytechnic Institute and State University",
      );
    }

    if (/\b(bachelor|bachelors|bs|bsc|science)\b/.test(key)) {
      aliases.push(
        "Bachelor's Degree",
        "Bachelors Degree",
        "Bachelor of Science",
        "Bachelor",
      );
    }

    if (fieldKey === "gender") {
      if (/\bmale\b/.test(key) && !/\bfemale\b/.test(key)) aliases.push("Male");
      if (/\bfemale\b|\bwoman\b/.test(key)) aliases.push("Female");
      if (/prefer|decline|dont want|do not want|self identify/.test(key)) {
        aliases.push("Decline to self-identify");
      }
    }

    if (fieldKey === "race") {
      if (/\bhispanic\b|\blatino\b/.test(key)) aliases.push("Hispanic or Latino");
      if (/\bwhite\b/.test(key)) aliases.push("White (Not Hispanic or Latino)");
      if (/\bblack\b|\bafrican american\b/.test(key)) {
        aliases.push("Black or African American (Not Hispanic or Latino)");
      }
      if (
        /\basian\b/.test(key) ||
        /\bsouth asian\b/.test(key) ||
        /\basian indian\b/.test(key) ||
        (/\bindia(?:n)?\b/.test(key) &&
          !/\b(american indian|native american|alaska native)\b/.test(key))
      ) {
        aliases.push("Asian (Not Hispanic or Latino)");
      }
      if (/\bnative hawaiian\b|\bpacific islander\b/.test(key)) {
        aliases.push(
          "Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)",
        );
      }
      if (/\bamerican indian\b|\balaska native\b/.test(key)) {
        aliases.push("American Indian or Alaska Native (Not Hispanic or Latino)");
      }
      if (/\btwo\b.*\bmore\b|\bmultiple races\b/.test(key)) {
        aliases.push("Two or More Races (Not Hispanic or Latino)");
      }
      if (/prefer|decline|dont want|do not want|self identify/.test(key)) {
        aliases.push("Decline to self-identify");
      }
    }

    if (fieldKey === "veteran_status") {
      if (/not.*protected.*veteran|no.*veteran|not.*veteran/.test(key)) {
        aliases.push("I am not a protected veteran", "Not a protected veteran");
      } else if (/protected.*veteran/.test(key)) {
        aliases.push(
          "I identify as one or more of the classifications of protected veteran listed above",
          "I identify as one or more of the classifications of protected veteran",
        );
      } else if (/prefer|decline|dont want|do not want|self identify/.test(key)) {
        aliases.push("I decline to self-identify for protected veteran status");
      }
    }

    if (fieldKey === "disability_status") {
      if (/\bno\b/.test(key) && /\bdisab/.test(key)) {
        aliases.push(
          "No, I do not have a disability and have not had one in the past",
          "No disability",
        );
      } else if (/\byes\b/.test(key) && /\bdisab/.test(key)) {
        aliases.push(
          "Yes, I have a disability, or have had one in the past",
          "Yes disability",
        );
      } else if (/prefer|decline|dont want|do not want/.test(key)) {
        aliases.push("I do not want to answer");
      }
    }

    return unique(aliases);
  }

  function searchQueriesFor(fieldKey, value) {
    const queries = [value, ...fieldValueAliases(fieldKey, value)];
    const tokens = selectTokens(value);

    if (tokens.includes("virginia")) queries.push("Virginia");
    if (tokens.includes("bachelor") || tokens.includes("bachelors")) {
      queries.push("Bachelor");
    }
    if (fieldKey === "race" && tokens.length) queries.push(tokens[0]);
    if (fieldKey === "veteran_status" && tokens.includes("veteran")) {
      queries.push("veteran");
    }
    if (fieldKey === "disability_status" && tokens.includes("no")) {
      queries.push("No");
    }

    return unique(
      queries
        .map((query) => normalizeText(query))
        .filter(Boolean)
        .slice(0, 8),
    );
  }

  function scoreOptionText(optionText, value, fieldKey = "") {
    const optionKey = canonicalSelectText(optionText);
    const wantedKey = canonicalSelectText(value);
    if (!optionKey || !wantedKey) return 0;
    if (optionKey === wantedKey) return 1000;
    if (fieldKey === "gender" && wantedKey === "male") {
      return optionKey === "male" ? 1000 : 0;
    }
    if (isLocationFieldKey(fieldKey)) {
      const locationAliases = locationAliasesFor(value).map(canonicalSelectText);
      for (const aliasKey of locationAliases) {
        if (!aliasKey) continue;
        if (optionKey === aliasKey) return 1000;
        if (optionKey.startsWith(aliasKey)) return 960;
        if (optionKey.includes(aliasKey)) return 930;
      }
    }
    if (
      fieldKey === "race" &&
      /\bindia(?:n)?\b/.test(wantedKey) &&
      !/\b(american indian|native american|alaska native)\b/.test(wantedKey)
    ) {
      if (/\basian\b/.test(optionKey)) return 1000;
      if (/\bamerican indian\b|\balaska native\b/.test(optionKey)) return 0;
    }

    for (const alias of fieldValueAliases(fieldKey, value)) {
      const aliasKey = canonicalSelectText(alias);
      if (!aliasKey) continue;
      if (optionKey === aliasKey) return 980;
      if (optionKey.startsWith(aliasKey)) return 940;
      if (optionKey.includes(aliasKey)) return 900;
      if (aliasKey.includes(optionKey) && optionKey.length >= 5) return 850;
    }

    if (optionKey.startsWith(wantedKey)) return 830;
    if (wantedKey.length >= 4 && optionKey.includes(wantedKey)) return 780;

    const wantedTokens = selectTokens(value);
    const optionTokens = new Set(selectTokens(optionText));
    const overlap = wantedTokens.filter((token) => optionTokens.has(token));
    let score = overlap.length * 120;

    if (wantedTokens.length && overlap.length === wantedTokens.length) score += 220;
    if (fieldKey === "race" && optionTokens.has("not") && optionTokens.has("hispanic")) {
      score += 80;
    }
    if (
      fieldKey === "veteran_status" &&
      wantedTokens.includes("veteran") &&
      (wantedTokens.includes("no") || wantedTokens.includes("not")) &&
      optionTokens.has("not") &&
      optionTokens.has("veteran")
    ) {
      score += 520;
    }
    if (
      fieldKey === "disability_status" &&
      wantedTokens.includes("no") &&
      wantedTokens.some((token) => token.startsWith("disab")) &&
      optionTokens.has("no") &&
      [...optionTokens].some((token) => token.startsWith("disab"))
    ) {
      score += 520;
    }
    if (
      wantedTokens.includes("virginia") &&
      wantedTokens.includes("tech") &&
      optionTokens.has("virginia") &&
      (optionTokens.has("tech") || optionTokens.has("polytechnic"))
    ) {
      score += 520;
    }

    return score;
  }

  function valuesEquivalent(observedValue, expectedValue, fieldKey = "") {
    return scoreOptionText(observedValue, expectedValue, fieldKey) >= 450;
  }

  function matchOption(options, value, fieldKey = "") {
    let best = null;
    let secondScore = 0;

    for (const option of options || []) {
      const score = scoreOptionText(option.text || option.optionText, value, fieldKey);
      if (!best || score > best.score) {
        secondScore = best?.score || 0;
        best = { ...option, score };
      } else if (score > secondScore) {
        secondScore = score;
      }
    }

    if (!best || best.score < 450) return null;
    if (best.score < 900 && secondScore && best.score - secondScore < 80) {
      return null;
    }
    return best;
  }

  function collectRuntimeFields(documentRef = document) {
    return collectFieldRoots(documentRef)
      .map((root, index) => {
        const question = questionText(root);
        const input = findPrimaryInput(root);
        const fieldPath = fieldPathFor(root, input, question, index);
        const eeocSpec = eeocFieldSpecFor(question, fieldPath);
        const hasCombobox = fieldHasCombobox(root, []);
        const options = hasCombobox ? [] : collectOptionInfos(root, [], question);
        const kind = fieldKind(root, options.length, hasCombobox);
        return {
          root,
          input,
          question,
          fieldPath,
          fieldKey: eeocSpec?.fieldKey || fieldPath,
          eeocFieldKey: eeocSpec?.fieldKey || "",
          sectionKind: eeocSpec ? "eeoc" : "application",
          fieldKind: kind,
          options,
        };
      })
      .filter((field) => field.question && field.fieldPath);
  }

  function connectorApplicationFields(documentRef = document) {
    return collectRuntimeFields(documentRef).filter(
      (field) => field.sectionKind !== "eeoc" && field.fieldKind !== "file",
    );
  }

  function connectorEeocFields(documentRef = document) {
    return collectRuntimeFields(documentRef).filter(
      (field) => field.sectionKind === "eeoc" && field.eeocFieldKey,
    );
  }

  function fieldSchemaDescription(field) {
    const optionText = (field.options || [])
      .map((option) => option.optionText)
      .filter(Boolean)
      .slice(0, 8)
      .join(", ");
    return truncate(
      [
        field.question,
        `kind: ${field.fieldKind}`,
        optionText ? `options: ${optionText}` : "",
        "for normal non-sensitive questions, synthesize from My Info/resume/job context when a literal value is not provided",
      ]
        .filter(Boolean)
        .join("; "),
      240,
    );
  }

  function eeocFieldSchemaDescription(field) {
    const optionText = (field.options || [])
      .map((option) => option.optionText)
      .filter(Boolean)
      .slice(0, 10)
      .join(", ");
    const special =
      field.eeocFieldKey === "race"
        ? ASHBY_RACE_INDIAN_HINT
        : field.eeocFieldKey === "veteran_status"
          ? "If runContext.myInfo says not a veteran, use I am not a protected veteran."
          : field.eeocFieldKey === "disability_status"
            ? "If runContext.myInfo says no disability, use the Ashby no-disability option."
            : "";
    return truncate(
      [
        `Explicit answer for ${field.question}.`,
        optionText ? `Available options: ${optionText}.` : "",
        special,
        "Omit when unknown.",
      ]
        .filter(Boolean)
        .join(" "),
      360,
    );
  }

  function provideTools({ document: documentRef }) {
    const applicationFields = connectorApplicationFields(documentRef || document);
    const eeocFields = connectorEeocFields(documentRef || document);
    const tools = [];

    if (applicationFields.length) {
      const mapping = applicationFields
        .map((field) => `${field.fieldPath} = "${truncate(field.question, 80)}"`)
        .join("; ");
      const fieldValueProperties = {};
      for (const field of applicationFields) {
        fieldValueProperties[field.fieldPath] = {
          type: "string",
          description: fieldSchemaDescription(field),
        };
      }

      tools.push({
        type: "function",
        name: APPLICATION_FIELDS_TOOL,
        description: truncate(
          "Fill all answerable non-file Ashby application fields in ONE step, including concise synthesized answers for normal non-sensitive questions. Provide fieldValues keyed by fieldPath. " +
            "This connector fills text inputs, textareas, native selects, radio/checkbox choices, and Ashby autocomplete/combobox dropdowns. " +
            ASHBY_APPLICATION_SYNTHESIS_HINT +
            " " +
            ASHBY_FILL_KNOWN_VALUES_HINT +
            " Omit resume/CV/file attachments and EEOC fields. fieldPath -> label: " +
            mapping,
          1200,
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
                "Object keyed by Ashby fieldPath. Include every known or safely synthesized value now; do not omit known fields just because other fields are unknown. Generated text must be complete and never truncated mid-word or mid-sentence.",
            },
          },
          required: ["fieldValues"],
          additionalProperties: false,
        },
      });
    }

    if (eeocFields.length) {
      const mapping = eeocFields
        .map((field) => `${field.eeocFieldKey} = "${truncate(field.question, 80)}"`)
        .join("; ");
      const fieldValueProperties = {};
      for (const field of eeocFields) {
        fieldValueProperties[field.eeocFieldKey] = {
          type: "string",
          description: eeocFieldSchemaDescription(field),
        };
      }

      tools.push({
        type: "function",
        name: EEOC_TOOL,
        description: truncate(
          "Fill multiple Ashby EEOC self-identification fields in ONE step. Include every explicit sensitive value available from runContext.myInfo or USER_GOAL in one call. " +
            "Omit only genuinely unknown fields; do not invent values or choose decline/prefer-not-to-answer unless explicit. " +
            ASHBY_FILL_KNOWN_VALUES_HINT +
            " " +
            ASHBY_RACE_INDIAN_HINT +
            " " +
            "The connector matches values against live options and commits each field. fieldKey -> label: " +
            mapping,
          1200,
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
                "Object keyed by Ashby EEOC fieldKey. Include only explicit values.",
            },
          },
          required: ["fieldValues"],
          additionalProperties: false,
        },
      });
    }

    return tools;
  }

  function fieldValuesFromAction(action) {
    const source =
      action?.fieldValues &&
      typeof action.fieldValues === "object" &&
      !Array.isArray(action.fieldValues)
        ? action.fieldValues
        : action || {};
    const fieldValues = {};

    for (const [fieldKey, value] of Object.entries(source || {})) {
      const key = normalizeText(fieldKey);
      const text = normalizeText(value);
      if (key && text) fieldValues[key] = text;
    }

    return fieldValues;
  }

  function locateRuntimeField(fieldKey, options = {}) {
    const key = normalizeText(fieldKey);
    if (!key) return null;

    const fields = collectRuntimeFields(document);
    return (
      fields.find((field) => {
        if (options.eeocOnly && field.sectionKind !== "eeoc") return false;
        return (
          field.fieldPath === key ||
          field.fieldKey === key ||
          field.eeocFieldKey === key
        );
      }) || null
    );
  }

  function fieldCurrentValue(field) {
    if (!field) return "";
    if (field.fieldKind === "file") return fileValueForField(field.root);
    if (field.fieldKind === "select") return selectValueForField(field.root);
    if (field.fieldKind === "combobox") return textValueForField(field.root);
    if (isYesNoFieldRoot(field.root)) return yesNoSelectedValue(field.root);
    if (field.options?.length) return selectedValueFromOptions(field.options);
    return textValueForField(field.root);
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

  function dispatchComboboxInput(input, value) {
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

  function readComboboxOptions(input, root) {
    const linkedOptions = comboboxLinkedOptionElements(input);
    const portalOptions = floatingPortalOptionElements();
    const optionElements = linkedOptions.length
      ? linkedOptions
      : portalOptions.length
        ? portalOptions
      : getVisibleElements("[role='option']", root || document).length
        ? getVisibleElements("[role='option']", root || document)
        : getVisibleElements("[role='option']", document);

    return optionElements
      .map((el) => ({ el, text: normalizeText(textContent(el)) }))
      .filter((option) => option.text);
  }

  function optionsSignature(options) {
    return (options || [])
      .map((option) => canonicalSelectText(option.text))
      .join("|");
  }

  async function waitForComboboxOptions(input, root, previousSignature = "") {
    let latest = readComboboxOptions(input, root);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const signature = optionsSignature(latest);
      if (latest.length && (!previousSignature || signature !== previousSignature)) {
        return latest;
      }
      await delay(100);
      latest = readComboboxOptions(input, root);
    }
    return latest;
  }

  async function searchComboboxOptions(input, root, fieldKey, value) {
    const startingSignature = optionsSignature(readComboboxOptions(input, root));
    let latest = readComboboxOptions(input, root);

    for (const query of searchQueriesFor(fieldKey, value)) {
      dispatchComboboxInput(input, query);
      latest = await waitForComboboxOptions(input, root, startingSignature);
      if (matchOption(latest, value, fieldKey)) return latest;
    }

    return latest;
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

  async function fillComboboxField(field, value, ctx) {
    const click = ctx?.primitives?.clickElement;
    const input = field.input;
    const fieldKey = field.fieldKey || field.fieldPath;
    if (!input || !isComboboxInput(input)) {
      return { ok: false, detail: `No Ashby combobox input for ${fieldKey}.` };
    }
    if (typeof click !== "function") {
      return { ok: false, detail: `${APPLICATION_FIELDS_TOOL} runner click primitive unavailable.` };
    }

    const already = fieldCurrentValue(field);
    if (already && valuesEquivalent(already, value, fieldKey)) {
      return {
        ok: true,
        committed: true,
        value: already,
        detail: `${fieldKey} already set to "${already}".`,
      };
    }

    await click(input);
    input.focus?.();
    await delay(150);

    let options = await waitForComboboxOptions(input, field.root);
    if (!options.length) {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
      await delay(150);
      options = await waitForComboboxOptions(input, field.root);
    }
    if (!options.length || !matchOption(options, value, fieldKey)) {
      options = await searchComboboxOptions(input, field.root, fieldKey, value);
    }

    const match = matchOption(options, value, fieldKey);
    if (!match) {
      closeCombobox(input);
      return {
        ok: false,
        recoverable: true,
        continueBatch: true,
        detail: `No Ashby combobox option matching "${value}" for ${fieldKey}.`,
        options: options.map((option) => option.text).slice(0, 12),
      };
    }

    await click(match.el);
    await delay(250);

    const committedValue = fieldCurrentValue({
      ...field,
      options: [],
    }) || match.text;
    return {
      ok: true,
      committed: true,
      value: committedValue,
      equivalentValues: unique([value, match.text, committedValue]),
      detail: `Set ${fieldKey} to "${match.text}".`,
    };
  }

  function requestedChoiceValues(value, multiSelect = false) {
    if (Array.isArray(value)) {
      return value.map(normalizeText).filter(Boolean);
    }
    const text = normalizeText(value);
    if (!text) return [];
    if (!multiSelect) return [text];
    return text
      .split(/\s*(?:;|\|)\s*/g)
      .map(normalizeText)
      .filter(Boolean);
  }

  function desiredBoolean(value) {
    if (typeof value === "boolean") return value;
    const key = canonicalSelectText(value);
    if (/^(yes|true|checked|selected|on)$/.test(key)) return true;
    if (/^(no|false|unchecked|unselected|off)$/.test(key)) return false;
    return null;
  }

  function desiredYesNoKey(value) {
    if (typeof value === "boolean") return value ? "yes" : "no";
    const key = canonicalSelectText(value);
    if (/^(yes|true|checked|selected|on)$/.test(key)) return "yes";
    if (/^(no|false|unchecked|unselected|off)$/.test(key)) return "no";
    if (/\byes\b/.test(key) && !/\bno\b/.test(key)) return "yes";
    if (/\bno\b/.test(key) && !/\byes\b/.test(key)) return "no";
    return "";
  }

  async function fillYesNoField(field, value, ctx) {
    const click = ctx?.primitives?.clickElement;
    if (typeof click !== "function") {
      return { ok: false, detail: `${APPLICATION_FIELDS_TOOL} runner click primitive unavailable.` };
    }

    const fieldKey = field.fieldKey || field.fieldPath;
    const requestedKey = desiredYesNoKey(value);
    const buttons = yesNoButtonsForRoot(field.root);
    if (!requestedKey || buttons.length < 2) {
      return {
        ok: false,
        recoverable: true,
        continueBatch: true,
        detail: `No yes/no value matching "${value}" for ${fieldKey}.`,
        options: buttons.map(textContent),
      };
    }

    const existing = yesNoSelectedValue(field.root);
    if (existing && lower(existing) === requestedKey) {
      return {
        ok: true,
        committed: true,
        value: existing,
        detail: `${fieldKey} already set to "${existing}".`,
      };
    }

    const button = buttons.find((candidate) => lower(textContent(candidate)) === requestedKey);
    if (!button) {
      return {
        ok: false,
        recoverable: true,
        continueBatch: true,
        detail: `No Ashby yes/no button matching "${value}" for ${fieldKey}.`,
        options: buttons.map(textContent),
      };
    }

    await click(button);
    let committedValue = yesNoSelectedValue(field.root);
    for (let attempt = 0; attempt < 6 && lower(committedValue) !== requestedKey; attempt += 1) {
      await delay(100);
      committedValue = yesNoSelectedValue(field.root);
    }

    const committed = lower(committedValue) === requestedKey;
    return {
      ok: committed,
      recoverable: !committed,
      continueBatch: !committed,
      committed,
      value: committedValue || textContent(button),
      detail: committed
        ? `Set ${fieldKey} to "${committedValue}".`
        : `Clicked ${fieldKey} "${textContent(button)}", but Ashby did not report it selected yet.`,
      options: buttons.map(textContent),
    };
  }

  async function fillChoiceField(field, value, ctx) {
    const click = ctx?.primitives?.clickElement;
    if (typeof click !== "function") {
      return { ok: false, detail: `${APPLICATION_FIELDS_TOOL} runner click primitive unavailable.` };
    }

    const fieldKey = field.fieldKey || field.fieldPath;
    if (isYesNoFieldRoot(field.root)) return fillYesNoField(field, value, ctx);

    const options = collectOptionInfos(field.root, [], field.question)
      .map((option) => ({
        ...option,
        text: option.optionText,
      }));
    const values = requestedChoiceValues(value, field.fieldKind === "multi_select");
    if (!values.length) {
      return { ok: false, detail: `No requested value for ${fieldKey}.` };
    }

    const committed = {};
    const failed = [];
    for (const requestedValue of values) {
      const already = options.find(
        (option) =>
          option.selected &&
          valuesEquivalent(option.optionText, requestedValue, fieldKey),
      );
      if (already) {
        committed[fieldKey] = already.optionText;
        continue;
      }

      const match = matchOption(options, requestedValue, fieldKey);
      if (!match?.optionEl) {
        failed.push(requestedValue);
        continue;
      }

      await click(match.optionEl);
      await delay(150);
      committed[fieldKey] = match.optionText || match.text || requestedValue;

      if (field.fieldKind !== "multi_select") break;
    }

    if (failed.length) {
      return {
        ok: Object.keys(committed).length > 0,
        recoverable: true,
        continueBatch: true,
        committed: false,
        value: Object.values(committed).join(", "),
        detail: `Some Ashby options did not match for ${fieldKey}: ${failed.join(", ")}.`,
        options: options.map((option) => option.optionText).slice(0, 12),
      };
    }

    return {
      ok: true,
      committed: true,
      value: Object.values(committed).join(", "),
      detail: `Set ${fieldKey} to ${Object.values(committed).join(", ")}.`,
    };
  }

  async function fillCheckboxField(field, value, ctx) {
    const click = ctx?.primitives?.clickElement;
    const desired = desiredBoolean(value);
    const input = field.root.querySelector("input[type='checkbox']");
    if (desired === null || !input) return fillChoiceField(field, value, ctx);
    if (typeof click !== "function") {
      return { ok: false, detail: `${APPLICATION_FIELDS_TOOL} runner click primitive unavailable.` };
    }

    if (Boolean(input.checked) !== desired) {
      await click(labelElementForInput(field.root, input) || input);
      await delay(150);
    }

    return {
      ok: true,
      committed: Boolean(input.checked) === desired,
      value: Boolean(input.checked) ? "true" : "false",
      detail: `Set ${field.fieldKey || field.fieldPath} checkbox to ${Boolean(input.checked)}.`,
    };
  }

  async function fillNativeOrTextField(field, value, ctx) {
    const fill = ctx?.primitives?.fillElement;
    const input = field.input || findPrimaryInput(field.root);
    if (!input) {
      return { ok: false, detail: `No fillable Ashby input for ${field.fieldPath}.` };
    }
    if (typeof fill !== "function") {
      return { ok: false, detail: `${APPLICATION_FIELDS_TOOL} runner fill primitive unavailable.` };
    }

    const current = fieldCurrentValue(field);
    if (current && valuesEquivalent(current, value, field.fieldKey || field.fieldPath)) {
      return {
        ok: true,
        committed: true,
        value: current,
        detail: `${field.fieldPath} already set to "${current}".`,
      };
    }

    await fill(input, value);
    await delay(120);
    const committedValue = fieldCurrentValue(field) || normalizeText(value);

    return {
      ok: true,
      committed: true,
      value: committedValue,
      detail: `Filled ${field.fieldPath}.`,
    };
  }

  async function fillRuntimeField(fieldKey, value, ctx, options = {}) {
    const field = locateRuntimeField(fieldKey, options);
    if (!field) {
      return {
        ok: false,
        recoverable: true,
        continueBatch: true,
        detail: `No Ashby field found for ${fieldKey}.`,
      };
    }
    if (field.fieldKind === "file") {
      return {
        ok: false,
        recoverable: true,
        continueBatch: true,
        skipped: true,
        detail: `Skipped Ashby file/upload field ${fieldKey}.`,
      };
    }

    if (field.fieldKind === "combobox") return fillComboboxField(field, value, ctx);
    if (field.fieldKind === "checkbox") return fillCheckboxField(field, value, ctx);
    if (field.fieldKind === "select") return fillNativeOrTextField(field, value, ctx);
    if (field.options?.length || /^(single_select|multi_select)$/.test(field.fieldKind)) {
      return fillChoiceField(field, value, ctx);
    }
    return fillNativeOrTextField(field, value, ctx);
  }

  function fieldTargetForResult(fieldKey, eeocOnly = false) {
    const field = locateRuntimeField(fieldKey, { eeocOnly });
    if (!field) return null;
    return {
      groupTargetId: fieldTargetId(field.fieldPath),
      matchedBy: field.eeocFieldKey && field.eeocFieldKey === fieldKey
        ? "eeocFieldKey"
        : "fieldPath",
      matchMode: "ashby_runtime_field",
      controlIds: [],
    };
  }

  async function ashbyFillFieldValues(action, ctx, options = {}) {
    const requestedFieldValues = fieldValuesFromAction(action);
    const entries = Object.entries(requestedFieldValues);
    const toolName = options.eeocOnly ? EEOC_TOOL : APPLICATION_FIELDS_TOOL;

    if (!entries.length) {
      return {
        ok: false,
        detail: `${toolName} requires at least one fieldValues entry.`,
      };
    }

    const results = [];
    const committedFieldValues = {};
    const fieldTargets = {};
    const failed = [];
    const skipped = [];

    for (const [fieldKey, value] of entries) {
      const result = await fillRuntimeField(fieldKey, value, ctx, {
        eeocOnly: Boolean(options.eeocOnly),
      });
      const ok = result.ok !== false;
      const target = fieldTargetForResult(fieldKey, Boolean(options.eeocOnly));
      if (target) fieldTargets[fieldKey] = target;

      results.push({
        fieldKey,
        requestedValue: value,
        ok,
        committed: Boolean(result.committed),
        value: result.value || "",
        detail: result.detail || "",
        options: result.options || undefined,
      });

      if (result.skipped) {
        skipped.push(fieldKey);
      } else if (!ok) {
        failed.push(fieldKey);
      } else {
        committedFieldValues[fieldKey] = result.value || value;
      }
    }

    const committedCount = Object.keys(committedFieldValues).length;
    return {
      ok: committedCount > 0 || (entries.length > 0 && !failed.length),
      recoverable: failed.length > 0,
      continueBatch: failed.length > 0,
      committed: failed.length === 0,
      fieldValues: committedFieldValues,
      fieldTargets,
      failed,
      skipped,
      results,
      detail: failed.length
        ? `${toolName} filled ${committedCount} field(s); ${failed.length} field(s) need fallback.`
        : `${toolName} filled ${committedCount} field(s).`,
    };
  }

  async function ashbyFillApplicationFields(action, ctx) {
    return ashbyFillFieldValues(action, ctx, { eeocOnly: false });
  }

  async function ashbyFillEeoc(action, ctx) {
    return ashbyFillFieldValues(action, ctx, { eeocOnly: true });
  }

  if (
    globalThis.WebGPTConnectorTools &&
    typeof globalThis.WebGPTConnectorTools.register === "function"
  ) {
    globalThis.WebGPTConnectorTools.register(
      APPLICATION_FIELDS_TOOL,
      ashbyFillApplicationFields,
    );
    globalThis.WebGPTConnectorTools.register(EEOC_TOOL, ashbyFillEeoc);
  }

  registry.register({
    id: ADAPTER_ID,
    priority: 85,
    provideTools,
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
          ...filterPlannerNoiseList(state.visibleTextSummary || []),
        ].slice(0, 80),
        groups: [
          ...siteAdapter.groups,
          ...filterPlannerNoiseGroups(state.groups || []),
        ],
        controls: filterPlannerNoiseControls(
          enhanceControls(
            state.controls || [],
            siteAdapter.actionHintsByTargetId || {},
            siteAdapter.selectorOverrides || {},
          ),
        ),
      };
    },
  });
})();
