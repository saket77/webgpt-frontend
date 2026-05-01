(function () {
  const ns = (globalThis.WebGPTExtractStateModules =
    globalThis.WebGPTExtractStateModules || {});

  if (!ns.domUtils || !ns.elementMetadata) {
    throw new Error(
      "extract-state/domUtils.js and elementMetadata.js must load before pageBuilders.js",
    );
  }

  const { normalizeText, lower, textContent, isVisible } = ns.domUtils;
  const { nearestHeadingText } = ns.elementMetadata;

  function buildHeadings() {
    const seen = new Set();

    return Array.from(
      document.querySelectorAll(
        "h1,h2,h3,h4,h5,h6,[role='heading'],[role='tab']",
      ),
    )
      .filter(isVisible)
      .map((el) => textContent(el))
      .filter(Boolean)
      .filter((text) => {
        const key = text.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 20);
  }

  function buildVisibleTextSummary() {
    const seen = new Set();

    return Array.from(document.querySelectorAll("body *"))
      .filter(isVisible)
      .filter((el) => !(el.children && el.children.length > 10))
      .map((el) => textContent(el))
      .map((text) => text.slice(0, 140))
      .filter((text) => text && text.length >= 2)
      .filter((text) => {
        const key = text.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 40);
  }

  function buildOverlays(controls) {
    return controls
      .filter((c) => {
        const haystack =
          `${c.text} ${c.label} ${c.ariaLabel} ${c.nearbyText}`.toLowerCase();
        return (
          haystack.includes("cookie") ||
          haystack.includes("accept all") ||
          haystack.includes("reject") ||
          haystack.includes("privacy") ||
          haystack.includes("consent") ||
          haystack.includes("sign in") ||
          haystack.includes("continue") ||
          haystack.includes("dismiss")
        );
      })
      .slice(0, 20);
  }

  function buildGroups() {
    const candidates = Array.from(
      document.querySelectorAll(
        [
          "ul",
          "ol",
          "dl",
          "table",
          "tbody",
          "fieldset",
          '[role="group"]',
          '[role="radiogroup"]',
          '[role="listbox"]',
          '[role="menu"]',
          '[role="tabpanel"]',
        ].join(","),
      ),
    );

    const seen = new Set();
    const groups = [];

    for (const el of candidates) {
      if (!isVisible(el)) continue;

      const text = textContent(el).slice(0, 180);
      const label =
        normalizeText(el.getAttribute("aria-label")) ||
        nearestHeadingText(el) ||
        "";

      const rect = el.getBoundingClientRect();
      const key = [
        lower(el.tagName),
        lower(el.getAttribute("role")),
        label.toLowerCase(),
        Math.round(rect.x),
        Math.round(rect.y),
      ].join("|");

      if (seen.has(key)) continue;
      seen.add(key);

      groups.push({
        tag: lower(el.tagName),
        role: normalizeText(el.getAttribute("role")),
        label,
        text,
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    }

    return groups.slice(0, 40);
  }

  ns.pageBuilders = {
    buildHeadings,
    buildVisibleTextSummary,
    buildOverlays,
    buildGroups,
  };
})();
