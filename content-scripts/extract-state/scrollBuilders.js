(function () {
  const ns = (globalThis.WebGPTExtractStateModules =
    globalThis.WebGPTExtractStateModules || {});

  if (!ns.domUtils || !ns.elementMetadata || !ns.controlBuilders) {
    throw new Error(
      "extract-state/domUtils.js, elementMetadata.js, and controlBuilders.js must load before scrollBuilders.js",
    );
  }

  const { normalizeText, lower, truncateWords, isVisible } = ns.domUtils;

  const {
    dataAttrsFor,
    labelForControl,
    controlTextFor,
    nearestHeadingText,
    nearbyText,
    getContainerKind,
  } = ns.elementMetadata;

  const { selectorFor } = ns.controlBuilders;

  function buildScrollState() {
    const body = document.body || { scrollWidth: 0, scrollHeight: 0 };
    const docEl = document.documentElement || {
      scrollWidth: 0,
      scrollHeight: 0,
    };

    const documentWidth = Math.max(
      body.scrollWidth,
      docEl.scrollWidth,
      window.innerWidth,
    );
    const documentHeight = Math.max(
      body.scrollHeight,
      docEl.scrollHeight,
      window.innerHeight,
    );

    const x = Math.round(window.scrollX);
    const y = Math.round(window.scrollY);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    return {
      x,
      y,
      viewportWidth,
      viewportHeight,
      documentWidth,
      documentHeight,
      atTop: y <= 5,
      atBottom: y + viewportHeight >= documentHeight - 10,
    };
  }

  function isScrollableElement(el) {
    if (!el || !(el instanceof Element)) return false;
    if (!isVisible(el)) return false;

    const style = window.getComputedStyle(el);
    const overflowY = lower(style.overflowY);
    const overflowX = lower(style.overflowX);
    const overflow = lower(style.overflow);

    const allowsY =
      overflowY === "auto" ||
      overflowY === "scroll" ||
      overflowY === "overlay" ||
      overflow === "auto" ||
      overflow === "scroll" ||
      overflow === "overlay";

    const allowsX =
      overflowX === "auto" ||
      overflowX === "scroll" ||
      overflowX === "overlay" ||
      overflow === "auto" ||
      overflow === "scroll" ||
      overflow === "overlay";

    const hasVerticalRange = el.scrollHeight > el.clientHeight + 20;
    const hasHorizontalRange = el.scrollWidth > el.clientWidth + 20;

    if (!allowsY && !allowsX) return false;
    if (!hasVerticalRange && !hasHorizontalRange) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 60) return false;

    return true;
  }

  function scrollContainerCandidateSelector() {
    return [
      "div",
      "section",
      "article",
      "main",
      "aside",
      "nav",
      "ul",
      "ol",
      "dl",
      "li",
      "table",
      "tbody",
      '[role="region"]',
      '[role="group"]',
      '[role="list"]',
      '[role="listbox"]',
      '[role="menu"]',
      '[role="grid"]',
      '[role="tree"]',
      '[role="tabpanel"]',
      '[role="dialog"]',
      '[role="radiogroup"]',
    ].join(",");
  }

  function collectScrollableContainerCandidates() {
    return Array.from(
      document.querySelectorAll(scrollContainerCandidateSelector()),
    ).filter((el) => isScrollableElement(el));
  }

  function scrollStateForElement(el) {
    const scrollTop = Math.round(el.scrollTop || 0);
    const scrollLeft = Math.round(el.scrollLeft || 0);
    const scrollHeight = Math.round(el.scrollHeight || 0);
    const scrollWidth = Math.round(el.scrollWidth || 0);
    const clientHeight = Math.round(el.clientHeight || 0);
    const clientWidth = Math.round(el.clientWidth || 0);
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);

    return {
      scrollTop,
      scrollLeft,
      scrollHeight,
      scrollWidth,
      clientHeight,
      clientWidth,
      maxScrollTop,
      maxScrollLeft,
      atTop: scrollTop <= 5,
      atBottom: scrollTop >= Math.max(0, maxScrollTop - 5),
      atLeft: scrollLeft <= 5,
      atRight: scrollLeft >= Math.max(0, maxScrollLeft - 5),
      scrollableY: maxScrollTop > 0,
      scrollableX: maxScrollLeft > 0,
    };
  }

  function scrollContainerDedupeKey(el) {
    if (!el || !(el instanceof Element)) return "";

    const rect = el.getBoundingClientRect();

    return [
      lower(el.tagName),
      lower(el.getAttribute("role")),
      normalizeText(labelForControl(el)).toLowerCase(),
      normalizeText(el.getAttribute("aria-label")).toLowerCase(),
      normalizeText(el.getAttribute("data-testid")).toLowerCase(),
      Math.round(rect.x),
      Math.round(rect.y),
      Math.round(rect.width),
      Math.round(rect.height),
      Math.round(el.scrollHeight || 0),
      Math.round(el.clientHeight || 0),
    ].join("|");
  }

  function buildScrollableContainers() {
    const rawCandidates = collectScrollableContainerCandidates();
    const seen = new Set();
    const containers = [];
    let idCounter = 1;

    for (const el of rawCandidates) {
      const key = scrollContainerDedupeKey(el);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const rect = el.getBoundingClientRect();

      containers.push({
        id: `sc_${idCounter++}`,
        selector: selectorFor(el),
        tag: lower(el.tagName),
        role: normalizeText(el.getAttribute("role")),
        label: truncateWords(labelForControl(el), 100),
        text: truncateWords(controlTextFor(el), 200),
        ariaLabel: normalizeText(el.getAttribute("aria-label")),
        name: truncateWords(normalizeText(el.getAttribute("name")), 100),
        title: truncateWords(normalizeText(el.getAttribute("title")), 100),
        heading: truncateWords(nearestHeadingText(el), 100),
        nearbyText: truncateWords(nearbyText(el), 100),
        visible: true,
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        containerKind: getContainerKind(el),
        dataAttrs: dataAttrsFor(el),
        className: truncateWords(normalizeText(el.getAttribute("class")), 200),
        classes: normalizeText(el.getAttribute("class"))
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 20),
        scrollState: scrollStateForElement(el),
      });
    }

    return containers;
  }

  ns.scrollBuilders = {
    buildScrollState,
    isScrollableElement,
    scrollStateForElement,
    buildScrollableContainers,
  };
})();
