(function () {
  const ns = (globalThis.WebGPTRunnerModules =
    globalThis.WebGPTRunnerModules || {});

  if (
    !ns.actions ||
    !ns.resolver ||
    !ns.scrollResolver ||
    !ns.primitives ||
    !ns.collectionExtractor
  ) {
    throw new Error(
      "actions.js, resolver.js, scrollResolver.js, primitives.js, and collectionExtractor.js must load before replayRunner.js",
    );
  }

  const { resolveElement } = ns.resolver;
  const { resolveScrollableContainer, findScrollableAncestor, isScrollable } =
    ns.scrollResolver;
  const { clickElement, fillElement, pressKeyOnElement } = ns.primitives;
  const { extractCollectionItemsFromResolvedTargets } = ns.collectionExtractor;

  function getReplayTarget(step) {
    return step?.replayTarget || null;
  }

  function requireReplayTarget(step, expectedKind) {
    const replayTarget = getReplayTarget(step);

    if (!replayTarget) {
      throw new Error("Replay step is missing replayTarget.");
    }

    if (replayTarget.kind !== expectedKind) {
      throw new Error(
        `Replay step expected replayTarget.kind="${expectedKind}" but got "${replayTarget.kind}".`,
      );
    }

    if (!replayTarget.snapshot) {
      throw new Error("Replay target snapshot is missing.");
    }

    return replayTarget.snapshot;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function requireReplayTargetSnapshot(step, expectedKind) {
    return requireReplayTarget(step, expectedKind);
  }

  function resolveReplayExtractTargets(snapshot) {
    const controlSnapshots = Array.isArray(snapshot?.controlSnapshots)
      ? snapshot.controlSnapshots.filter(Boolean)
      : [];
    const targets = [];

    for (const controlSnapshot of controlSnapshots) {
      const resolved = resolveElement(controlSnapshot, "extract");
      if (!resolved?.el) continue;

      targets.push({
        id: controlSnapshot.id || "",
        kind: "control",
        el: resolved.el,
        controlSnapshot,
        scrollableContainerSnapshot: null,
        strategyUsed: resolved.strategyUsed || "resolved-control",
        strategiesTried: resolved.strategiesTried || ["resolved-control"],
      });
    }

    if (snapshot?.scrollableContainerSnapshot) {
      const resolved = resolveScrollableContainer(
        snapshot.scrollableContainerSnapshot,
      );
      if (resolved?.el) {
        targets.push({
          id: snapshot.scrollableContainerSnapshot.id || "",
          kind: "scrollable-container",
          el: resolved.el,
          controlSnapshot: null,
          scrollableContainerSnapshot: snapshot.scrollableContainerSnapshot,
          strategyUsed:
            resolved.strategyUsed || "explicit-scrollable-container",
          strategiesTried: resolved.strategiesTried || [
            "explicit-scrollable-container",
          ],
        });
      }
    }

    return targets;
  }

  async function runReplayStep(step) {
    const action = step?.action;

    if (!action || !action.type) {
      throw new Error("Replay step is missing action.type.");
    }

    if (action.executor === "webmcp") {
      throw new Error(
        "WebMCP actions cannot be replayed because their live tool handles and schemas must be re-authorized and re-discovered.",
      );
    }

    switch (action.type) {
      case "wait": {
        const ms = Number(action.ms || step?.preStepWaitMs || 1000);
        await sleep(ms);
        return {
          ok: true,
          detail: `Waited ${ms}ms`,
        };
      }

      case "goto": {
        const replayTarget = getReplayTarget(step);
        const url = String(
          action.url || replayTarget?.snapshot?.url || "",
        ).trim();

        if (!url) {
          throw new Error("Replay goto step requires a non-empty url.");
        }

        window.location.assign(url);

        return {
          ok: true,
          detail: `Replayed goto to ${url}`,
        };
      }

      case "click": {
        const control = requireReplayTarget(step, "control");
        const resolved = resolveElement(control, "click");
        await clickElement(resolved.el);
        return {
          ok: true,
          detail: `Replayed click for ${
            action.targetId || control.id || "control"
          }`,
        };
      }

      case "fill": {
        const control = requireReplayTarget(step, "control");
        const resolved = resolveElement(control, "fill");
        await fillElement(resolved.el, action.value ?? "");
        return {
          ok: true,
          detail: `Replayed fill for ${
            action.targetId || control.id || "control"
          }`,
        };
      }

      case "press": {
        const replayTarget = getReplayTarget(step);

        if (replayTarget?.kind === "control" && replayTarget.snapshot) {
          const resolved = resolveElement(replayTarget.snapshot, "press");
          await pressKeyOnElement(resolved.el, action.key || "Enter");
          return {
            ok: true,
            detail: `Replayed press ${action.key || "Enter"} on ${
              action.targetId || replayTarget.snapshot.id || "control"
            }`,
          };
        }

        const target =
          document.activeElement instanceof Element
            ? document.activeElement
            : document.body;

        await pressKeyOnElement(target, action.key || "Enter");
        return {
          ok: true,
          detail: `Replayed global press ${action.key || "Enter"}`,
        };
      }

      case "extract": {
        const snapshot = requireReplayTargetSnapshot(step, "extract-targets");
        const targets = resolveReplayExtractTargets(snapshot);

        if (!targets.length) {
          throw new Error(
            "Replay extract target did not resolve any elements.",
          );
        }

        const batch = extractCollectionItemsFromResolvedTargets(targets, {
          type: "extract",
          frameId:
            Number.isInteger(action?.frameId) ||
            Number.isInteger(snapshot?.frameId)
              ? Number(
                  Number.isInteger(action?.frameId)
                    ? action.frameId
                    : snapshot.frameId,
                )
              : 0,
          targetId: action?.targetId || snapshot?.targetId || "",
          controlIds: Array.isArray(action?.controlIds)
            ? [...action.controlIds]
            : Array.isArray(snapshot?.controlSnapshots)
              ? snapshot.controlSnapshots
                  .map((control) => control?.id)
                  .filter(Boolean)
              : [],
        });

        return {
          ok: true,
          detail: `Replayed extract for ${
            action?.targetId || snapshot?.targetId || "targets"
          } and collected ${batch.extractedCount} visible items`,
          extractionBatch: {
            frameId: batch.frameId,
            targetId: batch.targetId,
            extractedCount: batch.extractedCount,
            items: batch.items,
          },
        };
      }

      case "scroll": {
        const replayTarget = getReplayTarget(step);
        const amount = Number(action.amount || 800);
        const direction =
          String(action.direction || "down").toLowerCase() === "up" ? -1 : 1;

        if (
          replayTarget?.kind === "scrollable-container" &&
          replayTarget.snapshot
        ) {
          const resolved = resolveScrollableContainer(replayTarget.snapshot);

          if (typeof resolved.el.scrollBy === "function") {
            resolved.el.scrollBy({
              top: direction * amount,
              behavior: "smooth",
            });
          } else {
            resolved.el.scrollTop += direction * amount;
          }

          await sleep(450);

          return {
            ok: true,
            detail: `Replayed scroll for ${
              action.targetId || replayTarget.snapshot.id || "container"
            }`,
          };
        }

        if (replayTarget?.kind === "control" && replayTarget.snapshot) {
          const resolved = resolveElement(replayTarget.snapshot, "scroll");
          const targetEl =
            findScrollableAncestor(resolved.el) ||
            (isScrollable(resolved.el) ? resolved.el : null);

          if (!targetEl) {
            throw new Error(
              `Resolved control ${
                replayTarget.snapshot.id || action.targetId || ""
              } but no scrollable ancestor was found.`,
            );
          }

          if (typeof targetEl.scrollBy === "function") {
            targetEl.scrollBy({
              top: direction * amount,
              behavior: "smooth",
            });
          } else {
            targetEl.scrollTop += direction * amount;
          }

          await sleep(450);

          return {
            ok: true,
            detail: `Replayed scroll for ${
              action.targetId || replayTarget.snapshot.id || "control"
            }`,
          };
        }

        window.scrollBy({
          top: direction * amount,
          behavior: "smooth",
        });

        await sleep(450);

        return {
          ok: true,
          detail: "Replayed window scroll",
        };
      }

      default:
        throw new Error(`Unsupported replay action type: ${action.type}`);
    }
  }

  async function runReplaySteps(steps, options = {}) {
    const results = [];
    const defaultPreStepWaitMs = Number(options.defaultPreStepWaitMs || 0);

    for (let i = 0; i < (steps || []).length; i++) {
      const step = steps[i];

      try {
        const result = await runReplayStep(step);

        results.push({
          stepIndex: i,
          step,
          result,
        });

        const waitMs = Number(step?.preStepWaitMs || defaultPreStepWaitMs || 0);

        if (waitMs > 0) {
          await sleep(waitMs);
        }
      } catch (error) {
        return {
          ok: false,
          error: error?.message || String(error),
          failedStepIndex: i,
          failedStep: step,
          results,
        };
      }
    }

    return {
      ok: true,
      summary: "All replay steps executed.",
      results,
    };
  }

  ns.replayRunner = {
    runReplayStep,
    runReplaySteps,
  };
})();
