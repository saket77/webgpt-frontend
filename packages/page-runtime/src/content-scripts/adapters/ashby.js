(function () {
  const ADAPTER_ID = "ashby.application";
  const APPLICATION_TARGET_ID = `site:${ADAPTER_ID}:application`;
  const APPLICATION_FIELDS_TOOL = "ashby_fill_application_fields";
  const EEOC_TOOL = "ashby_fill_eeoc";
  const READ_JOB_DESCRIPTION_TOOL = "ashby_read_job_description";
  const UPLOAD_APPLICATION_FILE_TOOL = "ashby_upload_application_file";
  const SUBMIT_APPLICATION_TOOL = "ashby_submit_application";
  const EEOC_SECTION_TARGET_ID = `site:${ADAPTER_ID}:section:eeoc`;
  const EEOC_FIELD_SPECS = [
    { fieldKey: "gender", label: "Gender" },
    { fieldKey: "race", label: "Race" },
    { fieldKey: "veteran_status", label: "Veteran Status" },
    { fieldKey: "disability_status", label: "Disability Status" },
  ];
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

  function jsonLdItems(value) {
    if (Array.isArray(value)) return value.flatMap(jsonLdItems);
    if (!value || typeof value !== "object") return [];
    return [value, ...jsonLdItems(value["@graph"] || [])];
  }

  function jsonLdTypeIncludes(value, expected) {
    const values = Array.isArray(value) ? value : [value];
    return values.some((item) => lower(item) === lower(expected));
  }

  function ashbyJobDescriptionText(value, documentRef) {
    const root = documentRef.createElement("div");
    root.innerHTML = String(value || "");
    for (const el of root.querySelectorAll(
      [
        "form",
        ".ashby-application-form-container",
        ".ashby-survey-form-container",
        ".ashby-application-form-submit-button",
        "script",
        "style",
        "noscript",
      ].join(","),
    )) {
      el.remove();
    }
    const blocks = new Set([
      "article", "blockquote", "div", "h1", "h2", "h3", "h4", "h5", "h6",
      "li", "ol", "p", "section", "ul",
    ]);
    let result = "";
    function visit(node) {
      if (node.nodeType === 3) {
        result += node.nodeValue || "";
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = lower(node.tagName);
      if (tag === "br") {
        result += "\n";
        return;
      }
      if (blocks.has(tag)) result += "\n";
      if (tag === "li") result += "- ";
      for (const child of node.childNodes) visit(child);
      if (blocks.has(tag)) result += "\n";
    }
    visit(root);
    return result
      .split(/\n+/)
      .map(normalizeText)
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function firstAshbyText(documentRef, selectors) {
    for (const selector of selectors) {
      const value = textContent(documentRef.querySelector(selector));
      if (value) return value;
    }
    return "";
  }

  function ashbyLocationText(jobLocation) {
    const locations = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
    return unique(
      locations.flatMap((locationItem) => {
        const address = locationItem?.address || {};
        return [
          address.addressLocality,
          address.addressRegion,
          address.addressCountry,
          locationItem?.name,
        ].map(normalizeText);
      }),
    ).join(", ");
  }

  function compactAshbyBaseSalary(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const amount =
      value.value && typeof value.value === "object" && !Array.isArray(value.value)
        ? value.value
        : value;
    const compactAmount = {};
    for (const key of ["minValue", "maxValue", "value"]) {
      const rawValue = amount[key];
      if (
        rawValue === null ||
        rawValue === undefined ||
        (typeof rawValue === "string" && !rawValue.trim())
      ) {
        continue;
      }
      const numericValue = Number(rawValue);
      if (Number.isFinite(numericValue)) compactAmount[key] = numericValue;
    }
    const unitText = normalizeText(amount.unitText);
    if (unitText) compactAmount.unitText = unitText;
    const currency = normalizeText(value.currency || amount.currency);
    if (!currency && !Object.keys(compactAmount).length) return null;
    return {
      ...(currency ? { currency } : {}),
      ...(Object.keys(compactAmount).length ? { value: compactAmount } : {}),
    };
  }

  function ashbyJobDescriptionContext(documentRef = document) {
    let structured = null;
    for (const script of documentRef.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        structured = jsonLdItems(JSON.parse(script.textContent || "null")).find((item) =>
          jsonLdTypeIncludes(item?.["@type"], "JobPosting"),
        );
      } catch {
        structured = null;
      }
      if (structured) break;
    }

    const descriptionRoot = documentRef.querySelector(
      ".ashby-job-posting-description, .ashby-job-posting-right-pane",
    );
    const fullDescription = ashbyJobDescriptionText(
      structured?.description || descriptionRoot?.innerHTML || "",
      documentRef,
    );
    return { structured, descriptionRoot, fullDescription };
  }

  function extractAshbyJobPosting(
    documentRef = document,
    descriptionContext = ashbyJobDescriptionContext(documentRef),
  ) {
    const { structured, fullDescription } = descriptionContext;
    const description = fullDescription.slice(0, 24000).trim();
    if (!description) return null;

    const title =
      normalizeText(structured?.title) ||
      firstAshbyText(documentRef, [
        ".ashby-job-posting-heading",
        ".ashby-job-posting-title",
        ".ashby-job-posting-right-pane h1",
        "main h1",
        "h1",
      ]);
    const company =
      normalizeText(structured?.hiringOrganization?.name) ||
      firstAshbyText(documentRef, [
        ".ashby-job-posting-company-name",
        ".ashby-job-posting-header-company",
      ]);
    const locationTextValue =
      ashbyLocationText(structured?.jobLocation) ||
      firstAshbyText(documentRef, [
        ".ashby-job-posting-location",
        ".ashby-job-posting-heading + div",
      ]);
    const canonicalUrl = normalizeText(
      structured?.url ||
        documentRef.querySelector("link[rel='canonical']")?.href ||
        documentRef.location?.href ||
        location.href,
    );
    const posting = {
      "@type": "JobPosting",
      source: structured ? "ashby_json_ld" : "ashby_dom",
      title,
      company,
      location: locationTextValue,
      description,
      descriptionTruncated: description.length < fullDescription.length,
      descriptionOriginalCharCount: fullDescription.length,
      url: canonicalUrl,
    };
    if (company) {
      posting.hiringOrganization = { "@type": "Organization", name: company };
    }
    if (locationTextValue) {
      posting.jobLocation = {
        "@type": "Place",
        address: { "@type": "PostalAddress", addressLocality: locationTextValue },
      };
    }
    for (const key of [
      "datePosted",
      "validThrough",
      "employmentType",
      "jobLocationType",
    ]) {
      if (structured?.[key]) posting[key] = structured[key];
    }
    const baseSalary = compactAshbyBaseSalary(structured?.baseSalary);
    if (baseSalary) posting.baseSalary = baseSalary;
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

  function isRequiredControl(control) {
    return Boolean(
      control &&
        (control.hasAttribute("required") ||
          lower(control.getAttribute("aria-required")) === "true"),
    );
  }

  function normalizedSmsConsentValue(value) {
    const text = normalizeText(value);
    const key = lower(text);
    if (/^yes\b/.test(key) || /\bi consent\b/.test(key)) return "Yes";
    if (/^no\b/.test(key) || /\b(?:do not|don't) consent\b/.test(key)) return "No";
    return text;
  }

  function selectedSmsConsentValue(options) {
    const selected = (options || []).find((option) => option.selected);
    return selected ? normalizedSmsConsentValue(selected.optionText) : "";
  }

  function phoneSmsComposite(root, input, question, fieldPath) {
    if (!input || lower(input.getAttribute("type")) !== "tel") return null;

    const consentInputs = getElements("input[type='radio']", root);
    if (consentInputs.length < 2) return null;

    const consentText = lower(
      consentInputs
        .map((control) => textContent(labelElementForInput(root, control)))
        .join(" "),
    );
    const rootText = lower(textContent(root));
    if (
      !/\b(?:sms|text message|text messages)\b/.test(`${consentText} ${rootText}`) ||
      !/\b(?:consent|agreement|agree|updates?|communications?)\b/.test(
        `${consentText} ${rootText}`,
      )
    ) {
      return null;
    }

    const prompt = getElements(
      "p, [class*='description'], [class*='helper'], [class*='subtitle']",
      root,
    )
      .map((el) => textContent(el))
      .find((text) => /\b(?:sms|text message|text messages)\b/i.test(text));

    return {
      fieldPath,
      phone: {
        fieldKey: `${fieldPath}::phone`,
        logicalKind: "phone",
        question,
        input,
        fieldKind: inputKind(input) || "tel",
        required: isRequiredControl(input),
      },
      smsConsent: {
        fieldKey: `${fieldPath}::sms_consent`,
        logicalKind: "sms_consent",
        question: truncate(prompt || "SMS consent", 220),
        input: null,
        fieldKind: "single_select",
        required: consentInputs.some(isRequiredControl),
      },
    };
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

  function isSensitiveField(question) {
    const text = lower(question);
    return (
      /\b(current age|gender identity|ethnicity|ethnicities)\b/.test(text) ||
      /which of the following communities do you belong to/.test(text) ||
      /\b(disability|neurodivergent|veteran|refugee|immigrant)\b/.test(text)
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

  function collectPhoneSmsConsentOptionInfos(root, controls) {
    const options = [];
    for (const input of getElements("input[type='radio']", root)) {
      const wrapper = optionWrapperForInput(input, root);
      const label = directLabelForInput(root, input) || textContent(wrapper);
      const labelEl = labelElementForInput(root, input);
      const control =
        findControlForElement(controls, input) ||
        findControlForElement(controls, labelEl) ||
        findControlForElement(controls, wrapper);
      addOption(options, wrapper, label, input.checked, control?.id || "");
    }
    return options;
  }

  function selectedValueFromOptions(options) {
    return (options || [])
      .filter((option) => option.selected)
      .map((option) => option.optionText)
      .join(", ");
  }

  function exactTextValueForField(root) {
    const input = root.querySelector(
      "textarea, input:not([type='hidden']):not([type='file']):not([type='radio']):not([type='checkbox'])",
    );
    if (!input) return "";
    return normalizeText(input.value ?? input.getAttribute("value") ?? "");
  }

  function textValueForField(root) {
    return truncate(exactTextValueForField(root), 360);
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
    const files = Array.from(input?.files || [])
      .map((file) => file.name)
      .filter(Boolean);
    if (files.length) return files.join(", ");

    return normalizeText(
      root.querySelector(".ashby-application-form-input-file-item-name")
        ?.textContent || "",
    );
  }

  function uploadTriggerInfo(state, root, input) {
    if (!input || lower(input.getAttribute("type")) !== "file") return null;

    const inputId = normalizeText(input.id);
    const inputSelector = inputId ? `#${cssEscape(inputId)}` : "";
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
              `.ashby-application-form-input-file:has(${inputSelector}) button`,
              `.ashby-application-form-field-entry:has(${inputSelector}) button`,
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

    // The browser host's native upload contract prefers the actual file input.
    // Ashby themes may render a nearby "Upload File" button that opens custom
    // UI without emitting a filechooser event. A file input that the extracted
    // state can identify exactly remains safe even when visually clipped because
    // the host activates the native picker only for a verified input[type=file].
    for (const tier of [[input], uploadButtons, inputLabels]) {
      const candidates = provableTriggers(tier);
      if (candidates.length === 1) {
        const [{ controlId, selector }] = candidates;
        return { controlId, selector };
      }
      if (candidates.length > 1) return null;
    }

    return null;
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

  function collectField(state, root, index, logical = null) {
    const regionControls = controlsInRegion(state.controls || [], root);
    const rootQuestion = questionText(root);
    const rootInput = findPrimaryInput(root);
    const question = logical?.question || rootQuestion;
    const input = logical ? logical.input : rootInput;
    const hasCombobox = logical
      ? false
      : fieldHasCombobox(root, regionControls);
    const controls = hasCombobox
      ? regionControls
      : regionControls.filter((control) => !isComboboxPopupControl(control));
    const fieldPath = fieldPathFor(root, rootInput, rootQuestion, index);
    const entryId = fieldEntryIdFor(root);
    const eeocSpec = eeocFieldSpecFor(question, fieldPath);
    const sectionKind = eeocSpec ? "eeoc" : sectionKindForField(question, fieldPath);
    const fieldKey = logical?.fieldKey || eeocSpec?.fieldKey || fieldPath;
    const targetKey = logical?.fieldKey ? fieldKey : fieldPath;
    const options = logical?.logicalKind === "phone"
      ? []
      : logical?.logicalKind === "sms_consent"
        ? collectPhoneSmsConsentOptionInfos(root, controls)
        : hasCombobox
          ? collectComboboxOptionInfos(input, state.controls || [])
          : collectOptionInfos(root, controls, question);
    const kind = logical?.fieldKind || fieldKind(root, options.length, hasCombobox);
    const isCombobox = kind === "combobox";
    const uploadBoundary = kind === "file";
    const selectedValue = isCombobox
      ? ""
      : logical?.logicalKind === "sms_consent"
        ? selectedSmsConsentValue(options)
        : selectedValueFromOptions(options);
    const textValue = logical?.logicalKind === "sms_consent"
      ? ""
      : truncate(input?.value ?? input?.getAttribute("value") ?? "", 360);
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
    const optionControlIds = unique(
      options.flatMap((option) => option.controlIds || []),
    );
    const fillControl =
      findControlForElement(state.controls || [], input) ||
      (logical?.logicalKind === "sms_consent"
        ? controls.find((control) => optionControlIds.includes(control.id)) || null
        : findBestControlInRegion(state.controls || [], root, {
            preferInput: !options.length || kind === "combobox",
          }));
    const uploadTrigger = uploadBoundary
      ? uploadTriggerInfo(state, root, input)
      : null;
    const fieldControlIds = unique(
      (logical?.logicalKind === "phone"
        ? [fillControl?.id]
        : logical?.logicalKind === "sms_consent"
          ? [fillControl?.id, ...optionControlIds]
          : uploadBoundary
            ? [
                uploadTrigger?.controlId,
                fillControl?.id,
                ...controls.map((control) => control.id),
              ]
            : [fillControl?.id, ...controls.map((control) => control.id)]
      ).filter(Boolean),
    );
    const sensitive = sectionKind === "eeoc" || isSensitiveField(question);
    const blankFillable = Boolean(
      !answered &&
        fillControl?.id &&
        !uploadBoundary,
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
          ? { fieldPath: fieldKey }
          : null;
    const batchPlacement = connectorTool ? "can_batch" : "";
    const verifyAfterAction = connectorTool ? "adapter_group_current_value" : "";
    const textFacts = [
      question,
      rawValue ? `current value: ${currentValue}` : "currentValue: blank",
      `answered: ${answered ? "true" : "false"}`,
      needsAutocompleteCommit
        ? "autocomplete options visible; click the matching option to commit"
        : "",
      sensitive
        ? "sensitive field detected"
        : "",
      connectorTool === APPLICATION_FIELDS_TOOL
        ? `connector action available: ${APPLICATION_FIELDS_TOOL} with fieldValues.${fieldKey}`
        : "",
      connectorTool === EEOC_TOOL
        ? `connector action available: ${EEOC_TOOL} with fieldValues.${eeocSpec?.fieldKey || fieldPath}`
        : "",
    ];

    return {
      id: `ashby_field_${stableKey(fieldKey, `field_${index + 1}`)}`,
      kind: "ashby_application_field",
      adapterId: ADAPTER_ID,
      targetId: fieldTargetId(targetKey),
      fieldKey,
      fieldPath,
      targetKey,
      logicalKind: logical?.logicalKind || "",
      fieldEntryId: entryId,
      eeocFieldKey: eeocSpec?.fieldKey || "",
      sectionKind,
      fieldKind: kind,
      required: logical ? Boolean(logical.required) : isRequiredField(root),
      label: question,
      text: textFacts.filter(Boolean).join(" | "),
      currentValue,
      selectedValue,
      answered,
      blank: !rawValue,
      sensitive,
      blankFillable,
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
      controlIds: fieldControlIds,
      optionTargets: options.map((option) => optionTargetId(targetKey, option.optionText)),
      optionTexts: options.map((option) => option.optionText),
      options,
      controls,
      bounds: elementBounds(root),
    };
  }

  function collectFields(state, root, index) {
    const question = questionText(root);
    const input = findPrimaryInput(root);
    const fieldPath = fieldPathFor(root, input, question, index);
    const composite = phoneSmsComposite(root, input, question, fieldPath);
    if (!composite) return [collectField(state, root, index)];

    return [
      collectField(state, root, index, composite.phone),
      collectField(state, root, index, composite.smsConsent),
    ];
  }

  function selectedOptionGroups(fields) {
    const groups = [];

    for (const field of fields) {
      for (const option of field.options || []) {
        const targetId = optionTargetId(field.targetKey, option.optionText);
        const controlIds = unique(option.controlIds || []);

        groups.push({
          id: `ashby_option_${stableKey(field.targetKey)}_${stableKey(
            option.optionText,
            "option",
          )}`,
          kind: "ashby_application_option",
          adapterId: ADAPTER_ID,
          targetId,
          fieldTargetId: field.targetId,
          fieldKey: field.fieldKey,
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
      fieldKey: field.fieldKey,
      fieldPath: field.fieldPath,
      logicalKind: field.logicalKind,
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
      sensitive: field.sensitive,
      blankFillable: field.blankFillable,
      uploadBoundary: field.uploadBoundary,
      committedFilename: field.committedFilename,
      uploadTriggerTargetId: field.uploadTriggerTargetId,
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

    const fieldKeys = fillableFields.map((field) => field.fieldKey);
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
          `connector action available: ${APPLICATION_FIELDS_TOOL} with fieldValues for ${fieldKeys.join(", ")}`,
          "The connector applies only caller-provided exact field-keyed values and leaves omitted fields unchanged",
          blankLabels.length
            ? `blank non-file fields: ${blankLabels.join(" | ")}`
            : "no blank non-file application fields detected",
          answeredLabels.length ? `answered fields: ${answeredLabels.join(" | ")}` : "",
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
          "The connector applies only caller-provided exact field-keyed values and leaves omitted fields unchanged",
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
          field.fieldKind !== "file",
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
    const blankSensitiveFields = fields
      .filter((field) => field.sensitive && !field.answered)
      .map((field) => field.label)
      .slice(0, 12);
    const currentValue = missingRequired.length
      ? `missing required: ${missingRequired.join(", ")}`
      : "all non-file required fields answered";

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
        blankSensitiveFields.length
          ? `sensitive fields blank: ${blankSensitiveFields.join(" | ")}`
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
            machineKey: field.fieldKey,
            answerText: field.label,
            instruction:
              "Ashby file-upload boundary. Use the host-routed upload operation for this exact field.",
          });
        }
        continue;
      }

      if (field.connectorTool) {
        const connectorInstruction =
          field.connectorTool === EEOC_TOOL
            ? `Use ${EEOC_TOOL} with an exact caller-provided fieldValues.${field.fieldKey} value for this Ashby EEOC field.`
            : `Use ${APPLICATION_FIELDS_TOOL} with an exact caller-provided fieldValues.${field.fieldKey} value for this Ashby non-file field. Do not fill or click this connector-managed control directly.`;
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
          machineKey: field.fieldKey,
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
            machineKey: field.fieldKey,
            answerText: field.label,
            instruction: isCombobox
              ? "This Ashby field is an autocomplete combobox. Enter an exact caller-provided value, observe the listbox, then click the exact matching visible option to commit it. Typing alone or pressing Enter may not commit the answer."
              : "Fill this Ashby application field with an exact caller-provided value.",
          });
        }
      }

      for (const option of field.options || []) {
        const targetIds = actionableControlIds(option.controlIds, controlsById);
        const isComboboxOption = field.fieldKind === "combobox";
        const isConnectorManagedOption = Boolean(field.connectorTool && !isComboboxOption);
        const optionInstruction = option.selected
          ? "This Ashby option is already selected in adapter state."
          : field.connectorTool === EEOC_TOOL
            ? `Ashby EEOC option. Use ${EEOC_TOOL} with this exact visible value.`
            : field.connectorTool === APPLICATION_FIELDS_TOOL
              ? `Ashby application option. Use ${APPLICATION_FIELDS_TOOL} with this exact visible fieldValues.${field.fieldKey} value.`
              : "Ashby application option with exact visible text.";

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
            stableFieldTargetId: optionTargetId(field.targetKey, option.optionText),
            machineKey: field.fieldKey,
            checked: isComboboxOption ? undefined : Boolean(option.selected),
            answerText: option.optionText,
            verifyAfterAction: isComboboxOption
              ? "adapter_group_current_value"
              : "adapter_group_selected_value",
            instruction: isComboboxOption
              ? "Use this visible Ashby autocomplete option only when its normalized text exactly matches the caller-provided value, then observe fresh state to verify commitment."
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
          "Ashby file-upload boundary. Use the host-routed upload operation for this exact field.",
      });
    }

    addHint(actionHintsByTargetId, submitTargetId, {
      semanticRole: "ashby_submit_application_boundary",
      protectedEffect: "submit",
      preferredAction: "click",
      navigationAction: true,
      avoidAction: true,
      instruction:
        "Final Submit Application boundary. Generic click and key actions are blocked; use the host-authorized guarded submit operation.",
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
      if (field.uploadTriggerTargetId && field.uploadTriggerSelector) {
        overrides[field.uploadTriggerTargetId] = field.uploadTriggerSelector;
      }
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
    const root =
      documentRef.querySelector(".ashby-application-form-container") || documentRef;
    return unique(
      getVisibleElements(
        "button, input[type='submit'], [role='button']",
        root,
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
      element.matches(".ashby-application-form-submit-button")
        ? ".ashby-application-form-submit-button"
        : "",
      ".ashby-application-form-container button[type='submit']",
      ".ashby-application-form-container input[type='submit']",
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

  function findSubmitTargetId(state, documentRef) {
    return exactSubmitTarget(state, documentRef)?.targetId || "";
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
          field.required &&
          !field.answered &&
          field.fieldKind !== "file",
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
    const blankSensitiveFields = fields
      .filter((field) => field.sensitive && !field.answered)
      .map((field) => field.label)
      .slice(0, 10);

    return [
      "Ashby adapter active: use Ashby application groups and adapter control labels as high-confidence field state.",
      `${APPLICATION_FIELDS_TOOL}(fieldValues) accepts exact caller-provided values keyed by live non-file, non-EEOC Ashby fieldKey and leaves omitted fields unchanged.`,
      `${EEOC_TOOL}(fieldValues) accepts exact caller-provided values keyed by live Ashby EEOC fieldKey and leaves omitted fields unchanged.`,
      "Ashby connector-managed controls execute through their advertised connector tool and are verified from fresh adapter state.",
      "Selected option state is reported for idempotence; observe fresh state after an option changes.",
      selected.length ? `Currently selected Ashby options: ${selected.join(" | ")}.` : "",
      missingRequired.length
        ? `Ashby required fields still missing or unsupported: ${missingRequired.join(" | ")}.`
        : "No required Ashby text or choice field is visibly missing.",
      blankSensitiveFields.length
        ? `Ashby sensitive fields currently blank: ${blankSensitiveFields.join(" | ")}.`
        : "",
      requiredUploadBoundaries.length
        ? `Ashby required file-upload boundaries currently blank: ${requiredUploadBoundaries.join(" | ")}.`
        : "",
      uploadTargetIds.length
        ? "Ashby file-upload controls require the host-routed upload operation for an exact live field."
        : "",
      submitTargetId
        ? `Ashby Submit Application target ${submitTargetId} is guarded; generic click and key actions cannot activate it.`
        : "",
      "Ashby legal and EEOC explanatory copy is filtered from actionable state; field groups and optionTexts remain authoritative.",
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
          field.fieldKind !== "file",
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
    const blankSensitiveFields = fields
      .filter((field) => field.sensitive && !field.answered)
      .map((field) => field.label)
      .slice(0, 12);

    return [
      `Ashby application adapter: ${fields.length} fields detected.`,
      selected.length ? `Ashby selected options: ${selected.join(" | ")}` : "",
      missing.length
        ? `Ashby missing required/unsupported fields: ${missing.join(" | ")}`
        : "Ashby required text and choice fields appear answered.",
      blankSensitiveFields.length
        ? `Ashby sensitive fields blank: ${blankSensitiveFields.join(" | ")}`
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

  function buildPlannerDescriptionEvidence(descriptionContext) {
    const fullText = lower(descriptionContext?.fullDescription);
    const textKeys = new Set();
    const headingKeys = new Set();
    const descriptionRoot = descriptionContext?.descriptionRoot;
    const excludedSelector = [
      "form",
      ".ashby-application-form-container",
      ".ashby-survey-form-container",
      ".ashby-application-form-submit-button",
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
        !isAshbyPolicyNoiseText(item) &&
        !isPlannerDescriptionText(item, descriptionEvidence),
    );
  }

  function filterPlannerNoiseHeadings(headings, descriptionEvidence) {
    return (headings || []).filter(
      (heading) =>
        !isAshbyPolicyNoiseText(heading) &&
        !isPlannerDescriptionText(heading, descriptionEvidence),
    );
  }

  function filterPlannerNoiseGroups(groups, descriptionEvidence) {
    return (groups || []).filter(
      (group) =>
        !isAshbyPolicyNoiseText(
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
    const jobDescriptionContext = ashbyJobDescriptionContext(documentRef);
    const jobPosting = plannerJobPosting(
      extractAshbyJobPosting(documentRef, jobDescriptionContext),
    );
    const fields = collectFieldRoots(documentRef)
      .flatMap((root, index) => collectFields(state, root, index))
      .filter((field) => field.label);
    const submitBoundaryIds = submitBoundaryTargetIds(state, documentRef);
    const submitTargetId = findSubmitTargetId(state, documentRef);
    const groupedUploadControlIds = new Set(
      fields
        .filter((field) => field.fieldKind === "file")
        .flatMap((field) => field.controlIds || []),
    );
    const uploadTargetIds = unique([
      ...fields.map((field) => field.uploadTriggerTargetId),
      ...findUploadTargetIds(state).filter(
        (controlId) => !groupedUploadControlIds.has(controlId),
      ),
    ]);
    const controlsById = controlByIdMap(state.controls || []);
    const actionHintsByTargetId = buildActionHints(
      fields,
      submitTargetId,
      uploadTargetIds,
      controlsById,
    );
    for (const targetId of submitBoundaryIds) {
      addHint(actionHintsByTargetId, targetId, {
        semanticRole: "ashby_submit_application_boundary",
        protectedEffect: "submit",
        avoidAction: true,
      });
    }
    const primaryControlIds = unique([
      ...fields.flatMap((field) => fieldPrimaryControlIds(field, controlsById)),
      ...actionableControlIds(uploadTargetIds, controlsById, 4),
      ...submitBoundaryIds,
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
          field.fieldKind !== "file",
      ).length,
      submitTargetId,
      uploadTargetIds,
      primaryControlIds,
      actionHintsByTargetId,
      selectorOverrides,
      jobPosting,
      jobDescriptionEvidence: buildPlannerDescriptionEvidence(
        jobDescriptionContext,
      ),
    };
    siteAdapter.plannerHints = buildPlannerHints(
      fields,
      submitTargetId,
      uploadTargetIds,
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
  function canonicalSelectText(value) {
    return lower(value)
      .replace(/['’]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function searchQueriesFor(_fieldKey, value) {
    const exactValue = normalizeText(value);
    return exactValue ? [exactValue] : [];
  }

  function normalizedPhoneDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function valuesEquivalent(observedValue, expectedValue, fieldKey = "") {
    if (/phone/.test(canonicalSelectText(fieldKey))) {
      const observedDigits = normalizedPhoneDigits(observedValue);
      const expectedDigits = normalizedPhoneDigits(expectedValue);
      if (!observedDigits || !expectedDigits) return false;
      if (observedDigits === expectedDigits) return true;
      return (
        expectedDigits.length === observedDigits.length + 1 &&
        expectedDigits.startsWith("1") &&
        expectedDigits.slice(1) === observedDigits
      );
    }
    const observed = canonicalSelectText(observedValue);
    const expected = canonicalSelectText(expectedValue);
    return Boolean(observed && expected && observed === expected);
  }

  function matchOption(options, value) {
    const expected = canonicalSelectText(value);
    if (!expected) return null;
    return (
      (options || []).find(
        (option) =>
          canonicalSelectText(option.text || option.optionText) === expected,
      ) || null
    );
  }

  function collectRuntimeFieldsForRoot(root, index) {
    const question = questionText(root);
    const input = findPrimaryInput(root);
    const fieldPath = fieldPathFor(root, input, question, index);
    const composite = phoneSmsComposite(root, input, question, fieldPath);

    if (composite) {
      return [
        {
          root,
          input: composite.phone.input,
          question: composite.phone.question,
          fieldPath,
          fieldKey: composite.phone.fieldKey,
          logicalKind: composite.phone.logicalKind,
          eeocFieldKey: "",
          sectionKind: "application",
          fieldKind: composite.phone.fieldKind,
          options: [],
        },
        {
          root,
          input: null,
          question: composite.smsConsent.question,
          fieldPath,
          fieldKey: composite.smsConsent.fieldKey,
          logicalKind: composite.smsConsent.logicalKind,
          eeocFieldKey: "",
          sectionKind: "application",
          fieldKind: composite.smsConsent.fieldKind,
          options: collectPhoneSmsConsentOptionInfos(root, []),
        },
      ];
    }

    const eeocSpec = eeocFieldSpecFor(question, fieldPath);
    const hasCombobox = fieldHasCombobox(root, []);
    const options = hasCombobox ? [] : collectOptionInfos(root, [], question);
    const kind = fieldKind(root, options.length, hasCombobox);
    return [
      {
        root,
        input,
        question,
        fieldPath,
        fieldKey: eeocSpec?.fieldKey || fieldPath,
        logicalKind: "",
        eeocFieldKey: eeocSpec?.fieldKey || "",
        sectionKind: eeocSpec ? "eeoc" : "application",
        fieldKind: kind,
        options,
      },
    ];
  }

  function collectRuntimeFields(documentRef = document) {
    return collectFieldRoots(documentRef)
      .flatMap((root, index) => collectRuntimeFieldsForRoot(root, index))
      .filter((field) => field.question && field.fieldPath && field.fieldKey);
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
        "supply an exact caller-provided value for this field key",
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
    return truncate(
      [
        `Exact caller-provided answer for ${field.question}.`,
        optionText ? `Available options: ${optionText}.` : "",
        "Use exact visible option text when options are present.",
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
      .flatMap((root, index) => collectFields({ controls: [] }, root, index))
      .filter((field) => field?.label);
    const missingRequiredFields = [];
    const seen = new Set();

    for (const field of fields) {
      if (!field.required || field.answered) continue;
      const fieldKey = normalizeText(field.fieldKey || field.fieldPath);
      const identity = `${fieldKey}:${field.logicalKind || field.fieldKind}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      missingRequiredFields.push({
        fieldKey,
        label: field.label,
        fieldKind: field.logicalKind || field.fieldKind,
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
          group?.kind === "ashby_application_field" &&
          group.fieldKind === "file" &&
          group.fieldKey &&
          group.uploadTriggerTargetId,
      )
      .map((group) => {
        const control = controls.get(group.uploadTriggerTargetId);
        const nativeFileInput =
          lower(control?.tag) === "input" && lower(control?.type) === "file";
        return {
          fieldKey: group.fieldKey,
          label: group.label,
          targetId: group.uploadTriggerTargetId,
          selector: group.uploadTriggerSelector || control?.selector || "",
          ...(nativeFileInput
            ? { activation: { kind: "file-input-picker" } }
            : {}),
          verification: {
            kind: "adapter_field_property",
            groupKind: "ashby_application_field",
            targetId: group.targetId,
            fieldKey: group.fieldKey,
            property: "committedFilename",
            previousValue: group.committedFilename || "",
            expectedValueFrom: "filePath.basename",
          },
        };
      })
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
    const eeocFields = connectorEeocFields(documentRef || document);
    const jobPosting = extractAshbyJobPosting(documentRef || document);
    const uploadTargets = hostCapability(meta, "hostFileUpload")
      ? uploadExecutionTargets(state)
      : [];
    const submitTarget = hostCapability(meta, "guardedSubmit")
      ? submitExecutionTarget(state, documentRef || document)
      : null;
    const tools = [];

    if (jobPosting) {
      tools.push({
        schema: {
          type: "function",
          name: READ_JOB_DESCRIPTION_TOOL,
          description:
            "Read the current Ashby job description as dense structured job-posting data. Takes no arguments and excludes application answers.",
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
            "Upload one local file to an exact Ashby application file field. filePath is resolved by the Codex host and is never sent to the page executor.",
          strict: true,
          parameters: {
            type: "object",
            properties: {
              fieldKey: {
                type: "string",
                enum: uploadTargets.map((target) => target.fieldKey),
                description: "The exact live Ashby file field to receive the file.",
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
        ashbySubmitApplication,
        { requiresAuthorization: true },
      );
      tools.push({
        schema: {
          type: "function",
          name: SUBMIT_APPLICATION_TOOL,
          description:
            "Submit the current Ashby application. Use only when the user explicitly authorized final submission for this exact application.",
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
        .map((field) => `${field.fieldKey} = "${truncate(field.question, 80)}"`)
        .join("; ");
      const fieldValueProperties = {};
      for (const field of applicationFields) {
        fieldValueProperties[field.fieldKey] = {
          type: "string",
          description: fieldSchemaDescription(field),
        };
      }

      tools.push({
        type: "function",
        name: APPLICATION_FIELDS_TOOL,
        description: truncate(
          "Fill caller-selected non-file Ashby application fields with exact values keyed by fieldKey. " +
            "This connector fills text inputs, textareas, native selects, radio/checkbox choices, and Ashby autocomplete/combobox dropdowns. " +
            "Omitted fields remain unchanged. Resume/CV/file attachments and EEOC fields are outside this operation. fieldKey -> label: " +
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
                "Exact caller-provided values keyed by live Ashby fieldKey. Omitted fields remain unchanged.",
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
          "Fill caller-selected Ashby EEOC self-identification fields with exact values keyed by fieldKey. " +
            "Omitted fields remain unchanged. The connector matches supplied values against live options and verifies each commit. fieldKey -> label: " +
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
                "Exact caller-provided values keyed by live Ashby EEOC fieldKey. Use exact visible option text when available.",
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
        return field.fieldKey === key || field.eeocFieldKey === key;
      }) || null
    );
  }

  function fieldCurrentValue(field) {
    if (!field) return "";
    if (field.logicalKind === "phone") {
      return normalizeText(
        field.input?.value ?? field.input?.getAttribute("value") ?? "",
      );
    }
    if (field.logicalKind === "sms_consent") {
      return selectedSmsConsentValue(
        collectPhoneSmsConsentOptionInfos(field.root, []),
      );
    }
    if (field.fieldKind === "file") return fileValueForField(field.root);
    if (field.fieldKind === "select") return selectValueForField(field.root);
    if (field.fieldKind === "combobox") return exactTextValueForField(field.root);
    if (isYesNoFieldRoot(field.root)) return yesNoSelectedValue(field.root);
    if (field.options?.length) return selectedValueFromOptions(field.options);
    return exactTextValueForField(field.root);
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

    const options = (field.logicalKind === "sms_consent"
      ? collectPhoneSmsConsentOptionInfos(field.root, [])
      : collectOptionInfos(field.root, [], field.question))
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
        committed[fieldKey] = field.logicalKind === "sms_consent"
          ? normalizedSmsConsentValue(already.optionText)
          : already.optionText;
        continue;
      }

      const match = matchOption(options, requestedValue, fieldKey);
      if (!match?.optionEl) {
        failed.push(requestedValue);
        continue;
      }

      await click(match.optionEl);
      await delay(150);
      committed[fieldKey] = field.logicalKind === "sms_consent"
        ? fieldCurrentValue(field) || normalizedSmsConsentValue(match.optionText)
        : match.optionText || match.text || requestedValue;

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
    const fieldKey = field.fieldKey || field.fieldPath;
    const input = field.input || findPrimaryInput(field.root);
    if (!input) {
      return { ok: false, detail: `No fillable Ashby input for ${fieldKey}.` };
    }
    if (typeof fill !== "function") {
      return { ok: false, detail: `${APPLICATION_FIELDS_TOOL} runner fill primitive unavailable.` };
    }

    const exactTextVerification =
      input.tagName === "TEXTAREA" || field.fieldKind === "long_text";
    const valuesMatch = (observed, expected) =>
      exactTextVerification
        ? normalizeText(observed) === normalizeText(expected)
        : valuesEquivalent(observed, expected, fieldKey);
    const current = fieldCurrentValue(field);
    if (current && valuesMatch(current, value)) {
      return {
        ok: true,
        committed: true,
        value: current,
        verificationMode: exactTextVerification
          ? "exact_normalized_text"
          : "adapter_equivalent",
        detail: `${fieldKey} already set to "${current}".`,
      };
    }

    await fill(input, value);
    await delay(120);
    const committedValue = fieldCurrentValue(field);
    const committed = Boolean(committedValue) && valuesMatch(committedValue, value);

    return {
      ok: committed,
      recoverable: !committed,
      continueBatch: !committed,
      committed,
      value: committedValue,
      verificationMode: exactTextVerification
        ? "exact_normalized_text"
        : "adapter_equivalent",
      detail: committed
        ? `Filled ${fieldKey}.`
        : `Filled ${fieldKey}; the committed value did not match exactly.`,
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
    const targetKey = field.logicalKind ? field.fieldKey : field.fieldPath;
    return {
      groupTargetId: fieldTargetId(targetKey),
      matchedBy: field.eeocFieldKey && field.eeocFieldKey === fieldKey
        ? "eeocFieldKey"
        : field.logicalKind
          ? "fieldKey"
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
    const fieldEvidence = {};
    const fieldTargets = {};
    const failed = [];
    const skipped = [];

    for (const [fieldKey, value] of entries) {
      const result = await fillRuntimeField(fieldKey, value, ctx, {
        eeocOnly: Boolean(options.eeocOnly),
      });
      const ok = result.ok !== false && result.committed !== false;
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

  async function ashbyReadJobDescription() {
    const jobPosting = extractAshbyJobPosting(document);
    if (!jobPosting) {
      return { ok: false, detail: "Ashby job description is not available." };
    }
    return {
      ok: true,
      committed: false,
      jobPosting,
      detail: "Read the current Ashby job description.",
    };
  }

  async function ashbySubmitApplication(_action, ctx) {
    const target = exactSubmitTarget(ctx?.state || {}, document);
    if (
      !target ||
      !target.enabled ||
      !ctx?.state?.siteAdapter?.submitTargetId ||
      target.targetId !== ctx.state.siteAdapter.submitTargetId
    ) {
      return { ok: false, detail: "Exact Ashby submit control is unavailable." };
    }
    const readiness = submitReadiness(document);
    if (!readiness.ready) {
      return {
        ok: false,
        code: "APPLICATION_NOT_READY",
        committed: false,
        missingRequiredFields: readiness.missingRequiredFields,
        detail: `Ashby application has ${readiness.missingRequiredFields.length} missing required field(s).`,
      };
    }
    if (typeof ctx?.primitives?.clickElement !== "function") {
      return { ok: false, detail: "Ashby submit click primitive is unavailable." };
    }
    await ctx.primitives.clickElement(target.element);
    return {
      ok: true,
      committed: true,
      submitted: true,
      detail: "Activated the exact Ashby Submit Application control.",
    };
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
    globalThis.WebGPTConnectorTools.register(
      READ_JOB_DESCRIPTION_TOOL,
      ashbyReadJobDescription,
    );
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
