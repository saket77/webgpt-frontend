(function () {
  const ns = window.WebGPTRunnerModules;
  const { lower, setNativeValue, dispatchInputEvents } = ns.domUtils;

  function normalizeChoiceText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function findSelectOption(selectEl, value) {
    const wanted = normalizeChoiceText(value);
    const options = Array.from(selectEl.options || []);

    if (!wanted) return null;

    return (
      options.find((option) => normalizeChoiceText(option.value) === wanted) ||
      options.find((option) => normalizeChoiceText(option.label) === wanted) ||
      options.find(
        (option) => normalizeChoiceText(option.textContent) === wanted,
      )
    );
  }

  function fillSelectElement(selectEl, value) {
    const option = findSelectOption(selectEl, value);

    if (option) {
      selectEl.selectedIndex = option.index;
      setNativeValue(selectEl, option.value);
    } else {
      setNativeValue(selectEl, value);
    }

    selectEl.dispatchEvent(new Event("input", { bubbles: true }));
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    selectEl.blur?.();
  }

  function findRichTextEditorTarget(el) {
    if (!el || !(el instanceof Element)) return null;

    const candidates = [
      el,
      el.closest?.(
        ".tox-tinymce, .ic-RichContentEditor, .textarea-question-holder",
      ),
      el.parentElement,
    ].filter(Boolean);

    for (const candidate of candidates) {
      const iframe =
        candidate.matches?.("iframe.tox-edit-area__iframe")
          ? candidate
          : candidate.querySelector?.("iframe.tox-edit-area__iframe");

      if (!iframe) continue;

      try {
        const body = iframe.contentDocument?.body;
        if (body) return { body, iframe, root: candidate };
      } catch {
        // Cross-origin editors are not fillable from the content script.
      }
    }

    return null;
  }

  function syncTinyMceEditor(iframe, value) {
    const editorId = iframe?.id ? iframe.id.replace(/_ifr$/, "") : "";
    const tinyMce = window.tinymce || window.tinyMCE;
    const editor = editorId && tinyMce?.get ? tinyMce.get(editorId) : null;

    if (editor?.setContent) {
      editor.setContent(`<p>${escapeHtml(value)}</p>`);
      editor.fire?.("input");
      editor.fire?.("change");
      editor.save?.();
      return true;
    }

    return false;
  }

  function syncHiddenTextarea(root, iframe, value) {
    const editorId = iframe?.id ? iframe.id.replace(/_ifr$/, "") : "";
    const textarea =
      (editorId && document.getElementById(editorId)) ||
      root?.querySelector?.("textarea.question_input[data-rich_text='true']") ||
      root?.closest?.(".textarea-question-holder")?.querySelector?.("textarea");

    if (!textarea || !("value" in textarea)) return;

    setNativeValue(textarea, value);
    dispatchInputEvents(textarea);
  }

  function fillRichTextEditor(el, value) {
    const target = findRichTextEditorTarget(el);
    if (!target) return false;

    const { body, iframe, root } = target;
    const syncedViaTinyMce = syncTinyMceEditor(iframe, value);

    if (!syncedViaTinyMce) {
      body.focus?.();
      body.innerHTML = `<p>${escapeHtml(value)}</p>`;
      dispatchInputEvents(body);
      syncHiddenTextarea(root, iframe, value);
    }

    body.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  async function clickElement(el) {
    el.scrollIntoView({ block: "center", inline: "center" });
    el.focus?.();

    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    const pointerOpts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX,
      clientY,
    };

    const mouseOpts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons: 1,
      clientX,
      clientY,
    };

    el.dispatchEvent(new PointerEvent("pointerover", pointerOpts));
    el.dispatchEvent(new PointerEvent("pointerenter", pointerOpts));
    el.dispatchEvent(new MouseEvent("mouseover", mouseOpts));
    el.dispatchEvent(new MouseEvent("mouseenter", mouseOpts));

    el.dispatchEvent(new PointerEvent("pointerdown", pointerOpts));
    el.dispatchEvent(new MouseEvent("mousedown", mouseOpts));

    el.dispatchEvent(
      new PointerEvent("pointerup", { ...pointerOpts, buttons: 0 }),
    );
    el.dispatchEvent(new MouseEvent("mouseup", { ...mouseOpts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", { ...mouseOpts, buttons: 0 }));

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  async function fillElement(el, value) {
    el.scrollIntoView({ block: "center", inline: "center" });
    el.focus?.();

    const tag = lower(el.tagName);

    if (tag === "select") {
      fillSelectElement(el, value);
      return;
    }

    if (fillRichTextEditor(el, value)) return;

    if ("value" in el) {
      setNativeValue(el, value);
      dispatchInputEvents(el);
      return;
    }

    if (el.isContentEditable) {
      el.textContent = value;
      dispatchInputEvents(el);
      return;
    }

    throw new Error("Resolved element is not fillable.");
  }

  async function pressKeyOnElement(el, keySpec) {
    el.focus?.();

    const parts = String(keySpec || "Enter")
      .split("+")
      .map((s) => s.trim())
      .filter(Boolean);

    const key = parts[parts.length - 1];
    const modifiers = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));

    const eventInit = {
      key,
      code:
        key.length === 1
          ? `Key${key.toUpperCase()}`
          : key === "Enter"
            ? "Enter"
            : key,
      bubbles: true,
      cancelable: true,
      composed: true,
      shiftKey: modifiers.has("shift"),
      ctrlKey: modifiers.has("ctrl") || modifiers.has("control"),
      altKey: modifiers.has("alt"),
      metaKey:
        modifiers.has("meta") ||
        modifiers.has("cmd") ||
        modifiers.has("command"),
    };

    el.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    el.dispatchEvent(new KeyboardEvent("keypress", eventInit));
    el.dispatchEvent(new KeyboardEvent("keyup", eventInit));

    if (key !== "Enter") return;

    const form = el instanceof Element ? el.closest("form") : null;
    if (form && typeof form.requestSubmit === "function") {
      form.requestSubmit();
      return;
    }

    const role = lower(el.getAttribute?.("role"));
    const tag = lower(el.tagName);

    if (
      tag === "button" ||
      tag === "a" ||
      role === "button" ||
      role === "link"
    ) {
      if (typeof el.click === "function") {
        el.click();
      }
      return;
    }

    const submitControl = form?.querySelector(
      'button[type="submit"], input[type="submit"]',
    );

    if (submitControl && typeof submitControl.click === "function") {
      submitControl.click();
      return;
    }

    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  ns.primitives = {
    clickElement,
    fillElement,
    pressKeyOnElement,
  };
})();
