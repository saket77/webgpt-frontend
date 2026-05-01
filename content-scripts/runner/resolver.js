(function () {
  const ns = window.WebGPTRunnerModules;
  const { normalizeText, isVisible, isEnabled, isEditable } = ns.domUtils;
  const { candidateClosestSelector, candidateElements, promoteCandidate } =
    ns.candidates;
  const { scoreElementAgainstControl } = ns.controlScoring;

  function isLikelyBrittleSelector(selector) {
    const s = normalizeText(selector);

    if (!s) return true;
    if (s.includes(":nth-of-type(")) return true;
    if (/#.*\d{4,}/.test(s)) return true;

    const genericSelectors = new Set([
      "button",
      "a",
      "input",
      "textarea",
      "select",
      "div",
      "li",
      "span",
      "section",
      "article",
      "tr",
      "td",
      "label",
      "figure",
      "picture",
      '[role="button"]',
      '[role="link"]',
      '[role="textbox"]',
      '[role="combobox"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="listitem"]',
      '[role="gridcell"]',
      '[role="row"]',
      '[role="treeitem"]',
      '[role="switch"]',
      '[role="group"]',
      '[role="radiogroup"]',
      '[role="listbox"]',
      '[role="menu"]',
      '[role="tabpanel"]',
    ]);

    return genericSelectors.has(s);
  }

  function getControlById(state, targetId) {
    return state?.controls?.find((c) => c.id === targetId) || null;
  }

  function bestSemanticMatch(control, actionType) {
    const candidates = candidateElements();
    let best = null;

    for (const el of candidates) {
      const score = scoreElementAgainstControl(el, control, actionType);
      if (score === -Infinity) continue;

      if (!best || score > best.score) {
        best = { el, score };
      }
    }

    if (!best || best.score < 35) return null;
    return best;
  }

  function findByStableSelector(control, actionType) {
    const selector = normalizeText(control?.selector);
    if (!selector || isLikelyBrittleSelector(selector)) return null;

    try {
      const matches = Array.from(document.querySelectorAll(selector))
        .map((el) => promoteCandidate(el))
        .filter(Boolean)
        .filter((el, index, arr) => arr.indexOf(el) === index)
        .filter((el) => {
          if (!isVisible(el)) return false;
          if (actionType !== "scroll" && !isEnabled(el)) return false;
          if (actionType === "fill" && !isEditable(el)) return false;
          return true;
        });

      if (!matches.length) return null;

      let best = null;
      for (const el of matches) {
        const score = scoreElementAgainstControl(el, control, actionType);
        if (score === -Infinity) continue;
        if (!best || score > best.score) best = { el, score };
      }

      return best;
    } catch {
      return null;
    }
  }

  function findByRecordedBounds(control, actionType) {
    if (!control?.bounds) return null;

    const x = Math.round(
      (control.bounds.x || 0) + (control.bounds.width || 0) / 2,
    );
    const y = Math.round(
      (control.bounds.y || 0) + (control.bounds.height || 0) / 2,
    );

    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      return null;
    }

    const el = document.elementFromPoint(x, y);
    if (!el) return null;

    const candidates = [
      el,
      promoteCandidate(el),
      el.closest(candidateClosestSelector()),
    ].filter(Boolean);

    let best = null;

    for (const candidate of candidates) {
      if (!isVisible(candidate)) continue;
      if (actionType !== "scroll" && !isEnabled(candidate)) continue;
      if (actionType === "fill" && !isEditable(candidate)) continue;

      const score = scoreElementAgainstControl(candidate, control, actionType);
      if (score === -Infinity) continue;
      if (!best || score > best.score) best = { el: candidate, score };
    }

    return best;
  }

  function findByFallbackSelector(control, actionType) {
    const selector = normalizeText(control?.selector);
    if (!selector) return null;

    try {
      const matches = Array.from(document.querySelectorAll(selector))
        .map((el) => promoteCandidate(el))
        .filter(Boolean)
        .filter((el, index, arr) => arr.indexOf(el) === index)
        .filter((el) => {
          if (!isVisible(el)) return false;
          if (actionType !== "scroll" && !isEnabled(el)) return false;
          if (actionType === "fill" && !isEditable(el)) return false;
          return true;
        });

      if (!matches.length) return null;

      let best = null;
      for (const el of matches) {
        const score = scoreElementAgainstControl(el, control, actionType);
        if (score === -Infinity) continue;
        if (!best || score > best.score) best = { el, score };
      }

      return best;
    } catch {
      return null;
    }
  }

  function resolveElement(control, actionType = "click") {
    if (!control) {
      throw new Error("Missing control.");
    }

    const strategiesTried = [];

    const byStableSelector = findByStableSelector(control, actionType);
    strategiesTried.push(
      control.selector && !isLikelyBrittleSelector(control.selector)
        ? `stable-selector:${control.selector}`
        : "stable-selector:skipped",
    );
    if (byStableSelector) {
      return {
        el: byStableSelector.el,
        strategyUsed: `stable-selector:${control.selector}:score:${byStableSelector.score}`,
        strategiesTried,
      };
    }

    const semantic = bestSemanticMatch(control, actionType);
    strategiesTried.push("semantic-score");
    if (semantic) {
      return {
        el: semantic.el,
        strategyUsed: `semantic-score:${semantic.score}`,
        strategiesTried,
      };
    }

    const byBounds = findByRecordedBounds(control, actionType);
    strategiesTried.push("recorded-bounds");
    if (byBounds) {
      return {
        el: byBounds.el,
        strategyUsed: `recorded-bounds:score:${byBounds.score}`,
        strategiesTried,
      };
    }

    const fallback = findByFallbackSelector(control, actionType);
    strategiesTried.push(
      control.selector
        ? `brittle-selector:${control.selector}`
        : "brittle-selector:skipped",
    );
    if (fallback) {
      return {
        el: fallback.el,
        strategyUsed: `brittle-selector:${control.selector}:score:${fallback.score}`,
        strategiesTried,
      };
    }

    throw new Error(
      `Unable to locate control ${control.id}. Tried: ${strategiesTried.join(" | ")}`,
    );
  }

  ns.resolver = {
    isLikelyBrittleSelector,
    getControlById,
    bestSemanticMatch,
    findByStableSelector,
    findByRecordedBounds,
    findByFallbackSelector,
    resolveElement,
  };
})();
