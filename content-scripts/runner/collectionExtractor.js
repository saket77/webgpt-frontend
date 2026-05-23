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
    const items = dedupeItems(
      (targets || []).map((target) => buildExtractedItem(target.el)),
    );
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
    return extractCollectionItemsFromResolvedTargets(targets, action);
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
