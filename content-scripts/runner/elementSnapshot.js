(function () {
  const ns = window.WebGPTRunnerModules;
  const { lower, normalizeText, textOf } = ns.domUtils;

  function hasBackgroundImage(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    return Boolean(
      style.backgroundImage &&
      style.backgroundImage !== "none" &&
      style.backgroundImage !== 'url("")',
    );
  }

  function hasMediaDescendant(el) {
    if (!el || !(el instanceof Element)) return false;
    return Boolean(
      el.querySelector("img,svg,picture,figure,i,canvas,[data-icon]"),
    );
  }

  function roleOfElement(el) {
    const explicit = lower(el.getAttribute("role"));
    if (explicit) return explicit;

    const tag = lower(el.tagName);
    const type = lower(el.getAttribute("type"));

    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      return "textbox";
    }

    return "";
  }

  function roleFromControl(control) {
    if (!control) return "";

    const explicitRole = lower(control.role);
    if (explicitRole) return explicitRole;

    const tag = lower(control.tag);
    const type = lower(control.type);
    const controlType = lower(control.controlType);

    if (controlType === "button" || tag === "button") return "button";
    if (controlType === "a" || tag === "a") return "link";
    if (controlType === "textbox" || tag === "input" || tag === "textarea") {
      return "textbox";
    }
    if (controlType === "checkbox" || type === "checkbox") return "checkbox";
    if (controlType === "radio" || type === "radio") return "radio";
    if (
      controlType === "combobox" ||
      controlType === "select" ||
      tag === "select"
    ) {
      return "combobox";
    }

    return "";
  }

  function labelTextForElement(el) {
    if (!el || !(el instanceof Element)) return "";

    const dataLabel =
      normalizeText(el.getAttribute("data-productname")) ||
      normalizeText(el.getAttribute("data-name")) ||
      normalizeText(el.getAttribute("data-label")) ||
      normalizeText(el.getAttribute("data-title"));

    if (dataLabel) return dataLabel;

    const ariaLabel = normalizeText(el.getAttribute("aria-label"));
    if (ariaLabel) return ariaLabel;

    const title = normalizeText(el.getAttribute("title"));
    if (title) return title;

    if (el.id && window.CSS && typeof window.CSS.escape === "function") {
      const explicit = document.querySelector(
        `label[for="${CSS.escape(el.id)}"]`,
      );
      if (explicit) {
        const text = textOf(explicit);
        if (text) return text;
      }
    }

    const wrappingLabel = el.closest("label");
    if (wrappingLabel) {
      const text = textOf(wrappingLabel);
      if (text) return text;
    }

    const ownLabel = el.querySelector(":scope > label");
    if (ownLabel) {
      const text = textOf(ownLabel);
      if (text) return text;
    }

    const labelledBy = normalizeText(el.getAttribute("aria-labelledby"));
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => textOf(node))
        .filter(Boolean)
        .join(" ");
      if (text) return normalizeText(text);
    }

    const img = el.querySelector("img[alt]");
    if (img) {
      const alt = normalizeText(img.getAttribute("alt"));
      if (alt) return alt;
    }

    const ownText = textOf(el);
    if (ownText) return ownText;

    return "";
  }

  function nearbyHeadingForElement(el) {
    let current = el || null;

    for (let i = 0; i < 6 && current; i++) {
      let sibling = current.previousElementSibling;

      while (sibling) {
        if (
          sibling.matches("h1,h2,h3,h4,h5,h6,[role='heading'],[role='tab']")
        ) {
          const text = textOf(sibling);
          if (text) return text;
        }
        sibling = sibling.previousElementSibling;
      }

      const directHeading = current.querySelector(
        ":scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5,:scope > h6,:scope > [role='heading'],:scope > [role='tab']",
      );
      if (directHeading) {
        const text = textOf(directHeading);
        if (text) return text;
      }

      current = current.parentElement;
    }

    return "";
  }

  function nearbyTextForElement(el) {
    let current = el?.parentElement || null;

    for (let i = 0; i < 4 && current; i++) {
      const text = textOf(current).slice(0, 200);
      if (text) return text;
      current = current.parentElement;
    }

    return "";
  }

  function dataAttrsForElement(el) {
    if (!el || !(el instanceof Element)) return {};

    const attrs = [
      "data-testid",
      "data-test",
      "data-qa",
      "data-cy",
      "data-id",
      "data-key",
      "data-value",
      "data-name",
      "data-label",
      "data-title",
      "data-productid",
      "data-productname",
      "data-productfamilyid",
      "data-parentproductid",
      "data-logiksalesforceproductid",
      "data-isconfigurable",
    ];

    const result = {};
    for (const attr of attrs) {
      const value = normalizeText(el.getAttribute(attr));
      if (value) result[attr] = value;
    }
    return result;
  }

  function containerKindForElement(el) {
    if (!el || !(el instanceof Element)) return "";

    const tag = lower(el.tagName);
    const role = lower(el.getAttribute("role"));
    const className = lower(el.getAttribute("class"));

    if (role === "menuitem" || role === "menu") return "menu";
    if (role === "tab" || role === "tabpanel") return "tab";
    if (role === "row" || role === "gridcell") return "grid";
    if (role === "option" || role === "listbox") return "option";
    if (role === "group" || role === "radiogroup") return "group";
    if (tag === "tr" || tag === "td" || tag === "th") return "table";
    if (tag === "li" || tag === "ul" || tag === "ol") return "list";
    if (tag === "figure" || tag === "picture") return "media";

    if (
      className.includes("tile") ||
      className.includes("card") ||
      className.includes("product") ||
      className.includes("item") ||
      className.includes("option") ||
      className.includes("row")
    ) {
      return "tile";
    }

    return "";
  }

  function getElementSnapshot(el) {
    return {
      tag: lower(el.tagName),
      role: roleOfElement(el),
      type: lower(el.getAttribute("type")),
      text: textOf(el),
      ariaLabel: normalizeText(el.getAttribute("aria-label")),
      placeholder: normalizeText(el.getAttribute("placeholder")),
      name: normalizeText(el.getAttribute("name")),
      title: normalizeText(el.getAttribute("title")),
      label: labelTextForElement(el),
      heading: nearbyHeadingForElement(el),
      nearbyText: nearbyTextForElement(el),
      dataAttrs: dataAttrsForElement(el),
      containerKind: containerKindForElement(el),
      hasMedia: hasMediaDescendant(el) || hasBackgroundImage(el),
      promoted: false,
    };
  }

  ns.elementSnapshot = {
    hasBackgroundImage,
    hasMediaDescendant,
    roleOfElement,
    roleFromControl,
    labelTextForElement,
    nearbyHeadingForElement,
    nearbyTextForElement,
    dataAttrsForElement,
    containerKindForElement,
    getElementSnapshot,
  };
})();
