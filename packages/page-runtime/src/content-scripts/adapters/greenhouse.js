(function () {
  const ADAPTER_ID = "greenhouse.application";
  const APPLICATION_TARGET_ID = `site:${ADAPTER_ID}:application`;
  const APPLICATION_FIELDS_TOOL = "greenhouse_fill_application_fields";
  const READ_JOB_DESCRIPTION_TOOL = "greenhouse_read_job_description";
  const READ_APPLICATION_OPERATION = "greenhouse_read_application";
  const UPLOAD_APPLICATION_FILE_TOOL = "greenhouse_upload_application_file";
  const SUBMIT_APPLICATION_TOOL = "greenhouse_submit_application";
  const SELECT_TOOL = "greenhouse_fill_select";
  const EEOC_TOOL = "greenhouse_fill_eeoc";
  const EEOC_SECTION_TARGET_ID = `site:${ADAPTER_ID}:section:eeoc`;
  const COVER_LETTER_TARGET_ID = `site:${ADAPTER_ID}:cover_letter`;
  const EEOC_FIELD_SPECS = [
    { fieldKey: "gender", label: "Gender" },
    { fieldKey: "hispanic_ethnicity", label: "Are you Hispanic/Latino?" },
    { fieldKey: "race", label: "Please identify your race" },
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

  function utf8Bytes(value) {
    const text = String(value || "");
    if (typeof globalThis.TextEncoder === "function") {
      return new globalThis.TextEncoder().encode(text);
    }
    const encoded = unescape(encodeURIComponent(text));
    return Uint8Array.from(encoded, (character) => character.charCodeAt(0));
  }

  async function committedValueEvidence(value) {
    const normalizedValue = normalizeText(value);
    const bytes = utf8Bytes(normalizedValue);
    if (globalThis.crypto?.subtle?.digest) {
      try {
        const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
        return {
          normalizedLength: normalizedValue.length,
          utf8ByteLength: bytes.byteLength,
          digestAlgorithm: "sha256",
          digest: Array.from(new Uint8Array(hash), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(""),
        };
      } catch {
        /* Fall through to a deterministic digest in older page realms. */
      }
    }

    let hash = 0xcbf29ce484222325n;
    for (const byte of bytes) {
      hash ^= BigInt(byte);
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return {
      normalizedLength: normalizedValue.length,
      utf8ByteLength: bytes.byteLength,
      digestAlgorithm: "fnv1a64",
      digest: hash.toString(16).padStart(16, "0"),
    };
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

  function coverLetterTextarea(documentRef = document) {
    const form = applicationForm(documentRef);
    return (
      form?.querySelector("textarea#cover_letter_text, textarea[name='cover_letter_text']") ||
      null
    );
  }

  function coverLetterRootForElement(el, documentRef = document) {
    if (!el || !(el instanceof Element)) return null;
    const form = applicationForm(documentRef);
    const root =
      el.closest(".field-wrapper") ||
      el.closest("[data-field-path]") ||
      el.closest("section") ||
      null;
    return root && form?.contains(root) ? root : null;
  }

  function isCoverLetterArea(el, documentRef = document) {
    const root = coverLetterRootForElement(el, documentRef);
    return /\bcover letter\b/i.test(textContent(root || el));
  }

  function findCoverLetterManualButton(documentRef = document) {
    const form = applicationForm(documentRef);
    if (!form) return null;

    const candidates = getVisibleElements(
      "button, [role='button'], label, a",
      form,
    ).filter((el) => /\benter manually\b/i.test(textContent(el)));

    return candidates.find((el) => isCoverLetterArea(el, documentRef)) || null;
  }

  function coverLetterEntryInfo(state, documentRef = document) {
    const textarea = coverLetterTextarea(documentRef);
    const manualButton = findCoverLetterManualButton(documentRef);
    if (!textarea && !manualButton) return null;

    const controls = state?.controls || [];
    const textareaControl = findControlForElement(controls, textarea);
    const manualControl = findControlForElement(controls, manualButton);
    const currentText = normalizeText(
      textarea?.value || textarea?.getAttribute("value") || "",
    );

    return {
      targetId: COVER_LETTER_TARGET_ID,
      label: "Cover Letter",
      textareaControlId: textareaControl?.id || "",
      manualControlId: manualControl?.id || "",
      controlIds: unique([manualControl?.id, textareaControl?.id]),
      hasTextarea: Boolean(textarea),
      hasManualButton: Boolean(manualButton),
      answered: Boolean(currentText),
      currentValue: currentText
        ? truncate(currentText, 360)
        : textarea
          ? "manual textarea blank"
          : "manual entry collapsed",
    };
  }

  function metadataContent(documentRef, selector) {
    return normalizeText(documentRef.querySelector(selector)?.getAttribute("content"));
  }

  function jobTitleMetadata(documentRef) {
    const candidates = unique([
      metadataContent(documentRef, "meta[property='og:title']"),
      normalizeText(documentRef.title),
    ]);
    for (const raw of candidates) {
      const match = raw.match(
        /^Job Application for\s+(.+?)\s+at\s+(.+?)(?:\s*[|\u2022]\s*.*)?$/i,
      );
      if (match) {
        return {
          title: normalizeText(match[1]),
          company: normalizeText(match[2]),
        };
      }
    }
    return { title: "", company: "" };
  }

  function firstJobPageText(documentRef, selectors) {
    const form = applicationForm(documentRef);
    for (const selector of selectors) {
      const el = documentRef.querySelector(selector);
      if (!el || form?.contains(el)) continue;
      const value = normalizeText(textContent(el));
      if (value) return value;
    }
    return "";
  }

  function jobDescriptionDomText(root) {
    if (!root) return "";
    const clone = root.cloneNode(true);
    for (const el of clone.querySelectorAll(
      [
        "form",
        "#application-form",
        ".application--form",
        ".application--questions",
        ".application--submit",
        "script",
        "style",
        "noscript",
      ].join(","),
    )) {
      el.remove();
    }

    let result = "";
    const blockTags = new Set([
      "article", "blockquote", "div", "h1", "h2", "h3", "h4", "h5",
      "h6", "li", "ol", "p", "section", "ul",
    ]);
    function append(value) {
      result += value;
    }
    function visit(node) {
      if (node.nodeType === 3) {
        append(node.nodeValue || "");
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = lower(node.tagName);
      if (tag === "br") {
        append("\n");
        return;
      }
      if (blockTags.has(tag)) append("\n");
      if (tag === "li") append("- ");
      for (const child of node.childNodes) visit(child);
      if (blockTags.has(tag)) append("\n");
    }
    visit(clone);

    return result
      .split(/\n+/)
      .map(normalizeText)
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function greenhouseJobDescriptionContext(documentRef = document) {
    const descriptionRoot = [
      ".job__description",
      "[data-testid='job-description']",
      "#job_description",
      ".job-description",
      "#content",
      "main",
      ".job-post",
    ]
      .map((selector) => documentRef.querySelector(selector))
      .find(Boolean);
    const fullDescription = jobDescriptionDomText(descriptionRoot);
    return { descriptionRoot, fullDescription };
  }

  function extractGreenhouseJobPosting(
    documentRef = document,
    descriptionContext = greenhouseJobDescriptionContext(documentRef),
  ) {
    const metadata = jobTitleMetadata(documentRef);
    const title =
      firstJobPageText(documentRef, [
        "h1.job__title",
        ".job__title h1",
        "[data-testid='job-title']",
        "#header h1",
        "main h1",
        "h1",
      ]) || metadata.title;
    const company = (
      firstJobPageText(documentRef, [
        ".job__company",
        "[data-testid='company-name']",
        ".company-name",
        "#header .company-name",
      ]) || metadata.company
    ).replace(/^at\s+/i, "");
    const locationTextValue = firstJobPageText(documentRef, [
      ".job__location",
      "[data-testid='job-location']",
      "#header .location",
      ".location",
    ]);
    const { fullDescription } = descriptionContext;
    const description = fullDescription.slice(0, 24000).trim();
    if (!description) return null;

    const canonicalUrl = normalizeText(
      documentRef.querySelector("link[rel='canonical']")?.href ||
        documentRef.location?.href ||
        location.href,
    );
    const posting = {
      "@type": "JobPosting",
      source: "greenhouse_dom",
      title,
      company,
      location: locationTextValue,
      description,
      descriptionTruncated: description.length < fullDescription.length,
      descriptionOriginalCharCount: fullDescription.length,
      url: canonicalUrl,
    };
    if (company) {
      posting.hiringOrganization = {
        "@type": "Organization",
        name: company,
      };
    }
    if (locationTextValue) {
      posting.jobLocation = {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          addressLocality: locationTextValue,
        },
      };
    }
    return posting;
  }

  function plannerJobPosting(jobPosting) {
    if (!jobPosting) return null;
    const description =
      typeof jobPosting.description === "string" ? jobPosting.description : "";
    const projected = { ...jobPosting };
    delete projected.description;
    return {
      ...projected,
      descriptionAvailableViaTool: Boolean(description),
      descriptionCharCount: description.length,
    };
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
    const uploadLabel = root.querySelector(
      ".upload-label, [id^='upload-label-']",
    );
    if (cleanLabel(textContent(uploadLabel))) return uploadLabel;

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

    if (
      getElements("button, label, input", root).some((el) =>
        /\b(upload|attach|resume|cv|remove file|replace file)\b/i.test(
          textContent(el),
        ),
      )
    ) {
      return true;
    }

    return (
      Boolean(fileValueForField(root)) &&
      /\b(resume|cv|cover letter|attachment)\b/i.test(questionText(root))
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

  function exactTextValueForField(input) {
    if (!input || !(input instanceof Element)) return "";
    if (["checkbox", "radio", "file"].includes(lower(input.getAttribute("type")))) {
      return "";
    }
    return normalizeText(input.value ?? input.getAttribute("value") ?? "");
  }

  function textValueForField(input) {
    return truncate(exactTextValueForField(input), 360);
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
    if (files.length) return files.join(", ");

    const rendered = root.querySelector(
      [
        ".file-upload__filename",
        ".file-upload__file-name",
        "[class*='file-name']",
        "[class*='fileName']",
        "[class*='filename']",
      ].join(","),
    );
    if (rendered) return normalizeText(rendered.textContent);

    const leaf = getElements("span, p, a, div", root).find((el) => {
      if (el.children.length) return false;
      return /\.(?:pdf|docx?|rtf|txt)\b/i.test(textContent(el));
    });
    return normalizeText(textContent(leaf));
  }

  function uploadTriggerInfo(state, root, input) {
    if (!input || lower(input.getAttribute("type")) !== "file") return null;

    const inputId = normalizeText(input.id);
    const inputSelector = ownStableSelector(input);
    const uploadButtons = getVisibleElements("button, [role='button']", root).filter(
      (el) => /\b(upload|attach|replace|browse)\b/i.test(textContent(el)),
    );
    const inputLabels = inputId
      ? getVisibleElements(`label[for="${cssEscape(inputId)}"]`, root)
      : [];

    function provableTriggers(elements) {
      const candidates = [];
      const seen = new Set();

      for (const trigger of elements) {
        if (!(trigger instanceof Element)) continue;
        const control = findControlForElement(state.controls || [], trigger);
        if (!control?.id) continue;

        const tag = lower(trigger.tagName);
        const anchoredSelectors = [];
        if (inputSelector && isUniqueSelector(inputSelector)) {
          if (tag === "button" || lower(trigger.getAttribute("role")) === "button") {
            anchoredSelectors.push(
              inputId
                ? `.file-upload:has(${inputSelector}) .secondary-button:has(label[for="${cssEscape(inputId)}"]) button`
                : "",
              `.field-wrapper:has(${inputSelector}) button`,
              `.file-upload:has(${inputSelector}) button`,
              `.field-wrapper:has(${inputSelector}) [role='button']`,
            );
          }
          if (tag === "label" && inputId) {
            anchoredSelectors.push(`label[for="${cssEscape(inputId)}"]`);
          }
          if (trigger === input) anchoredSelectors.push(inputSelector);
        }
        const selector =
          anchoredSelectors.find(
            (candidate) =>
              isUniqueSelector(candidate) &&
              document.querySelector(candidate) === trigger,
          ) || ownStableSelector(trigger);
        if (!selector) continue;

        const identity = `${control.id}:${selector}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        candidates.push({ controlId: control.id, selector, trigger });
      }

      return candidates;
    }

    const visibleInputFallback = isVisible(input) ? [input] : [];
    for (const tier of [uploadButtons, inputLabels, visibleInputFallback]) {
      const candidates = provableTriggers(tier);
      if (candidates.length === 1) {
        const [{ controlId, selector }] = candidates;
        return { controlId, selector };
      }
      if (candidates.length > 1) return null;
    }

    return null;
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
      const actionEl = labelEl || input;
      const control =
        findControlForElement(controls, input) ||
        findControlForElement(controls, labelEl) ||
        findControlForElement(controls, wrapper);
      addOption(
        options,
        actionEl,
        label,
        selectedFromInput(input),
        control?.id || "",
      );
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

  function isSensitiveField(root, question) {
    if (root.closest(".eeoc__container")) return true;
    if (root.closest("#demographic-section, .demographic--container")) return true;

    const text = lower(question);
    return (
      /\b(gender|hispanic|latino|race|ethnicity|veteran|disability|sexual orientation|transgender|demographic)\b/.test(text) ||
      /\bvoluntary self-identification\b/.test(text)
    );
  }

  function isLegalOrWorkAuthorizationField(root, question) {
    const text = lower([question, descriptionText(root)].join(" "));
    return (
      /\b(work authorization|authorized to work|legally authorized|visa|sponsor|sponsorship|work permit|security clearance|background check)\b/.test(
        text,
      ) ||
      /\b(privacy notice|privacy policy|terms|consent|certify|certification|acknowledge|confirm accuracy)\b/.test(
        text,
      )
    );
  }

  function isPhoneCountryCodeRoot(root) {
    return Boolean(root?.closest?.("fieldset.phone-input .phone-input__country"));
  }

  function isUploadBoundaryField(question) {
    return /\b(resume|cv|cover letter|upload|attach)\b/i.test(question);
  }

  function uploadLabelFieldKey(root) {
    const labelledElements = [root, ...getElements("[aria-labelledby]", root)];
    for (const element of labelledElements) {
      const labelledBy = normalizeText(element.getAttribute("aria-labelledby"));
      for (const id of labelledBy.split(/\s+/).filter(Boolean)) {
        const match = id.match(/^upload-label-(.+)$/i);
        const label = root.ownerDocument?.getElementById(id);
        if (match && label && root.contains(label)) return normalizeText(match[1]);
      }
    }

    const label = root.querySelector("[id^='upload-label-']");
    const match = normalizeText(label?.id).match(/^upload-label-(.+)$/i);
    return normalizeText(match?.[1]);
  }

  function fieldKeyFor(root, input, question, index) {
    return (
      normalizeText(root.getAttribute("data-field-path")) ||
      normalizeText(input?.id) ||
      normalizeText(input?.getAttribute("name")) ||
      (isFileField(root) ? uploadLabelFieldKey(root) : "") ||
      `question_${stableKey(question, `field_${index + 1}`)}`
    );
  }

  function sectionKind(root) {
    if (root.closest(".eeoc__container")) return "eeoc";
    if (root.closest("#demographic-section, .demographic--container")) {
      return "demographic";
    }
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
      const specificRoots = getElements(".select, .field-wrapper", eeoc).filter(
        (root) => !(root.matches(".field-wrapper") && root.querySelector(".select")),
      );

      for (const root of specificRoots) {
        addRoot(root);
      }

      for (const root of getElements(".eeoc__question__wrapper", eeoc)) {
        if (specificRoots.some((specificRoot) => root.contains(specificRoot))) {
          continue;
        }
        addRoot(root);
      }
    }

    for (const demographic of getElements(
      "#demographic-section, .demographic--container",
      form,
    )) {
      const specificRoots = getElements(".select, .field-wrapper", demographic).filter(
        (root) => !(root.matches(".field-wrapper") && root.querySelector(".select")),
      );

      for (const root of specificRoots) {
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
    const phoneCountryCode = isPhoneCountryCodeRoot(root);
    const displayLabel = phoneCountryCode ? "Phone Country Code" : question;
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
    const sensitive = isSensitiveField(root, question);
    const uploadBoundary = kind === "file";
    const uploadTrigger = uploadBoundary
      ? uploadTriggerInfo(state, root, input)
      : null;
    const fieldSectionKind = sectionKind(root);
    const demographic = fieldSectionKind === "demographic";
    const dedicatedCoverLetter = isCoverLetterArea(root);
    const legalOrWorkAuthorization =
      ["application", "education"].includes(fieldSectionKind) &&
      isLegalOrWorkAuthorizationField(root, question);
    const supportedSensitiveSelect = Boolean(
      sensitive &&
        ["eeoc", "demographic"].includes(fieldSectionKind) &&
        kind === "combobox" &&
        fieldWrapperSelectInput(root) === input,
    );
    const connectorTool = uploadBoundary
      ? ""
      : supportedSensitiveSelect
        ? EEOC_TOOL
        : !dedicatedCoverLetter &&
            ["application", "education"].includes(fieldSectionKind)
          ? APPLICATION_FIELDS_TOOL
          : "";
    const connectorArgs = connectorTool ? { fieldKey } : null;
    const batchPlacement = connectorTool
      ? "can_batch"
      : kind === "combobox"
        ? "after_batchable_plain_fields"
        : !uploadBoundary
          ? "can_batch"
          : "";
    const verifyAfterAction = connectorTool
      ? "adapter_group_current_value"
      : "";
    const description = descriptionText(root);
    const textFacts = [
      displayLabel,
      phoneCountryCode ? "phone country-code selector" : "",
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
      demographic
        ? "demographic field detected"
        : "",
      sensitive
        ? demographic
          ? ""
          : "sensitive self-identification field detected"
        : "",
      legalOrWorkAuthorization ? "legal or work-authorization field detected" : "",
      uploadBoundary ? "upload/file boundary" : "",
      connectorTool
        ? `connector action available: ${connectorTool} with exact fieldKey ${fieldKey}`
        : "",
    ];
    const fieldControlIds = unique(
      [
        uploadTrigger?.controlId,
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
      sectionKind: fieldSectionKind,
      required,
      label: displayLabel,
      description,
      text: textFacts.filter(Boolean).join(" | "),
      currentValue,
      selectedValue,
      answered,
      blank: !rawValue,
      sensitive,
      legalOrWorkAuthorization,
      demographic,
      dedicatedCoverLetter,
      phoneCountryCode,
      uploadBoundary,
      committedFilename: uploadBoundary ? rawValue : "",
      uploadTriggerTargetId: uploadTrigger?.controlId || "",
      uploadTriggerSelector: uploadTrigger?.selector || "",
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
      const aMissingRequired = a.required && !a.answered && !a.uploadBoundary ? 0 : 1;
      const bMissingRequired = b.required && !b.answered && !b.uploadBoundary ? 0 : 1;
      if (aMissingRequired !== bMissingRequired) {
        return aMissingRequired - bMissingRequired;
      }
      const aAnswered = a.answered ? 1 : 0;
      const bAnswered = b.answered ? 1 : 0;
      if (aAnswered !== bAnswered) return aAnswered - bAnswered;
      return Number(a.bounds?.y || 0) - Number(b.bounds?.y || 0);
    });
  }

  function isConnectorFillSelectField(field) {
    return Boolean(
      field &&
        field.connectorTool === SELECT_TOOL &&
        field.connectorArgs?.fieldKey,
    );
  }

  function isConnectorManagedField(field) {
    return Boolean(
      field?.connectorArgs?.fieldKey &&
        [APPLICATION_FIELDS_TOOL, EEOC_TOOL, SELECT_TOOL].includes(
          field.connectorTool,
        ),
    );
  }

  function addHint(actionHintsByTargetId, targetId, hint) {
    if (!targetId) return;
    actionHintsByTargetId[targetId] = {
      ...(actionHintsByTargetId[targetId] || {}),
      ...hint,
    };
  }

  function buildActionHints(
    fields,
    submitTargetId,
    uploadTargetIds,
    controlsById,
    coverLetterInfo = null,
  ) {
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
              "Greenhouse upload/file control. Use the exact field-keyed host upload operation for this target.",
          });
        }
        continue;
      }

      const isCombobox = field.fieldKind === "combobox";
      const isSelect = field.fieldKind === "select";
      const connectorSelect = isConnectorFillSelectField(field);
      const connectorManaged = connectorSelect || isConnectorManagedField(field);
      const shouldOpenCombobox =
        isCombobox &&
        !connectorManaged &&
        !field.answered &&
        !field.autocompleteOpen &&
        !field.needsAutocompleteCommit &&
        !(field.options || []).length;

      if (connectorManaged) {
        const connectorInstruction = field.connectorTool === APPLICATION_FIELDS_TOOL
          ? `Use connector tool ${APPLICATION_FIELDS_TOOL} with an exact caller-provided fieldValues.${field.fieldKey} value. The connector verifies the committed value and leaves omitted fields unchanged.`
          : field.connectorTool === EEOC_TOOL
            ? `Use connector tool ${EEOC_TOOL} with an exact caller-provided fieldValues.${field.fieldKey} value for this sensitive self-identification select. The adapter does not infer an answer.`
            : field.phoneCountryCode
              ? `Use connector tool ${SELECT_TOOL} with fieldKey="${field.fieldKey}" and the exact caller-provided visible phone country-code option. It opens, matches, commits, and verifies the requested value.`
              : `Use connector tool ${SELECT_TOOL} with fieldKey="${field.fieldKey}" and an exact caller-provided visible option. It opens, searches when needed, matches, commits, and verifies the requested value.`;
        const connectorHint = {
          semanticRole: field.connectorTool === APPLICATION_FIELDS_TOOL
            ? "greenhouse_application_connector_field"
            : field.connectorTool === EEOC_TOOL
              ? "greenhouse_sensitive_connector_field"
              : field.phoneCountryCode
                ? "greenhouse_phone_country_code_connector_select"
                : "greenhouse_connector_select",
          preferredAction: field.connectorTool,
          connectorTool: field.connectorTool,
          connectorArgs: field.connectorArgs,
          exactValueMode: "connectorValue",
          avoidAction: true,
          safeFillTarget: false,
          observeAfterAction: false,
          batchPlacement: "can_batch",
          stableFieldTargetId: field.targetId,
          machineKey: field.fieldKey,
          answerText: field.label,
          optionTexts: [],
          verifyAfterAction: "adapter_group_current_value",
          instruction: connectorInstruction,
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
          safeFillTarget: true,
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
        !connectorManaged &&
        !shouldOpenCombobox
      ) {
        const instruction = isCombobox
          ? "Greenhouse React select/combobox field. If the matching option is visible, click that option to commit it. Otherwise fill search text, observe the in-field listbox, then click the exact matching visible option. Do not treat typed search text or a focused option as selected."
          : field.sensitive
            ? "Sensitive Greenhouse field. Apply only an exact caller-provided value."
            : field.legalOrWorkAuthorization
              ? "Legal or work-authorization Greenhouse field. Apply only an exact caller-provided value."
              : isSelect
                ? "Fill this Greenhouse native select using an exact caller-provided visible option value."
                : "Fill this Greenhouse application field using the exact caller-provided value.";

        addHint(actionHintsByTargetId, field.fillTargetId, {
          semanticRole: isCombobox
            ? "greenhouse_combobox"
            : isSelect
              ? "greenhouse_select"
              : "greenhouse_text_field",
          preferredAction: "fill",
          exactValueMode: isSelect ? "optionText" : isCombobox ? "searchText" : "literal",
          safeFillTarget: true,
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
        const isConnectorManagedOption = connectorManaged;
        const instruction = isConnectorManagedOption
          ? `Greenhouse option fallback. Prefer ${field.connectorTool} for fieldValues.${field.fieldKey}; click only if the connector is unavailable or failed.`
          : field.sensitive
          ? "Sensitive Greenhouse option. Use only when its exact visible value was supplied by the caller."
          : field.fieldKind === "combobox"
            ? "Click this visible Greenhouse combobox option if it matches the desired field value. After one click, observe the next state and move on if the field shows the value."
              : option.selected
              ? "This Greenhouse option is already selected in adapter state; do not click it again unless the caller supplied a different exact value."
              : "Click this Greenhouse option only when it exactly matches the caller-provided value. After one click, observe the next state and do not repeat it if adapter state shows it selected.";

        for (const targetId of targetIds) {
          addHint(actionHintsByTargetId, targetId, {
            semanticRole:
              isConnectorManagedOption
                ? "greenhouse_connector_managed_option"
                : field.fieldKind === "combobox"
                ? "greenhouse_combobox_option"
                : "greenhouse_application_option",
            preferredAction: isConnectorManagedOption ? field.connectorTool : "click",
            avoidAction: isConnectorManagedOption ? true : undefined,
            safeFillTarget: isConnectorManagedOption ? false : undefined,
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
          "Greenhouse upload control. Use the exact field-keyed host upload operation when host upload capability is available.",
      });
    }

    for (const targetId of actionableControlIds(
      coverLetterInfo?.controlIds || [],
      controlsById,
      3,
    )) {
      addHint(actionHintsByTargetId, targetId, {
        semanticRole:
          targetId === coverLetterInfo?.textareaControlId
            ? "greenhouse_cover_letter_textarea"
            : "greenhouse_cover_letter_manual_entry",
        preferredAction: "greenhouse_write_cover_letter",
        connectorTool: "greenhouse_write_cover_letter",
        exactValueMode: "callerProvidedText",
        avoidAction: false,
        stableFieldTargetId: COVER_LETTER_TARGET_ID,
        machineKey: "cover_letter_text",
        answerText: "Cover Letter",
        batchPlacement: "separate_exact_value",
        verifyAfterAction: "adapter_group_current_value",
        instruction:
          "Use greenhouse_write_cover_letter with exact caller-provided letterText; the connector opens manual entry when needed and verifies the committed text.",
      });
    }

    addHint(actionHintsByTargetId, submitTargetId, {
      semanticRole: "greenhouse_submit_application_boundary",
      protectedEffect: "submit",
      preferredAction: "click",
      navigationAction: true,
      avoidAction: true,
      instruction:
        "Final Greenhouse Submit application boundary. Execution requires the guarded-submit host capability and explicit authorization.",
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
      sensitive: field.sensitive,
      legalOrWorkAuthorization: field.legalOrWorkAuthorization,
      demographic: field.demographic,
      uploadBoundary: field.uploadBoundary,
      committedFilename: field.committedFilename,
      uploadTriggerTargetId: field.uploadTriggerTargetId,
      autocompleteOpen: field.autocompleteOpen,
      needsAutocompleteCommit: field.needsAutocompleteCommit,
      fillTargetId: field.fillTargetId,
      openTargetId: field.openTargetId,
      controlIds: field.controlIds,
      optionTexts: field.optionTexts,
      optionTargets: field.optionTargets,
      preferredAction: field.connectorTool || (field.uploadBoundary ? "extract" : ""),
      connectorTool: field.connectorTool,
      connectorArgs: field.connectorArgs,
      batchPlacement: field.batchPlacement,
      verifyAfterAction: field.verifyAfterAction,
      bounds: field.bounds,
    }));
  }

  function applicationFillGroups(fields) {
    const fillableFields = fields.filter(
      (field) => field.connectorTool === APPLICATION_FIELDS_TOOL,
    );
    if (!fillableFields.length) return [];

    const fieldKeys = fillableFields.map((field) => field.fieldKey);
    const blankLabels = fillableFields
      .filter((field) => !field.answered)
      .map((field) => field.label);

    return [
      {
        id: "greenhouse_application_fill_batch",
        kind: "greenhouse_application_section",
        adapterId: ADAPTER_ID,
        targetId: `${APPLICATION_TARGET_ID}:batch:non_file_fields`,
        sectionKind: "application",
        label: "Greenhouse Non-File Application Fields",
        text: [
          "Greenhouse non-file application and education fields detected",
          `connector action available: ${APPLICATION_FIELDS_TOOL} with fieldValues for ${fieldKeys.join(", ")}`,
          "The connector applies only exact caller-provided field-keyed values, leaves omitted fields unchanged, and verifies each commit",
          blankLabels.length
            ? `blank connector fields: ${blankLabels.join(" | ")}`
            : "all connector-managed application fields are answered",
        ]
          .filter(Boolean)
          .join(" | "),
        preferredAction: APPLICATION_FIELDS_TOOL,
        connectorTool: APPLICATION_FIELDS_TOOL,
        connectorFieldKeys: fieldKeys,
        batchPlacement: "can_batch",
        verifyAfterAction: "adapter_group_current_value",
        currentValue: `${fillableFields.filter((field) => field.answered).length}/${fillableFields.length} answered`,
        answered: fillableFields.every((field) => field.answered),
        fieldTargets: fillableFields.map((field) => field.targetId),
        controlIds: unique(
          fillableFields.flatMap((field) => field.controlIds || []),
        ),
      },
    ];
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
          `connector action available: ${EEOC_TOOL} with fieldValues for ${fieldKeys.join(", ")}`,
          "The connector applies only exact caller-provided sensitive values and does not infer answers",
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
        batchPlacement: "can_batch",
        verifyAfterAction: "adapter_group_current_value",
        currentValue: `${eeocFields.filter((field) => field.answered).length}/${eeocFields.length} answered`,
        answered: eeocFields.every((field) => field.answered),
        fieldTargets: eeocFields.map((field) => field.targetId),
        controlIds: unique(eeocFields.flatMap((field) => field.controlIds || [])),
      },
    ];
  }

  function demographicSectionGroups(fields) {
    const demographicFields = fields.filter(
      (field) => field.sectionKind === "demographic",
    );
    if (!demographicFields.length) return [];

    const blankLabels = demographicFields
      .filter((field) => !field.answered)
      .map((field) => field.label);
    const answeredLabels = demographicFields
      .filter((field) => field.answered)
      .map((field) => `${field.label}: ${field.currentValue}`);

    return [
      {
        id: "greenhouse_demographic_section",
        kind: "greenhouse_application_section",
        adapterId: ADAPTER_ID,
        targetId: "site:greenhouse.application:section:demographic",
        sectionKind: "demographic",
        label: "U.S. Standard Demographic Questions",
        text: [
          "Greenhouse demographic section detected",
          `connector action available: ${EEOC_TOOL} with fieldValues for supported demographic selects`,
          "The connector applies only exact caller-provided sensitive values and does not infer answers",
          blankLabels.length
            ? `blank sensitive demographic fields: ${blankLabels.join(" | ")}`
            : "no blank sensitive demographic fields detected",
          answeredLabels.length
            ? `answered sensitive demographic fields: ${answeredLabels.join(" | ")}`
            : "",
        ]
          .filter(Boolean)
          .join(" | "),
        preferredAction: EEOC_TOOL,
        connectorTool: EEOC_TOOL,
        connectorFieldKeys: demographicFields
          .filter((field) => field.connectorTool === EEOC_TOOL)
          .map((field) => field.fieldKey),
        batchPlacement: "can_batch",
        verifyAfterAction: "adapter_group_current_value",
        currentValue: `${demographicFields.filter((field) => field.answered).length}/${demographicFields.length} answered`,
        answered: demographicFields.every((field) => field.answered),
        fieldTargets: demographicFields.map((field) => field.targetId),
        controlIds: unique(
          demographicFields.flatMap((field) => field.controlIds || []),
        ),
      },
    ];
  }

  function coverLetterGroups(info) {
    if (!info) return [];

    return [
      {
        id: "greenhouse_cover_letter_section",
        kind: "greenhouse_application_section",
        adapterId: ADAPTER_ID,
        targetId: COVER_LETTER_TARGET_ID,
        sectionKind: "application",
        label: "Cover Letter",
        text: [
          "Greenhouse cover letter manual-entry section detected",
          "connector action available: greenhouse_write_cover_letter(letterText)",
          "The connector writes exact caller-provided letterText and verifies the committed text",
          info.answered
            ? `cover letter current value: ${info.currentValue}`
            : `cover letter blank: ${info.currentValue}`,
        ]
          .filter(Boolean)
          .join(" | "),
        preferredAction: "greenhouse_write_cover_letter",
        connectorTool: "greenhouse_write_cover_letter",
        batchPlacement: "separate_exact_value",
        verifyAfterAction: "adapter_group_current_value",
        currentValue: info.currentValue,
        answered: info.answered,
        fieldTargets: [COVER_LETTER_TARGET_ID],
        controlIds: info.controlIds,
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
          !field.uploadBoundary,
      )
      .map((field) => field.label)
      .slice(0, 16);
    const blankDemographicFields = fields
      .filter((field) => field.demographic && !field.answered)
      .map((field) => field.label)
      .slice(0, 12);
    const blankSensitiveFields = fields
      .filter(
        (field) =>
          field.sensitive && !field.demographic && !field.answered,
      )
      .map((field) => field.label)
      .slice(0, 12);
    const uploadBoundaries = fields
      .filter((field) => field.uploadBoundary && !field.answered)
      .map((field) => field.label)
      .slice(0, 8);
    const currentValue = missingRequired.length
      ? `missing required: ${missingRequired.join(", ")}`
      : blankDemographicFields.length
        ? `sensitive demographic fields blank: ${blankDemographicFields.join(", ")}`
        : "required fields handled; upload/submit boundaries may remain";

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
          : "no required non-file field is visibly missing",
        blankDemographicFields.length
          ? `demographic fields blank: ${blankDemographicFields.join(" | ")}`
          : "",
        blankSensitiveFields.length
          ? `sensitive self-identification fields blank: ${blankSensitiveFields.join(" | ")}`
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
        hint.avoidAction ? "direct control action blocked; use preferred action" : "",
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

  function selectorForExactElement(documentRef, element, candidates) {
    for (const selector of unique(candidates)) {
      try {
        const matches = documentRef.querySelectorAll(selector);
        if (matches.length === 1 && matches[0] === element) return selector;
      } catch {
        // Ignore malformed fallback candidates and fail closed below.
      }
    }
    return "";
  }

  function submitCandidateElements(documentRef = document) {
    const form = applicationForm(documentRef);
    if (!form) return [];
    return unique(
      getVisibleElements(
        "button, input[type='submit'], [role='button']",
        form,
      ).filter(
        (element) =>
          /^submit application$/i.test(
            textContent(element) || normalizeText(element.value),
          ),
      ),
    );
  }

  function submitBoundaryTargetIds(state, documentRef = document) {
    return unique(
      submitCandidateElements(documentRef).map(
        (element) => findControlForElement(state?.controls || [], element)?.id,
      ),
    );
  }

  function exactSubmitTarget(state, documentRef = document) {
    const candidates = submitCandidateElements(documentRef);
    if (candidates.length !== 1) return null;

    const element = candidates[0];
    const control = findControlForElement(state?.controls || [], element);
    if (!control?.id) return null;
    const selector = selectorForExactElement(documentRef, element, [
      ownStableSelector(element),
      element.matches(".application--submit")
        ? "form#application-form .application--submit"
        : "",
      element.matches(".application--submit")
        ? "form.application--form .application--submit"
        : "",
      "form#application-form .application--submit button[type='submit']",
      "form.application--form .application--submit button[type='submit']",
      "form#application-form button[type='submit']",
      "form.application--form button[type='submit']",
      "form#application-form input[type='submit']",
      "form.application--form input[type='submit']",
    ]);
    if (!selector) return null;

    return {
      element,
      targetId: control.id,
      selector,
      enabled:
        !element.disabled && lower(element.getAttribute("aria-disabled")) !== "true",
    };
  }

  function findSubmitTargetId(state, form) {
    return exactSubmitTarget(state, form?.ownerDocument || document)?.targetId || "";
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
          !field.uploadBoundary,
      )
      .map((field) => field.label)
      .slice(0, 12);
    const blankDemographicFields = fields
      .filter((field) => field.demographic && !field.answered)
      .map((field) => field.label)
      .slice(0, 12);
    const blankPhoneCountryCodeFields = fields.filter(
      (field) => field.phoneCountryCode && !field.answered,
    );
    const blankSensitiveFields = fields
      .filter(
        (field) =>
          field.sensitive && !field.demographic && !field.answered,
      )
      .map((field) => field.label)
      .slice(0, 12);

    return [
      "Greenhouse adapter active: use only fields inside form#application-form, especially .application--questions, .field-wrapper, .eeoc__container, and .application--submit.",
      `${APPLICATION_FIELDS_TOOL}(fieldValues) accepts exact caller-provided values for advertised non-file application and education field keys and leaves omitted fields unchanged.`,
      blankPhoneCountryCodeFields.length
        ? `Greenhouse Phone Country Code is a phone country/extension selector; pass its exact visible option through ${SELECT_TOOL}(fieldKey="country", value).`
        : "",
      `${SELECT_TOOL}(fieldKey, value) opens a Greenhouse React select, searches for the exact caller-provided visible value, commits it, and verifies the committed value.`,
      "For Greenhouse React select/combobox fields without a connector, click the closed control opener first, preferably the Toggle flyout button or inner .select__control target, to open the in-field listbox. Then observe and click the matching visible option. Fill search text only if the menu is open and the desired option is not visible. Do not treat typed search text as a committed Greenhouse selection.",
      `${EEOC_TOOL}(fieldValues) accepts exact caller-provided values for advertised EEOC and demographic field keys. It re-resolves conditional fields after each committed selection and does not infer sensitive answers.`,
      siteAdapter.coverLetterAvailable
        ? "greenhouse_write_cover_letter(letterText) opens manual entry when necessary, writes exact caller-provided text, and verifies the committed text."
        : "",
      "If a Greenhouse field group says currentValue blank and answered false, treat it as not filled. If it says selected/current value, do not repeat the same action.",
      missingRequired.length
        ? `Greenhouse required non-file fields still missing: ${missingRequired.join(" | ")}.`
        : "No Greenhouse required non-file field is visibly missing.",
      blankDemographicFields.length
        ? `Greenhouse demographic fields currently blank: ${blankDemographicFields.join(" | ")}.`
        : "",
      blankSensitiveFields.length
        ? `Greenhouse sensitive self-identification fields currently blank: ${blankSensitiveFields.join(" | ")}.`
        : "",
      siteAdapter.uploadTargetIds.length
        ? `Greenhouse upload targets are file-upload boundaries exposed through ${UPLOAD_APPLICATION_FILE_TOOL} when host upload capability is available.`
        : "",
      siteAdapter.submitTargetId
        ? `Greenhouse Submit application target ${siteAdapter.submitTargetId} is a guarded final-submission boundary.`
        : "",
    ].filter(Boolean);
  }

  function buildVisibleTextSummary(fields, siteAdapter) {
    const missing = fields
      .filter(
        (field) =>
          field.required &&
          !field.answered &&
          !field.uploadBoundary,
      )
      .map((field) => field.label)
      .slice(0, 12);
    const blankDemographicFields = fields
      .filter((field) => field.demographic && !field.answered)
      .map((field) => field.label)
      .slice(0, 12);
    const blankSensitiveFields = fields
      .filter(
        (field) =>
          field.sensitive && !field.demographic && !field.answered,
      )
      .map((field) => field.label)
      .slice(0, 12);

    return [
      `Greenhouse application adapter: ${fields.length} fields detected inside #application-form.`,
      missing.length
        ? `Greenhouse missing required fields: ${missing.join(" | ")}`
        : "Greenhouse required non-file fields appear handled.",
      blankDemographicFields.length
        ? `Greenhouse demographic fields blank: ${blankDemographicFields.join(" | ")}`
        : "",
      blankSensitiveFields.length
        ? `Greenhouse sensitive self-identification fields blank: ${blankSensitiveFields.join(" | ")}`
        : "",
      siteAdapter.coverLetterAvailable
        ? `Greenhouse cover letter manual entry available. Current value: ${siteAdapter.coverLetterCurrentValue}.`
        : "",
      siteAdapter.uploadTargetIds.length
        ? `Greenhouse upload boundary targets: ${siteAdapter.uploadTargetIds.join(" | ")}`
        : "",
      siteAdapter.submitTargetId
        ? `Greenhouse submit boundary target: ${siteAdapter.submitTargetId}`
        : "",
    ].filter(Boolean);
  }

  function isGreenhousePolicyNoiseText(value) {
    const text = lower(value);
    if (!text) return false;

    return (
      /\bequal employment opportunity\b/.test(text) ||
      /\bcompletion of the form is entirely voluntary\b/.test(text) ||
      /\bcompletion is entirely voluntary\b/.test(text) ||
      /\bconfidential file\b/.test(text) ||
      /\bprotected group status\b/.test(text) ||
      /\brace & ethnicity definitions\b/.test(text) ||
      /\bused in aggregate\b|\bin aggregate form\b/.test(text) ||
      /\bdiversity and inclusion efforts\b/.test(text) ||
      /\bwill not be associated with your specific application\b/.test(text) ||
      /\bwill not\b.*\bdisclosed to the hiring team\b/.test(text) ||
      /\bequal employment opportunity\/affirmative action record keeping\b/.test(
        text,
      ) ||
      /\bclassification of protected categories\b/.test(text) ||
      /\bvietnam era veterans readjustment assistance act\b/.test(text) ||
      /\bdisabled veteran\b|\brecently separated veteran\b/.test(text) ||
      /\bactive duty wartime\b|\bcampaign badge veteran\b/.test(text) ||
      /\barmed forces service medal veteran\b/.test(text) ||
      /\bvoluntary self-identification of disability\b/.test(text) ||
      /\bomb control number\b|\bpublic burden statement\b/.test(text) ||
      /\bpaperwork reduction act\b|\boffice of federal contract compliance programs\b/.test(
        text,
      ) ||
      /\bmajor life activities\b/.test(text) ||
      (text.length > 120 &&
        (/\bvoluntary self-identification\b/.test(text) ||
          /\bfor government reporting purposes\b/.test(text) ||
          /\bhow do you know if you have a disability\b/.test(text) ||
          /\ba person (of|having origins)\b/.test(text) ||
          /\bnot hispanic or latino\b/.test(text)))
    );
  }

  function buildPlannerDescriptionEvidence(descriptionContext) {
    const fullText = lower(descriptionContext?.fullDescription);
    const textKeys = new Set();
    const headingKeys = new Set();
    const descriptionRoot = descriptionContext?.descriptionRoot;
    const excludedSelector = [
      "form",
      "#application-form",
      ".application--form",
      ".application--questions",
      ".application--submit",
      "script",
      "style",
      "noscript",
    ].join(",");

    for (const line of String(descriptionContext?.fullDescription || "").split(/\n+/)) {
      const key = lower(line);
      if (key) textKeys.add(key);
    }

    if (descriptionRoot) {
      for (const element of [descriptionRoot, ...descriptionRoot.querySelectorAll("*")]) {
        if (element !== descriptionRoot && element.closest(excludedSelector)) continue;
        const key = lower(textContent(element));
        if (!key) continue;
        textKeys.add(key);
        textKeys.add(key.slice(0, 140).trim());
        textKeys.add(key.slice(0, 180).trim());
        if (element.matches("h1,h2,h3,h4,h5,h6,[role='heading'],[role='tab']")) {
          headingKeys.add(key);
        }
      }
    }

    return { fullText, textKeys, headingKeys };
  }

  function isPlannerDescriptionText(value, evidence) {
    const text = lower(value);
    if (!text || !evidence) return false;
    if (evidence.headingKeys.has(text)) return true;
    if (text.length < 24) return false;
    if (evidence.textKeys.has(text) || evidence.fullText.includes(text)) return true;

    if (text.length >= 40) {
      for (const descriptionText of evidence.textKeys) {
        if (descriptionText.length >= 40 && text.includes(descriptionText)) {
          return true;
        }
      }
    }
    return false;
  }

  function filterPlannerNoiseList(items, descriptionEvidence) {
    return (items || []).filter(
      (item) =>
        !isGreenhousePolicyNoiseText(item) &&
        !isPlannerDescriptionText(item, descriptionEvidence),
    );
  }

  function filterPlannerNoiseHeadings(headings, descriptionEvidence) {
    return (headings || []).filter(
      (heading) =>
        !isGreenhousePolicyNoiseText(heading) &&
        !isPlannerDescriptionText(heading, descriptionEvidence),
    );
  }

  function filterPlannerNoiseGroups(groups, descriptionEvidence) {
    return (groups || []).filter(
      (group) =>
        !isGreenhousePolicyNoiseText(
          [group?.label, group?.text, group?.heading].join(" "),
        ) &&
        !isPlannerDescriptionText(group?.text, descriptionEvidence) &&
        !(
          !normalizeText(group?.text) &&
          isPlannerDescriptionText(
            group?.label || group?.heading,
            descriptionEvidence,
          )
        ),
    );
  }

  function filterPlannerNoiseControls(controls) {
    return (controls || []).filter((control) => {
      if (control?.adapterHints?.[ADAPTER_ID]) return true;
      return !isGreenhousePolicyNoiseText(
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

  function buildSiteAdapter(state, documentRef) {
    const form = applicationForm(documentRef);
    const jobDescriptionContext = greenhouseJobDescriptionContext(documentRef);
    const jobPosting = plannerJobPosting(
      extractGreenhouseJobPosting(documentRef, jobDescriptionContext),
    );
    const fields = collectFieldRoots(documentRef)
      .map((root, index) => collectField(state, root, index))
      .filter((field) => field.label);
    const controlsById = controlByIdMap(state.controls || []);
    const submitBoundaryIds = submitBoundaryTargetIds(state, documentRef);
    const submitTargetId = findSubmitTargetId(state, form);
    const groupedUploadControlIds = new Set(
      fields
        .filter((field) => field.fieldKind === "file")
        .flatMap((field) => field.controlIds || []),
    );
    const uploadTargetIds = unique([
      ...fields.map((field) => field.uploadTriggerTargetId),
      ...findUploadTargetIds(state, form).filter(
        (controlId) => !groupedUploadControlIds.has(controlId),
      ),
    ]);
    const coverLetterInfo = coverLetterEntryInfo(state, documentRef);
    const applicationQuestionCount = getElements(".application--questions", form).length;
    const actionHintsByTargetId = buildActionHints(
      fields,
      submitTargetId,
      uploadTargetIds,
      controlsById,
      coverLetterInfo,
    );
    for (const targetId of submitBoundaryIds) {
      addHint(actionHintsByTargetId, targetId, {
        semanticRole: "greenhouse_submit_application_boundary",
        protectedEffect: "submit",
        avoidAction: true,
      });
    }
    const primaryControlIds = unique([
      ...fields.flatMap((field) => fieldPrimaryControlIds(field, controlsById)),
      ...(coverLetterInfo?.controlIds || []),
      ...actionableControlIds(uploadTargetIds, controlsById, 4),
      ...submitBoundaryIds,
      submitTargetId,
    ]).slice(0, 120);
    const selectorOverrides = {};
    for (const field of fields) {
      if (field.uploadTriggerTargetId && field.uploadTriggerSelector) {
        selectorOverrides[field.uploadTriggerTargetId] = field.uploadTriggerSelector;
      }
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
          !field.uploadBoundary,
      ).length,
      submitTargetId,
      uploadTargetIds,
      coverLetterAvailable: Boolean(coverLetterInfo),
      coverLetterTargetId: coverLetterInfo?.targetId || "",
      coverLetterControlIds: coverLetterInfo?.controlIds || [],
      coverLetterCurrentValue: coverLetterInfo?.currentValue || "",
      jobPosting,
      primaryControlIds,
      actionHintsByTargetId,
      selectorOverrides,
      jobDescriptionEvidence: buildPlannerDescriptionEvidence(
        jobDescriptionContext,
      ),
    };

    siteAdapter.plannerHints = buildPlannerHints(fields, siteAdapter);
    siteAdapter.groups = [
      applicationGroup(fields, siteAdapter),
      ...applicationFillGroups(fields),
      ...eeocSectionGroups(fields),
      ...demographicSectionGroups(fields),
      ...coverLetterGroups(coverLetterInfo),
      ...fieldGroups(sortFieldsForPlanner(fields)),
      ...optionGroups(fields),
    ].slice(0, 140);
    siteAdapter.visibleTextSummary = buildVisibleTextSummary(fields, siteAdapter);
    return siteAdapter;
  }

  // ---------------------------------------------------------------------------
  // Connector tool: greenhouse_fill_select
  // Handles Greenhouse React-select dropdowns in normal application questions,
  // education rows, and supported demographic questions. EEOC uses greenhouse_fill_eeoc.
  // ---------------------------------------------------------------------------

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function coverLetterTextFromAction(action) {
    return String(action?.letterText ?? action?.value ?? action?.text ?? "").replace(
      /\r\n?/g,
      "\n",
    );
  }

  async function waitForCoverLetterTextarea() {
    let latest = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      latest = coverLetterTextarea(document);
      if (latest && isVisible(latest)) return latest;
      await delay(100);
    }
    return latest;
  }

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

  function equivalentValuesForSelect(_fieldKey, ...values) {
    return unique(values.map(normalizeText).filter(Boolean));
  }

  function searchQueriesFor(_fieldKey, value) {
    const query = normalizeText(value);
    return query ? [query] : [];
  }

  function scoreComboboxOption(optionText, value, _fieldKey) {
    const optionKey = canonicalSelectText(optionText);
    const wantedKey = canonicalSelectText(value);
    return optionKey && wantedKey && optionKey === wantedKey ? 2000 : 0;
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
      const fieldSectionKind = sectionKind(root);
      if (fieldSectionKind === "eeoc") continue;
      if (!["application", "education", "demographic"].includes(fieldSectionKind)) {
        continue;
      }
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

  function collectRuntimeFields(documentRef = document) {
    return collectFieldRoots(documentRef)
      .map((root, index) => {
        const input = findPrimaryInput(root);
        const question = questionText(root);
        const fieldKey = fieldKeyFor(root, input, question, index);
        const options = collectChoiceOptionInfos(root, []);
        const kind = fieldKind(root, input, options.length);
        const fieldSectionKind = sectionKind(root);
        const sensitive = isSensitiveField(root, question);
        return {
          root,
          input,
          inputId: normalizeText(input?.id),
          question,
          fieldKey,
          fieldKind: kind,
          sectionKind: fieldSectionKind,
          sensitive,
          legalOrWorkAuthorization:
            ["application", "education"].includes(fieldSectionKind) &&
            isLegalOrWorkAuthorizationField(root, question),
          options,
        };
      })
      .filter((field) => field.question && field.fieldKey);
  }

  function connectorApplicationFields(documentRef = document) {
    return collectRuntimeFields(documentRef).filter(
      (field) =>
        ["application", "education"].includes(field.sectionKind) &&
        !isCoverLetterArea(field.root, documentRef) &&
        field.fieldKind !== "file" &&
        Boolean(field.input || field.options.length),
    );
  }

  function applicationFieldSchemaDescription(field) {
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
        "Provide the exact value to commit for this advertised field key.",
      ]
        .filter(Boolean)
        .join("; "),
      360,
    );
  }

  function eeocSelectFields(documentRef) {
    const form = applicationForm(documentRef);
    const container = form?.querySelector(".eeoc__container");
    if (!container) return [];

    return EEOC_FIELD_SPECS.map((spec) => {
      const input = container.querySelector(`#${cssEscape(spec.fieldKey)}`);
      if (!input || !isComboboxInput(input)) {
        return {
          ...spec,
          inputId: spec.fieldKey,
          present: false,
          sectionKind: "eeoc",
          scopeSelector: ".eeoc__container",
        };
      }
      const root =
        input.closest(".select") ||
        input.closest(".field-wrapper") ||
        input.closest(".eeoc__question__wrapper") ||
        container;
      return {
        ...spec,
        inputId: spec.fieldKey,
        label:
          questionText(root) ||
          directLabelForInput(root, input) ||
          spec.label,
        present: true,
        sectionKind: "eeoc",
        scopeSelector: ".eeoc__container",
      };
    });
  }

  function sensitiveSelectFields(documentRef = document) {
    const merged = new Map();
    for (const field of eeocSelectFields(documentRef)) {
      merged.set(field.fieldKey, field);
    }
    for (const field of collectRuntimeFields(documentRef)) {
      if (
        field.sectionKind !== "demographic" ||
        !field.sensitive ||
        field.fieldKind !== "combobox" ||
        fieldWrapperSelectInput(field.root) !== field.input
      ) {
        continue;
      }
      merged.set(field.fieldKey, {
        fieldKey: field.fieldKey,
        inputId: field.inputId,
        label: field.question,
        present: true,
        sectionKind: "demographic",
        scopeSelector: "#demographic-section, .demographic--container",
      });
    }
    return Array.from(merged.values());
  }

  function eeocFieldSchemaDescription(field) {
    return truncate(
      [
        `Exact visible option value for ${field.label}.`,
        field.present ? "Currently visible." : "May appear after a prior EEOC answer.",
        "No sensitive answer is inferred by the adapter.",
      ]
        .filter(Boolean)
        .join(" "),
      360,
    );
  }

  function hostCapability(meta, name) {
    return meta?.capabilities?.[name] === true;
  }

  function submitReadiness(documentRef = document) {
    const fields = collectFieldRoots(documentRef)
      .map((root, index) => collectField({ controls: [] }, root, index))
      .filter((field) => field?.label);
    const missingRequiredFields = [];
    const seen = new Set();

    for (const field of fields) {
      if (!field.required || field.answered) continue;
      const fieldKey = normalizeText(field.fieldKey);
      const identity = `${fieldKey}:${field.fieldKind}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      missingRequiredFields.push({
        fieldKey,
        label: field.label,
        fieldKind: field.fieldKind,
      });
    }

    return {
      ready: missingRequiredFields.length === 0,
      missingRequiredFields,
    };
  }

  function uploadExecutionTargets(state) {
    const controls = new Map((state?.controls || []).map((control) => [control.id, control]));
    return (state?.groups || [])
      .filter(
        (group) =>
          group?.kind === "greenhouse_application_field" &&
          group.fieldKind === "file" &&
          group.fieldKey &&
          group.uploadTriggerTargetId,
      )
      .map((group) => ({
        fieldKey: group.fieldKey,
        label: group.label,
        targetId: group.uploadTriggerTargetId,
        selector:
          group.uploadTriggerSelector ||
          controls.get(group.uploadTriggerTargetId)?.selector ||
          "",
        verification: {
          kind: "adapter_field_property",
          groupKind: "greenhouse_application_field",
          targetId: group.targetId,
          fieldKey: group.fieldKey,
          property: "committedFilename",
          previousValue: group.committedFilename || "",
          expectedValueFrom: "filePath.basename",
        },
      }))
      .filter((target) => target.selector);
  }

  function submitExecutionTarget(state, documentRef = document) {
    const target = exactSubmitTarget(state, documentRef);
    if (
      !target ||
      !target.enabled ||
      !state?.siteAdapter?.submitTargetId ||
      target.targetId !== state.siteAdapter.submitTargetId
    ) {
      return null;
    }
    return {
      targetId: target.targetId,
      selector: target.selector,
    };
  }

  function provideTools({ state, meta, document: documentRef }) {
    const applicationFields = connectorApplicationFields(documentRef || document);
    const fields = connectorSelectFields(documentRef || document);
    const eeocFields = sensitiveSelectFields(documentRef || document);
    const jobPosting = extractGreenhouseJobPosting(documentRef || document);
    const uploadTargets = hostCapability(meta, "hostFileUpload")
      ? uploadExecutionTargets(state)
      : [];
    const submitTarget = hostCapability(meta, "guardedSubmit")
      ? submitExecutionTarget(state, documentRef || document)
      : null;
    const coverLetterAvailable = Boolean(
      coverLetterTextarea(documentRef || document) ||
        findCoverLetterManualButton(documentRef || document),
    );
    const tools = [];

    if (jobPosting) {
      tools.push({
        schema: {
          type: "function",
          name: READ_JOB_DESCRIPTION_TOOL,
          description:
            "Read the current Greenhouse job description as dense structured job-posting data. Takes no arguments and excludes application answers.",
          strict: true,
          parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
        execution: {
          realm: "page",
          capability: null,
          effect: "read",
          sensitiveArguments: [],
          operation: "read_job_description",
          verification: { kind: "result_property", property: "jobPosting" },
        },
      });
    }

    if (uploadTargets.length) {
      tools.push({
        schema: {
          type: "function",
          name: UPLOAD_APPLICATION_FILE_TOOL,
          description:
            "Upload one local file to an exact Greenhouse application file field. filePath is resolved by the Codex host and is never sent to the page executor.",
          strict: true,
          parameters: {
            type: "object",
            properties: {
              fieldKey: {
                type: "string",
                enum: uploadTargets.map((target) => target.fieldKey),
                description: "The exact live Greenhouse file field to receive the file.",
              },
              filePath: {
                type: "string",
                description: "Absolute Codex-host path of the local file to upload.",
              },
            },
            required: ["fieldKey", "filePath"],
            additionalProperties: false,
          },
        },
        execution: {
          realm: "host",
          capability: "browser.file-upload",
          effect: "file-upload",
          sensitiveArguments: ["filePath"],
          operation: "upload_file",
          targets: uploadTargets,
        },
      });
    }

    if (submitTarget) {
      globalThis.WebGPTConnectorTools?.register?.(
        SUBMIT_APPLICATION_TOOL,
        greenhouseSubmitApplication,
        { requiresAuthorization: true },
      );
      tools.push({
        schema: {
          type: "function",
          name: SUBMIT_APPLICATION_TOOL,
          description:
            "Submit the current Greenhouse application. Use only when the user explicitly authorized final submission for this exact application.",
          strict: true,
          parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
        execution: {
          realm: "page",
          capability: "guarded-submit",
          effect: "submit",
          sensitiveArguments: [],
          operation: "guarded_submit",
          requiresAuthorization: true,
          target: submitTarget,
          verification: {
            kind: "navigation_or_target_absent",
            previousUrl: state?.url || "",
            targetId: submitTarget.targetId,
          },
        },
      });
    }

    if (applicationFields.length) {
      const mapping = applicationFields
        .map((field) => `${field.fieldKey} = "${truncate(field.question, 90)}"`)
        .join("; ");
      const fieldValueProperties = {};
      for (const field of applicationFields) {
        fieldValueProperties[field.fieldKey] = {
          type: "string",
          description: applicationFieldSchemaDescription(field),
        };
      }

      tools.push({
        type: "function",
        name: APPLICATION_FIELDS_TOOL,
        description: truncate(
          "Fill exact caller-provided values for advertised non-file Greenhouse application and education fields in one step. " +
            "The connector handles text inputs, textareas, native selects, choices, checkboxes, and Greenhouse React selects. " +
            "It leaves omitted fields unchanged; file uploads and dedicated EEOC/demographic selects use their own operations. fieldKey -> label: " +
            mapping,
          1400,
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
                "Exact caller-provided values keyed by advertised Greenhouse fieldKey. Omitted fields remain unchanged.",
            },
          },
          required: ["fieldValues"],
          additionalProperties: false,
        },
      });
    }

    if (fields.length) {
      const mapping = fields
        .map((field) => `${field.fieldKey} = "${truncate(field.label, 90)}"`)
        .join("; ");

      tools.push({
        type: "function",
        name: SELECT_TOOL,
        description: truncate(
          "Fill one Greenhouse single- or multi-select dropdown: open the menu, match the exact caller-provided visible option value, " +
            "search when needed, commit it, and verify the committed value. " +
            " fieldKey -> label: " +
            mapping,
          1200,
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
                "The exact visible Greenhouse option value to select. The adapter does not derive or infer a replacement value.",
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
          description: eeocFieldSchemaDescription(field),
        };
      }

      tools.push({
        type: "function",
        name: EEOC_TOOL,
        description: truncate(
          "Fill exact caller-provided values for advertised Greenhouse EEOC and custom demographic field keys in one step. " +
            "The connector re-resolves conditional fields, opens each menu, matches the exact visible option, commits it, and verifies the committed value. " +
            "It does not infer sensitive answers. fieldKey -> label: " +
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
                "Object keyed by an advertised Greenhouse EEOC or demographic fieldKey, containing exact caller-provided visible option values.",
            },
          },
          required: ["fieldValues"],
          additionalProperties: false,
        },
      });
    }

    if (coverLetterAvailable) {
      tools.push({
        type: "function",
        name: "greenhouse_write_cover_letter",
        description: truncate(
          "Write exact caller-provided cover-letter text into the Greenhouse manual-entry textarea. " +
            "The connector clicks Enter manually if needed, waits for #cover_letter_text, fills the text exactly, and verifies the committed value.",
          900,
        ),
        strict: false,
        parameters: {
          type: "object",
          properties: {
            letterText: {
              type: "string",
              description:
                "Exact complete cover-letter text to write without adapter-side generation or rewriting.",
            },
          },
          required: ["letterText"],
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
          : ".application--questions .field-wrapper, #demographic-section .select, .demographic--container .select");
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

  function locatedSelectReady(located) {
    return Boolean(located?.input && located?.control && isVisible(located.control));
  }

  async function waitForSelectByFieldKey(fieldKey, options = {}) {
    let latest = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      latest = locateSelectByFieldKey(fieldKey, options);
      if (locatedSelectReady(latest)) return latest;
      await delay(100);
    }
    return latest;
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

    const located = await waitForSelectByFieldKey(fieldKey, locateOptions);
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
        equivalentValues: equivalentValuesForSelect(fieldKey, value, already),
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

    const committedValue = await waitForCommittedSelectValue(container);
    const committed = valuesEquivalent(committedValue, match.text, fieldKey);
    return {
      ok: committed,
      recoverable: !committed,
      continueBatch: !committed,
      committed,
      value: committedValue,
      equivalentValues: equivalentValuesForSelect(
        fieldKey,
        value,
        match.text,
        committedValue,
      ),
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

  function fieldValuesFromAction(action) {
    const source =
      action?.fieldValues &&
      typeof action.fieldValues === "object" &&
      !Array.isArray(action.fieldValues)
        ? action.fieldValues
        : action || {};
    const fieldValues = {};

    for (const [rawFieldKey, rawValue] of Object.entries(source)) {
      const fieldKey = normalizeText(rawFieldKey);
      const value = normalizeText(rawValue);
      if (fieldKey && value) fieldValues[fieldKey] = value;
    }
    return fieldValues;
  }

  function orderedApplicationFieldEntries(fieldValues) {
    const entries = Object.entries(fieldValues || {});
    const phoneIndex = entries.findIndex(([fieldKey]) => lower(fieldKey) === "phone");
    const countryIndex = entries.findIndex(
      ([fieldKey]) => lower(fieldKey) === "country",
    );
    if (phoneIndex < 0 || countryIndex < 0 || countryIndex < phoneIndex) {
      return entries;
    }

    const [countryEntry] = entries.splice(countryIndex, 1);
    entries.splice(phoneIndex, 0, countryEntry);
    return entries;
  }

  function locateRuntimeApplicationField(fieldKey) {
    const key = normalizeText(fieldKey);
    if (!key) return null;
    return (
      connectorApplicationFields(document).find(
        (field) => field.fieldKey === key,
      ) || null
    );
  }

  function runtimeFieldCurrentValue(field) {
    if (!field) return "";
    if (field.fieldKind === "file") return fileValueForField(field.root);
    if (field.fieldKind === "select") return selectValueForField(field.input);
    if (field.fieldKind === "combobox") {
      return reactSelectValueForField(field.root);
    }
    if (field.options?.length) {
      return selectedValueFromOptions(collectChoiceOptionInfos(field.root, []));
    }
    return exactTextValueForField(field.input);
  }

  function requestedChoiceValues(value, multiSelect = false) {
    const text = normalizeText(value);
    if (!text) return [];
    if (!multiSelect) return [text];
    return text
      .split(/\s*(?:;|\|)\s*/g)
      .map(normalizeText)
      .filter(Boolean);
  }

  function desiredBoolean(value) {
    const key = canonicalSelectText(value);
    if (/^(yes|true|checked|selected|on)$/.test(key)) return true;
    if (/^(no|false|unchecked|unselected|off)$/.test(key)) return false;
    return null;
  }

  async function fillRuntimeChoiceField(field, value, ctx) {
    const click = ctx?.primitives?.clickElement;
    if (typeof click !== "function") {
      return {
        ok: false,
        detail: `${APPLICATION_FIELDS_TOOL} runner click primitive unavailable.`,
      };
    }

    const options = collectChoiceOptionInfos(field.root, []).map((option) => ({
      ...option,
      text: option.optionText,
      el: option.optionEl,
    }));
    const requested = requestedChoiceValues(
      value,
      field.fieldKind === "multi_select",
    );
    const committed = [];
    const failed = [];

    for (const requestedValue of requested) {
      const already = options.find(
        (option) =>
          option.selected &&
          valuesEquivalent(option.optionText, requestedValue, field.fieldKey),
      );
      if (already) {
        committed.push(already.optionText);
        continue;
      }

      const match = matchComboboxOption(options, requestedValue, field.fieldKey);
      if (!match?.el) {
        failed.push(requestedValue);
        continue;
      }
      await click(match.el);
      await delay(120);
      const verified = collectChoiceOptionInfos(field.root, []).find(
        (option) =>
          option.selected &&
          valuesEquivalent(option.optionText, requestedValue, field.fieldKey),
      );
      if (verified) committed.push(verified.optionText);
      else failed.push(requestedValue);
      if (field.fieldKind !== "multi_select") break;
    }

    return {
      ok: committed.length > 0 && failed.length === 0,
      recoverable: failed.length > 0,
      continueBatch: failed.length > 0,
      committed: committed.length > 0 && failed.length === 0,
      value: runtimeFieldCurrentValue(field),
      detail: failed.length
        ? `No Greenhouse option matched ${failed.join(", ")} for ${field.fieldKey}.`
        : `Set ${field.fieldKey} to ${committed.join(", ")}.`,
      options: failed.length
        ? options.map((option) => option.optionText).slice(0, 12)
        : undefined,
    };
  }

  async function fillRuntimeCheckboxField(field, value, ctx) {
    const click = ctx?.primitives?.clickElement;
    const input = field.root.querySelector("input[type='checkbox']");
    const desired = desiredBoolean(value);
    if (!input || desired === null) return fillRuntimeChoiceField(field, value, ctx);
    if (typeof click !== "function") {
      return {
        ok: false,
        detail: `${APPLICATION_FIELDS_TOOL} runner click primitive unavailable.`,
      };
    }
    if (Boolean(input.checked) !== desired) {
      await click(labelElementForInput(field.root, input) || input);
      await delay(120);
    }
    const committed = Boolean(input.checked) === desired;
    return {
      ok: committed,
      recoverable: !committed,
      continueBatch: !committed,
      committed,
      value: Boolean(input.checked) ? "true" : "false",
      detail: `Set ${field.fieldKey} checkbox to ${Boolean(input.checked)}.`,
    };
  }

  function phoneValuesEquivalent(leftValue, rightValue) {
    const digits = (value) => String(value || "").replace(/\D/g, "");
    const left = digits(leftValue);
    const right = digits(rightValue);
    if (!left || !right) return false;
    if (left === right) return true;

    const national = (value) =>
      value.length === 11 && value.startsWith("1") ? value.slice(1) : value;
    const leftNational = national(left);
    const rightNational = national(right);
    return (
      leftNational.length === 10 &&
      rightNational.length === 10 &&
      leftNational === rightNational
    );
  }

  async function fillRuntimeNativeOrTextField(field, value, ctx) {
    const fill = ctx?.primitives?.fillElement;
    if (!field.input || typeof fill !== "function") {
      return {
        ok: false,
        detail: `${APPLICATION_FIELDS_TOOL} runner fill primitive unavailable for ${field.fieldKey}.`,
      };
    }

    const current = runtimeFieldCurrentValue(field);
    const currentMatches = lower(field.fieldKey) === "phone"
      ? phoneValuesEquivalent(current, value)
      : valuesEquivalent(current, value, field.fieldKey);
    if (current && currentMatches) {
      return {
        ok: true,
        committed: true,
        value: current,
        verificationMode: field.input.tagName === "TEXTAREA"
          ? "exact_normalized_text"
          : "adapter_equivalent",
        detail: `${field.fieldKey} already set to "${current}".`,
      };
    }

    await fill(field.input, value);
    await delay(100);
    const committedValue = runtimeFieldCurrentValue(field);
    const committed = field.fieldKind === "select"
      ? valuesEquivalent(committedValue, value, field.fieldKey)
      : lower(field.fieldKey) === "phone"
        ? phoneValuesEquivalent(committedValue, value)
        : normalizeText(committedValue) === normalizeText(value);
    return {
      ok: committed,
      recoverable: !committed,
      continueBatch: !committed,
      committed,
      value: committedValue,
      verificationMode: field.input.tagName === "TEXTAREA"
        ? "exact_normalized_text"
        : "adapter_equivalent",
      detail: committed
        ? `Filled ${field.fieldKey}.`
        : `Filled ${field.fieldKey}; verify on the next observation.`,
    };
  }

  async function fillRuntimeApplicationField(fieldKey, value, ctx) {
    const field = locateRuntimeApplicationField(fieldKey);
    if (!field) {
      return {
        ok: false,
        recoverable: true,
        continueBatch: true,
        detail: `No eligible Greenhouse application field found for ${fieldKey}.`,
      };
    }
    if (field.fieldKind === "combobox") {
      return fillSelectByFieldKey(field.inputId || field.fieldKey, value, ctx);
    }
    if (field.fieldKind === "checkbox") {
      return fillRuntimeCheckboxField(field, value, ctx);
    }
    if (
      field.options?.length ||
      /^(single_select|multi_select)$/.test(field.fieldKind)
    ) {
      return fillRuntimeChoiceField(field, value, ctx);
    }
    return fillRuntimeNativeOrTextField(field, value, ctx);
  }

  function runtimeFieldTarget(fieldKey) {
    const field = locateRuntimeApplicationField(fieldKey);
    if (!field) return null;
    return {
      groupTargetId: fieldTargetId(field.fieldKey),
      matchedBy: "fieldKey",
      matchMode: "greenhouse_runtime_field",
      controlIds: [],
    };
  }

  async function greenhouseFillApplicationFields(action, ctx) {
    const requestedFieldValues = fieldValuesFromAction(action);
    const entries = orderedApplicationFieldEntries(requestedFieldValues);
    if (!entries.length) {
      return {
        ok: false,
        detail: `${APPLICATION_FIELDS_TOOL} requires at least one fieldValues entry.`,
      };
    }

    const results = [];
    const committedFieldValues = {};
    const fieldEvidence = {};
    const fieldTargets = {};
    const failed = [];
    const skipped = [];

    for (const [fieldKey, value] of entries) {
      const result = await fillRuntimeApplicationField(fieldKey, value, ctx);
      const ok = result.ok !== false && result.committed !== false;
      const target = runtimeFieldTarget(fieldKey);
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
      if (result.skipped) skipped.push(fieldKey);
      else if (!ok) failed.push(fieldKey);
      else {
        const committedValue = result.value || value;
        committedFieldValues[fieldKey] = committedValue;
        if (result.verificationMode === "exact_normalized_text") {
          fieldEvidence[fieldKey] = {
            ...(await committedValueEvidence(committedValue)),
            verificationMode: result.verificationMode,
          };
        }
      }
    }

    const committedCount = Object.keys(committedFieldValues).length;
    return {
      ok: committedCount > 0 || (entries.length > 0 && !failed.length),
      recoverable: failed.length > 0,
      continueBatch: failed.length > 0,
      committed: failed.length === 0,
      fieldValues: committedFieldValues,
      fieldEvidence,
      fieldTargets,
      failed,
      skipped,
      results,
      detail: failed.length
        ? `${APPLICATION_FIELDS_TOOL} filled ${committedCount} field(s); ${failed.length} field(s) need fallback.`
        : `${APPLICATION_FIELDS_TOOL} filled ${committedCount} field(s).`,
    };
  }

  async function greenhouseWriteCoverLetter(action, ctx) {
    const letterText = coverLetterTextFromAction(action);
    const hasText = Boolean(normalizeText(letterText));
    const fill = ctx?.primitives?.fillElement;
    const click = ctx?.primitives?.clickElement;

    if (!hasText) {
      return {
        ok: false,
        detail: "greenhouse_write_cover_letter requires letterText.",
      };
    }
    if (typeof fill !== "function") {
      return {
        ok: false,
        detail: "greenhouse_write_cover_letter runner fill primitive unavailable.",
      };
    }

    let textarea = coverLetterTextarea(document);
    const manualButton = findCoverLetterManualButton(document);

    if (!(textarea && isVisible(textarea)) && manualButton) {
      if (typeof click !== "function") {
        return {
          ok: false,
          detail:
            "greenhouse_write_cover_letter needs clickElement to open Enter manually.",
        };
      }
      await click(manualButton);
      await delay(200);
    }

    textarea = await waitForCoverLetterTextarea();
    if (!textarea || !isVisible(textarea)) {
      return {
        ok: false,
        recoverable: true,
        detail:
          "Could not find the Greenhouse #cover_letter_text textarea after opening Enter manually.",
      };
    }

    await fill(textarea, letterText);
    await delay(100);

    const committedValue = String(
      textarea.value ?? textarea.getAttribute("value") ?? "",
    );
    const committed = normalizeText(committedValue) === normalizeText(letterText);

    return {
      ok: committed,
      committed,
      fieldKey: "cover_letter_text",
      characterCount: letterText.length,
      valuePreview: truncate(committedValue, 180),
      valueEvidence: {
        ...(await committedValueEvidence(committedValue)),
        verificationMode: "exact_normalized_text",
      },
      detail: committed
        ? "Committed the caller-provided cover letter text."
        : "Filled the cover-letter textarea; verify on next observation.",
    };
  }

  function eeocFieldValuesFromAction(action, fields) {
    const source =
      action?.fieldValues &&
      typeof action.fieldValues === "object" &&
      !Array.isArray(action.fieldValues)
        ? action.fieldValues
        : action || {};
    const fieldValues = {};

    for (const field of fields || []) {
      const value = normalizeText(source[field.fieldKey]);
      if (value) fieldValues[field.fieldKey] = value;
    }

    return fieldValues;
  }

  async function greenhouseFillEeoc(action, ctx) {
    const fields = sensitiveSelectFields(document);
    const requestedFieldValues = eeocFieldValuesFromAction(action, fields);
    const entries = fields
      .map((field) => [field, requestedFieldValues[field.fieldKey]])
      .filter(([, value]) => value);

    if (!entries.length) {
      return {
        ok: false,
        detail:
          "greenhouse_fill_eeoc requires at least one explicit EEOC fieldValues entry.",
      };
    }

    const results = [];
    const committedFieldValues = {};
    const fieldTargets = {};
    const failed = [];

    for (const [field, value] of entries) {
      const fieldKey = field.fieldKey;
      const result = await fillSelectByFieldKey(field.inputId || fieldKey, value, ctx, {
        scopeSelector: field.scopeSelector,
      });
      fieldTargets[fieldKey] = {
        groupTargetId: fieldTargetId(fieldKey),
        matchedBy: "fieldKey",
        matchMode: `greenhouse_${field.sectionKind}_select`,
        controlIds: [],
      };
      results.push({
        fieldKey,
        requestedValue: value,
        ok: result.ok !== false && result.committed !== false,
        committed: Boolean(result.committed),
        value: result.value || "",
        detail: result.detail || "",
        options: result.options || undefined,
      });

      if (result.ok === false || result.committed === false) {
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
      fieldTargets,
      failed,
      results,
      detail: failed.length
        ? `Filled ${committedCount} EEOC field(s); ${failed.length} field(s) need fallback.`
        : `Filled ${committedCount} EEOC field(s).`,
    };
  }

  async function greenhouseReadJobDescription() {
    const jobPosting = extractGreenhouseJobPosting(document);
    if (!jobPosting) {
      return { ok: false, detail: "Greenhouse job description is not available." };
    }
    return {
      ok: true,
      committed: false,
      jobPosting,
      detail: "Read the current Greenhouse job description.",
    };
  }

  async function greenhouseSubmitApplication(_action, ctx) {
    const target = exactSubmitTarget(ctx?.state || {}, document);
    if (
      !target ||
      !target.enabled ||
      !ctx?.state?.siteAdapter?.submitTargetId ||
      target.targetId !== ctx.state.siteAdapter.submitTargetId
    ) {
      return { ok: false, detail: "Exact Greenhouse submit control is unavailable." };
    }
    const readiness = submitReadiness(document);
    if (!readiness.ready) {
      return {
        ok: false,
        code: "APPLICATION_NOT_READY",
        committed: false,
        missingRequiredFields: readiness.missingRequiredFields,
        detail: `Greenhouse application has ${readiness.missingRequiredFields.length} missing required field(s).`,
      };
    }
    if (typeof ctx?.primitives?.clickElement !== "function") {
      return { ok: false, detail: "Greenhouse submit click primitive is unavailable." };
    }
    await ctx.primitives.clickElement(target.element);
    return {
      ok: true,
      committed: true,
      submitted: true,
      detail: "Activated the exact Greenhouse Submit Application control.",
    };
  }

  if (
    globalThis.WebGPTConnectorTools &&
    typeof globalThis.WebGPTConnectorTools.register === "function"
  ) {
    globalThis.WebGPTConnectorTools.register(
      APPLICATION_FIELDS_TOOL,
      greenhouseFillApplicationFields,
    );
    globalThis.WebGPTConnectorTools.register(
      SELECT_TOOL,
      greenhouseFillSelect,
    );
    globalThis.WebGPTConnectorTools.register(
      EEOC_TOOL,
      greenhouseFillEeoc,
    );
    globalThis.WebGPTConnectorTools.register(
      "greenhouse_write_cover_letter",
      greenhouseWriteCoverLetter,
    );
    globalThis.WebGPTConnectorTools.register(
      READ_JOB_DESCRIPTION_TOOL,
      greenhouseReadJobDescription,
    );
  }

  registry.register({
    id: ADAPTER_ID,
    priority: 84,
    provides: {
      "job.description.read": READ_JOB_DESCRIPTION_TOOL,
      "application.read": READ_APPLICATION_OPERATION,
      "application.fill": APPLICATION_FIELDS_TOOL,
      "application.eeoc.fill": EEOC_TOOL,
      "application.file.upload": UPLOAD_APPLICATION_FILE_TOOL,
      "application.submit": SUBMIT_APPLICATION_TOOL,
    },
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
          jobPosting: siteAdapter.jobPosting,
          primaryControlIds: siteAdapter.primaryControlIds,
          actionHintsByTargetId: siteAdapter.actionHintsByTargetId,
          plannerHints: siteAdapter.plannerHints,
        },
        visibleTextSummary: [
          ...(siteAdapter.visibleTextSummary || []),
          ...siteAdapter.plannerHints,
          ...filterPlannerNoiseList(
            state.visibleTextSummary || [],
            siteAdapter.jobDescriptionEvidence,
          ),
        ].slice(0, 80),
        headings: filterPlannerNoiseHeadings(
          state.headings || [],
          siteAdapter.jobDescriptionEvidence,
        ),
        groups: [
          ...siteAdapter.groups,
          ...filterPlannerNoiseGroups(
            state.groups || [],
            siteAdapter.jobDescriptionEvidence,
          ),
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
