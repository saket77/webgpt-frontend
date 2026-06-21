(function () {
  const ns = (globalThis.WebGPTExtractStateModules =
    globalThis.WebGPTExtractStateModules || {});

  if (!ns.domUtils || !ns.elementMetadata) {
    throw new Error(
      "extract-state/domUtils.js and elementMetadata.js must load before controlBuilders.js",
    );
  }

  const {
    normalizeText,
    lower,
    truncateWords,
    isVisible,
    isEnabled,
    cssEscapeSafe,
  } = ns.domUtils;

  const {
    hasBackgroundImage,
    hasMediaDescendant,
    mediaSummaryFor,
    hasMeaningfulText,
    hasIdentityDataAttrs,
    dataAttrsFor,
    labelForControl,
    controlTextFor,
    nearestHeadingText,
    nearbyText,
    controlTypeFor,
    getContainerKind,
  } = ns.elementMetadata;

  function hasInteractiveRole(el) {
    if (!el || !(el instanceof Element)) return false;

    const role = lower(el.getAttribute("role"));
    return [
      "button",
      "link",
      "tab",
      "menuitem",
      "option",
      "listitem",
      "gridcell",
      "row",
      "treeitem",
      "switch",
      "checkbox",
      "radio",
      "card",
      "group",
      "radiogroup",
      "listbox",
      "menu",
      "tabpanel",
      "textbox",
      "combobox",
    ].includes(role);
  }

  function isNativeInteractiveTag(el) {
    if (!el || !(el instanceof Element)) return false;
    const tag = lower(el.tagName);
    return [
      "button",
      "a",
      "input",
      "textarea",
      "select",
      "summary",
      "option",
      "label",
    ].includes(tag);
  }

  function hasPointerCursor(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    return style.cursor === "pointer";
  }

  function hasClickSignals(el) {
    if (!el || !(el instanceof Element)) return false;

    const tabIndexAttr = el.getAttribute("tabindex");
    const tabIndexValue =
      tabIndexAttr === null ? null : Number.parseInt(tabIndexAttr, 10);

    return Boolean(
      typeof el.onclick === "function" ||
      el.hasAttribute("onclick") ||
      (tabIndexAttr !== null &&
        !Number.isNaN(tabIndexValue) &&
        tabIndexValue >= 0) ||
      el.hasAttribute("aria-expanded") ||
      el.hasAttribute("aria-pressed") ||
      el.hasAttribute("aria-selected") ||
      el.hasAttribute("aria-haspopup"),
    );
  }

  function elementSizeScore(el) {
    if (!el || !(el instanceof Element)) return 0;
    const rect = el.getBoundingClientRect();

    if (rect.width >= 44 && rect.height >= 24) return 2;
    if (rect.width >= 24 && rect.height >= 18) return 1;
    return 0;
  }

  function repeatedSiblingPatternScore(el) {
    if (!el || !(el instanceof Element) || !el.parentElement) return 0;

    const parent = el.parentElement;
    const siblings = Array.from(parent.children).filter(
      (child) =>
        child instanceof Element &&
        lower(child.tagName) === lower(el.tagName) &&
        isVisible(child),
    );

    if (siblings.length >= 3) return 2;
    if (siblings.length >= 2) return 1;
    return 0;
  }

  function stableClassPatternScore(el) {
    if (!el || !(el instanceof Element)) return 0;

    const cls = lower(el.getAttribute("class"));
    if (!cls) return 0;

    const patterns = [
      "item",
      "tile",
      "card",
      "option",
      "product",
      "row",
      "tab",
      "menu",
      "choice",
      "entry",
      "select",
      "picker",
    ];

    const matches = patterns.filter((pattern) => cls.includes(pattern)).length;
    if (matches >= 2) return 2;
    if (matches >= 1) return 1;
    return 0;
  }

  function isDebugTarget(el) {
    if (!el || !(el instanceof Element)) return false;

    const aria = normalizeText(el.getAttribute("aria-label"));
    return aria.includes("SYSENG-118923 ");
  }

  function scorePromotableContainer(el) {
    if (isDebugTarget(el)) {
      console.log("yes this one");
    }

    if (!el || !(el instanceof Element)) {
      return { score: 0, reasons: [] };
    }

    const reasons = [];
    let score = 0;

    if (hasClickSignals(el)) {
      score += 3;
      reasons.push("click-signals");
    }

    if (hasInteractiveRole(el)) {
      score += 3;
      reasons.push("interactive-role");
    }

    if (hasPointerCursor(el)) {
      score += 2;
      reasons.push("pointer-cursor");
    }

    if (hasIdentityDataAttrs(el)) {
      score += 2;
      reasons.push("identity-data-attrs");
    }

    if (hasMediaDescendant(el) || hasBackgroundImage(el)) {
      score += 2;
      reasons.push("media-or-icon");
    }

    if (hasMeaningfulText(el) || labelForControl(el) || nearbyText(el)) {
      score += 2;
      reasons.push("meaningful-text");
    }

    const siblingScore = repeatedSiblingPatternScore(el);
    if (siblingScore > 0) {
      score += siblingScore;
      reasons.push("repeated-sibling-pattern");
    }

    const sizeScore = elementSizeScore(el);
    if (sizeScore > 0) {
      score += sizeScore;
      reasons.push("reasonable-size");
    }

    const classScore = stableClassPatternScore(el);
    if (classScore > 0) {
      score += classScore;
      reasons.push("ui-class-pattern");
    }

    return { score, reasons };
  }

  function shouldPromoteContainer(el) {
    if (!el || !(el instanceof Element)) return false;
    if (!isVisible(el)) return false;

    const tag = lower(el.tagName);
    const role = lower(el.getAttribute("role"));

    const alwaysIncludeRoles = [
      "button",
      "link",
      "tab",
      "menuitem",
      "option",
      "treeitem",
      "switch",
      "checkbox",
      "radio",
      "textbox",
      "combobox",
    ];

    if (alwaysIncludeRoles.includes(role)) return true;

    if (role !== "option" && el.querySelector("[role='option']")) {
      return false;
    }

    const conditionalTags = [
      "div",
      "li",
      "span",
      "a",
      "section",
      "article",
      "td",
      "th",
      "tr",
      "label",
      "figure",
      "figcaption",
      "picture",
    ];

    const conditionalRoles = [
      "listitem",
      "gridcell",
      "row",
      "card",
      "group",
      "radiogroup",
      "listbox",
      "menu",
      "tabpanel",
    ];

    if (isNativeInteractiveTag(el)) return true;
    if (!conditionalTags.includes(tag) && !conditionalRoles.includes(role)) {
      return false;
    }

    const { score } = scorePromotableContainer(el);
    return score >= 4;
  }

  function findPromotableAncestor(el) {
    if (!el || !(el instanceof Element)) return null;

    let current = el;

    for (let i = 0; i < 5 && current; i++) {
      if (shouldPromoteContainer(current)) return current;
      current = current.parentElement;
    }

    return null;
  }

  function selectorFor(el) {
    if (!el || !(el instanceof Element)) return "";

    if (el.id) {
      return `#${cssEscapeSafe(el.id)}`;
    }

    const tag = lower(el.tagName);

    const testId =
      el.getAttribute("data-testid") ||
      el.getAttribute("data-test") ||
      el.getAttribute("data-qa") ||
      el.getAttribute("data-cy");

    if (testId) {
      const escaped = cssEscapeSafe(testId);
      if (el.hasAttribute("data-testid")) return `[data-testid="${escaped}"]`;
      if (el.hasAttribute("data-test")) return `[data-test="${escaped}"]`;
      if (el.hasAttribute("data-qa")) return `[data-qa="${escaped}"]`;
      if (el.hasAttribute("data-cy")) return `[data-cy="${escaped}"]`;
    }

    const dataProductName = normalizeText(el.getAttribute("data-productname"));
    if (dataProductName) {
      return `${tag}[data-productname="${cssEscapeSafe(dataProductName)}"]`;
    }

    const dataProductId = normalizeText(el.getAttribute("data-productid"));
    if (dataProductId) {
      return `${tag}[data-productid="${cssEscapeSafe(dataProductId)}"]`;
    }

    const dataParentProductId = normalizeText(
      el.getAttribute("data-parentproductid"),
    );
    if (dataParentProductId) {
      return `${tag}[data-parentproductid="${cssEscapeSafe(dataParentProductId)}"]`;
    }

    const dataName =
      normalizeText(el.getAttribute("data-name")) ||
      normalizeText(el.getAttribute("data-label")) ||
      normalizeText(el.getAttribute("data-title"));
    if (dataName) {
      return `${tag}[data-name="${cssEscapeSafe(dataName)}"]`;
    }

    const name = normalizeText(el.getAttribute("name"));
    if (name) {
      return `${tag}[name="${cssEscapeSafe(name)}"]`;
    }

    const ariaLabel = normalizeText(el.getAttribute("aria-label"));
    if (ariaLabel && ariaLabel.length <= 120) {
      return `${tag}[aria-label="${cssEscapeSafe(ariaLabel)}"]`;
    }

    const title = normalizeText(el.getAttribute("title"));
    if (title && title.length <= 120) {
      return `${tag}[title="${cssEscapeSafe(title)}"]`;
    }

    const href = normalizeText(el.getAttribute("href"));
    if (tag === "a" && href && href.length <= 180) {
      return `a[href="${cssEscapeSafe(href)}"]`;
    }

    const cls = normalizeText(el.getAttribute("class"));
    if (cls) {
      const stableClasses = cls
        .split(/\s+/)
        .filter(Boolean)
        .filter(
          (name) =>
            !/\d/.test(name) &&
            name.length <= 40 &&
            !name.startsWith("ng-") &&
            !name.startsWith("css-"),
        )
        .slice(0, 2);

      if (stableClasses.length) {
        return `${tag}.${stableClasses.map(cssEscapeSafe).join(".")}`;
      }
    }

    return tag || "";
  }

  function dedupeKeyFor(el) {
    if (!el || !(el instanceof Element)) return "";

    const rect = el.getBoundingClientRect();
    return [
      el.id || "",
      lower(el.tagName),
      lower(el.getAttribute("role")),
      normalizeText(labelForControl(el)).toLowerCase(),
      normalizeText(el.getAttribute("aria-label")).toLowerCase(),
      normalizeText(el.getAttribute("data-productname")).toLowerCase(),
      Math.round(rect.x),
      Math.round(rect.y),
      Math.round(rect.width),
      Math.round(rect.height),
    ].join("|");
  }

  function collectDirectAndContainerCandidates() {
    const selector = [
      "button",
      "a",
      "input",
      "textarea",
      "select",
      "summary",
      "option",
      "label",
      "div",
      "li",
      "span",
      "section",
      "article",
      "nav",
      "main",
      "aside",
      "header",
      "footer",
      "ul",
      "ol",
      "dl",
      "dt",
      "dd",
      "table",
      "tbody",
      "tr",
      "td",
      "th",
      "fieldset",
      "legend",
      "figure",
      "figcaption",
      "picture",
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="listitem"]',
      '[role="gridcell"]',
      '[role="row"]',
      '[role="treeitem"]',
      '[role="switch"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="card"]',
      '[role="group"]',
      '[role="radiogroup"]',
      '[role="listbox"]',
      '[role="menu"]',
      '[role="tabpanel"]',
      '[role="textbox"]',
      '[role="combobox"]',
      "[onclick]",
      "[tabindex]",
      "[aria-expanded]",
      "[aria-pressed]",
      "[aria-selected]",
      "[aria-haspopup]",
      "[data-testid]",
      "[data-test]",
      "[data-qa]",
      "[data-cy]",
      "[data-id]",
      "[data-key]",
      "[data-value]",
      "[data-name]",
      "[data-label]",
      "[data-title]",
      "[data-productid]",
      "[data-productname]",
      "[data-parentproductid]",
      "img",
      "svg",
      "picture",
      "i",
      "canvas",
      "[data-icon]",
    ].join(",");

    return Array.from(document.querySelectorAll(selector));
  }

  function buildControls() {
    const allControls = [];
    let idCounter = 1;

    const rawCandidates = collectDirectAndContainerCandidates();
    const deduped = [];
    const seen = new Set();

    for (const node of rawCandidates) {
      if (!(node instanceof Element)) continue;
      if (!isVisible(node)) continue;

      let promoted = node;

      if (!shouldPromoteContainer(promoted)) {
        const ancestor = findPromotableAncestor(node);
        if (ancestor) promoted = ancestor;
      }

      if (!shouldPromoteContainer(promoted)) continue;
      if (!isVisible(promoted)) continue;

      const tag = lower(promoted.tagName);
      const role = lower(promoted.getAttribute("role"));

      const isGroupingOnly =
        [
          "nav",
          "main",
          "aside",
          "header",
          "footer",
          "ul",
          "ol",
          "dl",
          "table",
          "tbody",
          "fieldset",
          "legend",
        ].includes(tag) ||
        ["radiogroup", "listbox", "menu", "tabpanel"].includes(role);

      if (isGroupingOnly) continue;

      const key = dedupeKeyFor(promoted);
      if (!key || seen.has(key)) continue;

      seen.add(key);
      deduped.push(promoted);
    }

    for (const option of Array.from(
      document.querySelectorAll('[role="option"]'),
    )) {
      if (!(option instanceof Element)) continue;
      if (!isVisible(option)) continue;

      const key = dedupeKeyFor(option);
      if (!key || seen.has(key)) continue;

      seen.add(key);
      deduped.push(option);
    }

    for (const el of deduped) {
      const rect = el.getBoundingClientRect();
      const tag = lower(el.tagName);
      const role = normalizeText(el.getAttribute("role"));
      const type = normalizeText(el.getAttribute("type"));
      const label = truncateWords(labelForControl(el), 100);
      const text = truncateWords(controlTextFor(el), 200);
      const { score, reasons } = scorePromotableContainer(el);

      allControls.push({
        id: `el_${idCounter++}`,
        selector: selectorFor(el),
        tag,
        role,
        type,
        controlType: controlTypeFor(el),
        label,
        text,
        ariaLabel: normalizeText(el.getAttribute("aria-label")),
        placeholder: normalizeText(el.getAttribute("placeholder")),
        name: truncateWords(normalizeText(el.getAttribute("name")), 100),
        title: truncateWords(normalizeText(el.getAttribute("title")), 100),
        visible: true,
        enabled: isEnabled(el),
        heading: truncateWords(nearestHeadingText(el), 100),
        nearbyText: truncateWords(nearbyText(el), 100),
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        containerKind: getContainerKind(el),
        promoted: !isNativeInteractiveTag(el) && !hasInteractiveRole(el),
        promotionScore: score,
        promotionReasons: reasons,
        dataAttrs: dataAttrsFor(el),
        media: mediaSummaryFor(el),
        hasMedia: hasMediaDescendant(el) || hasBackgroundImage(el),
        className: truncateWords(normalizeText(el.getAttribute("class")), 200),
        classes: normalizeText(el.getAttribute("class"))
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 20),
        ariaAutocomplete: normalizeText(el.getAttribute("aria-autocomplete")),
        ariaControls: normalizeText(el.getAttribute("aria-controls")),
        ariaExpanded: normalizeText(el.getAttribute("aria-expanded")),
        ariaHaspopup: normalizeText(el.getAttribute("aria-haspopup")),
        ariaOwns: normalizeText(el.getAttribute("aria-owns")),
        ariaPressed: normalizeText(el.getAttribute("aria-pressed")),
        ariaSelected: normalizeText(el.getAttribute("aria-selected")),
        ariaChecked: normalizeText(el.getAttribute("aria-checked")),
        checked:
          el instanceof HTMLInputElement ? Boolean(el.checked) : undefined,
      });
    }

    return allControls;
  }

  ns.controlBuilders = {
    hasInteractiveRole,
    isNativeInteractiveTag,
    hasPointerCursor,
    hasClickSignals,
    elementSizeScore,
    repeatedSiblingPatternScore,
    stableClassPatternScore,
    isDebugTarget,
    scorePromotableContainer,
    shouldPromoteContainer,
    findPromotableAncestor,
    selectorFor,
    dedupeKeyFor,
    collectDirectAndContainerCandidates,
    buildControls,
  };
})();
