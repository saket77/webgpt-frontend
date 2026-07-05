(function () {
  const ns = window.WebGPTRunnerModules;
  const { lower, isVisible, isEnabled, isEditable } = ns.domUtils;
  const { getElementSnapshot, roleFromControl } = ns.elementSnapshot;

  function scoreTextMatch(actual, expected) {
    const a = lower(actual);
    const e = lower(expected);

    if (!a || !e) return 0;
    if (a === e) return 100;
    if (a.startsWith(e)) return 70;
    if (e.startsWith(a) && a.length >= 3) return 55;
    if (a.includes(e)) return 50;
    if (e.includes(a) && a.length >= 3) return 35;
    return 0;
  }

  function scoreRoleMatch(actual, expected) {
    if (!actual || !expected) return 0;
    return lower(actual) === lower(expected) ? 30 : 0;
  }

  function scoreTagMatch(actual, expected) {
    if (!actual || !expected) return 0;
    return lower(actual) === lower(expected) ? 15 : 0;
  }

  function scoreTypeMatch(actual, expected) {
    if (!actual || !expected) return 0;
    return lower(actual) === lower(expected) ? 12 : 0;
  }

  function scoreContainerKindMatch(actual, expected) {
    if (!actual || !expected) return 0;
    return lower(actual) === lower(expected) ? 18 : 0;
  }

  function scoreBooleanMatch(actual, expected) {
    if (typeof actual !== "boolean" || typeof expected !== "boolean") return 0;
    return actual === expected ? 8 : 0;
  }

  function scoreBoundsProximity(el, control) {
    if (!control?.bounds) return 0;
    const rect = el.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;

    const tcx = (control.bounds.x || 0) + (control.bounds.width || 0) / 2;
    const tcy = (control.bounds.y || 0) + (control.bounds.height || 0) / 2;

    const dx = Math.abs(cx - tcx);
    const dy = Math.abs(cy - tcy);
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 20) return 25;
    if (distance < 60) return 15;
    if (distance < 120) return 8;
    return 0;
  }

  function scoreDataAttrsMatch(actualDataAttrs, expectedDataAttrs) {
    const actual = actualDataAttrs || {};
    const expected = expectedDataAttrs || {};
    let score = 0;

    const keys = [
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

    for (const key of keys) {
      if (!actual[key] || !expected[key]) continue;

      if (lower(actual[key]) === lower(expected[key])) {
        score += key.includes("product") || key.includes("id") ? 60 : 35;
      } else if (lower(actual[key]).includes(lower(expected[key]))) {
        score += 15;
      }
    }

    return score;
  }

  function scoreElementAgainstControl(el, control, actionType) {
    if (!isVisible(el)) return -Infinity;
    if (actionType !== "scroll" && !isEnabled(el)) return -Infinity;
    if (actionType === "fill" && !isEditable(el)) return -Infinity;

    const snap = getElementSnapshot(el);
    let score = 0;

    score += scoreRoleMatch(snap.role, roleFromControl(control));
    score += scoreTagMatch(snap.tag, control.tag);
    score += scoreTypeMatch(snap.type, control.type);

    score += scoreTextMatch(snap.label, control.label) * 1.4;
    score += scoreTextMatch(snap.ariaLabel, control.ariaLabel) * 1.25;
    score += scoreTextMatch(snap.placeholder, control.placeholder) * 1.2;
    score += scoreTextMatch(snap.name, control.name) * 1.0;
    score += scoreTextMatch(snap.text, control.text) * 1.1;
    score += scoreTextMatch(snap.title, control.title) * 0.9;
    score += scoreTextMatch(snap.heading, control.heading) * 0.6;
    score += scoreTextMatch(snap.nearbyText, control.nearbyText) * 0.2;

    score += scoreDataAttrsMatch(snap.dataAttrs, control.dataAttrs);
    score += scoreContainerKindMatch(snap.containerKind, control.containerKind);
    score += scoreBooleanMatch(snap.hasMedia, control.hasMedia);

    if (control.promoted && snap.hasMedia && snap.label) {
      score += 10;
    }

    score += scoreBoundsProximity(el, control);

    return score;
  }

  ns.controlScoring = {
    scoreTextMatch,
    scoreRoleMatch,
    scoreTagMatch,
    scoreTypeMatch,
    scoreContainerKindMatch,
    scoreBooleanMatch,
    scoreBoundsProximity,
    scoreDataAttrsMatch,
    scoreElementAgainstControl,
  };
})();
