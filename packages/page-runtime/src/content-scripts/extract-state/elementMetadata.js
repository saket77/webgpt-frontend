(function () {
  const ns = (globalThis.WebGPTExtractStateModules =
    globalThis.WebGPTExtractStateModules || {});

  if (!ns.domUtils) {
    throw new Error(
      "extract-state/domUtils.js must load before elementMetadata.js",
    );
  }

  const { normalizeText, lower, textContent, cssEscapeSafe } = ns.domUtils;

  function hasBackgroundImage(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    return Boolean(
      style.backgroundImage &&
      style.backgroundImage !== "none" &&
      style.backgroundImage !== 'url("")',
    );
  }

  function getBackgroundImage(el) {
    if (!el || !(el instanceof Element)) return "";
    const style = window.getComputedStyle(el);
    return normalizeText(style.backgroundImage);
  }

  function hasMediaDescendant(el) {
    if (!el || !(el instanceof Element)) return false;
    return Boolean(
      el.querySelector("img,svg,picture,figure,i,canvas,[data-icon]"),
    );
  }

  function mediaSummaryFor(el) {
    if (!el || !(el instanceof Element)) return [];

    const items = [];
    const pushUnique = (value) => {
      const text = normalizeText(value);
      if (!text) return;
      if (items.includes(text)) return;
      items.push(text);
    };

    if (hasBackgroundImage(el)) {
      pushUnique(getBackgroundImage(el));
    }

    const mediaNodes = Array.from(
      el.querySelectorAll("img,svg,picture,figure,i,canvas,[data-icon]"),
    ).slice(0, 10);

    for (const node of mediaNodes) {
      const tag = lower(node.tagName);
      const alt = normalizeText(node.getAttribute?.("alt"));
      const ariaLabel = normalizeText(node.getAttribute?.("aria-label"));
      const title = normalizeText(node.getAttribute?.("title"));
      const cls = normalizeText(node.getAttribute?.("class"));
      const bg = getBackgroundImage(node);

      if (alt) pushUnique(`${tag}:alt=${alt}`);
      if (ariaLabel) pushUnique(`${tag}:aria=${ariaLabel}`);
      if (title) pushUnique(`${tag}:title=${title}`);
      if (cls) pushUnique(`${tag}:class=${cls}`);
      if (bg) pushUnique(`${tag}:bg=${bg}`);
    }

    return items.slice(0, 8);
  }

  function hasMeaningfulText(el) {
    const text = textContent(el);
    return Boolean(text && text.length >= 2);
  }

  function hasIdentityDataAttrs(el) {
    if (!el || !(el instanceof Element)) return false;

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
    ];

    return attrs.some((attr) => normalizeText(el.getAttribute(attr)));
  }

  function dataAttrsFor(el) {
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

  function labelForControl(el) {
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

    if (el.id) {
      const explicit = document.querySelector(
        `label[for="${cssEscapeSafe(el.id)}"]`,
      );
      if (explicit) {
        const text = textContent(explicit);
        if (text) return text;
      }
    }

    const wrappingLabel = el.closest("label");
    if (wrappingLabel) {
      const text = textContent(wrappingLabel);
      if (text) return text;
    }

    const ownLabel = el.querySelector(":scope > label");
    if (ownLabel) {
      const text = textContent(ownLabel);
      if (text) return text;
    }

    const labelledBy = normalizeText(el.getAttribute("aria-labelledby"));
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => textContent(node))
        .filter(Boolean)
        .join(" ");
      if (text) return normalizeText(text);
    }

    const img = el.querySelector("img[alt]");
    if (img) {
      const alt = normalizeText(img.getAttribute("alt"));
      if (alt) return alt;
    }

    const firstMeaningfulDescendant = Array.from(
      el.querySelectorAll("label,span,div,p,small,strong,b"),
    )
      .map((node) => textContent(node))
      .find((text) => text && text.length >= 2);

    if (firstMeaningfulDescendant) return firstMeaningfulDescendant;

    const ownText = textContent(el);
    if (ownText) return ownText;

    return "";
  }

  function controlTextFor(el) {
    if (!el || !(el instanceof Element)) return "";
    return (
      normalizeText(el.getAttribute("aria-label")) ||
      normalizeText(el.getAttribute("title")) ||
      textContent(el) ||
      labelForControl(el)
    );
  }

  function nearestHeadingText(el) {
    let current = el || null;

    for (let i = 0; i < 6 && current; i++) {
      const previousHeadings = [];
      let sibling = current.previousElementSibling;

      while (sibling && previousHeadings.length < 3) {
        if (
          sibling.matches("h1,h2,h3,h4,h5,h6,[role='heading'],[role='tab']")
        ) {
          const text = textContent(sibling);
          if (text) previousHeadings.push(text);
        }
        sibling = sibling.previousElementSibling;
      }

      if (previousHeadings.length) return previousHeadings[0];

      const directHeading = current.querySelector(
        ":scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5,:scope > h6,:scope > [role='heading'],:scope > [role='tab']",
      );
      if (directHeading) {
        const text = textContent(directHeading);
        if (text) return text;
      }

      current = current.parentElement;
    }

    return "";
  }

  function nearbyText(el) {
    let current = el?.parentElement || null;

    for (let i = 0; i < 4 && current; i++) {
      const text = textContent(current).slice(0, 200);
      if (text) return text;
      current = current.parentElement;
    }

    return "";
  }

  function controlTypeFor(el) {
    const tag = lower(el.tagName);
    const role = lower(el.getAttribute("role"));
    const type = lower(el.getAttribute("type"));

    if (tag === "input") {
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit") return "button";
      return "textbox";
    }

    if (tag === "textarea") return "textbox";
    if (tag === "select") return "select";
    if (role) return role;
    return tag;
  }

  function getContainerKind(el) {
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

  ns.elementMetadata = {
    hasBackgroundImage,
    getBackgroundImage,
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
  };
})();
