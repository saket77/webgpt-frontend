(function () {
  const ns = (globalThis.WebGPTExtractStateModules =
    globalThis.WebGPTExtractStateModules || {});

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function lower(value) {
    return normalizeText(value).toLowerCase();
  }

  function truncateWords(value, maxWords = 50) {
    const text = normalizeText(value);
    if (!text) return "";

    const words = text.split(/\s+/);
    if (words.length <= maxWords) {
      return text;
    }

    return words.slice(0, maxWords).join(" ");
  }

  function textContent(el) {
    return normalizeText(el?.innerText || el?.textContent || el?.value || "");
  }

  function isVisible(el) {
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
  }

  function isEnabled(el) {
    if (!el || !(el instanceof Element)) return false;
    const ariaDisabled = lower(el.getAttribute("aria-disabled"));
    return !el.hasAttribute("disabled") && ariaDisabled !== "true";
  }

  function cssEscapeSafe(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  ns.domUtils = {
    normalizeText,
    lower,
    truncateWords,
    textContent,
    isVisible,
    isEnabled,
    cssEscapeSafe,
  };
})();
