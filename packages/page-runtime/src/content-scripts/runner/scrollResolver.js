(function () {
  const ns = (globalThis.WebGPTRunnerModules =
    globalThis.WebGPTRunnerModules || {});

  if (!ns.domUtils || !ns.candidates || !ns.controlScoring) {
    throw new Error(
      "runner/domUtils.js, candidates.js, and controlScoring.js must load before scrollResolver.js",
    );
  }

  const { normalizeText, lower, clampToViewport, isVisible } = ns.domUtils;
  const { promoteCandidate } = ns.candidates;
  const { scoreElementAgainstControl } = ns.controlScoring;

  function isScrollable(el) {
    if (!el || !(el instanceof Element)) return false;

    const style = window.getComputedStyle(el);
    const overflowY = lower(style.overflowY);
    const overflowX = lower(style.overflowX);
    const overflow = lower(style.overflow);

    const scrollableOverflowY =
      overflowY === "auto" ||
      overflowY === "scroll" ||
      overflowY === "overlay" ||
      overflow === "auto" ||
      overflow === "scroll" ||
      overflow === "overlay";

    const scrollableOverflowX =
      overflowX === "auto" ||
      overflowX === "scroll" ||
      overflowX === "overlay" ||
      overflow === "auto" ||
      overflow === "scroll" ||
      overflow === "overlay";

    const hasVerticalRange = el.scrollHeight > el.clientHeight + 20;
    const hasHorizontalRange = el.scrollWidth > el.clientWidth + 20;

    return (
      (scrollableOverflowY && hasVerticalRange) ||
      (scrollableOverflowX && hasHorizontalRange)
    );
  }

  function getScrollableContainerById(state, targetId) {
    return state?.scrollableContainers?.find((c) => c.id === targetId) || null;
  }

  function findScrollableAncestor(el) {
    let current = el instanceof Element ? el : null;

    while (
      current &&
      current !== document.body &&
      current !== document.documentElement
    ) {
      if (isScrollable(current)) return current;
      current = current.parentElement;
    }

    return null;
  }

  function findElementNearBounds(bounds) {
    if (!bounds) return null;

    const points = [
      clampToViewport(
        (bounds.x || 0) + Math.min((bounds.width || 0) / 2, 40),
        (bounds.y || 0) + 24,
      ),
      clampToViewport(
        (bounds.x || 0) + (bounds.width || 0) / 2,
        (bounds.y || 0) + Math.min((bounds.height || 0) / 2, 120),
      ),
      clampToViewport(
        (bounds.x || 0) + Math.max((bounds.width || 0) - 24, 1),
        (bounds.y || 0) + 24,
      ),
    ];

    for (const point of points) {
      const el = document.elementFromPoint(point.x, point.y);
      if (el) return el;
    }

    return null;
  }

  function scoreScrollCandidate(el, meta = {}, goal = "") {
    if (!el || !(el instanceof Element)) return -Infinity;
    if (!isVisible(el)) return -Infinity;
    if (!isScrollable(el)) return -Infinity;

    let score = 0;
    const rect = el.getBoundingClientRect();
    const text = lower(meta.text || meta.label || "");
    const heading = lower(meta.heading || "");
    const nearby = lower(meta.nearbyText || "");
    const aria = lower(meta.ariaLabel || "");
    const title = lower(meta.title || "");
    const g = lower(goal || "");
    const className = lower(el.className || "");

    if (rect.height >= 250) score += 15;
    if (rect.width >= 220 && rect.width <= 520) score += 15;
    if (rect.top <= window.innerHeight && rect.bottom >= 0) score += 10;

    if (text.includes("rental")) score += 12;
    if (text.includes("listing")) score += 12;
    if (text.includes("available")) score += 12;
    if (text.includes("check availability")) score += 10;

    if (heading.includes("listing") || nearby.includes("listing")) score += 8;
    if (aria.includes("results") || title.includes("results")) score += 8;

    if (g.includes("sidebar")) score += 10;
    if (g.includes("listing")) score += 6;
    if (g.includes("results")) score += 6;

    if (className.includes("list")) score += 10;
    if (className.includes("sidebar")) score += 10;
    if (className.includes("results")) score += 8;
    if (className.includes("panel")) score += 6;

    return score;
  }

  function getFrameState(state, frameId) {
    if (state?.frames && typeof state.frames === "object") {
      return state.frames[String(frameId ?? 0)] || null;
    }
    return state || null;
  }

  function findBestScrollContainer(state, action) {
    const frame = getFrameState(state, action?.frameId);
    if (!frame) return null;

    const goal = state?.goal || "";
    const sources = []
      .concat(
        Array.isArray(frame.scrollableContainers)
          ? frame.scrollableContainers
          : [],
      )
      .concat(Array.isArray(frame.groups) ? frame.groups : [])
      .concat(Array.isArray(frame.overlays) ? frame.overlays : []);

    let best = null;

    for (const item of sources) {
      const seed = findElementNearBounds(item.bounds);
      if (!seed) continue;

      const candidate =
        (isScrollable(seed) ? seed : null) ||
        findScrollableAncestor(seed) ||
        findScrollableAncestor(promoteCandidate(seed));

      if (!candidate) continue;

      const score = scoreScrollCandidate(candidate, item, goal);
      if (!best || score > best.score) {
        best = { el: candidate, score };
      }
    }

    return best?.el || null;
  }

  function findScrollableByStableSelector(container) {
    const selector = normalizeText(container?.selector);
    if (!selector) return null;

    try {
      const matches = Array.from(document.querySelectorAll(selector))
        .map((el) => promoteCandidate(el) || el)
        .filter(Boolean)
        .filter((el, index, arr) => arr.indexOf(el) === index)
        .map((el) => (isScrollable(el) ? el : findScrollableAncestor(el)))
        .filter(Boolean)
        .filter((el, index, arr) => arr.indexOf(el) === index)
        .filter((el) => isVisible(el) && isScrollable(el));

      if (!matches.length) return null;

      let best = null;
      for (const el of matches) {
        const score = scoreScrollableElementAgainstContainer(el, container);
        if (score === -Infinity) continue;
        if (!best || score > best.score) best = { el, score };
      }

      return best;
    } catch {
      return null;
    }
  }

  function scoreScrollableElementAgainstContainer(el, container) {
    if (!el || !(el instanceof Element)) return -Infinity;
    if (!isVisible(el) || !isScrollable(el)) return -Infinity;

    // Reuse control scoring because extracted scrollableContainers are intentionally
    // shaped similarly to controls on the semantic side.
    return scoreElementAgainstControl(el, container, "scroll");
  }

  function findScrollableBySemanticMatch(container) {
    const selector = [
      "div",
      "section",
      "article",
      "main",
      "aside",
      "nav",
      "ul",
      "ol",
      "dl",
      "table",
      "tbody",
      '[role="region"]',
      '[role="group"]',
      '[role="list"]',
      '[role="listbox"]',
      '[role="menu"]',
      '[role="grid"]',
      '[role="tree"]',
      '[role="tabpanel"]',
      '[role="dialog"]',
      '[role="radiogroup"]',
    ].join(",");

    const candidates = Array.from(document.querySelectorAll(selector)).filter(
      (el) => isVisible(el) && isScrollable(el),
    );

    let best = null;

    for (const el of candidates) {
      const score = scoreScrollableElementAgainstContainer(el, container);
      if (score === -Infinity) continue;

      if (!best || score > best.score) {
        best = { el, score };
      }
    }

    if (!best || best.score < 35) return null;
    return best;
  }

  function findScrollableByRecordedBounds(container) {
    if (!container?.bounds) return null;

    const seed = findElementNearBounds(container.bounds);
    if (!seed) return null;

    const candidates = [
      seed,
      promoteCandidate(seed),
      findScrollableAncestor(seed),
      promoteCandidate(seed)
        ? findScrollableAncestor(promoteCandidate(seed))
        : null,
      isScrollable(seed) ? seed : null,
    ].filter(Boolean);

    let best = null;

    for (const candidate of candidates) {
      if (!isVisible(candidate) || !isScrollable(candidate)) continue;

      const score = scoreScrollableElementAgainstContainer(
        candidate,
        container,
      );
      if (score === -Infinity) continue;

      if (!best || score > best.score) {
        best = { el: candidate, score };
      }
    }

    return best;
  }

  function findScrollableByFallbackSelector(container) {
    const selector = normalizeText(container?.selector);
    if (!selector) return null;

    try {
      const matches = Array.from(document.querySelectorAll(selector))
        .map((el) => (isScrollable(el) ? el : findScrollableAncestor(el)))
        .filter(Boolean)
        .filter((el, index, arr) => arr.indexOf(el) === index)
        .filter((el) => isVisible(el) && isScrollable(el));

      if (!matches.length) return null;

      let best = null;
      for (const el of matches) {
        const score = scoreScrollableElementAgainstContainer(el, container);
        if (score === -Infinity) continue;
        if (!best || score > best.score) best = { el, score };
      }

      return best;
    } catch {
      return null;
    }
  }

  function resolveScrollableContainer(container) {
    if (!container) {
      throw new Error("Missing scrollable container.");
    }

    const strategiesTried = [];

    const byStableSelector = findScrollableByStableSelector(container);
    strategiesTried.push(
      container.selector
        ? `stable-selector:${container.selector}`
        : "stable-selector:skipped",
    );
    if (byStableSelector) {
      return {
        el: byStableSelector.el,
        strategyUsed: `stable-selector:${container.selector}:score:${byStableSelector.score}`,
        strategiesTried,
      };
    }

    const semantic = findScrollableBySemanticMatch(container);
    strategiesTried.push("semantic-score");
    if (semantic) {
      return {
        el: semantic.el,
        strategyUsed: `semantic-score:${semantic.score}`,
        strategiesTried,
      };
    }

    const byBounds = findScrollableByRecordedBounds(container);
    strategiesTried.push("recorded-bounds");
    if (byBounds) {
      return {
        el: byBounds.el,
        strategyUsed: `recorded-bounds:score:${byBounds.score}`,
        strategiesTried,
      };
    }

    const fallback = findScrollableByFallbackSelector(container);
    strategiesTried.push(
      container.selector
        ? `brittle-selector:${container.selector}`
        : "brittle-selector:skipped",
    );
    if (fallback) {
      return {
        el: fallback.el,
        strategyUsed: `brittle-selector:${container.selector}:score:${fallback.score}`,
        strategiesTried,
      };
    }

    throw new Error(
      `Unable to locate scrollable container ${container.id}. Tried: ${strategiesTried.join(" | ")}`,
    );
  }

  ns.scrollResolver = {
    isScrollable,
    getScrollableContainerById,
    findScrollableAncestor,
    findElementNearBounds,
    scoreScrollCandidate,
    getFrameState,
    findBestScrollContainer,
    scoreScrollableElementAgainstContainer,
    findScrollableByStableSelector,
    findScrollableBySemanticMatch,
    findScrollableByRecordedBounds,
    findScrollableByFallbackSelector,
    resolveScrollableContainer,
  };
})();
