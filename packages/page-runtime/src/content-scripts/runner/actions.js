(function () {
  const ns = (globalThis.WebGPTRunnerModules =
    globalThis.WebGPTRunnerModules || {});

  if (
    !ns.domUtils ||
    !ns.resolver ||
    !ns.scrollResolver ||
    !ns.primitives ||
    !ns.trace ||
    !ns.collectionExtractor
  ) {
    throw new Error("runner modules not loaded correctly before actions.js");
  }

  const { lower } = ns.domUtils;
  const { getControlById, resolveElement } = ns.resolver;
  const {
    isScrollable,
    getScrollableContainerById,
    findScrollableAncestor,
    findBestScrollContainer,
    resolveScrollableContainer,
  } = ns.scrollResolver;
  const { clickElement, fillElement, pressKeyOnElement } = ns.primitives;
  const {
    buildReplayTarget,
    buildResolvedControlTrace,
    buildScrollTrace,
    buildExtractTrace,
    buildGotoTrace,
  } = ns.trace;
  const { extractCollectionItems } = ns.collectionExtractor;

  async function runSingleAction(state, action) {
    if (!action || !action.type) {
      throw new Error("Invalid action.");
    }

    // WebMCP tool names are planner-facing aliases, so route on the explicit
    // executor before the normal action switch or connector-name fallback.
    if (action.executor === "webmcp") {
      const webMcp = globalThis.WebGPTWebMCP;
      if (!webMcp || typeof webMcp.executeAction !== "function") {
        throw new Error("WebMCP execution bridge is unavailable.");
      }
      return webMcp.executeAction(action, document, {
        frameId: Number.isInteger(state?.frameId) ? state.frameId : null,
      });
    }

    switch (action.type) {
      case "wait": {
        const ms = action.ms || 1000;
        await new Promise((resolve) => setTimeout(resolve, ms));
        return {
          ok: true,
          detail: `Waited ${ms}ms`,
        };
      }

      case "goto": {
        const url = String(action.url || "").trim();

        if (!url) {
          throw new Error("goto action requires a non-empty url.");
        }

        window.location.assign(url);

        return {
          ok: true,
          detail: `Navigating to ${url}`,
          executionTrace: buildGotoTrace({ action }),
        };
      }

      case "scroll": {
        const amount = Number(action.amount || 800);
        const direction = lower(action.direction) === "up" ? -1 : 1;

        let targetEl = null;
        let detail = "";
        let resolved = null;
        let scrollableContainer = null;
        let control = null;
        let source = "";
        let replayTarget = null;

        if (action.targetId && String(action.targetId).startsWith("sc_")) {
          scrollableContainer = getScrollableContainerById(
            state,
            action.targetId,
          );

          if (!scrollableContainer) {
            throw new Error(
              `Unknown scrollable container targetId: ${action.targetId}`,
            );
          }

          resolved = resolveScrollableContainer(scrollableContainer);
          targetEl = resolved.el;
          detail = `Scrolled ${action.targetId}`;
          source = "explicit-scrollable-container";
          replayTarget = buildReplayTarget(
            "scrollable-container",
            scrollableContainer,
          );
        } else if (action.targetId) {
          control = getControlById(state, action.targetId);
          if (!control) {
            throw new Error(`Unknown targetId: ${action.targetId}`);
          }

          resolved = resolveElement(control, "scroll");
          targetEl =
            findScrollableAncestor(resolved.el) ||
            (isScrollable(resolved.el) ? resolved.el : null);

          if (!targetEl) {
            throw new Error(
              `Resolved control ${action.targetId} but no scrollable ancestor was found.`,
            );
          }

          detail = `Scrolled container for ${action.targetId}`;
          source = "control-scroll-ancestor";
          replayTarget = buildReplayTarget("control", control);
        } else {
          targetEl = findBestScrollContainer(state, action);

          if (targetEl) {
            detail = "Scrolled inferred container";
            source = "inferred-scroll-container";
          } else {
            source = "window-scroll-fallback";
          }
        }

        if (targetEl) {
          if (typeof targetEl.scrollBy === "function") {
            targetEl.scrollBy({ top: direction * amount, behavior: "smooth" });
          } else {
            targetEl.scrollTop += direction * amount;
          }
        } else {
          window.scrollBy({ top: direction * amount, behavior: "smooth" });
          detail = "Scrolled window";
        }

        await new Promise((resolvePromise) => setTimeout(resolvePromise, 450));

        return {
          ok: true,
          detail: detail || `Scrolled ${amount}px`,
          executionTrace: buildScrollTrace({
            action,
            scrollableContainer,
            control,
            resolved,
            targetEl,
            source,
            replayTarget,
          }),
        };
      }

      case "extract": {
        const batch = extractCollectionItems(state, action);

        return {
          ok: true,
          detail: `Extracted ${batch.extractedCount} visible items from ${batch.targetId}`,
          extractionBatch: {
            frameId: batch.frameId,
            targetId: batch.targetId,
            extractedCount: batch.extractedCount,
            items: batch.items,
          },
          executionTrace: buildExtractTrace({
            action,
            extractionBatch: batch,
          }),
        };
      }

      case "press": {
        const key = action.key || "Enter";
        const control = action.targetId
          ? getControlById(state, action.targetId)
          : null;

        let target = document.activeElement;
        let resolved = null;
        let replayTarget = null;

        if (control) {
          resolved = resolveElement(control, "press");
          target = resolved.el;
          replayTarget = buildReplayTarget("control", control);
        }

        if (!target || !(target instanceof Element)) {
          throw new Error("No valid target available for key press.");
        }

        await pressKeyOnElement(target, key);

        return {
          ok: true,
          detail: `Pressed ${key}${control ? ` on ${action.targetId}` : ""}`,
          executionTrace: control
            ? buildResolvedControlTrace(
                "press",
                action,
                control,
                resolved,
                replayTarget,
              )
            : {
                actionType: "press",
                targetId: action.targetId || "",
                strategyUsed: "active-element",
                strategiesTried: ["active-element"],
                controlSnapshot: null,
                replayTarget: null,
              },
        };
      }

      case "click": {
        const control = getControlById(state, action.targetId);
        if (!control) {
          throw new Error(`Unknown targetId: ${action.targetId}`);
        }

        const resolved = resolveElement(control, "click");
        const replayTarget = buildReplayTarget("control", control);

        await clickElement(resolved.el);

        return {
          ok: true,
          detail: `Clicked ${action.targetId}`,
          executionTrace: buildResolvedControlTrace(
            "click",
            action,
            control,
            resolved,
            replayTarget,
          ),
        };
      }

      case "fill": {
        const control = getControlById(state, action.targetId);
        if (!control) {
          throw new Error(`Unknown targetId: ${action.targetId}`);
        }

        const resolved = resolveElement(control, "fill");
        const value = action.value ?? "";
        const replayTarget = buildReplayTarget("control", control);

        await fillElement(resolved.el, value);

        return {
          ok: true,
          detail: `Filled ${action.targetId}`,
          executionTrace: buildResolvedControlTrace(
            "fill",
            action,
            control,
            resolved,
            replayTarget,
          ),
        };
      }

      default: {
        // Connector-provided tools (declared by site adapters via provideTools) are executed by
        // their registered runner-side handler. Base action types are handled above; anything else
        // that a connector registered runs here.
        const connectorTools = globalThis.WebGPTConnectorTools;
        if (connectorTools && connectorTools.has(action.type)) {
          const result = await connectorTools.run(action.type, action, {
            state,
            primitives: ns.primitives,
            resolver: ns.resolver,
            domUtils: ns.domUtils,
          });
          if (result && typeof result === "object") return result;
          return {
            ok: false,
            detail: `Connector tool ${action.type} returned no result`,
          };
        }

        throw new Error(`Unsupported action type: ${action.type}`);
      }
    }
  }

  async function runActions(state, actions) {
    const batch = Array.isArray(actions) ? actions : [];
    const results = [];
    const recoverableFailures = [];

    try {
      for (let index = 0; index < batch.length; index += 1) {
        const action = batch[index];
        let result = null;
        try {
          result = await runSingleAction(state, action);
        } catch (error) {
          const failedResult = {
            ok: false,
            error: error?.message || String(error),
          };
          results.push({ action, result: failedResult });
          return {
            ok: false,
            error: failedResult.error,
            results,
            recoverableFailures,
          };
        }
        results.push({ action, result });
        const actionFailed = Boolean(result && result.ok === false);
        const recoverableFailure = Boolean(
          actionFailed && (result.recoverable || result.continueBatch),
        );
        if (recoverableFailure) {
          recoverableFailures.push({ action, result });
        }

        if (result?.navigationStarted) {
          const skippedActions = batch.slice(index + 1);
          return {
            ok: !actionFailed || recoverableFailure,
            summary: skippedActions.length
              ? `Navigation started after ${action.type}; ${skippedActions.length} remaining action(s) were skipped.`
              : `Navigation started after ${action.type}.`,
            ...(actionFailed && !recoverableFailure
              ? {
                  error:
                    result.detail ||
                    result.error ||
                    `Action ${action.type} reported failure.`,
                }
              : {}),
            results,
            recoverableFailures,
            navigationStarted: true,
            interruptedByNavigation: true,
            skippedActionCount: skippedActions.length,
            skippedActions,
          };
        }

        if (actionFailed) {
          if (recoverableFailure) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            continue;
          }
          throw new Error(
            result.detail ||
              result.error ||
              `Action ${action.type} reported failure.`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      return {
        ok: true,
        summary: recoverableFailures.length
          ? `Actions executed with ${recoverableFailures.length} recoverable connector failure(s).`
          : "All actions executed.",
        results,
        recoverableFailures,
      };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || String(error),
        results,
      };
    }
  }

  ns.actions = {
    runSingleAction,
    runActions,
  };
})();
