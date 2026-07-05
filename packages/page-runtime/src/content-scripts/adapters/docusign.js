(function () {
  const ADAPTER_ID = "docusign.local";
  const PREFILL_FIELDS_TARGET_ID = `site:${ADAPTER_ID}:prefill_fields`;
  const registry = globalThis.WebGPTContentAdapters;
  const extractModules = globalThis.WebGPTExtractStateModules || {};
  const domUtils = extractModules.domUtils || {};

  if (!registry || typeof registry.register !== "function") {
    throw new Error(
      "content-scripts/adapters/registry.js must load before docusign.js",
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
    return Array.from(new Set((items || []).filter(Boolean)));
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

  function isDocusignSendPage(url, documentRef) {
    const parsed = safeUrl(url);
    const host = lower(parsed.hostname);
    if (host !== "apps.docusign.com" && !host.endsWith(".apps.docusign.com")) {
      return false;
    }

    return (
      parsed.pathname.includes("/send") ||
      Boolean(
        documentRef.querySelector(
          [
            '[data-widget-id="@ds/send"]',
            '[data-qa="btn-use-template-desktop"]',
            '[data-qa="inkpicker-table"]',
            '[data-qa="recipient-row"]',
            '[data-qa="footer-send-button"]',
            'g[data-view-name="DataTabView"]',
          ].join(","),
        ),
      )
    );
  }

  function getElements(selector, root = document) {
    return Array.from(root.querySelectorAll(selector)).filter(
      (el, index, arr) => el instanceof Element && arr.indexOf(el) === index,
    );
  }

  function getVisibleElements(selector, root = document) {
    return getElements(selector, root).filter(isVisible);
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
    const id = normalizeText(el.id);
    const name = normalizeText(el.getAttribute("name"));
    const ariaLabel = normalizeText(el.getAttribute("aria-label"));
    const title = normalizeText(el.getAttribute("title"));
    const result = [];

    if (id) result.push(`#${cssEscape(id)}`);

    for (const attr of [
      "data-testid",
      "data-test",
      "data-qa",
      "data-cy",
      "data-view-name",
      "data-view-id",
    ]) {
      const value = normalizeText(el.getAttribute(attr));
      if (value) result.push(`[${attr}="${cssEscape(value)}"]`);
    }

    if (name) result.push(`${tag}[name="${cssEscape(name)}"]`);
    if (ariaLabel) result.push(`${tag}[aria-label="${cssEscape(ariaLabel)}"]`);
    if (title) result.push(`${tag}[title="${cssEscape(title)}"]`);

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
    const dataQa = normalizeText(el.getAttribute("data-qa"));
    const bounds = elementBounds(el);

    return (
      findControlBySelector(controls, selectors, bounds, tag) ||
      (controls || []).find(
        (control) =>
          dataQa &&
          lower(control.selector || "").includes(
            `[data-qa="${lower(dataQa)}"]`,
          ),
      ) ||
      (controls || []).find(
        (control) =>
          name &&
          control.name === name &&
          (!control.tag || !tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          ariaLabel &&
          control.ariaLabel === ariaLabel &&
          (!control.tag || !tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          title && control.title === title && (!control.tag || !tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          boundsContain(bounds, control.bounds) &&
          (!control.tag || !tag || control.tag === tag),
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
          control.heading,
          control.selector,
        ].join(" "),
      );
      let score =
        Number(control.bounds?.width || 0) * Number(control.bounds?.height || 0);

      if (options.preferInput && ["input", "textarea"].includes(control.tag)) {
        score += 100000;
      }
      if (options.preferButton && control.tag === "button") score += 100000;
      if (options.text && haystack.includes(lower(options.text))) score += 50000;
      if (control.enabled) score += 1000;
      if (control.visible) score += 1000;

      if (!best || score > best.score) {
        best = { control, score };
      }
    }

    return best?.control || null;
  }

  function findControlByDataQa(state, documentRef, dataQa, options = {}) {
    const el = documentRef.querySelector(`[data-qa="${cssEscape(dataQa)}"]`);
    if (!el) return null;
    return (
      findControlForElement(state.controls, el) ||
      findBestControlInRegion(state.controls, el, {
        preferButton: options.preferButton,
        preferInput: options.preferInput,
        text: options.text || textContent(el),
      })
    );
  }

  function controlHaystack(control) {
    return lower(
      [
        control?.label,
        control?.text,
        control?.title,
        control?.ariaLabel,
        control?.heading,
        control?.nearbyText,
        control?.selector,
      ].join(" "),
    );
  }

  function controlTag(control) {
    return lower(control?.tag || control?.tagName);
  }

  function isButtonControl(control) {
    const tag = controlTag(control);
    const role = lower(control?.role);
    const type = lower(control?.type);
    return tag === "button" || role === "button" || type === "button";
  }

  function controlOwnText(control) {
    return lower(
      [
        control?.text,
        control?.ariaLabel,
        control?.name,
        control?.title,
        control?.placeholder,
      ].join(" "),
    );
  }

  function findControlByText(state, pattern, options = {}) {
    return (
      (state.controls || []).find((control) => {
        if (options.preferButton && !isButtonControl(control)) {
          return false;
        }
        return pattern.test(controlHaystack(control));
      }) || null
    );
  }

  function findButtonByOwnText(state, pattern) {
    return (
      (state.controls || []).find(
        (control) =>
          isButtonControl(control) && pattern.test(controlOwnText(control)),
      ) || null
    );
  }

  function findControlByOwnText(state, pattern) {
    return (
      (state.controls || []).find((control) => pattern.test(controlOwnText(control))) ||
      null
    );
  }

  function editableValue(el) {
    if (!el || !(el instanceof Element)) return "";
    if ("value" in el) return normalizeText(el.value);
    return normalizeText(el.getAttribute("aria-valuetext") || textContent(el));
  }

  function isEditable(el) {
    return Boolean(
      el?.matches?.(
        [
          "textarea",
          'input:not([type="hidden"])',
          '[contenteditable="true"]',
          '[role="textbox"]',
        ].join(","),
      ),
    );
  }

  function findEditableNearLabel(state, documentRef, labelPattern) {
    const editables = getVisibleElements(
      [
        "textarea",
        'input:not([type="hidden"])',
        '[contenteditable="true"]',
        '[role="textbox"]',
      ].join(","),
      documentRef,
    );

    const direct = editables.find((editable) => {
      const forLabel = normalizeText(
        editable.id
          ? textContent(documentRef.querySelector(`label[for="${cssEscape(editable.id)}"]`))
          : "",
      );
      const haystack = normalizeText(
        [
          editable.getAttribute("aria-label"),
          editable.getAttribute("placeholder"),
          editable.getAttribute("name"),
          editable.getAttribute("id"),
          forLabel,
        ].join(" "),
      );
      return labelPattern.test(haystack);
    });

    if (direct) {
      return {
        element: direct,
        control:
          findControlForElement(state.controls, direct) ||
          findBestControlInRegion(state.controls, direct, {
            preferInput: true,
          }),
        value: editableValue(direct),
      };
    }

    const labels = getVisibleElements("label, span, div, p", documentRef)
      .filter((el) => {
        const text = textContent(el);
        return text.length <= 80 && labelPattern.test(text);
      })
      .slice(0, 20);

    for (const labelEl of labels) {
      if (labelEl.tagName && lower(labelEl.tagName) === "label") {
        const forId = normalizeText(labelEl.getAttribute("for"));
        const labeledEl = forId ? documentRef.getElementById(forId) : null;
        if (labeledEl && isEditable(labeledEl) && isVisible(labeledEl)) {
          return {
            element: labeledEl,
            control:
              findControlForElement(state.controls, labeledEl) ||
              findBestControlInRegion(state.controls, labeledEl, {
                preferInput: true,
              }),
            value: editableValue(labeledEl),
          };
        }
      }

      let root = labelEl.parentElement;
      for (let depth = 0; root && depth < 5; depth += 1, root = root.parentElement) {
        const editable = getVisibleElements(
          [
            "textarea",
            'input:not([type="hidden"])',
            '[contenteditable="true"]',
            '[role="textbox"]',
          ].join(","),
          root,
        ).find((item) => item !== labelEl);

        if (editable) {
          return {
            element: editable,
            control:
              findControlForElement(state.controls, editable) ||
              findBestControlInRegion(state.controls, root, {
                preferInput: true,
                text: textContent(labelEl),
              }),
            value: editableValue(editable),
          };
        }
      }
    }

    return null;
  }

  function findNoticeText(documentRef, pattern) {
    const candidates = getVisibleElements(
      [
        '[role="alert"]',
        '[data-qa*="message"]',
        '[data-qa*="alert"]',
        '[data-qa*="banner"]',
        '[data-qa*="trial"]',
      ].join(","),
      documentRef,
    );

    for (const el of candidates) {
      const text = textContent(el);
      if (pattern.test(text)) return truncate(text, 320);
    }

    const bodyText = textContent(documentRef.body);
    if (!pattern.test(bodyText)) return "";

    const match = bodyText.match(
      new RegExp(`([^.!?]*(?:${pattern.source})[^.!?]*[.!?]?)`, "i"),
    );
    return truncate(match?.[1] || bodyText, 320);
  }

  function findHardBlockerText(documentRef) {
    return findNoticeText(
      documentRef,
      /maximum number of envelope drafts|envelope drafts for the account has been exceeded|draft limit exceeded|cannot create envelope/i,
    );
  }

  function findWarningText(documentRef) {
    return findNoticeText(
      documentRef,
      /sent all the envelopes|premium trial|start paid plan/i,
    );
  }

  function detectWorkflowPhase(documentRef, url) {
    const parsed = safeUrl(url);
    const path = parsed.pathname;
    const earlyBodyText = textContent(documentRef.body).slice(0, 4000);

    if (
      path.includes("/documents") &&
      (parsed.search.includes("sent") || /sent/i.test(parsed.search))
    ) {
      return "sent_confirmation";
    }

    if (
      /envelope (?:has been )?sent|document (?:has been )?sent|sent successfully|successfully sent/i.test(
        earlyBodyText,
      )
    ) {
      return "sent_confirmation";
    }

    const statusCandidateText = getVisibleElements(
      [
        '[role="status"]',
        '[data-qa*="status"]',
        '[data-qa*="confirmation"]',
        '[data-qa*="success"]',
      ].join(","),
      documentRef,
    )
      .map((el) => textContent(el))
      .join(" ");

    if (/envelope (?:has been )?sent|sent successfully|successfully sent/i.test(statusCandidateText)) {
      return "sent_confirmation";
    }

    if (
      /\bsending(?:\.{3}|\s+(?:the\s+)?(?:document|envelope)\b)|\bplease wait\b/i.test(
        statusCandidateText,
      ) ||
      /\bsending(?:\.{3}|\s+(?:the\s+)?(?:document|envelope)\b)|\bplease wait\b/i.test(
        earlyBodyText,
      )
    ) {
      return "sending";
    }

    if (
      path.includes("/add-fields") ||
      documentRef.querySelector(
        [
          'g[data-view-name="DataTabView"]',
          '[data-qa="footer-send-button"]',
          '[data-qa="right-panel-tagger"]',
          '[data-qa="tagger-documents"]',
        ].join(","),
      )
    ) {
      return "add_fields_prefill";
    }

    if (
      path.includes("/send/prepare") ||
      documentRef.querySelector(
        [
          '[data-qa="recipient-row"]',
          '[data-qa="recipient-name"]',
          '[data-qa="recipient-email"]',
          '[data-qa="footer-next"]',
        ].join(","),
      )
    ) {
      return "setup_envelope";
    }

    if (
      documentRef.querySelector(
        ['[data-qa="inkpicker-table"]', '[data-qa="Picker-searchInput"]'].join(","),
      )
    ) {
      return "template_picker";
    }

    if (
      path.includes("/send/home") ||
      path.includes("/api/send/home") ||
      documentRef.querySelector('[data-qa="btn-use-template-desktop"]')
    ) {
      return "home";
    }

    return "unknown";
  }

  function detectPageKind(workflowPhase, hardBlockerText) {
    if (hardBlockerText && ["home", "unknown"].includes(workflowPhase)) {
      return "blocked_docusign";
    }
    return workflowPhase;
  }

  function templateNameFromRow(row) {
    return (
      textContent(row.querySelector('[data-qa$="-column-name"]')) ||
      textContent(row.querySelector('label[for]')) ||
      textContent(row.querySelector('[title]')) ||
      textContent(row).replace(/\bSelect\b|\bOWNER\b|\bLAST CHANGE\b/gi, "")
    );
  }

  function collectTemplates(state, documentRef) {
    const rows = getElements('tr[data-qa^="Picker-item-"]', documentRef);
    return rows
      .map((row, index) => {
        const input =
          row.querySelector('input[type="radio"]') ||
          row.querySelector('[role="radio"]') ||
          row;
        const name = truncate(templateNameFromRow(row), 140);
        if (!name) return null;

        const control =
          findControlForElement(state.controls, input) ||
          findBestControlInRegion(state.controls, row, {
            text: name,
          });
        const rowControl =
          findControlForElement(state.controls, row) ||
          findBestControlInRegion(state.controls, row, {
            text: name,
          });
        const owner = textContent(row.querySelector('[data-qa$="-column-owner"]'));
        const modified = textContent(row.querySelector('[data-qa$="-column-modified"]'));

        return {
          name,
          owner,
          modified,
          position: index + 1,
          targetId: control?.id || rowControl?.id || "",
          rowTargetId: rowControl?.id || "",
          selected:
            input instanceof HTMLInputElement
              ? Boolean(input.checked)
              : lower(input.getAttribute("aria-checked")) === "true",
          dataQa: normalizeText(row.getAttribute("data-qa")),
        };
      })
      .filter(Boolean);
  }

  function collectTemplateScopes(state) {
    const scopeDefinitions = [
      {
        key: "all_templates",
        label: "All Templates",
        preferredForUserTemplates: true,
        instruction:
          "Click All Templates before searching for user-created/account templates.",
        pattern: /^\s*all templates\s*$/i,
      },
      {
        key: "my_templates",
        label: "My Templates",
        instruction:
          "Use My Templates when the requested template is specifically owned by the current user.",
        pattern: /^\s*my templates\s*$/i,
      },
      {
        key: "shared_with_me",
        label: "Shared with Me",
        instruction:
          "Use Shared with Me when the requested template is described as shared by someone else.",
        pattern: /^\s*shared with me\s*$/i,
      },
      {
        key: "starter_templates",
        label: "Starter Templates",
        fallbackForSamples: true,
        instruction:
          "Use Starter Templates only for DocuSign sample/template-library templates or as a fallback after account templates are not found.",
        pattern: /^\s*starter templates\s*$/i,
      },
    ];

    return scopeDefinitions
      .map((scope) => {
        const control =
          findButtonByOwnText(state, scope.pattern) ||
          findControlByOwnText(state, scope.pattern);
        if (!control?.id) return null;
        return {
          ...scope,
          targetId: control.id,
        };
      })
      .filter(Boolean);
  }

  function cleanRoleName(value) {
    const text = normalizeText(value)
      .replace(/\bSet signing order\b/gi, "")
      .replace(/\bView\b/gi, "")
      .replace(/\bCustomize\b/gi, "")
      .replace(/\bNeeds to Sign\b/gi, "")
      .replace(/\bDelivery\b.*$/i, "")
      .replace(/\bName\b.*$/i, "")
      .replace(/\bRole\b/gi, "")
      .replace(/\*/g, "")
      .trim();
    return truncate(text, 80);
  }

  function roleNameForRow(row) {
    const roleInput = row.querySelector(
      [
        '[data-qa="recipient-role"]',
        'input[aria-label*="Role" i]',
        'input[placeholder*="Role" i]',
      ].join(","),
    );
    const fromInput = editableValue(roleInput);
    if (fromInput) return cleanRoleName(fromInput);

    const shortNodes = getVisibleElements("h1,h2,h3,h4,label,span,div", row)
      .map((el) => textContent(el))
      .filter(
        (text, index, arr) =>
          text &&
          text.length <= 80 &&
          arr.indexOf(text) === index &&
          !/name|email|delivery|customize|needs to sign|sms|view/i.test(text),
      );

    if (shortNodes.length) return cleanRoleName(shortNodes[0]);

    const match = textContent(row).match(/\bRole\s+(.+?)\s+Name\b/i);
    return cleanRoleName(match?.[1] || textContent(row));
  }

  function collectRecipientRoles(state, documentRef) {
    const rowEls = getElements('[data-qa="recipient-row"]', documentRef);
    const fallbackRows = getElements('[data-qa="recipient-name"]', documentRef)
      .map((el) => el.closest('[data-qa="recipient-row"], form, section, [role="group"]'))
      .filter(Boolean);
    const rows = rowEls.length ? rowEls : unique(fallbackRows);

    return rows
      .map((row, index) => {
        const nameEl = row.querySelector(
          [
            '[data-qa="recipient-name"]',
            'input[aria-label*="Name" i]',
            'input[placeholder*="Name" i]',
          ].join(","),
        );
        const emailEl = row.querySelector(
          [
            '[data-qa="recipient-email"]',
            'input[type="email"]',
            'input[aria-label*="Email" i]',
            'input[placeholder*="Email" i]',
          ].join(","),
        );
        const typeEl = row.querySelector(
          [
            '[data-qa="recipient-type"]',
            '[data-qa="recipient-type-trigger"]',
            '[data-qa="recipient-type-text"]',
          ].join(","),
        );
        const emailDeliveryEl = row.querySelector('[data-qa="delivery-email"]');
        const smsDeliveryEl = row.querySelector('[data-qa="delivery-sms"]');
        const role = roleNameForRow(row) || `recipient_${index + 1}`;

        const nameControl =
          findControlForElement(state.controls, nameEl) ||
          findBestControlInRegion(state.controls, nameEl || row, {
            preferInput: true,
            text: "name",
          });
        const emailControl =
          findControlForElement(state.controls, emailEl) ||
          findBestControlInRegion(state.controls, emailEl || row, {
            preferInput: true,
            text: "email",
          });
        const typeControl =
          findControlForElement(state.controls, typeEl) ||
          findBestControlInRegion(state.controls, typeEl || row, {
            preferButton: true,
            text: "needs to sign",
          });
        const emailDeliveryControl = findControlForElement(
          state.controls,
          emailDeliveryEl,
        );
        const smsDeliveryControl = findControlForElement(state.controls, smsDeliveryEl);

        return {
          role,
          position: index + 1,
          recipientType: textContent(typeEl) || "Needs to Sign",
          name: editableValue(nameEl),
          email: editableValue(emailEl),
          nameTargetId: nameControl?.id || "",
          emailTargetId: emailControl?.id || "",
          typeTargetId: typeControl?.id || "",
          emailDeliveryTargetId: emailDeliveryControl?.id || "",
          smsDeliveryTargetId: smsDeliveryControl?.id || "",
          emailDeliverySelected:
            emailDeliveryEl instanceof HTMLInputElement
              ? Boolean(emailDeliveryEl.checked)
              : lower(emailDeliveryEl?.getAttribute("aria-checked")) === "true",
          smsDeliverySelected:
            smsDeliveryEl instanceof HTMLInputElement
              ? Boolean(smsDeliveryEl.checked)
              : lower(smsDeliveryEl?.getAttribute("aria-checked")) === "true",
        };
      })
      .filter((role) => role.nameTargetId || role.emailTargetId || role.role);
  }

  function htmlFragmentText(fragment) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = fragment || "";
    return textContent(wrapper);
  }

  function svgTextEntries(tabEl) {
    return unique(
      getElements("text", tabEl)
        .map((textEl) => {
          const rawHtml = textEl.getAttribute("data-last-inner-html");
          const value = rawHtml ? htmlFragmentText(rawHtml) : textContent(textEl);
          return normalizeText(value);
        })
        .filter((value) => value && !/^details$/i.test(value)),
    );
  }

  function isGenericPrefillText(value) {
    return /^(text|number|date|dropdown|checkbox|radio|name|email|company|title|signature|initial|date signed|details)$/i.test(
      normalizeText(value),
    );
  }

  function isLikelyDocuSignGeneratedLabel(value) {
    return /^text\s+[0-9a-f]{8}-[0-9a-f-]{13,}$/i.test(normalizeText(value));
  }

  function looksLikeMachineFieldKey(value) {
    const text = normalizeText(value);
    return (
      Boolean(text) &&
      !/\s/.test(text) &&
      /[_.:-]/.test(text) &&
      /^[a-zA-Z][a-zA-Z0-9_.:-]*$/.test(text)
    );
  }

  function keyFromVisibleText(value) {
    const raw = normalizeText(value);
    if (
      !raw ||
      isGenericPrefillText(raw) ||
      isLikelyDocuSignGeneratedLabel(raw) ||
      raw.length > 100
    )
      return "";

    const rawWithoutWrappers = raw.replace(/[{}[\]<>#*:]/g, "").trim();
    if (
      !looksLikeMachineFieldKey(raw) &&
      !looksLikeMachineFieldKey(rawWithoutWrappers)
    ) {
      return "";
    }

    const cleaned = raw
      .replace(/[{}[\]<>]/g, " ")
      .replace(/[#*:]+$/g, "")
      .replace(/^[#*:]+/g, "")
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();

    return cleaned;
  }

  function positionFromTransform(tabEl) {
    const transform = normalizeText(tabEl.getAttribute("transform"));
    const match = transform.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([^,\s]+),\s*([^)\s]+)\)/);
    if (!match) return null;
    return {
      x: Math.round(Number(match[1]) || 0),
      y: Math.round(Number(match[2]) || 0),
    };
  }

  function pageNumberForTab(tabEl, fallbackIndex) {
    const pageAncestor = tabEl.closest(
      '[data-view-name*="Page"], [data-page-number], [aria-label*="Page" i]',
    );
    const explicit =
      normalizeText(pageAncestor?.getAttribute("data-page-number")) ||
      normalizeText(pageAncestor?.getAttribute("aria-label")) ||
      normalizeText(pageAncestor?.getAttribute("data-view-id"));
    const pageMatch = explicit.match(/\bpage\s*(\d+)\b/i) || explicit.match(/^(\d+)$/);
    if (pageMatch) return Number(pageMatch[1]);

    const bounds = elementBounds(tabEl);
    if (!bounds) return 1;

    const pageThumbs = getElements('[data-qa="tagger-documents"] img[alt*="Page"]');
    const firstMatchingThumb = pageThumbs.find((img) => {
      const alt = normalizeText(img.getAttribute("alt"));
      const match = alt.match(/\bPage\s+(\d+)\b/i);
      return match && Number(match[1]) === fallbackIndex + 1;
    });
    if (firstMatchingThumb) return fallbackIndex + 1;

    return 1;
  }

  function lowConfidenceFieldKey(tabEl, index) {
    const viewId = normalizeText(tabEl.getAttribute("data-view-id"));
    const position = positionFromTransform(tabEl) || elementBounds(tabEl) || {};
    return [
      "text_field",
      `page_${pageNumberForTab(tabEl, index)}`,
      viewId ? `view_${viewId}` : "",
      !viewId && Number.isFinite(position.x) ? `x_${Math.round(position.x)}` : "",
      !viewId && Number.isFinite(position.y) ? `y_${Math.round(position.y)}` : "",
    ]
      .filter(Boolean)
      .join("_");
  }

  function collectPrefillFields(state, documentRef, panelMetadata) {
    const tabs = getVisibleElements(
      'g[data-view-name="DataTabView"][role="listitem"], g[data-view-name="DataTabView"][tabindex]',
      documentRef,
    );
    const toolbarTabs = tabs.filter((tabEl) =>
      tabEl.querySelector('[data-tab-popover-target="true"]'),
    );

    return tabs.map((tabEl, index) => {
      const viewId = normalizeText(tabEl.getAttribute("data-view-id"));
      const visibleText = truncate(svgTextEntries(tabEl).join(" | "), 140);
      const visibleKey = keyFromVisibleText(visibleText);
      const currentValue =
        visibleText && !visibleKey && !isGenericPrefillText(visibleText)
          ? visibleText
          : "";
      const isSelected =
        panelMetadata.dataLabel &&
        (lower(panelMetadata.dataLabel) === lower(visibleText) ||
          lower(panelMetadata.dataLabel) === lower(visibleKey) ||
          (toolbarTabs.length === 1 && toolbarTabs[0] === tabEl));
      const panelKey = isSelected
        ? keyFromVisibleText(panelMetadata.dataLabel)
        : "";
      const key = panelKey || visibleKey || lowConfidenceFieldKey(tabEl, index);
      const identitySource =
        panelKey
          ? "property_panel_data_label"
          : visibleKey
            ? "visible_placeholder"
            : currentValue
              ? "visible_current_value"
            : "generic_position";
      const confidence =
        identitySource === "property_panel_data_label" ||
        identitySource === "visible_placeholder"
          ? "high"
          : "low";
      const control =
        findControlForElement(state.controls, tabEl) ||
        findBestControlInRegion(state.controls, tabEl, {
          text: visibleText,
        });
      const bounds = elementBounds(tabEl);
      const position = positionFromTransform(tabEl) || bounds;

      return {
        key,
        viewId,
        fieldType: "text",
        page: pageNumberForTab(tabEl, index),
        position: index + 1,
        x: position?.x ?? "",
        y: position?.y ?? "",
        visibleText,
        currentValue,
        identitySource,
        identityConfidence: confidence,
        targetId: control?.id || "",
        defaultTextTargetId: panelMetadata.defaultTextTargetId || "",
        dataLabelTargetId: panelMetadata.dataLabelTargetId || "",
        readyForAutomation: confidence !== "low",
      };
    });
  }

  function collectPanelMetadata(state, documentRef) {
    const defaultText = findEditableNearLabel(state, documentRef, /default\s+text/i);
    const dataLabel = findEditableNearLabel(state, documentRef, /data\s+label/i);

    return {
      defaultTextTargetId: defaultText?.control?.id || "",
      defaultTextValue: defaultText?.value || "",
      dataLabelTargetId: dataLabel?.control?.id || "",
      dataLabel: dataLabel?.value || "",
    };
  }

  function collectControls(state, documentRef) {
    const templateScopes = collectTemplateScopes(state);
    const useTemplate =
      findControlByDataQa(state, documentRef, "btn-use-template-desktop", {
        preferButton: true,
        text: "use a template",
      }) ||
      findControlByText(state, /use a template/i, { preferButton: true });
    const searchTemplate = findControlByDataQa(
      state,
      documentRef,
      "Picker-searchInput",
      {
        preferInput: true,
        text: "search",
      },
    );
    const addSelected = findControlByText(state, /^.*add selected.*$/i, {
      preferButton: true,
    });
    const nextAddFieldsByText =
      findButtonByOwnText(state, /\bnext\s*:\s*add fields\b/i) ||
      findButtonByOwnText(state, /\bnext\b.*\badd fields\b/i);
    const nextAddFieldsByDataQa = findControlByDataQa(
      state,
      documentRef,
      "footer-next",
      {
        preferButton: true,
        text: "next add fields",
      },
    );
    const nextAddFields =
      nextAddFieldsByText ||
      (/\bnext\b.*\badd fields\b/i.test(controlOwnText(nextAddFieldsByDataQa))
        ? nextAddFieldsByDataQa
        : null);
    const preview =
      findControlByDataQa(state, documentRef, "recipient-preview-button", {
        preferButton: true,
        text: "preview",
      }) ||
      findControlByText(state, /\bpreview\b/i, {
        preferButton: true,
      });
    const send =
      findControlByDataQa(state, documentRef, "footer-send-button", {
        preferButton: true,
        text: "send",
      }) ||
      findControlByText(state, /^\s*send\s*$/i, {
        preferButton: true,
      });
    const close = findButtonByOwnText(state, /^\s*close\s*$/i);

    return {
      useTemplate,
      templateScopes,
      searchTemplate,
      addSelected,
      nextAddFields,
      preview,
      send,
      close,
    };
  }

  function addHint(actionHintsByTargetId, targetId, hint) {
    if (!targetId) return;
    actionHintsByTargetId[targetId] = {
      ...(actionHintsByTargetId[targetId] || {}),
      ...hint,
    };
  }

  function buildActionHints(
    workflowPhase,
    controls,
    templates,
    roles,
    fields,
    panelMetadata,
  ) {
    const actionHintsByTargetId = {};

    addHint(actionHintsByTargetId, controls.useTemplate?.id, {
      semanticRole: "docusign_use_template",
      preferredAction: "click",
      navigationAction: true,
      verifyAfterAction: "templatePickerOpened",
      instruction:
        "Use templates for DocuSign template send/pre-fill workflows; do not upload a document unless the user explicitly asks.",
    });

    addHint(actionHintsByTargetId, controls.searchTemplate?.id, {
      semanticRole: "docusign_template_search",
      preferredAction: "fill",
      exactValueMode: "templateName",
      instruction:
        "Search existing DocuSign templates by template name. For user-created/account templates, click All Templates first when that scope is visible. If exact search returns no rows, clear it and retry with shorter distinctive words from the template name.",
    });

    for (const scope of controls.templateScopes || []) {
      addHint(actionHintsByTargetId, scope.targetId, {
        semanticRole: "docusign_template_scope",
        preferredAction: "click",
        answerText: scope.label,
        exactValueMode: "templateScope",
        verifyAfterAction: "templateScopeChanged",
        instruction: scope.instruction,
      });
    }

    for (const template of templates) {
      addHint(actionHintsByTargetId, template.targetId || template.rowTargetId, {
        semanticRole: "docusign_template_radio",
        preferredAction: "click",
        answerText: template.name,
        verifyAfterAction: "templateSelected",
        instruction:
          "Select this template row/radio before clicking Add Selected.",
      });
    }

    addHint(actionHintsByTargetId, controls.addSelected?.id, {
      semanticRole: "docusign_add_selected_template",
      preferredAction: "click",
      navigationAction: true,
      batchPlacement: "last",
      verifyAfterAction: "setupEnvelopeOpened",
      instruction:
        "After selecting the intended template, click Add Selected to create the envelope setup page.",
    });

    for (const role of roles) {
      addHint(actionHintsByTargetId, role.nameTargetId, {
        semanticRole: "docusign_recipient_name",
        preferredAction: "fill",
        exactValueMode: "fullName",
        answerText: `${role.role} recipient name`,
        instruction: `Fill the recipient name for role "${role.role}".`,
      });
      addHint(actionHintsByTargetId, role.emailTargetId, {
        semanticRole: "docusign_recipient_email",
        preferredAction: "fill",
        exactValueMode: "email",
        answerText: `${role.role} recipient email`,
        instruction: `Fill the recipient email for role "${role.role}".`,
      });
      addHint(actionHintsByTargetId, role.typeTargetId, {
        semanticRole: "docusign_recipient_type",
        preferredAction: "click",
        instruction:
          "Recipient type control. Use Needs to Sign for normal signature requests.",
      });
    }

    addHint(actionHintsByTargetId, controls.nextAddFields?.id, {
      semanticRole: "docusign_next_add_fields",
      preferredAction: "click",
      navigationAction: true,
      batchPlacement: "last",
      verifyAfterAction: "addFieldsOpened",
      instruction:
        "Only click Next: Add Fields after all required recipient role name/email values are filled.",
    });

    for (const field of fields) {
      addHint(actionHintsByTargetId, field.targetId, {
        semanticRole: "docusign_prefill_field",
        preferredAction: "click",
        answerText: field.key,
        exactValueMode: "fieldSelection",
        verifyAfterAction: "prefillFieldSelected",
        instruction:
          field.identityConfidence === "low"
            ? "Low-confidence sender pre-fill field identity; click only if the user explicitly identifies this field by position or visible placeholder."
            : `Click this sender pre-fill field, then fill the left-panel Default text field for key "${field.key}".`,
      });
    }

    addHint(actionHintsByTargetId, panelMetadata.defaultTextTargetId, {
      semanticRole: "docusign_prefill_default_text",
      preferredAction: "fill",
      exactValueMode: "exactText",
      answerText: "selected sender pre-fill value",
      instruction:
        "Fill this left-panel Default text control after clicking the matching sender pre-fill field on the document.",
    });

    addHint(actionHintsByTargetId, controls.preview?.id, {
      semanticRole: "docusign_preview",
      preferredAction: "click",
      instruction:
        "Preview the envelope only when the user explicitly asks for a review before send. For do-not-send setup/pre-fill goals, do not click Preview after requested fields are complete.",
    });

    addHint(actionHintsByTargetId, controls.send?.id, {
      semanticRole: "docusign_send",
      preferredAction: "click",
      navigationAction: true,
      batchPlacement: "last",
      verifyAfterAction: "sentConfirmation",
      instruction:
        "Send only after required recipient fields and requested sender pre-fill fields are completed.",
    });

    if (workflowPhase === "template_picker") {
      addHint(actionHintsByTargetId, controls.close?.id, {
        semanticRole: "docusign_template_picker_close",
        avoidAction: true,
        instruction:
          "This Close button cancels the Select a Template dialog. The template picker dialog is the active workflow surface, not a blocker. Do not click Close unless the user explicitly asks to cancel; select the template row/radio, then click Add Selected.",
      });
    }

    return actionHintsByTargetId;
  }

  function statusGroup(pageKind, workflowPhase, hardBlockerText, warningText) {
    return {
      id: "docusign_status",
      targetId: `site:${ADAPTER_ID}:status`,
      kind: "docusign_status",
      adapterId: ADAPTER_ID,
      label: "DocuSign workflow status",
      text: [
        `DocuSign page kind: ${pageKind}`,
        `workflow phase: ${workflowPhase}`,
        hardBlockerText ? `hard blocker: ${hardBlockerText}` : "",
        warningText ? `warning: ${warningText}` : "",
      ]
        .filter(Boolean)
        .join("; "),
      pageKind,
      workflowPhase,
      hardBlockerText,
      warningText,
    };
  }

  function templatesGroup(templates, controls) {
    const templateScopes = controls.templateScopes || [];
    const preferredScope = templateScopes.find((scope) => scope.key === "all_templates");
    if (
      !templates.length &&
      !controls.addSelected &&
      !controls.searchTemplate &&
      !templateScopes.length
    )
      return null;
    return {
      id: "docusign_templates",
      targetId: `site:${ADAPTER_ID}:templates`,
      kind: "docusign_templates",
      adapterId: ADAPTER_ID,
      label: "DocuSign templates",
      text: [
        templates.length
          ? `${templates.length} template rows detected: ${templates
              .map((template) => template.name)
              .slice(0, 6)
              .join(" | ")}`
          : "No template rows detected",
        controls.searchTemplate?.id
          ? `template search target: ${controls.searchTemplate.id}`
          : "",
        templateScopes.length
          ? `template scopes: ${templateScopes
              .map((scope) => `${scope.label} target=${scope.targetId}`)
              .join(" | ")}`
          : "",
        preferredScope?.targetId
          ? `For user-created/account templates, click All Templates first: ${preferredScope.targetId}`
          : "",
        !templates.length
          ? "If no template rows are detected, adjust template scope/search; do not click DocuSign home task/envelope cards because they are not template picker rows."
          : "",
        controls.addSelected?.id
          ? `Add Selected target: ${controls.addSelected.id}`
          : "",
      ]
        .filter(Boolean)
        .join("; "),
      templates,
      templateScopes,
      preferredTemplateScopeTargetId: preferredScope?.targetId || "",
      searchTargetId: controls.searchTemplate?.id || "",
      addSelectedTargetId: controls.addSelected?.id || "",
      controlIds: unique([
        ...templateScopes.map((scope) => scope.targetId),
        controls.searchTemplate?.id,
        controls.addSelected?.id,
        ...templates.map((template) => template.targetId || template.rowTargetId),
      ]),
    };
  }

  function recipientRolesGroup(roles, controls) {
    if (!roles.length && !controls.nextAddFields) return null;
    return {
      id: "docusign_recipient_roles",
      targetId: `site:${ADAPTER_ID}:recipient_roles`,
      kind: "docusign_recipient_roles",
      adapterId: ADAPTER_ID,
      label: "DocuSign recipient roles",
      text: [
        roles.length
          ? `${roles.length} recipient roles detected: ${roles
              .map(
                (role) =>
                  `${role.role} nameTarget=${role.nameTargetId || "missing"} emailTarget=${role.emailTargetId || "missing"}`,
              )
              .join(" | ")}`
          : "No recipient roles detected",
        controls.nextAddFields?.id
          ? `Next: Add Fields target: ${controls.nextAddFields.id}`
          : "",
      ]
        .filter(Boolean)
        .join("; "),
      roles,
      nextAddFieldsTargetId: controls.nextAddFields?.id || "",
      controlIds: unique([
        controls.nextAddFields?.id,
        ...roles.flatMap((role) => [
          role.nameTargetId,
          role.emailTargetId,
          role.typeTargetId,
          role.emailDeliveryTargetId,
          role.smsDeliveryTargetId,
        ]),
      ]),
    };
  }

  function prefillFieldsGroup(fields, panelMetadata) {
    if (!fields.length && !panelMetadata.defaultTextTargetId) return null;
    const highConfidenceFields = fields.filter(
      (field) => field.identityConfidence !== "low",
    );
    const fieldsWithValues = fields.filter((field) => field.currentValue);

    return {
      id: "docusign_prefill_fields",
      targetId: PREFILL_FIELDS_TARGET_ID,
      kind: "docusign_prefill_fields",
      adapterId: ADAPTER_ID,
      preferredAction: "extract",
      label: "DocuSign sender pre-fill fields",
      text: [
        `${fields.length} sender pre-fill DataTabView fields detected`,
        `${highConfidenceFields.length} high-confidence fields with Data Label or visible placeholder keys`,
        highConfidenceFields.length
          ? `keys: ${highConfidenceFields.map((field) => field.key).join(", ")}`
          : "",
        fieldsWithValues.length
          ? `visible current values: ${fieldsWithValues
              .map((field) => `${field.key}=${field.currentValue}`)
              .slice(0, 12)
              .join(" | ")}`
          : "",
        panelMetadata.defaultTextTargetId
          ? `selected field Default text target: ${panelMetadata.defaultTextTargetId}`
          : "Default text target not currently visible; click a pre-fill field first",
        panelMetadata.dataLabel
          ? `selected Data Label value: ${panelMetadata.dataLabel}`
          : "",
      ]
        .filter(Boolean)
        .join("; "),
      fields,
      defaultTextTargetId: panelMetadata.defaultTextTargetId || "",
      dataLabelTargetId: panelMetadata.dataLabelTargetId || "",
      selectedDataLabel: panelMetadata.dataLabel || "",
      controlIds: unique([
        panelMetadata.defaultTextTargetId,
        panelMetadata.dataLabelTargetId,
        ...fields.map((field) => field.targetId),
      ]),
    };
  }

  function sendControlsGroup(controls, hardBlockerText, warningText) {
    const ids = unique([
      controls.useTemplate?.id,
      controls.addSelected?.id,
      controls.nextAddFields?.id,
      controls.preview?.id,
      controls.send?.id,
    ]);
    if (!ids.length) return null;

    return {
      id: "docusign_send_controls",
      targetId: `site:${ADAPTER_ID}:send_controls`,
      kind: "docusign_send_controls",
      adapterId: ADAPTER_ID,
      label: "DocuSign send controls",
      text: [
        controls.useTemplate?.id ? `Use a Template target: ${controls.useTemplate.id}` : "",
        controls.addSelected?.id ? `Add Selected target: ${controls.addSelected.id}` : "",
        controls.nextAddFields?.id
          ? `Next: Add Fields target: ${controls.nextAddFields.id}`
          : "",
        controls.preview?.id
          ? `Preview target: ${controls.preview.id}; optional only when user asks to preview, not needed for do-not-send setup/pre-fill goals`
          : "",
        controls.send?.id ? `Send target: ${controls.send.id}` : "",
        hardBlockerText
          ? `Hard blocker present; do not send until resolved: ${truncate(hardBlockerText, 160)}`
          : "",
        warningText
          ? `Warning present; setup and pre-fill can continue, but sending may require resolving this warning: ${truncate(warningText, 160)}`
          : "",
        !hardBlockerText && !warningText
          ? "Send is allowed only after requested recipient and sender pre-fill values are complete"
          : "",
      ]
        .filter(Boolean)
        .join("; "),
      useTemplateTargetId: controls.useTemplate?.id || "",
      addSelectedTargetId: controls.addSelected?.id || "",
      nextAddFieldsTargetId: controls.nextAddFields?.id || "",
      previewTargetId: controls.preview?.id || "",
      sendTargetId: controls.send?.id || "",
      hardBlockerText,
      warningText,
      controlIds: ids,
    };
  }

  function buildPlannerHints(
    pageKind,
    workflowPhase,
    hardBlockerText,
    warningText,
    templates,
    roles,
    fields,
    controls,
    panelMetadata,
  ) {
    const hints = [
      `DocuSign adapter active; page kind: ${pageKind}; workflow phase: ${workflowPhase}.`,
      "For send-from-template workflows, use an existing template. Do not upload a document unless the user explicitly asks for upload.",
      (controls.templateScopes || []).some((scope) => scope.key === "all_templates")
        ? "Template picker scope guidance: for user-created/account templates, click All Templates before searching. Use Starter Templates only for DocuSign sample/template-library templates or as a fallback."
        : "",
      workflowPhase === "template_picker"
        ? "In the template picker, only select controls from the DocuSign templates group as templates. Do not click home/task/envelope cards such as prior Complete with DocuSign items when looking for a template."
        : "",
      workflowPhase === "template_picker" && controls.close?.id
        ? `The Select a Template dialog is the active workflow surface, not a blocking overlay. Do not click Close target ${controls.close.id} as cleanup; it cancels template selection.`
        : "",
      templates.length
        ? "Template picker is available: select the intended template row/radio, then click Add Selected."
        : "",
      roles.length
        ? `Recipient setup is available: fill role name/email targets before clicking Next: Add Fields. Roles: ${roles
            .map((role) => role.role)
            .join(", ")}.`
        : "",
      fields.length
        ? `Sender pre-fill fields are document DataTabView controls. Click the matching pre-fill field, then fill the left-panel Default text target ${panelMetadata.defaultTextTargetId || "(not visible yet)"} with the value.`
        : "",
      workflowPhase === "add_fields_prefill"
        ? "On Add Fields, recipient name/email setup has already happened on the Set Up Envelope page. Controls like Select Recipient, User type, or Viewing as only choose which recipient's fields are being assigned/viewed; do not use them to set the Tenant recipient."
        : "",
      workflowPhase === "add_fields_prefill" && controls.preview?.id
        ? `If the goal says not to send and the requested pre-fill fields show the requested values, stop and report completion; do not click Preview target ${controls.preview.id} unless explicitly asked.`
        : "",
      "Reliable sender pre-fill identity comes from Data Label/property panel metadata or visible machine-readable placeholder keys inside the field. Natural text, dates, addresses, and names visible inside a field are current values, not replacement field keys. Do not infer values from image-only PDF nearby labels.",
      controls.send?.id
        ? `Do not click Send target ${controls.send.id} if required recipient fields or requested pre-fill keys are missing.`
        : "",
      warningText
        ? `DocuSign warning detected: ${truncate(warningText, 220)}. This does not block selecting a template, setting recipients, or pre-filling fields. Continue setup when the goal says not to send; stop before actual Send if the warning remains relevant.`
        : "",
      hardBlockerText
        ? `DocuSign hard blocker detected: ${truncate(hardBlockerText, 220)}. Stop and report this blocker.`
        : "",
    ];

    return hints.filter(Boolean);
  }

  function controlHintText(hint) {
    if (!hint) return "";
    return truncate(
      [
        "DocuSign adapter",
        hint.semanticRole ? `role: ${hint.semanticRole}` : "",
        hint.preferredAction ? `preferred action: ${hint.preferredAction}` : "",
        hint.avoidAction ? "avoid unless explicitly requested" : "",
        hint.answerText ? `target: ${hint.answerText}` : "",
        hint.exactValueMode ? `value mode: ${hint.exactValueMode}` : "",
        hint.instruction || "",
      ]
        .filter(Boolean)
        .join("; "),
      260,
    );
  }

  function enhanceControls(controls, actionHintsByTargetId) {
    return (controls || []).map((control) => {
      const hint = actionHintsByTargetId?.[control.id];
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

  function buildSiteAdapter(state, documentRef, url) {
    const workflowPhase = detectWorkflowPhase(documentRef, url);
    const hardBlockerText = findHardBlockerText(documentRef);
    const warningText = findWarningText(documentRef);
    const pageKind = detectPageKind(workflowPhase, hardBlockerText);
    const controls = collectControls(state, documentRef);
    const templates = collectTemplates(state, documentRef);
    const roles = collectRecipientRoles(state, documentRef);
    const panelMetadata = collectPanelMetadata(state, documentRef);
    const fields = collectPrefillFields(state, documentRef, panelMetadata);
    const actionHintsByTargetId = buildActionHints(
      workflowPhase,
      controls,
      templates,
      roles,
      fields,
      panelMetadata,
    );
    const groups = [
      statusGroup(pageKind, workflowPhase, hardBlockerText, warningText),
      templatesGroup(templates, controls),
      recipientRolesGroup(roles, controls),
      prefillFieldsGroup(fields, panelMetadata),
      sendControlsGroup(controls, hardBlockerText, warningText),
    ].filter(Boolean);
    const plannerHints = buildPlannerHints(
      pageKind,
      workflowPhase,
      hardBlockerText,
      warningText,
      templates,
      roles,
      fields,
      controls,
      panelMetadata,
    );

    return {
      id: ADAPTER_ID,
      pageKind,
      workflowPhase,
      hardBlockerText,
      warningText,
      detectedTemplateCount: templates.length,
      detectedRecipientRoleCount: roles.length,
      detectedPrefillFieldCount: fields.length,
      highConfidencePrefillFieldCount: fields.filter(
        (field) => field.identityConfidence !== "low",
      ).length,
      prefillFieldsTargetId: PREFILL_FIELDS_TARGET_ID,
      defaultTextTargetId: panelMetadata.defaultTextTargetId || "",
      sendTargetId: controls.send?.id || "",
      primaryControlIds: unique([
        controls.useTemplate?.id,
        ...(controls.templateScopes || []).map((scope) => scope.targetId),
        controls.searchTemplate?.id,
        controls.addSelected?.id,
        controls.nextAddFields?.id,
        controls.send?.id,
        panelMetadata.defaultTextTargetId,
        panelMetadata.dataLabelTargetId,
        ...templates.map((template) => template.targetId || template.rowTargetId),
        ...roles.flatMap((role) => [role.nameTargetId, role.emailTargetId]),
        ...fields.slice(0, 20).map((field) => field.targetId),
      ]),
      actionHintsByTargetId,
      plannerHints,
      groups,
    };
  }

  registry.register({
    id: ADAPTER_ID,
    priority: 85,

    match({ url, document: documentRef }) {
      return isDocusignSendPage(url, documentRef);
    },

    enhanceState({ state, document: documentRef, url }) {
      const siteAdapter = buildSiteAdapter(state, documentRef, url);
      const pageFactSummary = [
        `DocuSign page kind: ${siteAdapter.pageKind}`,
        `workflow phase: ${siteAdapter.workflowPhase}`,
        `${siteAdapter.detectedTemplateCount} template rows detected`,
        `${siteAdapter.detectedRecipientRoleCount} recipient roles detected`,
        `${siteAdapter.detectedPrefillFieldCount} sender pre-fill fields detected`,
        siteAdapter.defaultTextTargetId
          ? `Default text target: ${siteAdapter.defaultTextTargetId}`
          : "",
        siteAdapter.sendTargetId ? `Send target: ${siteAdapter.sendTargetId}` : "",
        siteAdapter.hardBlockerText
          ? `DocuSign hard blocker: ${truncate(siteAdapter.hardBlockerText, 180)}`
          : "",
        siteAdapter.warningText
          ? `DocuSign warning: ${truncate(siteAdapter.warningText, 180)}`
          : "",
      ]
        .filter(Boolean)
        .join("; ");

      return {
        ...state,
        site: {
          ...(state.site || {}),
          id: "docusign",
          mode: siteAdapter.pageKind,
        },
        pageFacts: {
          ...(state.pageFacts || {}),
          docusignPageKind: siteAdapter.pageKind,
          docusignWorkflowPhase: siteAdapter.workflowPhase,
          docusignHardBlockerText: siteAdapter.hardBlockerText,
          docusignWarningText: siteAdapter.warningText,
          docusignDetectedTemplateCount: siteAdapter.detectedTemplateCount,
          docusignDetectedRecipientRoleCount:
            siteAdapter.detectedRecipientRoleCount,
          docusignDetectedPrefillFieldCount:
            siteAdapter.detectedPrefillFieldCount,
          docusignDefaultTextTargetId: siteAdapter.defaultTextTargetId,
          docusignSendTargetId: siteAdapter.sendTargetId,
        },
        siteAdapter: {
          id: siteAdapter.id,
          pageKind: siteAdapter.pageKind,
          workflowPhase: siteAdapter.workflowPhase,
          hardBlockerText: siteAdapter.hardBlockerText,
          warningText: siteAdapter.warningText,
          detectedTemplateCount: siteAdapter.detectedTemplateCount,
          detectedRecipientRoleCount: siteAdapter.detectedRecipientRoleCount,
          detectedPrefillFieldCount: siteAdapter.detectedPrefillFieldCount,
          highConfidencePrefillFieldCount:
            siteAdapter.highConfidencePrefillFieldCount,
          prefillFieldsTargetId: siteAdapter.prefillFieldsTargetId,
          defaultTextTargetId: siteAdapter.defaultTextTargetId,
          sendTargetId: siteAdapter.sendTargetId,
          primaryControlIds: siteAdapter.primaryControlIds,
          actionHintsByTargetId: siteAdapter.actionHintsByTargetId,
          plannerHints: siteAdapter.plannerHints,
        },
        visibleTextSummary: unique([
          pageFactSummary,
          ...siteAdapter.plannerHints,
          ...(state.visibleTextSummary || []),
        ]).slice(0, 80),
        groups: [...siteAdapter.groups, ...(state.groups || [])],
        controls: enhanceControls(
          state.controls || [],
          siteAdapter.actionHintsByTargetId || {},
        ),
      };
    },
  });
})();
