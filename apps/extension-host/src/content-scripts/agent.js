(function () {
  const CONTENT_SCRIPT_PROTOCOL_REVISION = "webgpt-content-runtime-v2";
  const PING_MESSAGE_TYPE = "PING_WEBGPT_CONTENT_SCRIPT";
  const EXTRACT_STATE_MESSAGE_TYPE = "WEBGPT_EXTRACT_STATE_V2";
  const RUN_ACTIONS_MESSAGE_TYPE = "WEBGPT_RUN_ACTIONS_V2";
  let mintObservation = null;
  window.addEventListener("pagehide", () => { mintObservation = null; });

  window.WebGPTContentScriptProtocolRevision = CONTENT_SCRIPT_PROTOCOL_REVISION;

  function logToConsole(...args) {
    console.log("[WebGPT]", ...args);
  }

  function assertDeps() {
    if (typeof window.WebGPTExtractState !== "function") {
      throw new Error("WebGPTExtractState is not available.");
    }

    if (
      !window.WebGPTRunner ||
      typeof window.WebGPTRunner.runActions !== "function"
    ) {
      throw new Error("WebGPTRunner.runActions is not available.");
    }
  }

  function protocolMatches(message) {
    return message?.protocolRevision === CONTENT_SCRIPT_PROTOCOL_REVISION;
  }

  function adapterIds() {
    try {
      return (window.WebGPTContentAdapters?.list?.() || [])
        .map((adapter) => adapter?.id)
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function connectorToolNames() {
    try {
      return window.WebGPTConnectorTools?.list?.() || [];
    } catch {
      return [];
    }
  }

  async function extractStateFromMessage(message) {
    assertDeps();

    const meta = {
      goal: message.goal || "",
      step: message.step || 1,
      ...(message.meta || {}),
    };
    if (message.mintProtocol === 1 && window === window.top) {
      const targets = new Map();
      const state = window.WebGPTExtractState(meta, {
        onControl(control, element) {
          if (control.enabled) targets.set(control.id, {
            element, parent: element.parentElement, value: element.value,
            selector: control.selector, label: control.label,
            signature: mintTargetSignature(element),
          });
          if (element.required || element.getAttribute("aria-required") === "true") {
            control.required = true;
          }
        },
      });
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte =>
        byte.toString(16).padStart(2, "0")).join("");
      mintObservation = { id, state, targets };
      const adapters = window.WebGPTContentAdapters;
      const discovery = adapters?.getActiveAdapters?.({ url: state.url, document });
      const activeAdapterIds = Array.isArray(discovery?.active) ? discovery.active.map(adapter => adapter.id) : [];
      const provides = Object.assign({}, ...activeAdapterIds.map(adapterId => adapters.getAdapterProvides(adapterId)));
      return { ...state, mintObservationId: id, mintDiscovery: {
        ok: Array.isArray(discovery?.active) && Array.isArray(discovery.errors) &&
          !discovery.errors.length && !state.adapterInfo?.errors?.length, activeAdapterIds, provides,
      }};
    }

    const state = window.WebGPTExtractState(meta);

    if (typeof window.WebGPTWebMCP?.augmentState === "function") {
      return window.WebGPTWebMCP.augmentState(state, document);
    }

    return state;
  }

  function mintTargetSignature(element) {
    return JSON.stringify([
      element.id, element.tagName, element.type, element.name,
      element.getAttribute("role"), element.getAttribute("href"),
      element.getAttribute("data-id"), element.getAttribute("data-value"),
      element.getAttribute("aria-label"), element.textContent,
    ]);
  }

  async function runMintActions({ actions, binding }) {
    const observation = mintObservation;
    mintObservation = null;
    const results = [];
    const failed = (action, code) => ({
      ok: false, results: [...results, {
        action: { type: action?.type, targetId: action?.targetId },
        result: { ok: false, verified: false, code },
      }],
    });
    const { isEnabled, isVisible } = window.WebGPTRunnerModules.domUtils;
    const { clickElement, fillElement, pressKeyOnElement } = window.WebGPTRunnerModules.primitives;
    for (const action of actions) {
      const { type, targetId } = action;
      if (!observation || binding.observationId !== observation.id ||
          binding.url !== observation.state.url || binding.url !== window.location.href) {
        return failed(action, "MINT_OBSERVATION_STALE");
      }
      const target = observation.targets.get(targetId);
      const element = target?.element;
      const controls = observation.state.controls.filter(control => control.id === targetId);
      const control = controls[0];
      if (targetId && (!element?.isConnected || element.parentElement !== target.parent ||
          element.value !== target.value || !isEnabled(element) || !isVisible(element) ||
          element.closest(":disabled,[inert],[hidden],[aria-disabled='true'],[aria-hidden='true']") ||
          mintTargetSignature(element) !== target.signature ||
          controls.length !== 1 || control.selector !== target.selector || control.label !== target.label)) {
        return failed(action, "MINT_TARGET_STALE");
      }
      let verified = false;
      if (type === "fill" && element?.matches("input:is([type=text],[type=search],:not([type])),textarea") &&
          !element.readOnly && element.value === "" && typeof action.value === "string" &&
          action.value.length > 0 && action.value.length <= 2500 &&
          !/\b(?:submit|upload|attach file|choose file|password|passcode|verification code|one[- ]time[- ]code)\b/i.test(
            [control.label, control.ariaLabel, control.name, element.autocomplete].join(" "))) {
        await fillElement(element, action.value, { exactTarget: true });
        verified = element.value === action.value;
      } else if (type === "press" && element?.matches("input[type=text],input[type=search],input:not([type])") &&
          /^(?:ArrowUp|ArrowDown|Escape)$/.test(action.key)) {
        await pressKeyOnElement(element, action.key);
      } else if (type === "click" && element?.matches("input:is([type=radio],[type=checkbox]),[role=option],[role=tab],summary") &&
          !element.closest("a[href],button") &&
          (!element.closest("label")?.control || element.closest("label").control === element) &&
          targetId !== observation.state.siteAdapter?.submitTargetId &&
          !Object.values(control.adapterHints || {}).some(hint => hint?.protectedEffect === "submit")) {
        const before = element.checked;
        await clickElement(element);
        verified = typeof before === "boolean" && element.checked !== before;
      } else if (type === "wait" && !targetId && Number.isFinite(action.ms) && action.ms >= 0 && action.ms <= 2000) {
        await new Promise(resolve => setTimeout(resolve, action.ms));
      } else if (type === "scroll" && !targetId && ["up", "down"].includes(action.direction) &&
          Number.isFinite(action.amount) && action.amount > 0 && action.amount <= 2000) {
        window.scrollBy(0, action.direction === "up" ? -action.amount : action.amount);
      } else {
        return failed(action, "MINT_ACTION_NOT_APPROVED");
      }
      results.push({ action: { type, targetId }, result: { ok: true, verified } });
    }
    return { ok: true, results };
  }

  function runActionsFromMessage(message) {
    assertDeps();

    if (message.mintProtocol === 1 && window === window.top) return runMintActions(message);

    return window.WebGPTRunner.runActions(
      message.state || {},
      Array.isArray(message.actions) ? message.actions : [],
    );
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === PING_MESSAGE_TYPE) {
      if (!protocolMatches(message)) return false;
      sendResponse({
        ok: true,
        where: "agent.js",
        protocolRevision: CONTENT_SCRIPT_PROTOCOL_REVISION,
        adapterIds: adapterIds(),
        connectorToolNames: connectorToolNames(),
        url: window.location.href,
        title: document.title,
        visibility: document.visibilityState,
        hasFocus: document.hasFocus(),
      });
      return false;
    }

    if (message?.type === "PING_WEBGPT") {
      sendResponse({
        ok: true,
        where: "agent.js",
        url: window.location.href,
        title: document.title,
        visibility: document.visibilityState,
        hasFocus: document.hasFocus(),
      });
      return false;
    }

    if (message?.type === EXTRACT_STATE_MESSAGE_TYPE) {
      if (!protocolMatches(message)) return false;
      try {
        extractStateFromMessage(message)
          .then((state) => {
            sendResponse({
              ok: true,
              protocolRevision: CONTENT_SCRIPT_PROTOCOL_REVISION,
              state,
            });
          })
          .catch((error) => {
            sendResponse({
              ok: false,
              protocolRevision: CONTENT_SCRIPT_PROTOCOL_REVISION,
              error: error?.message || String(error),
            });
          });

        return true;
      } catch (error) {
        sendResponse({
          ok: false,
          protocolRevision: CONTENT_SCRIPT_PROTOCOL_REVISION,
          error: error?.message || String(error),
        });
      }
      return false;
    }

    if (message?.type === "WEBGPT_EXTRACT_STATE") {
      try {
        extractStateFromMessage(message)
          .then((state) => sendResponse({ ok: true, state }))
          .catch((error) => {
            sendResponse({
              ok: false,
              error: error?.message || String(error),
            });
          });

        return true;
      } catch (error) {
        sendResponse({
          ok: false,
          error: error?.message || String(error),
        });
      }
      return false;
    }

    if (message?.type === RUN_ACTIONS_MESSAGE_TYPE) {
      if (!protocolMatches(message)) return false;
      try {
        runActionsFromMessage(message)
          .then((result) => {
            sendResponse({
              ok: true,
              protocolRevision: CONTENT_SCRIPT_PROTOCOL_REVISION,
              result,
            });
          })
          .catch((error) => {
            sendResponse({
              ok: false,
              protocolRevision: CONTENT_SCRIPT_PROTOCOL_REVISION,
              error: error?.message || String(error),
            });
          });

        return true;
      } catch (error) {
        sendResponse({
          ok: false,
          protocolRevision: CONTENT_SCRIPT_PROTOCOL_REVISION,
          error: error?.message || String(error),
        });
        return false;
      }
    }

    if (message?.type === "WEBGPT_RUN_ACTIONS") {
      try {
        runActionsFromMessage(message)
          .then((result) => {
            sendResponse({
              ok: true,
              result,
            });
          })
          .catch((error) => {
            sendResponse({
              ok: false,
              error: error?.message || String(error),
            });
          });

        return true;
      } catch (error) {
        sendResponse({
          ok: false,
          error: error?.message || String(error),
        });
        return false;
      }
    }

    if (message?.type === "WEBGPT_RUN_REPLAY") {
      try {
        assertDeps();

        if (
          !window.WebGPTRunner ||
          typeof window.WebGPTRunner.runReplaySteps !== "function"
        ) {
          throw new Error("WebGPTRunner.runReplaySteps is not available.");
        }

        window.WebGPTRunner.runReplaySteps(
          Array.isArray(message.steps) ? message.steps : [],
        )
          .then((result) => {
            sendResponse({
              ok: true,
              result,
            });
          })
          .catch((error) => {
            sendResponse({
              ok: false,
              error: error?.message || String(error),
            });
          });

        return true;
      } catch (error) {
        sendResponse({
          ok: false,
          error: error?.message || String(error),
        });
        return false;
      }
    }

    return false;
  });

  logToConsole("agent.js bridge loaded on", window.location.href);

  window.WebGPTAgent = {
    ping() {
      return {
        ok: true,
        url: window.location.href,
        title: document.title,
      };
    },
    extractState(meta = {}) {
      assertDeps();
      return window.WebGPTExtractState(meta);
    },
    runActions(state, actions) {
      assertDeps();
      return window.WebGPTRunner.runActions(state, actions);
    },
    runReplaySteps(steps) {
      assertDeps();
      return window.WebGPTRunner.runReplaySteps(steps);
    },
  };
})();
