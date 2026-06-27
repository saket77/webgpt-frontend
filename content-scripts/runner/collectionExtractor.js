(function () {
  const ns = (globalThis.WebGPTRunnerModules =
    globalThis.WebGPTRunnerModules || {});

  if (
    !ns.domUtils ||
    !ns.scrollResolver ||
    !ns.elementSnapshot ||
    !ns.resolver
  ) {
    throw new Error(
      "runner/domUtils.js, scrollResolver.js, elementSnapshot.js, and resolver.js must load before collectionExtractor.js",
    );
  }

  const { normalizeText, lower, textOf } = ns.domUtils;
  const { getScrollableContainerById, resolveScrollableContainer } =
    ns.scrollResolver;
  const { getControlById, resolveElement } = ns.resolver;
  const { labelTextForElement, nearbyHeadingForElement, nearbyTextForElement } =
    ns.elementSnapshot;

  function elementHref(el) {
    if (!el || !(el instanceof Element)) return "";

    if (lower(el.tagName) === "a") {
      return normalizeText(el.getAttribute("href"));
    }

    const link = el.querySelector("a[href]");
    return normalizeText(link?.getAttribute("href"));
  }

  function getRect(el) {
    return (
      el?.getBoundingClientRect?.() || {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      }
    );
  }

  function itemKeyFor(item) {
    return [
      lower(item.label),
      lower(item.text).slice(0, 500),
      lower(item.href),
    ].join("|");
  }

  function buildExtractedItem(el) {
    const rect = getRect(el);

    const text = (normalizeText(textOf(el)) || "").slice(0, 6000);
    const label = (normalizeText(labelTextForElement(el)) || "").slice(0, 500);
    const heading = (normalizeText(nearbyHeadingForElement(el)) || "").slice(
      0,
      300,
    );
    const nearbyText = (normalizeText(nearbyTextForElement(el)) || "").slice(
      0,
      1000,
    );
    const href = elementHref(el);

    const item = {
      key: "",
      text,
      label,
      nearbyText,
      heading,
      href,
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };

    item.key = itemKeyFor(item);
    return item;
  }

  function normalizeId(value) {
    return normalizeText(value);
  }

  function unique(values) {
    const seen = new Set();
    const result = [];

    for (const value of values || []) {
      const normalized = normalizeText(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      result.push(normalized);
    }

    return result;
  }

  function getActionTargetIds(action) {
    return unique(
      [
        action?.targetId,
        ...(Array.isArray(action?.controlIds) ? action.controlIds : []),
      ].filter(Boolean),
    );
  }

  function getGroupTargetIds(group) {
    const nestedControlIds = Array.isArray(group?.controls)
      ? group.controls.map((control) => control?.targetId)
      : [];

    return unique([
      group?.targetId,
      group?.collectionTargetId,
      group?.resultContainerTargetId,
      group?.resultsTargetId,
      group?.listTargetId,
      group?.cardTargetId,
      group?.profileTargetId,
      group?.websiteTargetId,
      ...(Array.isArray(group?.controlIds) ? group.controlIds : []),
      ...nestedControlIds,
    ]);
  }

  function groupMatchesTargetIds(group, targetIds) {
    if (!targetIds.length) return false;

    const groupIds = new Set([group?.id, ...getGroupTargetIds(group)].map(normalizeId));
    return targetIds.some((id) => groupIds.has(normalizeId(id)));
  }

  function isPrimitiveFact(value) {
    if (value === null || value === undefined || value === "") return false;
    return (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    );
  }

  function isPrimitiveListFact(value) {
    return Array.isArray(value) && value.some(isPrimitiveFact);
  }

  function isRecordLikeAdapterGroup(group) {
    if (!group || typeof group !== "object") return false;
    if (!normalizeText(group.adapterId) || !normalizeText(group.kind)) return false;
    if (!normalizeText(group.text)) return false;

    const metadataKeys = new Set([
      "id",
      "kind",
      "adapterId",
      "targetId",
      "preferredAction",
      "label",
      "text",
      "controlIds",
      "controls",
      "bounds",
      "cardTargetId",
      "profileTargetId",
      "websiteTargetId",
    ]);

    return Object.entries(group).some(
      ([key, value]) =>
        !metadataKeys.has(key) &&
        (isPrimitiveFact(value) || isPrimitiveListFact(value)),
    );
  }

  function isResultGroup(group) {
    const kind = lower(group?.kind);
    const id = lower(group?.id);
    return (
      isRecordLikeAdapterGroup(group) &&
      (kind.includes("result") ||
        id.includes("result") ||
        Number.isFinite(Number(group?.position)) ||
        Boolean(group?.profileTargetId || group?.cardTargetId))
    );
  }

  function isPrimaryRecordGroup(group, state) {
    if (!isRecordLikeAdapterGroup(group)) return false;

    const kind = lower(group?.kind);
    const id = lower(group?.id);
    const pageKind = lower(state?.siteAdapter?.pageKind || state?.site?.mode);
    const isSection = kind.includes("section") || id.includes("section");

    if (isSection) return false;
    if (kind.includes("detail") || id.includes("detail")) return true;
    if (pageKind.includes("detail") && !isResultGroup(group)) return true;

    return false;
  }

  function isScrollableExtraction(targets) {
    return (targets || []).some(
      (target) =>
        target?.kind === "scrollable-container" ||
        Boolean(target?.scrollableContainerSnapshot),
    );
  }

  function stringifyFactValue(value) {
    if (Array.isArray(value)) {
      return value.map(stringifyFactValue).filter(Boolean).join(", ");
    }

    if (value === null || value === undefined) return "";
    if (typeof value === "object") return "";
    return normalizeText(value);
  }

  function groupFactText(group) {
    const baseText = normalizeText(group?.text);
    const baseTextLower = lower(baseText);
    const facts = [
      group?.businessName,
      group?.rating ? `${group.rating} stars` : "",
      group?.reviewCount ? `${group.reviewCount} reviews` : "",
      group?.categories,
      group?.fullAddress,
      group?.area,
      group?.phone,
      group?.websiteUrl || group?.websiteText,
      group?.yelpUrl,
      group?.openStatusText,
      group?.snippet,
    ]
      .map(stringifyFactValue)
      .filter((fact) => fact && !baseTextLower.includes(lower(fact)))
      .filter(Boolean);

    return normalizeText([baseText, ...facts].filter(Boolean).join("; "));
  }

  function stateGroupEntityKey(group, state = {}) {
    return normalizeText(
      group?.yelpUrl ||
        group?.websiteUrl ||
        group?.businessName ||
        group?.fullAddress ||
        group?.phone ||
        state?.url ||
        group?.sectionLabel ||
        "",
    );
  }

  function buildStateExtractedItem(group, action = {}, state = {}) {
    const text = groupFactText(group).slice(0, 6000);
    const label = normalizeText(group?.label || group?.kind).slice(0, 500);
    const heading = normalizeText(group?.businessName || group?.sectionLabel || label).slice(
      0,
      300,
    );
    const nearbyText = normalizeText(group?.snippet || group?.area || group?.sectionLabel).slice(
      0,
      1000,
    );
    const href = normalizeText(group?.yelpUrl || group?.websiteUrl || "");
    const bounds =
      group?.bounds && typeof group.bounds === "object"
        ? {
            x: Math.round(Number(group.bounds.x || 0)),
            y: Math.round(Number(group.bounds.y || 0)),
            width: Math.round(Number(group.bounds.width || 0)),
            height: Math.round(Number(group.bounds.height || 0)),
          }
        : {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
          };

    const item = {
      key: [
        "site-adapter",
        normalizeText(group?.adapterId),
        normalizeText(group?.targetId || group?.id || group?.kind),
        stateGroupEntityKey(group, state),
      ]
        .filter(Boolean)
        .join("|"),
      text,
      label,
      nearbyText,
      heading,
      href,
      bounds,
      context: {
        source: "site_adapter",
        adapterId: normalizeText(group?.adapterId),
        groupId: normalizeText(group?.id),
        groupKind: normalizeText(group?.kind),
        targetId: normalizeText(action?.targetId),
      },
    };

    if (!item.key) item.key = itemKeyFor(item);
    return item;
  }

  function getAdapterRecordGroups(state) {
    return (Array.isArray(state?.groups) ? state.groups : []).filter(
      isRecordLikeAdapterGroup,
    );
  }

  function extractItemsFromState(state, action = {}, targets = []) {
    const groups = getAdapterRecordGroups(state);
    if (!groups.length) return [];

    const targetIds = getActionTargetIds(action);
    const exactMatches = groups.filter((group) =>
      groupMatchesTargetIds(group, targetIds),
    );
    if (exactMatches.length) {
      return exactMatches.map((group) => buildStateExtractedItem(group, action, state));
    }

    if (isScrollableExtraction(targets)) {
      const resultGroups = groups.filter(isResultGroup);
      if (resultGroups.length) {
        return resultGroups.map((group) => buildStateExtractedItem(group, action, state));
      }
    }

    const primaryGroups = groups.filter((group) =>
      isPrimaryRecordGroup(group, state),
    );
    if (primaryGroups.length === 1) {
      return primaryGroups.map((group) => buildStateExtractedItem(group, action, state));
    }

    return [];
  }

  function extractItemsFromDom(targets) {
    return (targets || []).map((target) => buildExtractedItem(target.el));
  }

  function dedupeItems(items) {
    const seen = new Set();
    const result = [];

    for (const item of items) {
      const key = normalizeText(item?.key);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }

    return result;
  }

  function resolveExtractTarget(state, id) {
    if (!id) return null;

    if (String(id).startsWith("sc_")) {
      const container = getScrollableContainerById(state, id);
      if (!container) return null;

      const resolved = resolveScrollableContainer(container);
      if (!resolved?.el) return null;

      return {
        id,
        kind: "scrollable-container",
        el: resolved.el,
        controlSnapshot: null,
        scrollableContainerSnapshot: container,
        strategyUsed: resolved.strategyUsed || "explicit-scrollable-container",
        strategiesTried: resolved.strategiesTried || [
          "explicit-scrollable-container",
        ],
      };
    }

    const control = getControlById(state, id);
    if (!control) return null;

    const resolved = resolveElement(control, "extract");
    if (!resolved?.el) return null;

    return {
      id,
      kind: "control",
      el: resolved.el,
      controlSnapshot: control,
      scrollableContainerSnapshot: null,
      strategyUsed: resolved.strategyUsed || "resolved-control",
      strategiesTried: resolved.strategiesTried || ["resolved-control"],
    };
  }

  function getExtractTargets(state, action) {
    const ids =
      Array.isArray(action?.controlIds) && action.controlIds.length
        ? action.controlIds
        : action?.targetId
          ? [action.targetId]
          : [];

    const targets = [];

    for (const id of ids) {
      try {
        const resolved = resolveExtractTarget(state, id);
        if (resolved?.el) {
          targets.push(resolved);
        }
      } catch {
        // ignore bad target ids
      }
    }

    return targets;
  }

  function extractCollectionItemsFromResolvedTargets(targets, action = {}) {
    const items = dedupeItems(extractItemsFromDom(targets));
    const context =
      action?.context && typeof action.context === "object"
        ? { ...action.context }
        : null;

    const firstScrollableTarget =
      (targets || []).find((target) => target.scrollableContainerSnapshot) ||
      null;

    return {
      frameId: Number.isInteger(action?.frameId) ? action.frameId : 0,
      targetId: action?.targetId || "",
      context,
      extractedCount: items.length,
      items,
      strategyUsed: targets?.[0]?.strategyUsed || "extract-targets",
      strategiesTried: (targets || []).flatMap(
        (target) => target.strategiesTried || [],
      ),
      controlSnapshots: (targets || [])
        .map((target) => target.controlSnapshot)
        .filter(Boolean),
      scrollableContainerSnapshot:
        firstScrollableTarget?.scrollableContainerSnapshot || null,
    };
  }

  function extractCollectionItems(state, action) {
    const targets = getExtractTargets(state, action);
    const stateItems = extractItemsFromState(state, action, targets);
    const domItems = extractItemsFromDom(targets);
    const items = dedupeItems([...stateItems, ...domItems]);
    const context =
      action?.context && typeof action.context === "object"
        ? { ...action.context }
        : null;

    const firstScrollableTarget =
      (targets || []).find((target) => target.scrollableContainerSnapshot) ||
      null;

    return {
      frameId: Number.isInteger(action?.frameId) ? action.frameId : 0,
      targetId: action?.targetId || "",
      context,
      extractedCount: items.length,
      items,
      strategyUsed:
        stateItems.length > 0
          ? "state-then-extract-targets"
          : targets?.[0]?.strategyUsed || "extract-targets",
      strategiesTried: [
        ...(stateItems.length > 0 ? ["state-groups"] : []),
        ...(targets || []).flatMap((target) => target.strategiesTried || []),
      ],
      controlSnapshots: (targets || [])
        .map((target) => target.controlSnapshot)
        .filter(Boolean),
      scrollableContainerSnapshot:
        firstScrollableTarget?.scrollableContainerSnapshot || null,
    };
  }

  ns.collectionExtractor = {
    buildExtractedItem,
    dedupeItems,
    resolveExtractTarget,
    getExtractTargets,
    extractCollectionItemsFromResolvedTargets,
    extractCollectionItems,
  };
})();
