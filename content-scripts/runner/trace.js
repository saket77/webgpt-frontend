(function () {
  const ns = (globalThis.WebGPTRunnerModules =
    globalThis.WebGPTRunnerModules || {});

  function buildReplayTarget(kind, snapshot) {
    if (!kind || !snapshot) return null;

    return {
      kind,
      snapshot,
    };
  }

  function buildResolvedControlTrace(
    actionType,
    action,
    control,
    resolved,
    replayTarget = null,
  ) {
    return {
      actionType,
      targetId: action.targetId,
      strategyUsed: resolved.strategyUsed,
      strategiesTried: resolved.strategiesTried,
      controlSnapshot: control,
      replayTarget:
        replayTarget || buildReplayTarget("control", control) || null,
    };
  }

  function buildScrollTrace({
    action,
    scrollableContainer = null,
    control = null,
    resolved = null,
    targetEl = null,
    source = "",
    replayTarget = null,
  }) {
    const base = {
      actionType: "scroll",
      targetId: action.targetId || "",
      strategyUsed: resolved?.strategyUsed || source || "",
      strategiesTried: resolved?.strategiesTried || [],
      controlSnapshot: control || null,
      scrollableContainerSnapshot: scrollableContainer || null,
      scrollTargetSource: source || "",
      replayTarget:
        replayTarget ||
        (scrollableContainer
          ? buildReplayTarget("scrollable-container", scrollableContainer)
          : control
            ? buildReplayTarget("control", control)
            : null),
    };

    if (scrollableContainer) {
      return {
        ...base,
        strategyUsed: resolved?.strategyUsed || "explicit-scrollable-container",
        strategiesTried: resolved?.strategiesTried || [
          "explicit-scrollable-container",
        ],
      };
    }

    if (control) {
      return {
        ...base,
        strategyUsed: resolved?.strategyUsed || "control-scroll-ancestor",
        strategiesTried: resolved?.strategiesTried || [
          "control-scroll-ancestor",
        ],
      };
    }

    if (targetEl) {
      return {
        ...base,
        strategyUsed: source || "inferred-scroll-container",
        strategiesTried: [
          source || "inferred-scroll-container",
          "window-scroll-fallback",
        ],
      };
    }

    return {
      ...base,
      strategyUsed: source || "window-scroll-fallback",
      strategiesTried: ["window-scroll-fallback"],
    };
  }

  function buildExtractTrace({ action, extractionBatch }) {
    const controlSnapshots = Array.isArray(extractionBatch?.controlSnapshots)
      ? extractionBatch.controlSnapshots.filter(Boolean)
      : [];
    const scrollableContainerSnapshot =
      extractionBatch?.scrollableContainerSnapshot || null;

    return {
      actionType: "extract",
      frameId: Number.isInteger(action?.frameId) ? action.frameId : 0,
      targetId: action?.targetId || "",
      context:
        action?.context && typeof action.context === "object"
          ? { ...action.context }
          : null,
      controlIds: Array.isArray(action?.controlIds) ? [...action.controlIds] : [],
      strategyUsed:
        extractionBatch?.strategyUsed || "scrollable-container-visible-items",
      strategiesTried: extractionBatch?.strategiesTried || [
        "scrollable-container-visible-items",
      ],
      controlSnapshot: controlSnapshots[0] || null,
      controlSnapshots,
      scrollableContainerSnapshot,
      extractedCount: Number(extractionBatch?.extractedCount || 0),
      replayTarget:
        controlSnapshots.length || scrollableContainerSnapshot
          ? buildReplayTarget("extract-targets", {
              frameId: Number.isInteger(action?.frameId) ? action.frameId : 0,
              targetId: action?.targetId || "",
              context:
                action?.context && typeof action.context === "object"
                  ? { ...action.context }
                  : null,
              controlSnapshots,
              scrollableContainerSnapshot,
            })
          : null,
    };
  }

  function buildGotoTrace({ action }) {
    return {
      actionType: "goto",
      targetId: action?.targetId || "",
      url: String(action?.url || ""),
      strategyUsed: "direct-navigation",
      strategiesTried: ["direct-navigation"],
      controlSnapshot: null,
      replayTarget: action?.url
        ? buildReplayTarget("goto", {
            url: String(action.url),
          })
        : null,
    };
  }

  ns.trace = {
    buildReplayTarget,
    buildResolvedControlTrace,
    buildScrollTrace,
    buildExtractTrace,
    buildGotoTrace,
  };
})();
