(function () {
  const ADAPTER_ID = "yelp.local";
  const registry = globalThis.WebGPTContentAdapters;
  const extractModules = globalThis.WebGPTExtractStateModules || {};
  const domUtils = extractModules.domUtils || {};

  if (!registry || typeof registry.register !== "function") {
    throw new Error(
      "content-scripts/adapters/registry.js must load before yelp.js",
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
        style.pointerEvents !== "none" &&
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

  function safeUrl(url) {
    try {
      return new URL(url || location.href);
    } catch {
      return new URL(location.href);
    }
  }

  function absoluteUrl(value, base = location.href) {
    const raw = normalizeText(value);
    if (!raw) return "";
    try {
      return new URL(raw, base).toString();
    } catch {
      return raw;
    }
  }

  function isYelpHost(url) {
    const host = safeUrl(url).hostname;
    return host === "yelp.com" || host.endsWith(".yelp.com");
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
    const result = [];
    const id = normalizeText(el.id);
    const name = normalizeText(el.getAttribute("name"));
    const ariaLabel = normalizeText(el.getAttribute("aria-label"));
    const title = normalizeText(el.getAttribute("title"));
    const href = normalizeText(el.getAttribute("href"));

    if (id) result.push(`#${cssEscape(id)}`);

    for (const attr of ["data-testid", "data-test", "data-qa", "data-cy"]) {
      const value = normalizeText(el.getAttribute(attr));
      if (value) result.push(`[${attr}="${cssEscape(value)}"]`);
    }

    if (name) result.push(`${tag}[name="${cssEscape(name)}"]`);
    if (ariaLabel) result.push(`${tag}[aria-label="${cssEscape(ariaLabel)}"]`);
    if (title) result.push(`${tag}[title="${cssEscape(title)}"]`);
    if (tag === "a" && href && href.length <= 180) {
      result.push(`a[href="${cssEscape(href)}"]`);
    }

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
    const href = normalizeText(el.getAttribute("href"));
    const labelText = textContent(
      el.id ? document.querySelector(`label[for="${cssEscape(el.id)}"]`) : null,
    );
    const bounds = elementBounds(el);

    return (
      findControlBySelector(controls, selectors, bounds, tag) ||
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
          href &&
          control.selector === `a[href="${cssEscape(href)}"]` &&
          (!control.tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          labelText &&
          lower([control.label, control.text, control.nearbyText].join(" ")).includes(
            lower(labelText),
          ) &&
          boundsContain(bounds, control.bounds),
      ) ||
      (controls || []).find(
        (control) =>
          boundsContain(bounds, control.bounds) &&
          (!control.tag || control.tag === tag),
      ) ||
      null
    );
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
          control.className,
          control.selector,
        ].join(" "),
      );
      let score =
        Number(control.bounds?.width || 0) * Number(control.bounds?.height || 0);

      if (options.preferLink && control.tag === "a") score += 100000;
      if (options.preferButton && control.tag === "button") score += 100000;
      if (options.preferInput && control.tag === "input") score += 100000;
      if (options.text && haystack.includes(lower(options.text))) score += 50000;
      if (control.enabled) score += 1000;
      if (control.visible) score += 1000;

      if (!best || score > best.score) {
        best = { control, score };
      }
    }

    return best?.control || null;
  }

  function labelForInput(inputEl) {
    if (!inputEl || !(inputEl instanceof Element)) return "";

    if (inputEl.id) {
      const explicit = document.querySelector(
        `label[for="${cssEscape(inputEl.id)}"]`,
      );
      const text = textContent(explicit);
      if (text) return text;
    }

    const labelledBy = normalizeText(inputEl.getAttribute("aria-labelledby"));
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => textContent(node))
        .join(" ");
      if (text) return normalizeText(text);
    }

    const wrappingLabel = inputEl.closest("label");
    if (wrappingLabel) return textContent(wrappingLabel);

    const parentText = textContent(inputEl.parentElement);
    return parentText || normalizeText(inputEl.getAttribute("aria-label"));
  }

  function textFromIds(value) {
    return normalizeText(value)
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((node) => textContent(node))
      .join(" ");
  }

  function contextLabelFor(el) {
    const region = el?.closest(
      "section[aria-label], [role='group'], [role='radiogroup'], [aria-labelledby]",
    );
    if (!region) return "";

    const ariaLabel = normalizeText(region.getAttribute("aria-label"));
    if (ariaLabel) return ariaLabel;

    const labelledBy = textFromIds(region.getAttribute("aria-labelledby"));
    if (labelledBy) return labelledBy;

    return textContent(region.querySelector("h1, h2, h3, p[data-font-weight='bold']"));
  }

  function cleanControlLabel(value) {
    return normalizeText(value)
      .replace(
        /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi,
        "",
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  function ancestorTextMatches(el, pattern, maxDepth = 6) {
    let node = el;
    for (let depth = 0; node && depth < maxDepth; depth += 1) {
      if (pattern.test(textContent(node))) return true;
      node = node.parentElement;
    }
    return false;
  }

  function decodeBizRedirUrl(href) {
    const raw = normalizeText(href);
    if (!raw) return "";

    try {
      const url = new URL(raw, location.href);
      if (!url.pathname.includes("/biz_redir")) return absoluteUrl(raw);
      return normalizeText(url.searchParams.get("url")) || absoluteUrl(raw);
    } catch {
      return raw;
    }
  }

  function canonicalYelpUrl(href) {
    const value = absoluteUrl(href);
    if (!value) return "";

    try {
      const url = new URL(value);
      url.hash = "";
      url.searchParams.delete("hrid");
      return url.toString();
    } catch {
      return value;
    }
  }

  function parseRatingFromText(value) {
    const match = normalizeText(value).match(/([0-5](?:\.\d)?)\s*star rating/i);
    return match ? match[1] : "";
  }

  function parseReviewCountFromText(value) {
    const match = normalizeText(value).match(/\(([\d,]+)\s+reviews?\)/i);
    return match ? match[1].replace(/,/g, "") : "";
  }

  function htmlJsonText(scriptEl) {
    return normalizeText(scriptEl?.textContent || "");
  }

  function collectJsonLdObjects(documentRef) {
    const result = [];

    function pushObject(value) {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach(pushObject);
        return;
      }
      if (typeof value !== "object") return;

      result.push(value);
      if (value["@graph"]) pushObject(value["@graph"]);
      if (value.itemListElement) pushObject(value.itemListElement);
    }

    for (const script of getElements('script[type="application/ld+json"]', documentRef)) {
      try {
        pushObject(JSON.parse(htmlJsonText(script)));
      } catch {
        // Yelp occasionally ships non-critical JSON-LD that is not parseable.
      }
    }

    return result;
  }

  function jsonLdType(value) {
    const type = value?.["@type"];
    return Array.isArray(type) ? type.join(" ") : normalizeText(type);
  }

  function findLocalBusinessJsonLd(documentRef) {
    return (
      collectJsonLdObjects(documentRef).find((item) =>
        lower(jsonLdType(item)).includes("localbusiness"),
      ) || null
    );
  }

  function isHomepage(documentRef, url) {
    const parsed = safeUrl(url);
    const value = lower(documentRef.documentElement?.innerHTML || "");
    return Boolean(
      (parsed.pathname === "/" || value.includes("gondolahomepage")) &&
        documentRef.querySelector("#header_find_form"),
    );
  }

  function isResultsPage(documentRef, url) {
    const parsed = safeUrl(url);
    const value = lower(documentRef.documentElement?.innerHTML || "");
    return Boolean(
      parsed.pathname.startsWith("/search") ||
        value.includes("gondolasearch") ||
        documentRef.querySelector('[data-testid="serp-ia-card"]'),
    );
  }

  function isDetailPage(documentRef, url) {
    const parsed = safeUrl(url);
    const value = lower(documentRef.documentElement?.innerHTML || "");
    return Boolean(
      parsed.pathname.startsWith("/biz/") ||
        value.includes("gondolabizdetails") ||
        (findLocalBusinessJsonLd(documentRef) &&
          documentRef.querySelector('[data-testid="main-content"], #main-content')),
    );
  }

  function detectPageKind(documentRef, url) {
    if (isDetailPage(documentRef, url)) return "business_detail";
    if (isResultsPage(documentRef, url)) return "search_results";
    if (isHomepage(documentRef, url)) return "homepage";
    return "yelp";
  }

  function searchForm(documentRef) {
    return (
      documentRef.querySelector("#header_find_form") ||
      documentRef.querySelector('form[action="/search"]') ||
      documentRef.querySelector('[data-testid="searchSuggest"] form')
    );
  }

  function findSearchControls(state, documentRef) {
    const form = searchForm(documentRef);
    const findInput =
      documentRef.querySelector("#search_description") ||
      documentRef.querySelector('input[name="find_desc"]');
    const locationInput =
      documentRef.querySelector("#search_location") ||
      documentRef.querySelector('input[name="find_loc"]');
    const submit =
      form?.querySelector('button[aria-label="Search"][type="submit"]') ||
      form?.querySelector('button[aria-label="Search"]') ||
      form?.querySelector('input[type="submit"], button[type="submit"]');

    return {
      query: normalizeText(findInput?.value || findInput?.getAttribute("value")),
      location: normalizeText(
        locationInput?.value ||
          locationInput?.getAttribute("value") ||
          form?.querySelector('input[name="find_loc"]')?.value,
      ),
      findTargetId: findControlForElement(state.controls, findInput)?.id || "",
      locationTargetId:
        findControlForElement(state.controls, locationInput)?.id || "",
      submitTargetId:
        findControlForElement(state.controls, submit)?.id ||
        findBestControlInRegion(state.controls, form, {
          preferButton: true,
          text: "search",
        })?.id ||
        "",
    };
  }

  function addHint(actionHintsByTargetId, targetId, hint) {
    if (!targetId) return;
    actionHintsByTargetId[targetId] = {
      ...(actionHintsByTargetId[targetId] || {}),
      ...hint,
    };
  }

  function addSearchHints(actionHintsByTargetId, search) {
    addHint(actionHintsByTargetId, search.findTargetId, {
      semanticRole: "search_find_input",
      preferredAction: "fill",
      exactValueMode: "text",
      answerText: "Yelp search terms",
      verifyAfterAction: "valueChanged",
      instruction:
        "Fill this Yelp Find field with the business category, service, or keyword.",
    });
    addHint(actionHintsByTargetId, search.locationTargetId, {
      semanticRole: "search_location_input",
      preferredAction: "fill",
      exactValueMode: "text",
      answerText: "Yelp search location",
      verifyAfterAction: "valueChanged",
      instruction: "Fill this Yelp Near field with city, neighborhood, address, or ZIP.",
    });
    addHint(actionHintsByTargetId, search.submitTargetId, {
      semanticRole: "search_submit",
      preferredAction: "click",
      navigationAction: true,
      batchPlacement: "last",
      verifyAfterAction: "urlOrResultsChanged",
      instruction:
        "Click the Yelp search button after filling Find and Near fields.",
    });
  }

  function filterLabelFor(el) {
    if (el instanceof HTMLInputElement) {
      return truncate(
        cleanControlLabel(labelForInput(el)) ||
          normalizeText(el.value) ||
          normalizeText(el.getAttribute("name")),
        80,
      );
    }

    const ownText = cleanControlLabel(textContent(el));
    if (ownText) return truncate(ownText, 80);

    const aria = normalizeText(el.getAttribute("aria-label"));
    if (aria) return truncate(aria, 80);

    return "";
  }

  function filterRoots(documentRef) {
    const roots = unique([
      ...getElements("[aria-labelledby='search-vertical-filter-panel-label']", documentRef),
      ...getElements("[class*='filterPanelWrapper']", documentRef),
      ...getElements("[class*='popoverInner']", documentRef).filter((el) =>
        /filters|price|distance|apply filters/i.test(textContent(el)),
      ),
      ...getElements("[data-testid='filter-panel-separator']", documentRef),
      ...getElements("[class*='stickyFilterOnSmallScreen']", documentRef),
      ...getElements("[aria-label='filters']", documentRef),
    ]).filter((el) => el === documentRef || isVisible(el) || textContent(el));

    return roots.length ? roots : [documentRef];
  }

  function filterSemanticRole(filter) {
    const label = lower(filter.label);
    if (label === "all") return "filter_panel_open";
    if (label === "apply filters") return "filter_apply";
    if (label === "cancel") return "filter_cancel";
    if (label === "price") return "filter_price_menu";
    if (/^\${1,4}$/.test(filter.label)) return "filter_price_option";
    if (filter.inputType === "radio") return "filter_distance_option";
    if (/bird's-eye|driving|biking|walking|blocks/.test(label)) {
      return "filter_distance_option";
    }
    if (label === "see all") return "filter_see_all";
    return "filter_option";
  }

  function filterChangesResultsImmediately(filter, semanticRole) {
    if (semanticRole === "filter_apply") return true;
    if (
      semanticRole === "filter_panel_open" ||
      semanticRole === "filter_cancel" ||
      semanticRole === "filter_price_menu" ||
      semanticRole === "filter_see_all"
    ) {
      return false;
    }

    if (filter.inputType === "checkbox" || filter.inputType === "radio") {
      return false;
    }

    return (
      semanticRole === "filter_option" ||
      semanticRole === "filter_price_option" ||
      semanticRole === "filter_distance_option"
    );
  }

  function filterInstruction(filter, semanticRole) {
    const scopedLabel = [filter.section, filter.label].filter(Boolean).join(": ");
    const resultChanging = filterChangesResultsImmediately(filter, semanticRole);
    if (semanticRole === "filter_panel_open") {
      return "Click this Yelp All filters chip to open the full filters panel. Use this route when multiple filters are needed and no matching Yelp URL shortcut is available: open the panel, observe, select the nested checkbox/radio options, then click Apply filters.";
    }
    if (semanticRole === "filter_apply") {
      return "Click Apply filters after selecting one or more Yelp filter options in the full filter panel. Apply refreshes results, so make it the last action in the step.";
    }
    if (semanticRole === "filter_cancel") {
      return "Click Cancel to close the Yelp filters panel without applying changes.";
    }
    if (semanticRole === "filter_price_menu") {
      return "Open the Yelp Price filter menu.";
    }
    if (semanticRole === "filter_see_all") {
      return `Click See all to reveal more Yelp ${filter.section || "filter"} options.`;
    }
    if (filter.inputType === "checkbox" || filter.inputType === "radio") {
      return `Select this Yelp full-panel filter option when the task asks for "${scopedLabel || filter.label}". Multiple full-panel checkbox/radio filters may be selected before clicking Apply filters.`;
    }
    if (resultChanging) {
      return `Click this Yelp visible filter option when the task asks for "${scopedLabel || filter.label}". This refreshes/rerenders Yelp results, so do not batch it with other visible filter or sort-changing clicks; click one, then observe. For multiple filters, prefer a matching Yelp URL shortcut when available; otherwise open All filters and apply them together.`;
    }
    if (semanticRole === "filter_price_option") {
      return `Click this Yelp price filter option: ${filter.label}.`;
    }
    if (semanticRole === "filter_distance_option") {
      return `Click this Yelp distance filter option: ${filter.label}.`;
    }
    return `Click this Yelp filter option when the task asks for "${scopedLabel || filter.label}".`;
  }

  function collectFilterElements(documentRef) {
    return unique(
      filterRoots(documentRef).flatMap((root) => [
        ...getVisibleElements("button[class*='filterToggle']", root),
        ...getElements(
          "input[role='checkbox'][type='checkbox'], input[role='radio'][type='radio']",
          root,
        ).filter((el) => isVisible(el) || isVisible(el.closest("label,div"))),
        ...getVisibleElements("a[role='button']", root),
        ...getVisibleElements("a[href*='/search?find_desc=']", root),
        ...getVisibleElements("button[data-button='true']", root).filter((button) =>
          /apply filters|cancel/i.test(textContent(button)),
        ),
      ]),
    );
  }

  function collectFilters(state, documentRef) {
    const elements = collectFilterElements(documentRef);

    return elements
      .map((el) => {
        const label = filterLabelFor(el);
        if (!label || label.length > 100) return null;

        const control =
          findControlForElement(state.controls, el) ||
          findBestControlInRegion(state.controls, el.closest("label,div"), {
            text: label,
          });

        return {
          label,
          targetId: control?.id || "",
          selected:
            lower(el.getAttribute("aria-pressed")) === "true" ||
            lower(el.getAttribute("data-selected")) === "true" ||
            Boolean(el.checked),
          expanded: lower(el.getAttribute("aria-expanded")) === "true",
          section: truncate(contextLabelFor(el), 80),
          inputName: normalizeText(el.getAttribute("name")),
          inputValue: normalizeText(el.getAttribute("value")),
          inputType: normalizeText(el.getAttribute("type")),
          tag: lower(el.tagName),
          href: absoluteUrl(el.getAttribute("href")),
        };
      })
      .filter((item) => item && (item.targetId || item.href || item.label))
      .filter((item, index, arr) => {
        const key = lower(
          [item.label, item.inputName, item.inputValue, item.href].join("|"),
        );
        return arr.findIndex((candidate) => lower(
          [
            candidate.label,
            candidate.inputName,
            candidate.inputValue,
            candidate.href,
          ].join("|"),
        ) === key) === index;
      });
  }

  function addFilterHints(actionHintsByTargetId, filters) {
    for (const filter of filters || []) {
      const semanticRole = filterSemanticRole(filter);
      const resultChanging = filterChangesResultsImmediately(filter, semanticRole);
      addHint(actionHintsByTargetId, filter.targetId, {
        semanticRole,
        preferredAction: "click",
        exactValueMode: "filterLabel",
        answerText: [filter.section, filter.label].filter(Boolean).join(": "),
        navigationAction: resultChanging,
        batchPlacement: resultChanging ? "last" : undefined,
        verifyAfterAction:
          semanticRole === "filter_panel_open"
            ? "filterPanelOpened"
            : "filterStateOrResultsChanged",
        instruction: filterInstruction(filter, semanticRole),
      });
    }
  }

  const URL_FILTER_ATTRS = {
    "online booking": "PlatformOnlineBooking",
    "accepts credit cards": "BusinessAcceptsCreditCards",
  };

  const URL_SORT_PARAMS = {
    "highest rated": "rating",
    "most reviewed": "review_count",
  };

  function parseAttrs(value) {
    return normalizeText(value)
      .split(",")
      .map((attr) => normalizeText(attr))
      .filter(Boolean);
  }

  function knownUrlFilters(filters) {
    return (filters || [])
      .map((filter) => {
        const attr = URL_FILTER_ATTRS[lower(filter.label)];
        if (!attr) return null;
        return {
          label: filter.label,
          attr,
          selected: Boolean(filter.selected),
        };
      })
      .filter(Boolean)
      .filter(
        (item, index, arr) =>
          arr.findIndex((candidate) => candidate.attr === item.attr) === index,
      );
  }

  function knownUrlSorts(sort) {
    const options = sort?.options?.length
      ? sort.options
      : SORT_OPTION_LABELS.map((label) => ({ label }));

    return options
      .map((option) => {
        const sortby = URL_SORT_PARAMS[lower(option.label)];
        if (!sortby) return null;
        return {
          label: option.label,
          sortby,
          active: Boolean(option.active) || lower(sort?.current) === lower(option.label),
        };
      })
      .filter(Boolean)
      .filter(
        (item, index, arr) =>
          arr.findIndex((candidate) => candidate.sortby === item.sortby) === index,
      );
  }

  function yelpSearchUrlWithParams(url, { attrs = [], sortby = "" } = {}) {
    const parsed = safeUrl(url);
    if (!parsed.pathname.includes("/search")) return "";

    const currentAttrs = parseAttrs(parsed.searchParams.get("attrs"));
    const nextAttrs = unique([...currentAttrs, ...attrs]);

    parsed.searchParams.delete("start");
    if (nextAttrs.length) parsed.searchParams.set("attrs", nextAttrs.join(","));
    if (sortby) parsed.searchParams.set("sortby", sortby);

    return parsed.toString();
  }

  function shortcutId(parts) {
    return `site:${ADAPTER_ID}:goto:${slug(parts.filter(Boolean).join(" "))}`;
  }

  function buildNavigationShortcut({ url, filterLabels = [], sortLabel = "" }) {
    const labelParts = [
      filterLabels.length ? `filters: ${filterLabels.join(", ")}` : "",
      sortLabel ? `sort: ${sortLabel}` : "",
    ].filter(Boolean);
    const label = labelParts.join("; ");

    return {
      targetId: shortcutId([...filterLabels, sortLabel]),
      preferredAction: "goto",
      url,
      label,
      text: `Yelp URL shortcut: ${label}. Use action type "goto" with this exact url: ${url}`,
      filterLabels,
      sortLabel,
    };
  }

  function collectNavigationShortcuts(url, filters, sort) {
    const parsed = safeUrl(url);
    if (!parsed.pathname.includes("/search")) return [];

    const filterOptions = knownUrlFilters(filters);
    const sortOptions = knownUrlSorts(sort);
    const shortcuts = [];

    for (const filter of filterOptions) {
      shortcuts.push(
        buildNavigationShortcut({
          url: yelpSearchUrlWithParams(url, { attrs: [filter.attr] }),
          filterLabels: [filter.label],
        }),
      );
    }

    if (filterOptions.length >= 2) {
      shortcuts.push(
        buildNavigationShortcut({
          url: yelpSearchUrlWithParams(url, {
            attrs: filterOptions.map((filter) => filter.attr),
          }),
          filterLabels: filterOptions.map((filter) => filter.label),
        }),
      );
    }

    for (const sortOption of sortOptions) {
      shortcuts.push(
        buildNavigationShortcut({
          url: yelpSearchUrlWithParams(url, { sortby: sortOption.sortby }),
          sortLabel: sortOption.label,
        }),
      );

      if (filterOptions.length >= 2) {
        shortcuts.push(
          buildNavigationShortcut({
            url: yelpSearchUrlWithParams(url, {
              attrs: filterOptions.map((filter) => filter.attr),
              sortby: sortOption.sortby,
            }),
            filterLabels: filterOptions.map((filter) => filter.label),
            sortLabel: sortOption.label,
          }),
        );
      }
    }

    const currentUrl = parsed.toString();
    return shortcuts
      .filter((shortcut) => shortcut.url && shortcut.url !== currentUrl)
      .filter(
        (shortcut, index, arr) =>
          arr.findIndex((candidate) => candidate.url === shortcut.url) === index,
      )
      .slice(0, 8);
  }

  const SORT_OPTION_LABELS = ["recommended", "highest rated", "most reviewed"];

  function isSortOptionLabel(label) {
    return SORT_OPTION_LABELS.includes(lower(label));
  }

  function collectSortControls(state, documentRef) {
    const triggerEl =
      getVisibleElements("a[role='button'][aria-haspopup='listbox']", documentRef).find(
        (el) => ancestorTextMatches(el, /sort:/i),
      ) ||
      getVisibleElements("a[role='button'][aria-expanded]", documentRef).find((el) =>
        ancestorTextMatches(el, /sort:/i),
      );
    const triggerControl = findControlForElement(state.controls, triggerEl);

    const options = unique([
      ...getVisibleElements("menu button[data-menu-item='true']", documentRef),
      ...getVisibleElements("button[data-menu-item='true']", documentRef),
      ...getVisibleElements("[role='option']", documentRef),
    ])
      .map((el) => {
        const label = cleanControlLabel(textContent(el));
        if (!isSortOptionLabel(label)) return null;
        const control =
          findControlForElement(state.controls, el) ||
          findBestControlInRegion(state.controls, el, { preferButton: true });

        return {
          label,
          targetId: control?.id || "",
          active: lower(el.getAttribute("data-active")) === "true",
          tag: lower(el.tagName),
        };
      })
      .filter(Boolean)
      .filter(
        (option, index, arr) =>
          arr.findIndex((candidate) => lower(candidate.label) === lower(option.label)) ===
          index,
      );

    return {
      current:
        options.find((option) => option.active)?.label ||
        cleanControlLabel(textContent(triggerEl)),
      triggerLabel: cleanControlLabel(textContent(triggerEl)) || "Sort",
      triggerTargetId: triggerControl?.id || "",
      expanded: lower(triggerEl?.getAttribute("aria-expanded")) === "true",
      options,
    };
  }

  function addSortHints(actionHintsByTargetId, sort) {
    addHint(actionHintsByTargetId, sort.triggerTargetId, {
      semanticRole: "sort_menu_trigger",
      preferredAction: "click",
      exactValueMode: "sortLabel",
      answerText: sort.current || sort.triggerLabel,
      verifyAfterAction: "sortMenuOpened",
      instruction:
        "Click this Yelp Sort control to open sorting options such as Recommended, Highest Rated, and Most Reviewed.",
    });

    for (const option of sort.options || []) {
      addHint(actionHintsByTargetId, option.targetId, {
        semanticRole: "sort_option",
        preferredAction: "click",
        exactValueMode: "sortLabel",
        answerText: option.label,
        navigationAction: true,
        batchPlacement: "last",
        verifyAfterAction: "sortOrResultsChanged",
        instruction: `Click this Yelp sort option when the task asks for ${option.label} results.`,
      });
    }
  }

  function headerRoot(documentRef) {
    return (
      documentRef.querySelector("header[class*='consumer-header']") ||
      documentRef.querySelector("header") ||
      null
    );
  }

  function headerSemanticRole(label) {
    const value = lower(label);
    if (value === "yelp") return "header_home_link";
    if (value.includes("start a project")) return "header_start_project";
    if (value.includes("write a review")) return "header_write_review";
    if (value.includes("log in") || value.includes("sign up")) return "header_account";
    if (value.includes("business")) return "header_business_nav";
    return "header_navigation";
  }

  function collectHeaderControls(state, documentRef) {
    const root = headerRoot(documentRef);
    if (!root) return [];

    return unique([
      ...getVisibleElements("a", root),
      ...getVisibleElements("button", root),
      ...getVisibleElements("[role='menuitem']", root),
      ...getVisibleElements("[role='button']", root),
    ])
      .filter((el) => !el.closest("#header_find_form"))
      .map((el) => {
        const label = cleanControlLabel(
          textContent(el) ||
            normalizeText(el.getAttribute("aria-label")) ||
            normalizeText(el.getAttribute("title")),
        );
        if (!label || label.length > 80) return null;

        const control =
          findControlForElement(state.controls, el) ||
          findBestControlInRegion(state.controls, el, {
            preferLink: lower(el.tagName) === "a",
            preferButton: lower(el.tagName) === "button",
            text: label,
          });

        return {
          label,
          targetId: control?.id || "",
          href: absoluteUrl(el.getAttribute("href")),
          semanticRole: headerSemanticRole(label),
          tag: lower(el.tagName),
        };
      })
      .filter((item) => item && item.targetId)
      .filter(
        (item, index, arr) =>
          arr.findIndex((candidate) => lower(candidate.label) === lower(item.label)) ===
          index,
      );
  }

  function addHeaderHints(actionHintsByTargetId, headerControls) {
    for (const item of headerControls || []) {
      addHint(actionHintsByTargetId, item.targetId, {
        semanticRole: item.semanticRole,
        preferredAction: "click",
        exactValueMode: "headerLabel",
        answerText: item.label,
        navigationAction: true,
        batchPlacement: "last",
        verifyAfterAction: "urlOrHeaderMenuChanged",
        instruction: `Click this Yelp header control for "${item.label}" when the task needs that navigation path.`,
      });
    }
  }

  function resultCardElements(documentRef) {
    return getVisibleElements('[data-testid="serp-ia-card"]', documentRef)
      .filter((el) => {
        const text = textContent(el);
        return text && el.querySelector('a[href^="/biz/"], a[href*="/biz/"]');
      });
  }

  function businessProfileAnchor(cardEl) {
    const anchors = getVisibleElements('a[href*="/biz/"]', cardEl);
    return (
      anchors.find((anchor) => {
        const href = normalizeText(anchor.getAttribute("href"));
        const text = textContent(anchor);
        return href && !href.includes("hrid=") && text && lower(text) !== "more";
      }) ||
      anchors.find((anchor) => {
        const href = normalizeText(anchor.getAttribute("href"));
        return href && !href.includes("hrid=");
      }) ||
      anchors[0] ||
      null
    );
  }

  function businessNameForCard(cardEl, anchor) {
    const anchorText = textContent(anchor);
    if (anchorText && lower(anchorText) !== "more") {
      return truncate(anchorText.replace(/^\d+\.\s*/, ""), 120);
    }

    const imageTitle = normalizeText(
      cardEl.querySelector("img[title]")?.getAttribute("title"),
    );
    if (imageTitle) return truncate(imageTitle, 120);

    const text = textContent(cardEl);
    const match = text.match(/^\s*\d+\.\s+(.+?)\s+[0-5](?:\.\d)?\s+\(/);
    return truncate(match?.[1] || "", 120);
  }

  function resultPositionForCard(cardEl) {
    const match = textContent(cardEl).match(/^\s*(\d+)\.\s+/);
    return match ? Number(match[1]) : null;
  }

  function categoriesForCard(cardEl) {
    return unique(
      getVisibleElements('a[href*="/search?find_desc="]', cardEl)
        .map((anchor) => textContent(anchor))
        .filter((text) => text && !/^\d+$/.test(text)),
    );
  }

  function areaForCard(cardEl) {
    const text = textContent(cardEl);
    const match = text.match(
      /\([\d,]+\s+reviews?\)\s+(.+?)(?:\s+Opens|\s+Open\b|\s+Closed\b|\s+"|\s+more\b)/i,
    );
    return truncate(match?.[1] || "", 120);
  }

  function reviewSnippetForCard(cardEl) {
    const text = textContent(cardEl);
    const match = text.match(/"([^"]{20,400})"/);
    return truncate(match?.[1] || "", 280);
  }

  function collectBusinessResults(state, documentRef) {
    return resultCardElements(documentRef).map((cardEl, index) => {
      const anchor = businessProfileAnchor(cardEl);
      const cardControl =
        findControlForElement(state.controls, cardEl) ||
        findBestControlInRegion(state.controls, cardEl);
      const linkControl =
        findControlForElement(state.controls, anchor) ||
        findBestControlInRegion(state.controls, anchor, { preferLink: true });
      const text = textContent(cardEl);
      const rating =
        parseRatingFromText(
          normalizeText(cardEl.querySelector("[aria-label*='star rating']")?.getAttribute("aria-label")),
        ) || parseRatingFromText(text);

      return {
        position: resultPositionForCard(cardEl) || index + 1,
        name: businessNameForCard(cardEl, anchor),
        rating,
        reviewCount: parseReviewCountFromText(text),
        categories: categoriesForCard(cardEl),
        area: areaForCard(cardEl),
        snippet: reviewSnippetForCard(cardEl),
        yelpUrl: canonicalYelpUrl(anchor?.getAttribute("href")),
        cardTargetId: cardControl?.id || "",
        profileTargetId: linkControl?.id || "",
        controlIds: unique([cardControl?.id, linkControl?.id]),
        bounds: elementBounds(cardEl),
      };
    });
  }

  function addBusinessResultHints(actionHintsByTargetId, results) {
    for (const result of results || []) {
      addHint(actionHintsByTargetId, result.cardTargetId, {
        semanticRole: "business_result_card",
        preferredAction: "extract",
        exactValueMode: "visibleText",
        answerText: result.name,
        verifyAfterAction: "businessSummaryExtracted",
        instruction:
          "Extract this Yelp result card for business name, rating, review count, categories, neighborhood snippet, and Yelp URL.",
      });
      addHint(actionHintsByTargetId, result.profileTargetId, {
        semanticRole: "business_profile_link",
        preferredAction: "click",
        navigationAction: true,
        batchPlacement: "last",
        answerText: result.name,
        verifyAfterAction: "businessDetailPageLoaded",
        instruction:
          "Click this Yelp business profile link when phone, website, or full address is needed.",
      });
    }
  }

  function nextPageTarget(state, documentRef) {
    const next =
      getVisibleElements('a.next-link[aria-label="Next"]', documentRef)[0] ||
      getVisibleElements('a[aria-label="Next"][href*="/search"]', documentRef)[0] ||
      getVisibleElements("button.pagination-button", documentRef).find((button) =>
        /next/i.test(textContent(button)),
      );

    const control = findControlForElement(state.controls, next);
    return {
      targetId: control?.id || "",
      href: absoluteUrl(next?.getAttribute("href")),
      label: textContent(next) || normalizeText(next?.getAttribute("aria-label")),
    };
  }

  function addNextPageHint(actionHintsByTargetId, nextPage) {
    addHint(actionHintsByTargetId, nextPage.targetId, {
      semanticRole: "results_next_page",
      preferredAction: "click",
      navigationAction: true,
      batchPlacement: "last",
      answerText: "Next Yelp results page",
      verifyAfterAction: "urlOrResultsPageChanged",
      instruction:
        "Use this Yelp pagination control to continue collecting more search result cards.",
    });
  }

  function fullAddressFromJsonLd(localBusiness) {
    const address = localBusiness?.address || {};
    return truncate(
      [
        address.streetAddress,
        [address.addressLocality, address.addressRegion, address.postalCode]
          .filter(Boolean)
          .join(", "),
        address.addressCountry,
      ]
        .filter(Boolean)
        .join(" "),
      240,
    );
  }

  function categoriesForDetail(documentRef) {
    return unique(
      getVisibleElements('[data-testid="BizHeaderCategory"] a', documentRef)
        .map((anchor) => textContent(anchor))
        .filter(Boolean),
    );
  }

  function textNearMainContent(documentRef) {
    const main =
      documentRef.querySelector('[data-testid="main-content"]') ||
      documentRef.querySelector("#main-content") ||
      documentRef.body;
    return textContent(main).slice(0, 12000);
  }

  function phoneFromPage(localBusiness, documentRef) {
    if (localBusiness?.telephone) return normalizeText(localBusiness.telephone);
    const match = textNearMainContent(documentRef).match(
      /Phone number\s+(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i,
    );
    return normalizeText(match?.[1]);
  }

  function websiteLink(documentRef) {
    const links = getVisibleElements('a[href*="/biz_redir?url="]', documentRef);
    return (
      links.find((link) => textContent(link) && !/^business website$/i.test(textContent(link))) ||
      links.find((link) => textContent(link)) ||
      links[0] ||
      null
    );
  }

  function openStatusText(documentRef) {
    const text = textNearMainContent(documentRef);
    const match = text.match(
      /\b(Open|Closed)\b(?:\s+(?:until\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM))?)?/i,
    );
    return truncate(match?.[0] || "", 120);
  }

  function collectBusinessDetail(state, documentRef, url) {
    const localBusiness = findLocalBusinessJsonLd(documentRef);
    const website = websiteLink(documentRef);
    const websiteControl =
      findControlForElement(state.controls, website) ||
      findBestControlInRegion(state.controls, website, { preferLink: true });
    const rating =
      normalizeText(localBusiness?.aggregateRating?.ratingValue) ||
      parseRatingFromText(
        normalizeText(
          documentRef
            .querySelector('[aria-label*="star rating"]')
            ?.getAttribute("aria-label"),
        ),
      );
    const reviewCount =
      normalizeText(localBusiness?.aggregateRating?.reviewCount) ||
      parseReviewCountFromText(textNearMainContent(documentRef));
    const address = localBusiness?.address || {};

    return {
      name:
        normalizeText(localBusiness?.name) ||
        textContent(documentRef.querySelector("h1")),
      rating,
      reviewCount,
      categories: categoriesForDetail(documentRef),
      fullAddress: fullAddressFromJsonLd(localBusiness),
      area: normalizeText(address.addressLocality),
      phone: phoneFromPage(localBusiness, documentRef),
      websiteText: textContent(website),
      websiteUrl: decodeBizRedirUrl(website?.getAttribute("href")),
      yelpUrl: canonicalYelpUrl(url),
      openStatusText: openStatusText(documentRef),
      websiteTargetId: websiteControl?.id || "",
    };
  }

  function addBusinessDetailHints(actionHintsByTargetId, detail) {
    addHint(actionHintsByTargetId, detail.websiteTargetId, {
      semanticRole: "business_website_link",
      preferredAction: "extract",
      exactValueMode: "href",
      answerText: detail.websiteText || detail.websiteUrl || "Business website",
      verifyAfterAction: "websiteHrefExtracted",
      instruction:
        "Extract this Yelp business website link; its href may be a Yelp redirect that includes the actual website URL.",
    });
  }

  function searchSummaryGroup({ pageKind, search, nextPage }) {
    return {
      id: "yelp_search_summary",
      kind: "yelp_search_summary",
      adapterId: ADAPTER_ID,
      label: "Yelp search summary",
      text: [
        `Yelp page kind: ${pageKind}`,
        search.query ? `query: ${search.query}` : "",
        search.location ? `location: ${search.location}` : "",
        nextPage.href ? `next page: ${nextPage.href}` : "",
      ]
        .filter(Boolean)
        .join("; "),
      query: search.query,
      location: search.location,
      pageKind,
      nextPageUrl: nextPage.href,
      primaryControlIds: unique([
        search.findTargetId,
        search.locationTargetId,
        search.submitTargetId,
        nextPage.targetId,
      ]),
    };
  }

  function filtersGroup(filters) {
    if (!filters.length) return null;
    return {
      id: "yelp_filters",
      kind: "yelp_filters",
      adapterId: ADAPTER_ID,
      label: "Yelp filters",
      text: filters
        .map(
          (filter) =>
            `${filter.section ? `${filter.section}: ` : ""}${filter.label}${
              filter.selected ? " (selected)" : ""
            }`,
        )
        .join("; "),
      filters,
      controlIds: unique(filters.map((filter) => filter.targetId)),
    };
  }

  function businessResultGroups(results) {
    return (results || []).map((result) => ({
      id: `yelp_business_result_${result.position}`,
      targetId: `site:${ADAPTER_ID}:business_result:${result.position}`,
      kind: "yelp_business_result",
      adapterId: ADAPTER_ID,
      preferredAction: "extract",
      label: `Yelp result ${result.position}: ${result.name}`,
      text: [
        result.name,
        result.rating ? `${result.rating} stars` : "",
        result.reviewCount ? `${result.reviewCount} reviews` : "",
        result.categories.length ? result.categories.join(", ") : "",
        result.area,
        result.snippet,
        result.yelpUrl,
      ]
        .filter(Boolean)
        .join("; "),
      position: result.position,
      businessName: result.name,
      rating: result.rating,
      reviewCount: result.reviewCount,
      categories: result.categories,
      area: result.area,
      snippet: result.snippet,
      yelpUrl: result.yelpUrl,
      controlIds: result.controlIds,
      cardTargetId: result.cardTargetId,
      profileTargetId: result.profileTargetId,
      bounds: result.bounds,
    }));
  }

  function businessDetailGroup(detail) {
    if (!detail?.name) return null;
    return {
      id: "yelp_business_detail",
      targetId: `site:${ADAPTER_ID}:business_detail`,
      kind: "yelp_business_detail",
      adapterId: ADAPTER_ID,
      preferredAction: "extract",
      label: `Yelp business detail: ${detail.name}`,
      text: [
        detail.name,
        detail.rating ? `${detail.rating} stars` : "",
        detail.reviewCount ? `${detail.reviewCount} reviews` : "",
        detail.categories.length ? detail.categories.join(", ") : "",
        detail.fullAddress,
        detail.phone,
        detail.websiteUrl || detail.websiteText,
        detail.yelpUrl,
        detail.openStatusText,
      ]
        .filter(Boolean)
        .join("; "),
      businessName: detail.name,
      rating: detail.rating,
      reviewCount: detail.reviewCount,
      categories: detail.categories,
      fullAddress: detail.fullAddress,
      area: detail.area,
      phone: detail.phone,
      websiteText: detail.websiteText,
      websiteUrl: detail.websiteUrl,
      yelpUrl: detail.yelpUrl,
      openStatusText: detail.openStatusText,
      controlIds: unique([detail.websiteTargetId]),
      websiteTargetId: detail.websiteTargetId,
    };
  }

  function slug(value) {
    return (
      lower(value)
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "section"
    );
  }

  function detailSectionLabel(sectionEl) {
    return truncate(
      normalizeText(sectionEl.getAttribute("aria-label")) ||
        textContent(sectionEl.querySelector("h1, h2, h3")) ||
        contextLabelFor(sectionEl),
      100,
    );
  }

  function isReviewDetailSection(section) {
    const label = typeof section === "string" ? section : section?.label || "";
    return /recommended reviews?|reviews?/i.test(label);
  }

  function prioritizedDetailSections(sections) {
    const important = (sections || []).filter((section) =>
      isReviewDetailSection(section),
    );
    return unique([...important, ...(sections || [])]);
  }

  function detailSectionElements(documentRef) {
    const main =
      documentRef.querySelector('[data-testid="main-content"]') ||
      documentRef.querySelector("#main-content") ||
      documentRef.body;

    return getVisibleElements("section", main)
      .filter((section) => detailSectionLabel(section) && textContent(section));
  }

  function collectBusinessDetailSections(state, documentRef) {
    return detailSectionElements(documentRef).map((sectionEl, index) => {
      const label = detailSectionLabel(sectionEl) || `Section ${index + 1}`;
      const controls = unique([
        ...getVisibleElements("button", sectionEl),
        ...getVisibleElements("a[href]", sectionEl),
        ...getVisibleElements("a[role='button']", sectionEl),
      ])
        .map((el) => {
          const control =
            findControlForElement(state.controls, el) ||
            findBestControlInRegion(state.controls, el, {
              preferButton: lower(el.tagName) === "button",
              preferLink: lower(el.tagName) === "a",
            });
          const controlLabel =
            cleanControlLabel(textContent(el)) ||
            normalizeText(el.getAttribute("aria-label")) ||
            label;

          return {
            label: truncate(controlLabel, 100),
            targetId: control?.id || "",
            tag: lower(el.tagName),
            href: absoluteUrl(el.getAttribute("href")),
            expanded: lower(el.getAttribute("aria-expanded")) === "true",
            hasExpanderState: el.hasAttribute("aria-expanded"),
          };
        })
        .filter((control) => control.targetId)
        .filter(
          (control, controlIndex, arr) =>
            arr.findIndex((candidate) => candidate.targetId === control.targetId) ===
            controlIndex,
        );

      return {
        id: `yelp_business_detail_section_${slug(label)}_${index + 1}`,
        label,
        text: textContent(sectionEl),
        controlIds: unique(controls.map((control) => control.targetId)),
        controls,
      };
    });
  }

  function addBusinessDetailSectionHints(actionHintsByTargetId, sections) {
    for (const section of sections || []) {
      for (const control of section.controls || []) {
        const isExpander = control.hasExpanderState;
        addHint(actionHintsByTargetId, control.targetId, {
          semanticRole: isExpander
            ? "business_detail_section_expand"
            : "business_detail_section_control",
          preferredAction: "click",
          exactValueMode: "sectionLabel",
          answerText: [section.label, control.label].filter(Boolean).join(": "),
          verifyAfterAction: isExpander
            ? "sectionExpandedOrCollapsed"
            : "detailSectionControlActivated",
          instruction: isReviewDetailSection(section)
            ? `This control belongs to Yelp "${section.label}". For review highlights, prefer extracting the visible Recommended Reviews section/group; click review sort/filter controls only when the task explicitly needs a different review order or filter.`
            : `Use this Yelp business detail section control for "${section.label}" when the task needs section content such as review highlights, hours, amenities, photos, or related business details.`,
        });
      }
    }
  }

  function businessDetailSectionGroups(sections) {
    return prioritizedDetailSections(sections).map((section) => ({
      id: section.id,
      targetId: `site:${ADAPTER_ID}:detail_section:${slug(section.label)}`,
      kind: "yelp_business_detail_section",
      adapterId: ADAPTER_ID,
      preferredAction: "extract",
      label: `Yelp detail section: ${section.label}`,
      text: section.text,
      sectionLabel: section.label,
      controlIds: section.controlIds,
      controls: section.controls,
    }));
  }

  function headerGroup(headerControls) {
    if (!headerControls.length) return null;
    return {
      id: "yelp_header_controls",
      kind: "yelp_header_controls",
      adapterId: ADAPTER_ID,
      label: "Yelp header controls",
      text: headerControls.map((item) => item.label).join("; "),
      controls: headerControls,
      controlIds: unique(headerControls.map((item) => item.targetId)),
    };
  }

  function sortGroup(sort) {
    if (!sort?.triggerTargetId && !sort?.options?.length) return null;
    return {
      id: "yelp_sort_controls",
      kind: "yelp_sort_controls",
      adapterId: ADAPTER_ID,
      label: "Yelp sort controls",
      text: [
        sort.current ? `current: ${sort.current}` : "",
        sort.options?.length
          ? `options: ${sort.options.map((option) => option.label).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("; "),
      current: sort.current,
      triggerTargetId: sort.triggerTargetId,
      options: sort.options,
      controlIds: unique([
        sort.triggerTargetId,
        ...((sort.options || []).map((option) => option.targetId)),
      ]),
    };
  }

  function navigationShortcutsGroup(shortcuts) {
    if (!shortcuts?.length) return null;
    return {
      id: "yelp_navigation_shortcuts",
      kind: "yelp_navigation_shortcuts",
      adapterId: ADAPTER_ID,
      targetId: `site:${ADAPTER_ID}:goto:shortcuts`,
      preferredAction: "goto",
      label: "Yelp URL navigation shortcuts",
      text: shortcuts.map((shortcut) => shortcut.text).join("; "),
      shortcuts,
    };
  }

  function buildPlannerHints(
    pageKind,
    results,
    detail,
    nextPage,
    filters,
    sort,
    detailSections,
    navigationShortcuts,
  ) {
    const hints = [
      "Yelp adapter detected search controls, result cards, filters, pagination, or business detail facts.",
      "Use Yelp result cards for quick business summaries.",
      "Visit a Yelp business detail page when phone, website, or full address is needed.",
    ];

    if (nextPage?.targetId || nextPage?.href) {
      hints.push("Use the Yelp next-page control to continue paginated result collection.");
    }

    if (results?.length) {
      hints.push(`Visible Yelp result cards detected: ${results.length}.`);
    }

    if (pageKind === "business_detail" && detail?.name) {
      hints.push(`Yelp business detail detected: ${detail.name}.`);
    }

    if (filters?.length) {
      hints.push(
        "Yelp filter controls detected, including the All filters panel, visible chips, nested options, and Apply filters when present.",
      );
      hints.push(
        "Yelp visible filter chips can refresh/rerender results and change target IDs. Click at most one visible Yelp filter chip per step, then observe before choosing another.",
      );
      hints.push(
        "When multiple Yelp filters are needed and no matching Yelp URL shortcut is available, open All filters, then after the panel is visible select multiple nested checkbox/radio options and click Apply filters last.",
      );
    }

    if (navigationShortcuts?.length) {
      hints.push(
        "Yelp URL shortcuts are available. When a shortcut exactly matches requested filters or sort order, prefer a single goto action with that exact URL over clicking visible chips or the All filters panel.",
      );
      hints.push(
        `Yelp shortcut examples: ${navigationShortcuts
          .slice(0, 3)
          .map((shortcut) => `${shortcut.label} -> ${shortcut.url}`)
          .join(" | ")}`,
      );
    }

    if (sort?.triggerTargetId || sort?.options?.length) {
      hints.push(
        "Yelp sort controls detected for Recommended, Highest Rated, and Most Reviewed ordering.",
      );
    }

    if (detailSections?.length) {
      hints.push(
        `Yelp business detail sections detected: ${detailSections
          .map((section) => section.label)
          .join(", ")}.`,
      );
      if (detailSections.some((section) => isReviewDetailSection(section))) {
        hints.push(
          "Yelp Recommended Reviews detected. For review highlights, extract the visible Recommended Reviews section/group; review sort/filter controls are optional and should not be clicked repeatedly unless review order matters.",
        );
      }
    }

    return hints;
  }

  function controlHintText(hint) {
    if (!hint) return "";
    const parts = [
      "Yelp adapter",
      hint.semanticRole ? `role: ${hint.semanticRole}` : "",
      hint.preferredAction ? `preferred action: ${hint.preferredAction}` : "",
      hint.exactValueMode ? `value mode: ${hint.exactValueMode}` : "",
      hint.answerText ? `target: ${hint.answerText}` : "",
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
        heading: truncate(unique([control.heading, hint.instruction]).join(" | "), 220),
        adapterHints: {
          ...(control.adapterHints || {}),
          [ADAPTER_ID]: hint,
        },
      };
    });
  }

  function buildPageFactSummary(
    pageKind,
    search,
    results,
    detail,
    nextPage,
    filters,
    sort,
    detailSections,
    headerControls,
    navigationShortcuts,
  ) {
    return [
      `Yelp page kind: ${pageKind}`,
      search.query ? `query: ${search.query}` : "",
      search.location ? `location: ${search.location}` : "",
      headerControls?.length ? `header controls: ${headerControls.length}` : "",
      filters?.length ? `filters: ${filters.length}` : "",
      sort?.current ? `sort: ${sort.current}` : "",
      navigationShortcuts?.length ? `url shortcuts: ${navigationShortcuts.length}` : "",
      results.length ? `visible results: ${results.length}` : "",
      detail?.name ? `business: ${detail.name}` : "",
      detailSections?.length ? `detail sections: ${detailSections.length}` : "",
      detail?.phone ? `phone: ${detail.phone}` : "",
      detail?.websiteUrl ? `website: ${detail.websiteUrl}` : "",
      nextPage?.href ? "next results page available" : "",
    ]
      .filter(Boolean)
      .join("; ");
  }

  function buildSiteAdapter(state, documentRef, url) {
    const pageKind = detectPageKind(documentRef, url);
    const search = findSearchControls(state, documentRef);
    const headerControls = collectHeaderControls(state, documentRef);
    const filters = pageKind === "search_results" ? collectFilters(state, documentRef) : [];
    const sort =
      pageKind === "search_results"
        ? collectSortControls(state, documentRef)
        : { current: "", triggerTargetId: "", options: [] };
    const navigationShortcuts =
      pageKind === "search_results" ? collectNavigationShortcuts(url, filters, sort) : [];
    const results =
      pageKind === "search_results" ? collectBusinessResults(state, documentRef) : [];
    const nextPage =
      pageKind === "search_results"
        ? nextPageTarget(state, documentRef)
        : { targetId: "", href: "", label: "" };
    const detail =
      pageKind === "business_detail"
        ? collectBusinessDetail(state, documentRef, url)
        : null;
    const detailSections =
      pageKind === "business_detail"
        ? collectBusinessDetailSections(state, documentRef)
        : [];
    const actionHintsByTargetId = {};

    addSearchHints(actionHintsByTargetId, search);
    addHeaderHints(actionHintsByTargetId, headerControls);
    addFilterHints(actionHintsByTargetId, filters);
    addSortHints(actionHintsByTargetId, sort);
    addBusinessResultHints(actionHintsByTargetId, results);
    addNextPageHint(actionHintsByTargetId, nextPage);
    if (detail) addBusinessDetailHints(actionHintsByTargetId, detail);
    addBusinessDetailSectionHints(actionHintsByTargetId, detailSections);

    const primaryControlIds = unique([
      search.findTargetId,
      search.locationTargetId,
      search.submitTargetId,
      ...headerControls.map((control) => control.targetId),
      ...filters.map((filter) => filter.targetId),
      sort.triggerTargetId,
      ...sort.options.map((option) => option.targetId),
      ...results.flatMap((result) => [result.cardTargetId, result.profileTargetId]),
      nextPage.targetId,
      detail?.websiteTargetId,
      ...prioritizedDetailSections(detailSections).flatMap(
        (section) => section.controlIds,
      ),
    ]);
    const plannerHints = buildPlannerHints(
      pageKind,
      results,
      detail,
      nextPage,
      filters,
      sort,
      detailSections,
      navigationShortcuts,
    );

    return {
      id: ADAPTER_ID,
      pageKind,
      navigation: {
        nextPageTargetId: nextPage.targetId,
        nextPageUrl: nextPage.href,
        shortcuts: navigationShortcuts,
      },
      primaryControlIds,
      actionHintsByTargetId,
      plannerHints,
      groups: [
        searchSummaryGroup({ pageKind, search, nextPage }),
        headerGroup(headerControls),
        navigationShortcutsGroup(navigationShortcuts),
        filtersGroup(filters),
        sortGroup(sort),
        businessDetailGroup(detail),
        ...businessDetailSectionGroups(detailSections),
        ...businessResultGroups(results),
      ].filter(Boolean),
      pageFactSummary: buildPageFactSummary(
        pageKind,
        search,
        results,
        detail,
        nextPage,
        filters,
        sort,
        detailSections,
        headerControls,
        navigationShortcuts,
      ),
    };
  }

  registry.register({
    id: ADAPTER_ID,
    priority: 90,

    match({ url, document: documentRef }) {
      return (
        isYelpHost(url) &&
        (isHomepage(documentRef, url) ||
          isResultsPage(documentRef, url) ||
          isDetailPage(documentRef, url))
      );
    },

    enhanceState({ state, document: documentRef, url }) {
      const siteAdapter = buildSiteAdapter(state, documentRef, url);

      return {
        ...state,
        site: {
          ...(state.site || {}),
          id: "yelp",
          mode: siteAdapter.pageKind,
        },
        pageFacts: {
          ...(state.pageFacts || {}),
          yelpPageKind: siteAdapter.pageKind,
        },
        siteAdapter: {
          id: siteAdapter.id,
          pageKind: siteAdapter.pageKind,
          navigation: siteAdapter.navigation,
          primaryControlIds: siteAdapter.primaryControlIds,
          actionHintsByTargetId: siteAdapter.actionHintsByTargetId,
          plannerHints: siteAdapter.plannerHints,
        },
        visibleTextSummary: unique([
          siteAdapter.pageFactSummary,
          ...siteAdapter.plannerHints,
          ...(state.visibleTextSummary || []),
        ]).slice(0, 60),
        groups: [...siteAdapter.groups, ...(state.groups || [])],
        controls: enhanceControls(
          state.controls || [],
          siteAdapter.actionHintsByTargetId || {},
        ),
      };
    },
  });
})();
