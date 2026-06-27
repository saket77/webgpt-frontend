(function () {
  const ADAPTER_ID = "dotloop.local";
  const DOCUMENT_FIELDS_TARGET_ID = `site:${ADAPTER_ID}:document_fields`;
  const SOURCE_VALUES_TARGET_ID = `site:${ADAPTER_ID}:source_values`;
  const PEOPLE_TARGET_ID = `site:${ADAPTER_ID}:people`;
  const FILL_DOCUMENT_FIELDS_TOOL = "dotloop_fill_document_fields";
  const ADD_PERSON_TOOL = "dotloop_add_person";
  const registry = globalThis.WebGPTContentAdapters;
  const extractModules = globalThis.WebGPTExtractStateModules || {};
  const domUtils = extractModules.domUtils || {};

  if (!registry || typeof registry.register !== "function") {
    throw new Error(
      "content-scripts/adapters/registry.js must load before dotloop.js",
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

  function isDotloopPage(url, documentRef) {
    const parsed = safeUrl(url);
    const host = lower(parsed.hostname);
    if (host === "dotloop.com" || host.endsWith(".dotloop.com")) return true;

    return Boolean(
      documentRef.querySelector(
        [
          "body.Loops",
          ".document-editor",
          ".document-list-item.document",
          ".share-modal-contents",
          "#loop-card-grid",
        ].join(","),
      ),
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
    const href = normalizeText(el.getAttribute("href"));
    const result = [];

    if (id) result.push(`#${cssEscape(id)}`);

    for (const attr of ["data-testid", "data-test", "data-qa", "data-cy"]) {
      const value = normalizeText(el.getAttribute(attr));
      if (value) result.push(`[${attr}="${cssEscape(value)}"]`);
    }

    if (name) result.push(`${tag}[name="${cssEscape(name)}"]`);
    if (ariaLabel) result.push(`${tag}[aria-label="${cssEscape(ariaLabel)}"]`);
    if (title) result.push(`${tag}[title="${cssEscape(title)}"]`);
    if (tag === "a" && href) result.push(`a[href="${cssEscape(href)}"]`);

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
    const bounds = elementBounds(el);

    return (
      findControlBySelector(controls, selectors, bounds, tag) ||
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
          control.className,
          control.selector,
        ].join(" "),
      );
      let score =
        Number(control.bounds?.width || 0) * Number(control.bounds?.height || 0);

      if (options.text && haystack.includes(lower(options.text))) score += 50000;
      if (options.preferInput && ["input", "textarea"].includes(control.tag)) {
        score += 100000;
      }
      if (options.preferButton && control.tag === "button") score += 100000;
      if (control.enabled) score += 1000;
      if (control.visible) score += 1000;

      if (!best || score > best.score) {
        best = { control, score };
      }
    }

    return best?.control || null;
  }

  function absoluteHref(href) {
    const text = normalizeText(href);
    if (!text) return "";
    try {
      return new URL(text, location.href).href;
    } catch {
      return text;
    }
  }

  function hrefId(href, pattern) {
    const match = normalizeText(href).match(pattern);
    return match?.[1] || "";
  }

  function currentLoopId(url) {
    return hrefId(safeUrl(url).pathname, /\/loop\/(\d+)/);
  }

  function currentDocumentId(url, documentRef) {
    const fromUrl = hrefId(safeUrl(url).pathname, /\/file\/(\d+)/);
    if (fromUrl) return fromUrl;
    const container = documentRef.querySelector("[id^='document-']");
    return normalizeText(container?.id).replace(/^document-/, "");
  }

  function currentDocumentName(documentRef) {
    return (
      normalizeText(
        textContent(
          documentRef.querySelector(
            ".details-tools-header[key='name'], .document-header [key='name']",
          ),
        ),
      ) ||
      normalizeText(
        textContent(documentRef.querySelector(".document-name-container .document-name")),
      ) ||
      normalizeText(documentRef.title)
    );
  }

  function detectWorkflowPhase(documentRef, url) {
    const parsed = safeUrl(url);
    if (findShareConfirmationText(documentRef)) return "shared_confirmation";
    if (findShareModal(documentRef)) return "share_modal";
    if (findAddPersonModal(documentRef)) return "add_person_modal";
    if (documentRef.querySelector("body.document-editor, body.Loops.document-editor")) {
      return "document_editor";
    }
    if (parsed.pathname.includes("/file/")) return "document_editor";
    if (parsed.pathname.match(/\/my\/loop\/\d+$/)) return "loop_detail";
    if (
      parsed.pathname === "/my/loops" ||
      parsed.pathname === "/loops" ||
      documentRef.querySelector("#loop-card-grid")
    ) {
      return "loops_dashboard";
    }
    return "unknown";
  }

  function detectPageKind(workflowPhase, blockerText) {
    if (blockerText) return "blocked_or_limited";
    return workflowPhase || "unknown";
  }

  function findBlockerText(documentRef) {
    const visibleMessages = getVisibleElements(
      [
        "[role='alert']",
        ".error-container",
        ".popup-message-container",
        ".prevent-add-warning",
        ".alert",
        ".notification",
        ".toast",
        ".snackbar",
      ].join(","),
      documentRef,
    )
      .map((el) => textContent(el))
      .filter(Boolean);
    const text = lower(visibleMessages.join(" "));
    const blockers = [
      "you do not have edit permissions",
      "maximum number",
      "limit has been reached",
      "cannot share",
      "unable to share",
      "upgrade required",
    ];

    if (!blockers.some((blocker) => text.includes(blocker))) return "";

    return truncate(visibleMessages.join("; "), 300);
  }

  function isMachineKey(value) {
    const text = normalizeText(value);
    return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(text);
  }

  function fieldTypeFor(item) {
    const cls = normalizeText(item?.getAttribute("class"));
    const match = cls.match(/data-type-([A-Z0-9_-]+)/);
    return normalizeText(match?.[1] || "field").toLowerCase();
  }

  function fieldValueFor(item) {
    const input = item.querySelector("textarea, input, select");
    if (input && "value" in input) return normalizeText(input.value);
    return normalizeText(
      textContent(
        item.querySelector(".data-display, .signature-name, .field") || item,
      ),
    );
  }

  function fieldEditability(item, fieldType, value) {
    const fieldEl = item.querySelector(".field");
    const canModify = Boolean(
      item.classList.contains("can-modify") ||
        fieldEl?.classList.contains("can-modify"),
    );
    const receiverOnly =
      ["signature", "initial"].includes(lower(fieldType)) ||
      lower(value).includes("sign here");
    const fillableByCurrentUser = canModify && !receiverOnly;
    const fillBlockReason = receiverOnly
      ? "receiver/signature field"
      : !canModify
        ? "not editable by current user"
        : "";

    return {
      canModify,
      receiverOnly,
      fillableByCurrentUser,
      fillBlockReason,
    };
  }

  function collectDocumentFields(state, documentRef, url) {
    const controls = state.controls || [];
    const documentId = currentDocumentId(url, documentRef) || "current";
    const documentName = currentDocumentName(documentRef);
    const pages = getElements(".document-page", documentRef);
    const items = getElements(".data-item", documentRef);

    return items.map((item, index) => {
      const page = item.closest(".document-page");
      const pageIndex = Math.max(0, pages.indexOf(page)) + 1 || 1;
      const fieldType = fieldTypeFor(item);
      const value = fieldValueFor(item);
      const editable =
        item.querySelector("textarea, input, select, [contenteditable='true']") || null;
      const editableControl = findControlForElement(controls, editable);
      const itemControl =
        findControlForElement(controls, item) ||
        findBestControlInRegion(controls, item, { text: value }) ||
        editableControl;
      const targetId =
        editableControl?.id ||
        itemControl?.id ||
        `site:${ADAPTER_ID}:field:${documentId}:${pageIndex}:${index + 1}`;
      const groupTargetId = `site:${ADAPTER_ID}:field:${documentId}:${pageIndex}:${
        index + 1
      }`;
      const bounds = elementBounds(item);
      const machineKey = isMachineKey(value) ? value : "";
      const editability = fieldEditability(item, fieldType, value);
      const connectorTool =
        machineKey && editability.fillableByCurrentUser
          ? FILL_DOCUMENT_FIELDS_TOOL
          : "";
      const valueKind = !value
        ? "empty"
        : machineKey
          ? "machine_placeholder"
          : "current_value";

      return {
        id: `dotloop_field_${documentId}_${pageIndex}_${index + 1}`,
        targetId: groupTargetId,
        kind: "dotloop_document_field",
        adapterId: ADAPTER_ID,
        label: machineKey || `Dotloop ${fieldType} field ${index + 1}`,
        text: [
          `Dotloop document field ${index + 1}`,
          documentName ? `document: ${documentName}` : "",
          `document id: ${documentId}`,
          `page: ${pageIndex}`,
          `field type: ${fieldType}`,
          value ? `visible value: ${value}` : "visible value: empty",
          machineKey ? `machine-readable key: ${machineKey}` : "",
          `fillable by current user: ${editability.fillableByCurrentUser ? "yes" : "no"}`,
          editability.fillBlockReason
            ? `fill block reason: ${editability.fillBlockReason}`
            : "",
          itemControl?.id ? `click target: ${itemControl.id}` : "",
          editableControl?.id ? `fill target: ${editableControl.id}` : "",
        ]
          .filter(Boolean)
          .join("; "),
        preferredAction: connectorTool || "extract",
        collectionTargetId: DOCUMENT_FIELDS_TARGET_ID,
        controlIds: unique([editableControl?.id, itemControl?.id]),
        clickTargetId: itemControl?.id || "",
        fillTargetId: editableControl?.id || "",
        connectorTool,
        connectorArgs: connectorTool ? { fieldKey: machineKey } : null,
        batchPlacement: connectorTool ? "can_batch" : "",
        verifyAfterAction: connectorTool ? "adapter_group_current_value" : "",
        activationRequired: !editableControl?.id,
        observeAfterAction: !editableControl?.id,
        safeFillTarget: Boolean(editableControl?.id),
        currentValue: value,
        fieldType,
        machineKey,
        valueKind,
        canModify: editability.canModify,
        receiverOnly: editability.receiverOnly,
        fillableByCurrentUser: editability.fillableByCurrentUser,
        fillBlockReason: editability.fillBlockReason,
        documentId,
        documentName,
        pageIndex,
        position: index + 1,
        bounds,
        identityConfidence: machineKey ? "high" : value ? "value_only" : "low",
      };
    });
  }

  function sourceValueGroups(fields) {
    return fields
      .filter((field) => {
        if (!field.currentValue || field.machineKey) return false;
        if (["signature", "initial"].includes(lower(field.fieldType))) return false;
        if (lower(field.currentValue).includes("sign here")) return false;
        return true;
      })
      .map((field, index) => ({
        id: `dotloop_source_value_${field.documentId}_${field.pageIndex}_${field.position}`,
        targetId: `site:${ADAPTER_ID}:source_value:${field.documentId}:${field.pageIndex}:${field.position}`,
        collectionTargetId: SOURCE_VALUES_TARGET_ID,
        kind: "dotloop_source_value",
        adapterId: ADAPTER_ID,
        label: `Dotloop source value ${index + 1}`,
        text: [
          `Dotloop source value ${index + 1}: ${field.currentValue}`,
          field.documentName ? `document: ${field.documentName}` : "",
          `document id: ${field.documentId}`,
          `page: ${field.pageIndex}`,
          `field position: ${field.position}`,
          `field type: ${field.fieldType}`,
          "source field label: unavailable from Dotloop DOM; do not infer from PDF image text",
        ]
          .filter(Boolean)
          .join("; "),
        preferredAction: "extract",
        currentValue: field.currentValue,
        fieldType: field.fieldType,
        documentId: field.documentId,
        documentName: field.documentName,
        pageIndex: field.pageIndex,
        position: field.position,
        bounds: field.bounds,
        identityConfidence: "value_only",
      }));
  }

  function collectLoops(state, documentRef) {
    const controls = state.controls || [];
    const links = unique(
      getElements('a[href*="/my/loop/"], a[href*="/loops/"]', documentRef)
        .map((link) => link)
        .filter((link) => {
          const href = normalizeText(link.getAttribute("href"));
          return /\/(?:my\/)?loop\/\d+$/.test(href) || /\/my\/loop\/\d+$/.test(href);
        }),
    );

    return links.map((link, index) => {
      const href = absoluteHref(link.getAttribute("href"));
      const loopId = hrefId(href, /\/loop\/(\d+)/);
      const control = findControlForElement(controls, link);
      const name = normalizeText(textContent(link));

      return {
        id: `dotloop_loop_${loopId || index + 1}`,
        targetId: `site:${ADAPTER_ID}:loop:${loopId || index + 1}`,
        kind: "dotloop_loop",
        adapterId: ADAPTER_ID,
        label: name || `Dotloop loop ${index + 1}`,
        text: [
          `Dotloop loop: ${name || "(unnamed)"}`,
          loopId ? `loop id: ${loopId}` : "",
          href ? `URL: ${href}` : "",
          control?.id ? `open target: ${control.id}` : "",
        ]
          .filter(Boolean)
          .join("; "),
        preferredAction: "click",
        controlIds: unique([control?.id]),
        openTargetId: control?.id || "",
        loopId,
        loopName: name,
        href,
      };
    });
  }

  function collectDocuments(state, documentRef, url) {
    const controls = state.controls || [];
    const loopId = currentLoopId(url);
    const rows = getElements(".document-list-item.document", documentRef);

    return rows.map((row, index) => {
      const nameEl = row.querySelector(".document-name[href], a.document-name[href]");
      const href = absoluteHref(nameEl?.getAttribute("href"));
      const documentId =
        normalizeText(row.querySelector("[data-documentid]")?.getAttribute("data-documentid")) ||
        hrefId(href, /\/file\/(\d+)/) ||
        String(index + 1);
      const name = normalizeText(textContent(nameEl));
      const status = normalizeText(
        textContent(row.querySelector(".document-status, .status-width")),
      );
      const shareEl = row.querySelector("a.share, .share");
      const openControl =
        findControlForElement(controls, nameEl) ||
        findBestControlInRegion(controls, row, { text: name });
      const shareControl =
        findControlForElement(controls, shareEl) ||
        findBestControlInRegion(controls, row, { text: "share" });

      return {
        id: `dotloop_document_${documentId}`,
        targetId: `site:${ADAPTER_ID}:document:${documentId}`,
        kind: "dotloop_document",
        adapterId: ADAPTER_ID,
        label: name || `Dotloop document ${index + 1}`,
        text: [
          `Dotloop document: ${name || "(unnamed)"}`,
          `document id: ${documentId}`,
          loopId ? `loop id: ${loopId}` : "",
          status ? `status: ${status}` : "",
          href ? `URL: ${href}` : "",
          openControl?.id ? `open target: ${openControl.id}` : "",
          shareControl?.id ? `share target: ${shareControl.id}` : "",
        ]
          .filter(Boolean)
          .join("; "),
        preferredAction: "click",
        controlIds: unique([openControl?.id, shareControl?.id]),
        openTargetId: openControl?.id || "",
        shareTargetId: shareControl?.id || "",
        documentId,
        documentName: name,
        loopId,
        href,
        status,
      };
    });
  }

  function collectEditorNavigation(state, documentRef) {
    const controls = state.controls || [];
    const backEl = documentRef.querySelector(
      [
        ".document-details li.back a.toolbar-link",
        ".document-details .back a",
        "li.back a.toolbar-link",
        "li.back a",
      ].join(","),
    );
    const backControl = findControlForElement(controls, backEl);

    return {
      backTargetId: backControl?.id || "",
    };
  }

  function collectPeople(state, documentRef) {
    const controls = state.controls || [];
    const rows = unique([
      ...getElements(".people-section .people-list > li", documentRef),
      ...getElements(".people-list-item, .person-list-item", documentRef),
    ]);

    return rows
      .map((row, index) => {
        const nameEl = row.querySelector(
          ".name-label, .person-name .name, .main-text.name, .name",
        );
        const emailEl = row.querySelector(".email, .person-email");
        const roleEl = row.querySelector(
          ".role-name, .role-options .select-toggle, .category.role .select-toggle",
        );
        const name = normalizeText(textContent(nameEl));
        const email =
          normalizeText(nameEl?.getAttribute("data-original-title")) ||
          normalizeText(textContent(emailEl));
        const role = normalizeText(textContent(roleEl));
        const rowControl =
          findControlForElement(controls, row.querySelector(".person-row") || row) ||
          findBestControlInRegion(controls, row, { text: name || email });

        return {
          id: `dotloop_person_${index + 1}`,
          targetId: `site:${ADAPTER_ID}:person:${index + 1}`,
          collectionTargetId: PEOPLE_TARGET_ID,
          kind: "dotloop_person",
          adapterId: ADAPTER_ID,
          preferredAction: "extract",
          label: name || email || `Dotloop person ${index + 1}`,
          text: [
            `Dotloop person ${index + 1}`,
            name ? `name: ${name}` : "",
            email ? `email: ${email}` : "",
            role ? `role: ${role}` : "",
          ]
            .filter(Boolean)
            .join("; "),
          name,
          email,
          role,
          position: index + 1,
          controlIds: unique([rowControl?.id]),
          rowTargetId: rowControl?.id || "",
        };
      })
      .filter((person) => person.name || person.email || person.role);
  }

  function findShareModal(documentRef) {
    return (
      getElements(".share-modal-contents, .modal-body", documentRef).find((modal) =>
        lower(textContent(modal.closest(".front, .modal, body") || modal)).includes(
          "share document",
        ),
      ) || null
    );
  }

  function findShareConfirmationText(documentRef) {
    const messages = getVisibleElements(
      [
        ".popup-message-container .notification",
        ".popup-message-container li",
        ".share-modal-contents .notification",
        ".modal-body .notification",
        "[role='status']",
        ".toast",
        ".snackbar",
      ].join(","),
      documentRef,
    )
      .map((el) => textContent(el))
      .filter(Boolean);

    return (
      messages.find((message) => {
        const text = lower(message);
        return (
          text.includes("this document has been shared") ||
          text.includes("document has been shared") ||
          text.includes("successfully shared")
        );
      }) || ""
    );
  }

  function shareActionRank(el) {
    if (!el || !(el instanceof Element)) return 0;
    if (el.closest(".permission")) return 0;

    const text = lower(textContent(el));
    if (!text || text.includes("more options")) return 0;
    if (text === "share") return 30;
    if (text === "done") return 20;
    if (text === "reshare" || text === "re-share") return 10;
    return 0;
  }

  function findFinalShareElement(root) {
    const candidates = getElements(
      [
        ".modal-footer .btn-share",
        ".modal-footer a.button-main",
        ".modal-footer button[type='submit']",
        ".modal-footer button",
        ".modal-footer a",
        ".share-modal-footer .btn-share",
        ".share-modal-footer a.button-main",
        ".share-modal-footer button[type='submit']",
        ".share-modal-footer button",
        ".share-modal-footer a",
        ".btn-share",
        "button[type='submit']",
        "a.button-main",
        "button.button-main",
      ].join(","),
      root,
    )
      .filter(isVisible)
      .map((el) => ({ el, rank: shareActionRank(el) }))
      .filter((candidate) => candidate.rank > 0)
      .sort((a, b) => b.rank - a.rank);

    return candidates[0]?.el || null;
  }

  function emailFromText(value) {
    const match = normalizeText(value).match(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    );
    return match?.[0] || "";
  }

  function collectSharePersonRows(root, controls) {
    return getElements(".people-list-item", root)
      .map((row, index) => {
        const nameEl = row.querySelector(".name-label");
        const emailEl = row.querySelector(".email, .person-email");
        const roleEl = row.querySelector(".role-name");
        const checkbox = row.querySelector("input[type='checkbox']");
        const permissionToggle = row.querySelector(".permission .select-toggle");
        const name = normalizeText(textContent(nameEl));
        const email =
          normalizeText(nameEl?.getAttribute("data-original-title")) ||
          normalizeText(textContent(emailEl)) ||
          emailFromText(textContent(row));
        const role = normalizeText(textContent(roleEl));
        const permission = normalizeText(textContent(permissionToggle));
        const rowControl =
          findControlForElement(controls, row) ||
          findBestControlInRegion(controls, row, { text: name || email });
        const checkboxControl =
          findControlForElement(controls, checkbox) ||
          findBestControlInRegion(controls, row, { preferInput: true }) ||
          null;
        const permissionControl =
          findControlForElement(controls, permissionToggle) ||
          findBestControlInRegion(controls, row, { text: permission || "permission" }) ||
          null;
        const checkboxTargetId = checkboxControl?.id || "";
        const rowTargetId = rowControl?.id || "";
        const permissionToggleTargetId = permissionControl?.id || "";
        const section = checkbox ? "add_people" : "who_has_access";

        return {
          id: `dotloop_share_person_${index + 1}`,
          targetId: `site:${ADAPTER_ID}:share_person:${index + 1}`,
          kind: "dotloop_share_person",
          adapterId: ADAPTER_ID,
          preferredAction: checkbox && !checkbox.checked ? "click" : "extract",
          label:
            [name, email, role].filter(Boolean).join(" / ") ||
            `Dotloop share person ${index + 1}`,
          text: [
            `Dotloop share person ${index + 1}`,
            section === "add_people" ? "section: Add People" : "section: Who Has Access",
            name ? `name: ${name}` : "",
            email ? `email: ${email}` : "",
            role ? `role: ${role}` : "",
            `checked: ${checkbox ? (checkbox.checked ? "yes" : "no") : "not selectable"}`,
            permission ? `permission: ${permission}` : "",
            checkboxTargetId ? `select checkbox target: ${checkboxTargetId}` : "",
            permissionToggleTargetId
              ? `permission toggle target: ${permissionToggleTargetId}`
              : "",
          ]
            .filter(Boolean)
            .join("; "),
          name,
          email,
          role,
          checked: checkbox ? Boolean(checkbox.checked) : false,
          selectable: Boolean(checkbox),
          section,
          permission,
          rowTargetId,
          checkboxTargetId,
          selectTargetId: checkboxTargetId || rowTargetId,
          permissionToggleTargetId,
          controlIds: unique([checkboxTargetId, rowTargetId, permissionToggleTargetId]),
          position: index + 1,
        };
      })
      .filter((person) => person.name || person.email || person.role);
  }

  function collectShareModal(state, documentRef) {
    const modal = findShareModal(documentRef);
    if (!modal) return null;

    const controls = state.controls || [];
    const root = modal.closest(".front, .modal") || modal;
    const documentName = normalizeText(textContent(root.querySelector(".document-names")));
    const addName = root.querySelector(
      "input[data-ac-key='name'], input[key='name'], input.name",
    );
    const addEmail = root.querySelector(
      "input[data-ac-key='emailAddress'], input[key='emailAddress'], input.email-address",
    );
    const message = root.querySelector("#share-message, textarea.message");
    const finalShare = findFinalShareElement(root);
    const confirmationText = findShareConfirmationText(root);
    const permissionToggles = getElements(".permission .select-toggle", root);
    const permissionOptions = getElements(".permission li[data-selected]", root).map(
      (option) => {
        const clickable =
          option.querySelector("a, button, [role='option'], [role='menuitem']") ||
          option;
        return {
          value: normalizeText(option.getAttribute("data-selected")),
          label: normalizeText(textContent(option)),
          active: option.classList.contains("active"),
          targetId:
            findControlForElement(controls, clickable)?.id ||
            findControlForElement(controls, option)?.id ||
            "",
        };
      },
    );
    const people = collectSharePersonRows(root, controls);
    const addPeopleRows = people.filter((person) => person.section === "add_people");
    const whoHasAccess = people.filter(
      (person) => person.section === "who_has_access",
    );

    return {
      documentName,
      addNameTargetId: findControlForElement(controls, addName)?.id || "",
      addEmailTargetId: findControlForElement(controls, addEmail)?.id || "",
      messageTargetId: findControlForElement(controls, message)?.id || "",
      shareTargetId: findControlForElement(controls, finalShare)?.id || "",
      permissionToggleTargetIds: permissionToggles
        .map((toggle) => findControlForElement(controls, toggle)?.id)
        .filter(Boolean),
      permissionOptions,
      people,
      addPeopleRows,
      whoHasAccess,
      confirmationText,
      shared: Boolean(confirmationText),
    };
  }

  function findAddPersonModal(documentRef) {
    const modal = documentRef.querySelector("#add-person-modal");
    if (modal && isVisible(modal)) return modal;

    return (
      getVisibleElements(".modal, .front", documentRef).find((candidate) => {
        const text = lower(textContent(candidate));
        return (
          text.includes("add person") &&
          text.includes("only name and role are required")
        );
      }) || null
    );
  }

  function collectAddPersonModal(state, documentRef) {
    const modal = findAddPersonModal(documentRef);
    if (!modal) return null;

    const controls = state.controls || [];
    const nameInput = modal.querySelector(
      "#inputName, input[data-ac-key='name'], input[key='name']",
    );
    const emailInput = modal.querySelector(
      "#inputEmail, input[data-ac-key='emailAddress'], input[key='emailAddress']",
    );
    const phoneInput = modal.querySelector(
      "input[data-ac-key='phone'], input[key='phone'], input[type='tel']",
    );
    const roleRoot = modal.querySelector("#inputRole, .role-options");
    const roleToggle = roleRoot?.querySelector(".select-toggle, [data-toggle='select']");
    const sendEmailCheckbox = modal.querySelector(
      "#send-email-checkbox, input[data-ac-key='sendEmail'], input[key='sendEmail'], input[name='sendEmail']",
    );
    const addToTeamCheckbox = modal.querySelector(
      "#add-to-team-checkbox, input[data-ac-key='teamMember'], input[key='teamMember'], input[name='teamMember']",
    );
    const addButton = modal.querySelector(
      "#add-person-button, .btn-add-person, .save.button-main",
    );
    const errors = getVisibleElements(".error-container li, .error-container", modal)
      .map((el) => textContent(el))
      .filter(Boolean);
    const currentRole = normalizeText(textContent(roleToggle));
    const roleOptions = getElements("li[data-selected]", roleRoot || modal)
      .map((option) => {
        const label = normalizeText(textContent(option));
        if (!label) return null;
        const clickable =
          option.querySelector("a, button, [role='option'], [role='menuitem']") ||
          option;
        const targetId =
          findControlForElement(controls, clickable)?.id ||
          findControlForElement(controls, option)?.id ||
          "";
        return {
          value: normalizeText(option.getAttribute("data-selected")),
          label,
          active: option.classList.contains("active"),
          targetId,
        };
      })
      .filter(Boolean);

    return {
      nameTargetId: findControlForElement(controls, nameInput)?.id || "",
      emailTargetId: findControlForElement(controls, emailInput)?.id || "",
      phoneTargetId: findControlForElement(controls, phoneInput)?.id || "",
      roleToggleTargetId: findControlForElement(controls, roleToggle)?.id || "",
      sendEmailTargetId: findControlForElement(controls, sendEmailCheckbox)?.id || "",
      addToTeamTargetId: findControlForElement(controls, addToTeamCheckbox)?.id || "",
      sendEmailPresent: Boolean(sendEmailCheckbox),
      addToTeamPresent: Boolean(addToTeamCheckbox),
      sendEmailChecked: Boolean(sendEmailCheckbox?.checked),
      addToTeamChecked: Boolean(addToTeamCheckbox?.checked),
      addPersonTargetId: findControlForElement(controls, addButton)?.id || "",
      currentRole,
      roleOptions,
      errors,
      roleMenuOpen: roleOptions.some((option) => option.targetId),
    };
  }

  function statusGroup(siteAdapter) {
    return {
      id: "dotloop_status",
      targetId: `site:${ADAPTER_ID}:status`,
      kind: "dotloop_status",
      adapterId: ADAPTER_ID,
      label: "Dotloop workflow status",
      text: [
        `Dotloop page kind: ${siteAdapter.pageKind}`,
        `workflow phase: ${siteAdapter.workflowPhase}`,
        siteAdapter.loopId ? `loop id: ${siteAdapter.loopId}` : "",
        siteAdapter.documentName ? `document: ${siteAdapter.documentName}` : "",
        siteAdapter.documentId ? `document id: ${siteAdapter.documentId}` : "",
        siteAdapter.shareConfirmationText
          ? `share confirmation: ${siteAdapter.shareConfirmationText}`
          : "",
        siteAdapter.shareCompleted
          ? "Dotloop explicit share goal is complete; stop unless the user asked to keep managing access."
          : "",
        siteAdapter.blockerText ? `blocker: ${siteAdapter.blockerText}` : "",
        "Share is the final send/share boundary in Dotloop.",
      ]
        .filter(Boolean)
        .join("; "),
      pageKind: siteAdapter.pageKind,
      workflowPhase: siteAdapter.workflowPhase,
      loopId: siteAdapter.loopId,
      documentId: siteAdapter.documentId,
      documentName: siteAdapter.documentName,
      shareCompleted: siteAdapter.shareCompleted,
      shareConfirmationText: siteAdapter.shareConfirmationText,
      blockerText: siteAdapter.blockerText,
    };
  }

  function sharedConfirmationGroup(siteAdapter) {
    if (!siteAdapter.shareCompleted) return null;
    return {
      id: "dotloop_shared_confirmation",
      targetId: `site:${ADAPTER_ID}:shared_confirmation`,
      kind: "dotloop_shared_confirmation",
      adapterId: ADAPTER_ID,
      label: "Dotloop share confirmation",
      text: [
        "Dotloop share confirmation is visible",
        siteAdapter.shareConfirmationText,
        siteAdapter.documentName ? `document: ${siteAdapter.documentName}` : "",
        "The requested share/send action has already succeeded; do not add more recipients or change permissions unless asked.",
      ]
        .filter(Boolean)
        .join("; "),
      preferredAction: "extract",
      shareCompleted: true,
      confirmationText: siteAdapter.shareConfirmationText,
      documentName: siteAdapter.documentName,
      controlIds: [],
    };
  }

  function loopsGroup(loops) {
    if (!loops.length) return null;
    return {
      id: "dotloop_loops",
      targetId: `site:${ADAPTER_ID}:loops`,
      kind: "dotloop_loops",
      adapterId: ADAPTER_ID,
      label: "Dotloop loops",
      text: `${loops.length} Dotloop loops detected: ${loops
        .map((loop) => loop.loopName || loop.loopId)
        .slice(0, 8)
        .join(" | ")}`,
      loopNames: loops.map((loop) => loop.loopName).filter(Boolean),
      loopIds: loops.map((loop) => loop.loopId).filter(Boolean),
      controlIds: unique(loops.map((loop) => loop.openTargetId)),
    };
  }

  function documentsGroup(documents) {
    if (!documents.length) return null;
    return {
      id: "dotloop_documents",
      targetId: `site:${ADAPTER_ID}:documents`,
      kind: "dotloop_documents",
      adapterId: ADAPTER_ID,
      label: "Dotloop documents",
      text: `${documents.length} Dotloop documents detected: ${documents
        .map((doc) => doc.documentName || doc.documentId)
        .slice(0, 8)
        .join(" | ")}`,
      documentNames: documents.map((doc) => doc.documentName).filter(Boolean),
      documentIds: documents.map((doc) => doc.documentId).filter(Boolean),
      controlIds: unique(
        documents.flatMap((doc) => [doc.openTargetId, doc.shareTargetId]),
      ),
    };
  }

  function peopleGroup(people) {
    if (!people.length) return null;
    return {
      id: "dotloop_people",
      targetId: PEOPLE_TARGET_ID,
      kind: "dotloop_people",
      label: "Dotloop people",
      text: `${people.length} Dotloop people detected: ${people
        .map((person) =>
          [person.name, person.email, person.role].filter(Boolean).join(" / "),
        )
        .slice(0, 10)
        .join(" | ")}`,
      preferredAction: "extract",
      peopleCount: people.length,
      people: people.map((person) =>
        [person.name, person.email, person.role].filter(Boolean).join(" / "),
      ),
      controlIds: unique(people.map((person) => person.rowTargetId)),
    };
  }

  function addPersonModalGroup(addPersonModal) {
    if (!addPersonModal) return null;
    const actionableRoleOptions = addPersonModal.roleOptions.filter(
      (option) => option.targetId,
    );
    return {
      id: "dotloop_add_person_modal",
      targetId: `site:${ADAPTER_ID}:add_person_modal`,
      kind: "dotloop_add_person_modal",
      adapterId: ADAPTER_ID,
      label: "Dotloop Add Person modal",
      text: [
        "Dotloop Add Person modal is open",
        addPersonModal.nameTargetId ? `Full Name target: ${addPersonModal.nameTargetId}` : "",
        addPersonModal.emailTargetId ? `Email target: ${addPersonModal.emailTargetId}` : "",
        addPersonModal.phoneTargetId ? `Phone target: ${addPersonModal.phoneTargetId}` : "",
        addPersonModal.roleToggleTargetId
          ? `Role dropdown target: ${addPersonModal.roleToggleTargetId}`
          : "",
        "connector action available: dotloop_add_person(name, role, email, phone, sendIntroEmail, addToTeam)",
        addPersonModal.currentRole ? `current role: ${addPersonModal.currentRole}` : "",
        addPersonModal.sendEmailPresent
          ? `Send intro email checkbox: ${
              addPersonModal.sendEmailChecked ? "checked" : "unchecked"
            }`
          : "",
        addPersonModal.addToTeamPresent
          ? `Add to my team checkbox: ${
              addPersonModal.addToTeamChecked ? "checked" : "unchecked"
            }`
          : "",
        actionableRoleOptions.length
          ? `visible role options: ${actionableRoleOptions
              .map((option) =>
                [option.label, option.targetId ? `target ${option.targetId}` : ""]
                  .filter(Boolean)
                  .join(" "),
              )
              .join(", ")}`
          : "Role options are not visible yet; open the Role dropdown first",
        addPersonModal.addPersonTargetId
          ? `Add Person target: ${addPersonModal.addPersonTargetId}`
          : "",
        addPersonModal.errors.length ? `errors: ${addPersonModal.errors.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
      nameTargetId: addPersonModal.nameTargetId,
      emailTargetId: addPersonModal.emailTargetId,
      phoneTargetId: addPersonModal.phoneTargetId,
      roleToggleTargetId: addPersonModal.roleToggleTargetId,
      sendEmailTargetId: addPersonModal.sendEmailTargetId,
      addToTeamTargetId: addPersonModal.addToTeamTargetId,
      sendEmailPresent: addPersonModal.sendEmailPresent,
      addToTeamPresent: addPersonModal.addToTeamPresent,
      sendEmailChecked: addPersonModal.sendEmailChecked,
      addToTeamChecked: addPersonModal.addToTeamChecked,
      roleOptions: actionableRoleOptions.map((option) => option.label),
      addPersonTargetId: addPersonModal.addPersonTargetId,
      errors: addPersonModal.errors,
      preferredAction: ADD_PERSON_TOOL,
      connectorTool: ADD_PERSON_TOOL,
      batchPlacement: "can_batch",
      verifyAfterAction: "adapter_group_or_people_list",
      controlIds: unique([
        addPersonModal.nameTargetId,
        addPersonModal.emailTargetId,
        addPersonModal.phoneTargetId,
        addPersonModal.roleToggleTargetId,
        addPersonModal.sendEmailTargetId,
        addPersonModal.addToTeamTargetId,
        addPersonModal.addPersonTargetId,
        ...addPersonModal.roleOptions.map((option) => option.targetId),
      ]),
    };
  }

  function addPersonRoleOptionGroups(addPersonModal) {
    if (!addPersonModal) return [];
    return addPersonModal.roleOptions
      .filter((option) => option.targetId)
      .map((option, index) => ({
        id: `dotloop_add_person_role_option_${index + 1}`,
        targetId: `site:${ADAPTER_ID}:add_person_role:${lower(option.label).replace(
          /[^a-z0-9]+/g,
          "_",
        )}`,
        kind: "dotloop_add_person_role_option",
        adapterId: ADAPTER_ID,
        label: option.label,
        text: [
          `Dotloop Add Person role option: ${option.label}`,
          option.value ? `value: ${option.value}` : "",
          option.active ? "currently active" : "",
          `click target: ${option.targetId}`,
        ]
          .filter(Boolean)
          .join("; "),
        preferredAction: "click",
        role: option.label,
        value: option.value,
        active: option.active,
        controlIds: unique([option.targetId]),
      }));
  }

  function documentFieldsGroup(fields) {
    if (!fields.length) return null;
    const placeholders = fields
      .filter((field) => field.fillableByCurrentUser)
      .map((field) => field.machineKey)
      .filter(Boolean)
      .slice(0, 20);
    const fillableCount = fields.filter((field) => field.fillableByCurrentUser).length;
    const receiverOnlyCount = fields.filter((field) => field.receiverOnly).length;
    return {
      id: "dotloop_document_fields",
      targetId: DOCUMENT_FIELDS_TARGET_ID,
      kind: "dotloop_document_fields",
      adapterId: ADAPTER_ID,
      label: "Dotloop document fields",
      text: [
        `${fields.length} Dotloop overlay fields detected`,
        `${fillableCount} fields fillable by current user`,
        receiverOnlyCount
          ? `${receiverOnlyCount} receiver/signature fields should not be filled by sender`
          : "",
        placeholders.length
          ? `machine-readable placeholders: ${placeholders.join(", ")}`
          : "No machine-readable placeholders detected",
        placeholders.length
          ? "connector action available: dotloop_fill_document_fields(fieldValues)"
          : "",
      ]
        .filter(Boolean)
        .join("; "),
      preferredAction: placeholders.length ? FILL_DOCUMENT_FIELDS_TOOL : "extract",
      connectorTool: placeholders.length ? FILL_DOCUMENT_FIELDS_TOOL : "",
      connectorFieldKeys: placeholders,
      batchPlacement: placeholders.length ? "can_batch" : "",
      verifyAfterAction: placeholders.length ? "adapter_group_current_value" : "",
      fieldCount: fields.length,
      fillableCount,
      receiverOnlyCount,
      placeholderKeys: placeholders,
      controlIds: unique(fields.flatMap((field) => field.controlIds || [])),
    };
  }

  function sourceValuesGroup(values) {
    if (!values.length) return null;
    return {
      id: "dotloop_source_values",
      targetId: SOURCE_VALUES_TARGET_ID,
      kind: "dotloop_source_values",
      label: "Dotloop source values",
      text: [
        `${values.length} filled Dotloop source values detected`,
        values
          .slice(0, 8)
          .map((value) => value.currentValue)
          .join(" | "),
        "Labels are not inferred from PDF image text.",
      ]
        .filter(Boolean)
        .join("; "),
      preferredAction: "extract",
      valueCount: values.length,
      values: values.map((value) => value.currentValue),
      controlIds: [],
    };
  }

  function shareModalGroup(shareModal) {
    if (!shareModal) return null;
    return {
      id: "dotloop_share_modal",
      targetId: `site:${ADAPTER_ID}:share_modal`,
      kind: "dotloop_share_modal",
      adapterId: ADAPTER_ID,
      label: "Dotloop share modal",
      text: [
        "Dotloop Share Document modal is open",
        shareModal.confirmationText
          ? `share confirmation: ${shareModal.confirmationText}`
          : "",
        shareModal.shared
          ? "share already completed; footer Done only closes the confirmation modal"
          : "",
        shareModal.documentName ? `document: ${shareModal.documentName}` : "",
        !shareModal.shared && shareModal.addNameTargetId
          ? `Add Name target: ${shareModal.addNameTargetId}`
          : "",
        !shareModal.shared && shareModal.addEmailTargetId
          ? `Add Email target: ${shareModal.addEmailTargetId}`
          : "",
        !shareModal.shared && shareModal.permissionOptions.length
          ? `permissions: ${shareModal.permissionOptions
              .map((option) => `${option.label}${option.active ? " (active)" : ""}`)
              .join(", ")}`
          : "",
        !shareModal.shared && shareModal.addPeopleRows.length
          ? `Add People rows: ${shareModal.addPeopleRows
              .map((person) =>
                [person.name, person.email, person.role, person.permission]
                  .filter(Boolean)
                  .join(" / "),
              )
              .join(" | ")}`
          : "",
        shareModal.whoHasAccess.length
          ? `Who Has Access: ${shareModal.whoHasAccess
              .map((person) =>
                [person.name, person.email, person.role, person.permission]
                  .filter(Boolean)
                  .join(" / "),
              )
              .join(" | ")}`
          : "",
        shareModal.shareTargetId
          ? shareModal.shared
            ? `Done target closes confirmation modal: ${shareModal.shareTargetId}`
            : `final Share target: ${shareModal.shareTargetId}`
          : "",
      ]
        .filter(Boolean)
        .join("; "),
      documentName: shareModal.documentName,
      shareCompleted: shareModal.shared,
      confirmationText: shareModal.confirmationText,
      people: shareModal.people
        .map((person) =>
          [person.name, person.email, person.role, person.permission].filter(Boolean).join(" / "),
        )
        .filter(Boolean),
      addPeopleRows: shareModal.addPeopleRows.map((person) => ({
        name: person.name,
        email: person.email,
        role: person.role,
        checked: person.checked,
        permission: person.permission,
        checkboxTargetId: person.checkboxTargetId,
        permissionToggleTargetId: person.permissionToggleTargetId,
      })),
      whoHasAccess: shareModal.whoHasAccess.map((person) => ({
        name: person.name,
        email: person.email,
        role: person.role,
        permission: person.permission,
      })),
      permissionOptions: shareModal.permissionOptions.map((option) => option.label),
      controlIds: shareModal.shared
        ? unique([shareModal.shareTargetId])
        : unique([
            shareModal.addNameTargetId,
            shareModal.addEmailTargetId,
            shareModal.messageTargetId,
            shareModal.shareTargetId,
            ...shareModal.permissionToggleTargetIds,
            ...shareModal.permissionOptions.map((option) => option.targetId),
            ...shareModal.addPeopleRows.flatMap((person) => [
              person.selectTargetId,
              person.permissionToggleTargetId,
            ]),
          ]),
    };
  }

  function sharePersonGroups(shareModal) {
    if (shareModal?.shared) return [];
    return shareModal?.addPeopleRows || [];
  }

  function addHint(actionHintsByTargetId, targetId, hint) {
    if (!targetId) return;
    actionHintsByTargetId[targetId] = {
      ...(actionHintsByTargetId[targetId] || {}),
      ...hint,
    };
  }

  function buildActionHints(
    documents,
    loops,
    fields,
    shareModal,
    addPersonModal,
    editorShareTargetId,
    editorBackTargetId,
  ) {
    const actionHintsByTargetId = {};

    for (const loop of loops) {
      addHint(actionHintsByTargetId, loop.openTargetId, {
        semanticRole: "dotloop_open_loop",
        preferredAction: "click",
        navigationAction: true,
        instruction:
          "Open this Dotloop loop. Avoid archive, transaction type, and closing date controls unless the user explicitly asks for them.",
      });
    }

    for (const doc of documents) {
      addHint(actionHintsByTargetId, doc.openTargetId, {
        semanticRole: "dotloop_open_document",
        preferredAction: "click",
        navigationAction: true,
        instruction:
          "Open this Dotloop document. For source-to-template transfer, open and extract the source document before opening the target template.",
      });
      addHint(actionHintsByTargetId, doc.shareTargetId, {
        semanticRole: "dotloop_open_share_modal",
        preferredAction: "click",
        instruction:
          "Open the Dotloop Share Document modal for this document. This is not the final share click yet.",
      });
    }

    addHint(actionHintsByTargetId, editorShareTargetId, {
      semanticRole: "dotloop_open_share_modal",
      preferredAction: "click",
      instruction:
        "Open the Dotloop Share Document modal. For do-not-share goals, stop before this if requested fields are already filled.",
    });

    addHint(actionHintsByTargetId, editorBackTargetId, {
      semanticRole: "dotloop_editor_back_to_loop_documents",
      preferredAction: "click",
      navigationAction: true,
      instruction:
        "Return from this Dotloop document editor to the loop document list. Use this when switching to another document in the same loop. The document title/header is not a document switcher.",
    });

    for (const field of fields) {
      if (!field.fillableByCurrentUser) {
        addHint(actionHintsByTargetId, field.clickTargetId || field.fillTargetId, {
          semanticRole: "dotloop_non_fillable_field",
          avoidAction: true,
          answerText: field.machineKey || field.currentValue || field.label,
          instruction: `Do not fill this Dotloop field during sender preparation: ${
            field.fillBlockReason || "not fillable by current user"
          }. It may still be extracted as document context if needed.`,
        });
        continue;
      }

      const instruction = field.machineKey
        ? `Prefer connector tool dotloop_fill_document_fields with fieldValues.${field.machineKey} for this Dotloop template field. The connector clicks/activates the field if needed, fills the live textbox, and commits it in one action. Use normal click/fill only as fallback if the connector is unavailable or fails.`
        : field.fillTargetId
          ? "Fill this active Dotloop field. Its identity is value/position based. After this fill, it is okay to click the next Dotloop field to activate it in the same action batch; only wait before filling that newly activated next field."
          : "Click this Dotloop field to activate its textbox, then observe and fill the visible textbox. Do not infer field identity from PDF image text. This activation click may follow a safe fill of a different already-active field, but the fill for this field must wait for the next observed state.";
      addHint(actionHintsByTargetId, field.fillTargetId || field.clickTargetId, {
        semanticRole: field.machineKey
          ? "dotloop_template_field"
          : "dotloop_document_field",
        preferredAction: field.machineKey
          ? FILL_DOCUMENT_FIELDS_TOOL
          : field.fillTargetId
            ? "fill"
            : "click",
        connectorTool: field.machineKey ? FILL_DOCUMENT_FIELDS_TOOL : "",
        connectorArgs: field.machineKey ? { fieldKey: field.machineKey } : null,
        answerText: field.machineKey || field.currentValue || field.label,
        exactValueMode: field.machineKey ? "connectorValue" : "literal",
        stableFieldTargetId: field.targetId,
        machineKey: field.machineKey || "",
        activationRequired: field.machineKey ? false : !field.fillTargetId,
        observeAfterAction: field.machineKey ? false : !field.fillTargetId,
        safeFillTarget: field.machineKey ? true : Boolean(field.fillTargetId),
        batchPlacement: field.machineKey ? "can_batch" : "",
        verifyAfterAction: field.machineKey ? "adapter_group_current_value" : "",
        instruction,
      });
      if (field.clickTargetId && field.fillTargetId && field.clickTargetId !== field.fillTargetId) {
        addHint(actionHintsByTargetId, field.clickTargetId, {
          semanticRole: "dotloop_activate_field",
          preferredAction: "click",
          answerText: field.machineKey || field.currentValue || field.label,
          stableFieldTargetId: field.targetId,
          activationRequired: true,
          observeAfterAction: true,
          instruction:
            "Click this Dotloop field only when it needs activation before filling. It may be batched after filling a different already-active field, but do not fill this newly activated field until after the next observed state.",
        });
      }
    }

    if (addPersonModal) {
      const addPersonConnectorHint = {
        preferredAction: ADD_PERSON_TOOL,
        connectorTool: ADD_PERSON_TOOL,
        exactValueMode: "connectorValue",
        batchPlacement: "can_batch",
        verifyAfterAction: "adapter_group_or_people_list",
      };
      addHint(actionHintsByTargetId, addPersonModal.nameTargetId, {
        semanticRole: "dotloop_add_person_name",
        ...addPersonConnectorHint,
        instruction:
          "Prefer connector tool dotloop_add_person for the open Add Person modal. Fallback: fill the Dotloop Add Person full name.",
      });
      addHint(actionHintsByTargetId, addPersonModal.emailTargetId, {
        semanticRole: "dotloop_add_person_email",
        ...addPersonConnectorHint,
        instruction:
          "Prefer connector tool dotloop_add_person for the open Add Person modal. Fallback: fill the email only when the user provided an email address.",
      });
      addHint(actionHintsByTargetId, addPersonModal.phoneTargetId, {
        semanticRole: "dotloop_add_person_phone",
        ...addPersonConnectorHint,
        instruction:
          "Prefer connector tool dotloop_add_person for the open Add Person modal. Fallback: fill the phone only when a phone field is visible. If no phone target exists, do not invent one.",
      });
      addHint(actionHintsByTargetId, addPersonModal.sendEmailTargetId, {
        semanticRole: "dotloop_add_person_send_intro_email",
        ...addPersonConnectorHint,
        instruction:
          "Prefer connector tool dotloop_add_person to set Send intro email when the checkbox is present. Fallback: click this checkbox only if it does not match the requested state.",
      });
      addHint(actionHintsByTargetId, addPersonModal.addToTeamTargetId, {
        semanticRole: "dotloop_add_person_add_to_team",
        ...addPersonConnectorHint,
        instruction:
          "Prefer connector tool dotloop_add_person to keep Add to my team off by default unless the user explicitly asks to add the person to the team.",
      });
      addHint(actionHintsByTargetId, addPersonModal.roleToggleTargetId, {
        semanticRole: "dotloop_add_person_role_toggle",
        ...addPersonConnectorHint,
        activationRequired: true,
        observeAfterAction: true,
        optionTexts: addPersonModal.roleOptions.map((option) => option.label),
        instruction:
          "Prefer connector tool dotloop_add_person to select the requested role. Fallback: open the Add Person Role dropdown and choose the requested role option from this modal, not a role label in the existing People list. Do not click Add Person until the role is selected.",
      });
      for (const option of addPersonModal.roleOptions) {
        addHint(actionHintsByTargetId, option.targetId, {
          semanticRole: "dotloop_add_person_role_option",
          preferredAction: "click",
          answerText: option.label,
          exactValueMode: "optionText",
          instruction: `Choose Add Person role "${option.label}" from the open Role dropdown. This option belongs to the Add Person modal, not the existing People list.`,
        });
      }
      addHint(actionHintsByTargetId, addPersonModal.addPersonTargetId, {
        semanticRole: "dotloop_add_person_submit",
        ...addPersonConnectorHint,
        batchPlacement: "last",
        instruction:
          "Prefer connector tool dotloop_add_person for filling the modal and clicking Add Person. Fallback: click Add Person only after Full Name is filled and the requested role is selected. If Role is still the placeholder or a role-required error is visible, open Role and choose the requested option first.",
      });
    }

    if (shareModal?.shared) {
      addHint(actionHintsByTargetId, shareModal.shareTargetId, {
        semanticRole: "dotloop_close_shared_confirmation",
        preferredAction: "click",
        navigationAction: true,
        instruction:
          "Dotloop already shows the document has been shared. This Done control only closes the confirmation modal; treat explicit share goals as complete without clicking it unless the user asked to close the modal.",
      });
    } else if (shareModal) {
      addHint(actionHintsByTargetId, shareModal.addNameTargetId, {
        semanticRole: "dotloop_share_add_name",
        preferredAction: "fill",
        exactValueMode: "literal",
        instruction:
          "Fill the recipient/person name only when no existing Add People row matches the requested recipient by exact email or name/role.",
      });
      addHint(actionHintsByTargetId, shareModal.addEmailTargetId, {
        semanticRole: "dotloop_share_add_email",
        preferredAction: "fill",
        exactValueMode: "literal",
        instruction:
          "Fill the recipient/person email only when no existing Add People row matches the requested recipient by exact email.",
      });
      for (const targetId of shareModal.permissionToggleTargetIds) {
        addHint(actionHintsByTargetId, targetId, {
          semanticRole: "dotloop_share_permission_toggle",
          preferredAction: "click",
          instruction:
            'Open the permission menu. For fillable tenant workflows, choose "Can fill & sign" before final Share.',
        });
      }
      for (const person of shareModal.addPeopleRows || []) {
        addHint(actionHintsByTargetId, person.selectTargetId, {
          semanticRole: "dotloop_share_select_existing_person",
          preferredAction: "click",
          answerText: [person.name, person.email, person.role].filter(Boolean).join(" / "),
          exactValueMode: "literal",
          instruction:
            "Select this existing Add People row when it matches the requested share recipient. Prefer exact email match first, then name plus role. Use this instead of Add Name/Add Email for saved people.",
          personName: person.name,
          personEmail: person.email,
          personRole: person.role,
          checked: person.checked,
          permission: person.permission,
        });
        addHint(actionHintsByTargetId, person.permissionToggleTargetId, {
          semanticRole: "dotloop_share_person_permission_toggle",
          preferredAction: "click",
          answerText: [person.name, person.email, person.role].filter(Boolean).join(" / "),
          instruction:
            'Open this matched person row permission menu. For tenant/client completion, choose "Can fill & sign" before final Share.',
          personName: person.name,
          personEmail: person.email,
          personRole: person.role,
          permission: person.permission,
        });
      }
      for (const option of shareModal.permissionOptions) {
        addHint(actionHintsByTargetId, option.targetId, {
          semanticRole:
            lower(option.label) === "can fill & sign"
              ? "dotloop_share_permission_fill_sign"
              : "dotloop_share_permission_option",
          preferredAction: "click",
          answerText: option.label,
          instruction:
            lower(option.label) === "can fill & sign"
              ? 'Choose "Can fill & sign" when sharing a fillable form for a tenant/client to complete.'
              : "Choose this permission only when the user explicitly asks for it.",
        });
      }
      addHint(actionHintsByTargetId, shareModal.shareTargetId, {
        semanticRole: "dotloop_final_share",
        preferredAction: "click",
        navigationAction: true,
        batchPlacement: "last",
        instruction:
          'This is the real modal footer Share/Done action, not a permission option. Do not click it for do-not-share goals. Before sharing fillable forms, ensure the matched recipient row is checked and has "Can fill & sign".',
      });
    }

    return actionHintsByTargetId;
  }

  function buildPlannerHints(
    siteAdapter,
    loops,
    documents,
    fields,
    sourceValues,
    shareModal,
    addPersonModal,
  ) {
    const placeholders = fields
      .filter((field) => field.fillableByCurrentUser)
      .map((field) => field.machineKey)
      .filter(Boolean)
      .slice(0, 16);
    const nonFillableCount = fields.filter((field) => !field.fillableByCurrentUser).length;

    return [
      "Dotloop connector adapter active: use normal browser navigation/extract actions for loops/documents, and prefer connector tools for supported Dotloop page operations.",
      loops.length
        ? "Dotloop loop cards are primary open targets. Avoid archive/type/closing-date controls unless explicitly requested."
        : "",
      documents.length
        ? `Dotloop documents detected: ${documents
            .map((doc) => doc.documentName)
            .filter(Boolean)
            .slice(0, 8)
            .join(" | ")}. Open the matching source or target document directly.`
        : "",
      siteAdapter.detectedPeopleCount
        ? `Dotloop people folder detected with ${siteAdapter.detectedPeopleCount} people. Extract people with extract.targetId="${PEOPLE_TARGET_ID}" when the goal needs current loop participants.`
        : "",
      addPersonModal
        ? [
            "Dotloop Add Person modal is open.",
            "Prefer dotloop_add_person(name, role, email, phone, sendIntroEmail, addToTeam) for this modal; it fills fields, handles role, Send intro email, Add to my team, and clicks Add Person in one connector action. Use normal click/fill only as fallback if the connector is unavailable or fails.",
            addPersonModal.roleToggleTargetId
              ? `Role dropdown target is ${addPersonModal.roleToggleTargetId}.`
              : "",
            addPersonModal.roleOptions.some((option) => option.targetId)
              ? `Visible role options: ${addPersonModal.roleOptions
                  .filter((option) => option.targetId)
                  .map((option) =>
                    `${option.label}${option.targetId ? ` (${option.targetId})` : ""}`,
                  )
                  .join(", ")}. Choose the requested role option from these modal options.`
              : "Role options are not visible yet; click the Add Person Role dropdown and observe before choosing a role.",
            "Do not use BUYER/SELLER/NONE text from the existing People list as the Add Person role.",
            addPersonModal.addPersonTargetId
              ? `Add Person submit target is ${addPersonModal.addPersonTargetId}; click it only after the requested role is selected.`
              : "",
            addPersonModal.errors.length
              ? `Visible Add Person errors: ${addPersonModal.errors.join("; ")}`
              : "",
          ]
            .filter(Boolean)
            .join(" ")
        : "",
      sourceValues.length
        ? `Filled source values are extractable with extract.targetId="${SOURCE_VALUES_TARGET_ID}". These values are value-only unless a DOM field key is present; do not infer labels from PDF image text.`
        : "",
      placeholders.length
        ? `Target template placeholders detected: ${placeholders.join(", ")}. Prefer dotloop_fill_document_fields(fieldValues) when values are known; it clicks/activates and fills each matching placeholder in one connector action. Use these machine-readable placeholders as the reliable fill anchors.`
        : "",
      fields.length && !placeholders.length
        ? "Dotloop overlay fields are visible, but no machine-readable placeholders are detected. Use value/position only and ask for review if mapping is ambiguous."
        : "",
      siteAdapter.workflowPhase === "document_editor"
        ? "In the Dotloop editor, non-active fields may need one click to reveal/focus their textbox before filling; dotloop_fill_document_fields performs that click-then-fill loop for matching machine-key placeholders."
        : "",
      siteAdapter.workflowPhase === "document_editor" && siteAdapter.editorBackTargetId
        ? `To switch from this Dotloop document editor back to the loop document list, click editor back target ${siteAdapter.editorBackTargetId}. Do not click the document name/header as a document switcher. Browser back is only a fallback if this target is unavailable.`
        : "",
      nonFillableCount
        ? `${nonFillableCount} Dotloop overlay fields are not fillable by the current user or are receiver/signature fields. Do not fill them unless the user explicitly asks to edit that field type and the UI allows it.`
        : "",
      shareModal && !shareModal.shared
        ? 'The Dotloop Share Document modal is open. For tenant/client fill workflows, set permission to "Can fill & sign"; View only is not enough.'
        : "",
      shareModal?.shared
        ? `Dotloop share confirmation is visible: "${shareModal.confirmationText}". For explicit share/send goals, this means the workflow succeeded. Return done; do not add more people, change permissions, click Reshare, or click Done unless the user asked to close the modal.`
        : "",
      shareModal?.addPeopleRows?.length && !shareModal.shared
        ? `Existing Add People rows detected: ${shareModal.addPeopleRows
            .map((person) =>
              [person.name, person.email, person.role, person.checked ? "checked" : "unchecked"]
                .filter(Boolean)
                .join(" / "),
            )
            .slice(0, 8)
            .join(" | ")}. Match share recipients by exact email first, then name plus role. If a matching Add People row exists, select that row instead of filling Add Name/Add Email.`
        : "",
      shareModal?.whoHasAccess?.length
        ? "Who Has Access lists people already shared with and is not the same as selecting a recipient in Add People."
        : "",
      shareModal?.shareTargetId
        ? shareModal.shared
          ? `Done target ${shareModal.shareTargetId} only closes an already-shared confirmation modal. It is not needed to complete the share goal.`
          : `Share target ${shareModal.shareTargetId} is the final send/share boundary. Do not click it when the goal says not to share/send.`
        : "",
      siteAdapter.blockerText
        ? `Dotloop blocker detected: ${siteAdapter.blockerText}. Stop and report this blocker.`
        : "",
    ].filter(Boolean);
  }

  function controlHintText(hint) {
    if (!hint) return "";
    return truncate(
      [
        "Dotloop adapter",
        hint.semanticRole ? `role: ${hint.semanticRole}` : "",
        hint.preferredAction ? `preferred action: ${hint.preferredAction}` : "",
        hint.connectorTool ? `connector: ${hint.connectorTool}` : "",
        hint.batchPlacement ? `batch: ${hint.batchPlacement}` : "",
        hint.verifyAfterAction ? `verify: ${hint.verifyAfterAction}` : "",
        hint.avoidAction ? "avoid unless explicitly requested" : "",
        hint.activationRequired ? "activation required" : "",
        hint.observeAfterAction ? "observe after action" : "",
        hint.safeFillTarget ? "safe fill target" : "",
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
    const blockerText = findBlockerText(documentRef);
    const pageKind = detectPageKind(workflowPhase, blockerText);
    const loopId = currentLoopId(url);
    const documentId = currentDocumentId(url, documentRef);
    const documentName = workflowPhase === "document_editor" ? currentDocumentName(documentRef) : "";
    const loops = collectLoops(state, documentRef);
    const documents = collectDocuments(state, documentRef, url);
    const people = collectPeople(state, documentRef);
    const editorNavigation =
      workflowPhase === "document_editor"
        ? collectEditorNavigation(state, documentRef)
        : { backTargetId: "" };
    const fields =
      workflowPhase === "document_editor"
        ? collectDocumentFields(state, documentRef, url)
        : [];
    const sourceValues = sourceValueGroups(fields);
    const shareModal = collectShareModal(state, documentRef);
    const addPersonModal = collectAddPersonModal(state, documentRef);
    const editorShareTargetId =
      findControlForElement(state.controls || [], documentRef.querySelector(".button.share"))?.id ||
      "";
    const actionHintsByTargetId = buildActionHints(
      documents,
      loops,
      fields,
      shareModal,
      addPersonModal,
      editorShareTargetId,
      editorNavigation.backTargetId,
    );

    const siteAdapter = {
      id: ADAPTER_ID,
      pageKind,
      workflowPhase,
      loopId,
      documentId,
      documentName: shareModal?.documentName || documentName,
      blockerText,
      detectedLoopCount: loops.length,
      detectedDocumentCount: documents.length,
      detectedPeopleCount: people.length,
      detectedFieldCount: fields.length,
      detectedSourceValueCount: sourceValues.length,
      addPersonModalOpen: Boolean(addPersonModal),
      documentFieldsTargetId: DOCUMENT_FIELDS_TARGET_ID,
      sourceValuesTargetId: SOURCE_VALUES_TARGET_ID,
      peopleTargetId: PEOPLE_TARGET_ID,
      shareTargetId: shareModal?.shareTargetId || editorShareTargetId || "",
      editorBackTargetId: editorNavigation.backTargetId || "",
      shareCompleted: Boolean(shareModal?.shared),
      shareConfirmationText: shareModal?.confirmationText || "",
    };

    const groups = [
      statusGroup(siteAdapter),
      sharedConfirmationGroup(siteAdapter),
      loopsGroup(loops),
      documentsGroup(documents),
      peopleGroup(people),
      documentFieldsGroup(fields),
      sourceValuesGroup(sourceValues),
      shareModalGroup(shareModal),
      addPersonModalGroup(addPersonModal),
      ...sharePersonGroups(shareModal),
      ...addPersonRoleOptionGroups(addPersonModal),
      ...loops,
      ...documents,
      ...people,
      ...fields,
      ...sourceValues,
    ].filter(Boolean);
    const plannerHints = buildPlannerHints(
      siteAdapter,
      loops,
      documents,
      fields,
      sourceValues,
      shareModal,
      addPersonModal,
    );

    const addPersonPrimaryControlIds = addPersonModal
      ? [
          addPersonModal.nameTargetId,
          addPersonModal.emailTargetId,
          addPersonModal.phoneTargetId,
          addPersonModal.roleToggleTargetId,
          addPersonModal.sendEmailTargetId,
          addPersonModal.addToTeamTargetId,
          ...addPersonModal.roleOptions.map((option) => option.targetId),
          addPersonModal.addPersonTargetId,
        ]
      : [];

    const shareModalPrimaryControlIds = shareModal?.shared
      ? []
      : [
          shareModal?.addNameTargetId,
          shareModal?.addEmailTargetId,
          shareModal?.shareTargetId,
          ...(shareModal?.permissionToggleTargetIds || []),
          ...(shareModal?.permissionOptions || []).map((option) => option.targetId),
          ...(shareModal?.addPeopleRows || []).flatMap((person) => [
            person.selectTargetId,
            person.permissionToggleTargetId,
          ]),
        ];

    return {
      ...siteAdapter,
      people,
      primaryControlIds: unique([
        ...addPersonPrimaryControlIds,
        ...loops.map((loop) => loop.openTargetId),
        ...documents.flatMap((doc) => [doc.openTargetId, doc.shareTargetId]),
        editorNavigation.backTargetId,
        editorShareTargetId,
        ...fields
          .filter((field) => field.fillableByCurrentUser)
          .slice(0, 30)
          .flatMap((field) => [field.fillTargetId, field.clickTargetId]),
        ...shareModalPrimaryControlIds,
      ]),
      actionHintsByTargetId,
      plannerHints,
      groups,
    };
  }

  function fillablePlaceholderFields(state, documentRef, url) {
    if (detectWorkflowPhase(documentRef, url) !== "document_editor") return [];

    const seen = new Set();
    return collectDocumentFields(state || { controls: [] }, documentRef, url)
      .filter(
        (field) =>
          field.machineKey &&
          field.fillableByCurrentUser &&
          !field.receiverOnly &&
          field.connectorTool === FILL_DOCUMENT_FIELDS_TOOL,
      )
      .filter((field) => {
        if (seen.has(field.machineKey)) return false;
        seen.add(field.machineKey);
        return true;
      })
      .slice(0, 40);
  }

  function addPersonRoleLabels(addPersonModal) {
    return unique((addPersonModal?.roleOptions || []).map((option) => option.label))
      .filter(Boolean)
      .slice(0, 80);
  }

  function provideTools({ state, document: documentRef, url }) {
    const doc = documentRef || document;
    const tools = [];
    const fields = fillablePlaceholderFields(state || { controls: [] }, doc, url);

    if (fields.length) {
      const fieldValueProperties = {};
      for (const field of fields) {
        fieldValueProperties[field.machineKey] = {
          type: "string",
          description: `Value to fill into Dotloop placeholder ${field.machineKey}.`,
        };
      }

      const mapping = fields
        .map((field) => `${field.machineKey} = "${truncate(field.label, 90)}"`)
        .join("; ");

      tools.push({
        type: "function",
        name: "dotloop_fill_document_fields",
        description: truncate(
          "Fill Dotloop PDF/editor placeholder fields in ONE action. Provide fieldValues keyed by visible machine-readable placeholders. The connector clicks/activates each matching field if needed, fills the live input, and commits input/change events. It skips missing, non-fillable, signature/initial, and receiver-only fields. fieldKey -> current placeholder: " +
            mapping,
          1100,
        ),
        strict: false,
        parameters: {
          type: "object",
          properties: {
            fieldValues: {
              type: "object",
              properties: fieldValueProperties,
              additionalProperties: false,
              description:
                "Object keyed by Dotloop placeholder/machine keys, for example tenant_legal_name.",
            },
          },
          required: ["fieldValues"],
          additionalProperties: false,
        },
      });
    }

    const addPersonModal = collectAddPersonModal(state || { controls: [] }, doc);
    if (addPersonModal) {
      const roleLabels = addPersonRoleLabels(addPersonModal);
      const roleSchema = roleLabels.length
        ? {
            type: "string",
            enum: roleLabels,
            description: "Dotloop role label to select from the open Add Person modal.",
          }
        : {
            type: "string",
            description: "Dotloop role label to select from the open Add Person modal.",
          };

      tools.push({
        type: "function",
        name: "dotloop_add_person",
        description: truncate(
          "Add a person through the open Dotloop Add Person modal in ONE action. The connector fills Full Name, optional email, optional phone when the phone field exists, selects role from the modal's preloaded role options, sets Send intro email when requested and present, keeps Add to my team off by default unless explicitly true, then clicks Add Person. Role options: " +
            roleLabels.join(", "),
          1100,
        ),
        strict: false,
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Full name to add.",
            },
            email: {
              type: "string",
              description: "Email address to fill when provided.",
            },
            phone: {
              type: "string",
              description: "Phone number to fill only when Dotloop shows a phone field.",
            },
            role: roleSchema,
            sendIntroEmail: {
              type: "boolean",
              description:
                "When true, turn on Send intro email if that checkbox is present. When false, turn it off if present.",
            },
            addToTeam: {
              type: "boolean",
              description:
                "Defaults to false. Set true only when the user explicitly asks to add this person to my team.",
            },
          },
          required: ["name", "role"],
          additionalProperties: false,
        },
      });
    }

    return tools;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function inputLikeEvent(type, init = {}) {
    try {
      return new InputEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        ...init,
      });
    } catch {
      return new Event(type, { bubbles: true, cancelable: true });
    }
  }

  function dispatchInputChange(el) {
    if (!el) return;
    el.dispatchEvent(inputLikeEvent("input"));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function documentFieldItems(documentRef = document) {
    return getElements(".data-item", documentRef);
  }

  function matchingDocumentFieldItems(fieldKey, documentRef = document) {
    const wanted = normalizeText(fieldKey);
    if (!wanted) return [];
    return documentFieldItems(documentRef).filter((item) => {
      const value = fieldValueFor(item);
      return isMachineKey(value) && normalizeText(value) === wanted;
    });
  }

  function liveDocumentFieldInput(item) {
    return (
      getVisibleElements(
        [
          "textarea",
          "input:not([type='hidden']):not([type='file'])",
          "select",
          "[contenteditable='true']",
        ].join(","),
        item,
      ).find((el) => {
        if (el.hasAttribute("disabled")) return false;
        if (lower(el.getAttribute("aria-disabled")) === "true") return false;
        return true;
      }) || null
    );
  }

  function documentFieldActivationTarget(item) {
    return (
      liveDocumentFieldInput(item) ||
      item.querySelector(".field.can-modify, .field, .data-display") ||
      item
    );
  }

  function fieldValuesFromAction(action) {
    const source =
      action?.fieldValues &&
      typeof action.fieldValues === "object" &&
      !Array.isArray(action.fieldValues)
        ? action.fieldValues
        : {};
    const fieldValues = {};

    for (const [key, value] of Object.entries(source)) {
      const fieldKey = normalizeText(key);
      const fieldValue = normalizeText(value);
      if (fieldKey && fieldValue) fieldValues[fieldKey] = fieldValue;
    }

    return fieldValues;
  }

  async function fillOneDocumentFieldItem(item, fieldKey, value, ctx) {
    const click = ctx?.primitives?.clickElement;
    const fill = ctx?.primitives?.fillElement;
    const fieldType = fieldTypeFor(item);
    const currentValue = fieldValueFor(item);
    const editability = fieldEditability(item, fieldType, currentValue);

    if (!editability.fillableByCurrentUser) {
      return {
        ok: false,
        skipped: true,
        fieldKey,
        reason: editability.fillBlockReason || "not fillable by current user",
        fieldType,
      };
    }
    if (typeof click !== "function" || typeof fill !== "function") {
      return {
        ok: false,
        fieldKey,
        reason: "runner primitives unavailable",
        fieldType,
      };
    }

    let input = liveDocumentFieldInput(item);
    if (!input) {
      await click(documentFieldActivationTarget(item));
      await delay(180);
      input = liveDocumentFieldInput(item);
    }
    if (!input) {
      return {
        ok: false,
        fieldKey,
        reason: "field did not reveal a fillable input after activation",
        fieldType,
      };
    }

    await fill(input, value);
    dispatchInputChange(input);
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    input.blur?.();
    await delay(120);

    return {
      ok: true,
      fieldKey,
      value,
      fieldType,
      committedValue: fieldValueFor(item) || value,
    };
  }

  async function dotloopFillDocumentFields(action, ctx) {
    const requestedFieldValues = fieldValuesFromAction(action);
    const entries = Object.entries(requestedFieldValues);
    if (!entries.length) {
      return {
        ok: false,
        detail: "dotloop_fill_document_fields requires fieldValues.",
      };
    }

    const filled = [];
    const skipped = [];
    const failed = [];
    const committedFieldValues = {};

    for (const [fieldKey, value] of entries) {
      const items = matchingDocumentFieldItems(fieldKey, document);
      if (!items.length) {
        skipped.push({
          fieldKey,
          requestedValue: value,
          reason: "matching placeholder not found",
        });
        continue;
      }

      for (const item of items) {
        const result = await fillOneDocumentFieldItem(item, fieldKey, value, ctx);
        if (result.ok) {
          filled.push(result);
          committedFieldValues[fieldKey] = result.committedValue || value;
        } else if (result.skipped) {
          skipped.push({
            fieldKey,
            requestedValue: value,
            reason: result.reason,
            fieldType: result.fieldType,
          });
        } else {
          failed.push({
            fieldKey,
            requestedValue: value,
            reason: result.reason || "fill failed",
            fieldType: result.fieldType,
          });
        }
      }
    }

    return {
      ok: filled.length > 0,
      recoverable: failed.length > 0 || skipped.length > 0,
      continueBatch: failed.length > 0,
      committed: failed.length === 0,
      fieldValues: committedFieldValues,
      filled,
      skipped,
      failed,
      detail: failed.length
        ? `Filled ${filled.length} Dotloop field(s); ${failed.length} failed and ${skipped.length} skipped.`
        : `Filled ${filled.length} Dotloop field(s); ${skipped.length} skipped.`,
    };
  }

  function booleanFromAction(value, fallback = null) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const text = lower(value);
      if (["true", "yes", "on", "1", "checked"].includes(text)) return true;
      if (["false", "no", "off", "0", "unchecked"].includes(text)) return false;
    }
    return fallback;
  }

  function addPersonModalRoot(documentRef = document) {
    const modal = findAddPersonModal(documentRef);
    return modal?.closest(".front, .modal") || modal;
  }

  function addPersonInput(root, selector) {
    const input = root?.querySelector(selector);
    if (!input || input.hasAttribute("disabled")) return null;
    return input;
  }

  function addPersonPhoneSelector() {
    return [
      "#inputPhone",
      "input[data-ac-key='phone']",
      "input[key='phone']",
      "input[name='phone']",
      "input[type='tel']",
    ].join(",");
  }

  function phoneInputForAddPerson(root) {
    return addPersonInput(root, addPersonPhoneSelector());
  }

  async function fillAddPersonInput(root, selector, value, label, fill) {
    const input = addPersonInput(root, selector);
    const normalizedValue = normalizeText(value);
    if (!input) {
      return {
        present: false,
        filled: false,
        skipped: Boolean(normalizedValue),
        label,
      };
    }
    if (!normalizedValue) {
      return { present: true, filled: false, skipped: false, label };
    }

    await fill(input, normalizedValue);
    dispatchInputChange(input);
    input.blur?.();
    await delay(80);
    return {
      present: true,
      filled: true,
      skipped: false,
      label,
      value: normalizeText(input.value) || normalizedValue,
    };
  }

  function roleOptionLabel(option) {
    return normalizeText(textContent(option.querySelector("a, button") || option));
  }

  function addPersonRoleOptions(root) {
    const roleRoot = root?.querySelector("#inputRole, .role-options") || root;
    return getElements("li[data-selected]", roleRoot)
      .map((option) => ({
        option,
        clickable:
          option.querySelector("a, button, [role='option'], [role='menuitem']") ||
          option,
        label: roleOptionLabel(option),
        value: normalizeText(option.getAttribute("data-selected")),
      }))
      .filter((option) => option.label);
  }

  function findAddPersonRoleOption(root, role) {
    const requested = lower(role);
    const options = addPersonRoleOptions(root);
    return (
      options.find((option) => lower(option.label) === requested) ||
      options.find((option) => lower(option.value) === requested) ||
      options.find((option) => lower(option.label).includes(requested)) ||
      null
    );
  }

  async function selectAddPersonRole(root, role, click) {
    const roleValue = normalizeText(role);
    const roleRoot = root?.querySelector("#inputRole, .role-options");
    const toggle = roleRoot?.querySelector(".select-toggle, [data-toggle='select']");
    if (!roleRoot || !toggle) {
      return {
        ok: false,
        reason: "role dropdown not found",
        availableRoles: addPersonRoleOptions(root).map((option) => option.label),
      };
    }

    const currentRole = normalizeText(textContent(toggle));
    if (currentRole && lower(currentRole) === lower(roleValue)) {
      return { ok: true, role: currentRole, changed: false };
    }

    await click(toggle);
    await delay(150);

    const match = findAddPersonRoleOption(root, roleValue);
    if (!match) {
      return {
        ok: false,
        reason: `role option "${roleValue}" not found`,
        availableRoles: addPersonRoleOptions(root).map((option) => option.label),
      };
    }

    await click(match.clickable);
    await delay(180);

    return {
      ok: true,
      role: normalizeText(textContent(toggle)) || match.label,
      changed: true,
      selectedValue: match.value,
    };
  }

  function checkboxClickTarget(root, checkbox) {
    const id = normalizeText(checkbox?.id);
    if (id) {
      const dataCheckbox = root.querySelector(`[data-checkbox="${cssEscape(id)}"]`);
      if (dataCheckbox) return dataCheckbox;
      const label = root.querySelector(`label[for="${cssEscape(id)}"]`);
      if (label) return label;
    }
    return checkbox?.closest("label") || checkbox;
  }

  async function setCheckboxState(root, selector, desired, click) {
    const checkbox = root?.querySelector(selector);
    if (!checkbox) {
      return {
        present: false,
        checked: false,
        changed: false,
      };
    }

    const normalizedDesired = booleanFromAction(desired, null);
    if (normalizedDesired === null) {
      return {
        present: true,
        checked: Boolean(checkbox.checked),
        changed: false,
      };
    }

    const before = Boolean(checkbox.checked);
    if (before !== normalizedDesired) {
      await click(checkboxClickTarget(root, checkbox));
      await delay(100);
      if (Boolean(checkbox.checked) !== normalizedDesired) {
        checkbox.checked = normalizedDesired;
        dispatchInputChange(checkbox);
      }
    }

    return {
      present: true,
      checked: Boolean(checkbox.checked),
      changed: before !== Boolean(checkbox.checked),
    };
  }

  function addedPersonExtractionBatch(person) {
    const label = [person.name, person.email, person.role].filter(Boolean).join(" / ");
    return {
      targetId: PEOPLE_TARGET_ID,
      items: [
        {
          id: `dotloop_added_person_${lower(person.email || person.name).replace(
            /[^a-z0-9]+/g,
            "_",
          )}`,
          targetId: `site:${ADAPTER_ID}:person:added`,
          kind: "dotloop_person",
          adapterId: ADAPTER_ID,
          preferredAction: "extract",
          label: label || "Dotloop added person",
          text: [
            "Dotloop person added through connector",
            person.name ? `name: ${person.name}` : "",
            person.email ? `email: ${person.email}` : "",
            person.phone ? `phone: ${person.phone}` : "",
            person.role ? `role: ${person.role}` : "",
          ]
            .filter(Boolean)
            .join("; "),
          name: person.name,
          email: person.email,
          phone: person.phone,
          role: person.role,
        },
      ],
    };
  }

  async function dotloopAddPerson(action, ctx) {
    const click = ctx?.primitives?.clickElement;
    const fill = ctx?.primitives?.fillElement;
    const name = normalizeText(action?.name);
    const role = normalizeText(action?.role);
    const email = normalizeText(action?.email);
    const phone = normalizeText(action?.phone);

    if (!name || !role) {
      return { ok: false, detail: "dotloop_add_person requires name and role." };
    }
    if (typeof click !== "function" || typeof fill !== "function") {
      return {
        ok: false,
        detail: "dotloop_add_person runner primitives unavailable.",
      };
    }

    const root = addPersonModalRoot(document);
    if (!root) {
      return {
        ok: false,
        recoverable: true,
        detail: "Dotloop Add Person modal is not open.",
      };
    }

    const nameResult = await fillAddPersonInput(
      root,
      "#inputName, input[data-ac-key='name'], input[key='name']",
      name,
      "name",
      fill,
    );
    const emailResult = await fillAddPersonInput(
      root,
      "#inputEmail, input[data-ac-key='emailAddress'], input[key='emailAddress']",
      email,
      "email",
      fill,
    );

    const roleResult = await selectAddPersonRole(root, role, click);
    if (!roleResult.ok) {
      return {
        ok: false,
        recoverable: true,
        continueBatch: true,
        detail: roleResult.reason || "Could not select Add Person role.",
        availableRoles: roleResult.availableRoles || [],
        nameFilled: Boolean(nameResult.filled),
        emailFilled: Boolean(emailResult.filled),
      };
    }

    const phoneInput = phoneInputForAddPerson(root);
    const phoneResult = phoneInput
      ? await fillAddPersonInput(root, addPersonPhoneSelector(), phone, "phone", fill)
      : {
          present: false,
          filled: false,
          skipped: Boolean(phone),
          label: "phone",
        };

    const sendIntroEmail =
      Object.prototype.hasOwnProperty.call(action || {}, "sendIntroEmail")
        ? booleanFromAction(action.sendIntroEmail, false)
        : null;
    const addToTeam = booleanFromAction(action?.addToTeam, false);
    const sendIntroResult = await setCheckboxState(
      root,
      "#send-email-checkbox, input[data-ac-key='sendEmail'], input[key='sendEmail'], input[name='sendEmail']",
      sendIntroEmail,
      click,
    );
    const addToTeamResult = await setCheckboxState(
      root,
      "#add-to-team-checkbox, input[data-ac-key='teamMember'], input[key='teamMember'], input[name='teamMember']",
      addToTeam,
      click,
    );

    const addButton = root.querySelector(
      "#add-person-button, .btn-add-person, .save.button-main",
    );
    if (!addButton) {
      return {
        ok: false,
        recoverable: true,
        continueBatch: true,
        detail: "Add Person submit button not found.",
        nameFilled: Boolean(nameResult.filled),
        emailFilled: Boolean(emailResult.filled),
        phoneFilled: Boolean(phoneResult.filled),
        role: roleResult.role || role,
        sendIntroEmail: sendIntroResult,
        addToTeam: addToTeamResult,
      };
    }

    await click(addButton);
    await delay(250);

    const person = {
      name,
      email,
      phone: phoneResult.present ? phone : "",
      role: roleResult.role || role,
    };
    return {
      ok: true,
      committed: true,
      person,
      nameFilled: Boolean(nameResult.filled),
      emailFilled: Boolean(emailResult.filled),
      phoneFilled: Boolean(phoneResult.filled),
      phoneSkipped: Boolean(phoneResult.skipped),
      role: person.role,
      sendIntroEmail: sendIntroResult,
      addToTeam: addToTeamResult,
      extractionBatch: addedPersonExtractionBatch(person),
      detail: `Added Dotloop person ${[name, email, person.role]
        .filter(Boolean)
        .join(" / ")}.`,
    };
  }

  if (
    globalThis.WebGPTConnectorTools &&
    typeof globalThis.WebGPTConnectorTools.register === "function"
  ) {
    globalThis.WebGPTConnectorTools.register(
      "dotloop_fill_document_fields",
      dotloopFillDocumentFields,
    );
    globalThis.WebGPTConnectorTools.register(
      "dotloop_add_person",
      dotloopAddPerson,
    );
  }

  registry.register({
    id: ADAPTER_ID,
    priority: 80,
    provideTools,

    match({ url, document: documentRef }) {
      return isDotloopPage(url, documentRef);
    },

    enhanceState({ state, document: documentRef, url }) {
      const siteAdapter = buildSiteAdapter(state, documentRef, url);
      const pageFactSummary = [
        `Dotloop page kind: ${siteAdapter.pageKind}`,
        `workflow phase: ${siteAdapter.workflowPhase}`,
        siteAdapter.loopId ? `loop id: ${siteAdapter.loopId}` : "",
        siteAdapter.documentName ? `document: ${siteAdapter.documentName}` : "",
        `${siteAdapter.detectedDocumentCount} documents detected`,
        `${siteAdapter.detectedPeopleCount} people detected`,
        `${siteAdapter.detectedFieldCount} document fields detected`,
        `${siteAdapter.detectedSourceValueCount} source values detected`,
        siteAdapter.addPersonModalOpen ? "Add Person modal open" : "",
        siteAdapter.editorBackTargetId
          ? `Editor back target: ${siteAdapter.editorBackTargetId}`
          : "",
        siteAdapter.shareTargetId ? `Share target: ${siteAdapter.shareTargetId}` : "",
        siteAdapter.shareCompleted
          ? `Dotloop share completed: ${siteAdapter.shareConfirmationText}`
          : "",
        siteAdapter.blockerText
          ? `Dotloop blocker: ${truncate(siteAdapter.blockerText, 180)}`
          : "",
      ]
        .filter(Boolean)
        .join("; ");

      return {
        ...state,
        site: {
          ...(state.site || {}),
          id: "dotloop",
          mode: siteAdapter.pageKind,
        },
        pageFacts: {
          ...(state.pageFacts || {}),
          dotloopPageKind: siteAdapter.pageKind,
          dotloopWorkflowPhase: siteAdapter.workflowPhase,
          dotloopLoopId: siteAdapter.loopId,
          dotloopDocumentId: siteAdapter.documentId,
          dotloopDocumentName: siteAdapter.documentName,
          dotloopDetectedDocumentCount: siteAdapter.detectedDocumentCount,
          dotloopDetectedFieldCount: siteAdapter.detectedFieldCount,
          dotloopDetectedSourceValueCount: siteAdapter.detectedSourceValueCount,
          dotloopAddPersonModalOpen: siteAdapter.addPersonModalOpen,
          dotloopPeopleTargetId: siteAdapter.peopleTargetId,
          dotloopSourceValuesTargetId: siteAdapter.sourceValuesTargetId,
          dotloopDocumentFieldsTargetId: siteAdapter.documentFieldsTargetId,
          dotloopShareTargetId: siteAdapter.shareTargetId,
          dotloopShareCompleted: siteAdapter.shareCompleted,
          dotloopShareConfirmationText: siteAdapter.shareConfirmationText,
          dotloopBlockerText: siteAdapter.blockerText,
        },
        siteAdapter: {
          id: siteAdapter.id,
          pageKind: siteAdapter.pageKind,
          workflowPhase: siteAdapter.workflowPhase,
          loopId: siteAdapter.loopId,
          documentId: siteAdapter.documentId,
          documentName: siteAdapter.documentName,
          detectedLoopCount: siteAdapter.detectedLoopCount,
          detectedDocumentCount: siteAdapter.detectedDocumentCount,
          detectedPeopleCount: siteAdapter.detectedPeopleCount,
          detectedFieldCount: siteAdapter.detectedFieldCount,
          detectedSourceValueCount: siteAdapter.detectedSourceValueCount,
          addPersonModalOpen: siteAdapter.addPersonModalOpen,
          peopleTargetId: siteAdapter.peopleTargetId,
          documentFieldsTargetId: siteAdapter.documentFieldsTargetId,
          sourceValuesTargetId: siteAdapter.sourceValuesTargetId,
          editorBackTargetId: siteAdapter.editorBackTargetId,
          shareTargetId: siteAdapter.shareTargetId,
          shareCompleted: siteAdapter.shareCompleted,
          shareConfirmationText: siteAdapter.shareConfirmationText,
          blockerText: siteAdapter.blockerText,
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
