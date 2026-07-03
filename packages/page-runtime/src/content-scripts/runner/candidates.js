(function () {
  const ns = window.WebGPTRunnerModules;
  const { isVisible, lower } = ns.domUtils;

  function shouldSkipAsCandidate(el) {
    if (!el || !(el instanceof Element)) return true;
    if (!isVisible(el)) return true;

    const tag = lower(el.tagName);
    const role = lower(el.getAttribute("role"));

    const groupingOnly =
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

    return groupingOnly;
  }

  function candidateClosestSelector() {
    return [
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
      "tr",
      "td",
      "th",
      "figure",
      "figcaption",
      "picture",
      '[role="button"]',
      '[role="link"]',
      '[role="textbox"]',
      '[role="combobox"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="listitem"]',
      '[role="gridcell"]',
      '[role="row"]',
      '[role="treeitem"]',
      '[role="switch"]',
      '[role="group"]',
      '[role="card"]',
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
    ].join(",");
  }

  function promoteCandidate(el) {
    if (!el || !(el instanceof Element)) return null;
    const closest = el.closest(candidateClosestSelector());
    return closest || el;
  }

  function candidateElements() {
    return Array.from(
      document.querySelectorAll(
        [
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
          "tr",
          "td",
          "th",
          "figure",
          "figcaption",
          "picture",
          '[role="button"]',
          '[role="link"]',
          '[role="textbox"]',
          '[role="combobox"]',
          '[role="checkbox"]',
          '[role="radio"]',
          '[role="tab"]',
          '[role="menuitem"]',
          '[role="option"]',
          '[role="listitem"]',
          '[role="gridcell"]',
          '[role="row"]',
          '[role="treeitem"]',
          '[role="switch"]',
          '[role="group"]',
          '[role="card"]',
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
          "i",
          "canvas",
          "[data-icon]",
        ].join(","),
      ),
    )
      .map((el) => promoteCandidate(el))
      .filter(Boolean)
      .filter((el, index, arr) => arr.indexOf(el) === index)
      .filter((el) => !shouldSkipAsCandidate(el))
      .filter(isVisible);
  }

  ns.candidates = {
    shouldSkipAsCandidate,
    candidateClosestSelector,
    promoteCandidate,
    candidateElements,
  };
})();
