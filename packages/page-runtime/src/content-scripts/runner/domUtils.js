(function () {
  const ns = (window.WebGPTRunnerModules = window.WebGPTRunnerModules || {});

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function lower(value) {
    return normalizeText(value).toLowerCase();
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

  function isEditable(el) {
    if (!el || !(el instanceof Element)) return false;
    const tag = lower(el.tagName);
    const role = lower(el.getAttribute("role"));
    const ariaLabel = lower(el.getAttribute("aria-label"));
    const className = lower(el.getAttribute("class"));

    return (
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      el.isContentEditable ||
      role === "textbox" ||
      role === "combobox" ||
      (role === "document" &&
        (ariaLabel.includes("rich content editor") ||
          className.includes("tox-tinymce")))
    );
  }

  function textOf(el) {
    return normalizeText(el?.innerText || el?.textContent || el?.value || "");
  }

  function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor =
      Object.getOwnPropertyDescriptor(prototype, "value") ||
      Object.getOwnPropertyDescriptor(element, "value");

    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function dispatchInputEvents(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function clampToViewport(x, y) {
    return {
      x: Math.max(1, Math.min(window.innerWidth - 1, Math.round(x))),
      y: Math.max(1, Math.min(window.innerHeight - 1, Math.round(y))),
    };
  }

  ns.domUtils = {
    normalizeText,
    lower,
    isVisible,
    isEnabled,
    isEditable,
    textOf,
    setNativeValue,
    dispatchInputEvents,
    clampToViewport,
  };
})();
