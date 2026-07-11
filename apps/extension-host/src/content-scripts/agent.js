(function () {
  const CONTENT_SCRIPT_PROTOCOL_REVISION = "webmcp-tools-2026-07-11";
  const PING_MESSAGE_TYPE = "PING_WEBGPT_CONTENT_SCRIPT";
  const EXTRACT_STATE_MESSAGE_TYPE = "WEBGPT_EXTRACT_STATE_V2";
  const RUN_ACTIONS_MESSAGE_TYPE = "WEBGPT_RUN_ACTIONS_V2";

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

    const state = window.WebGPTExtractState({
      goal: message.goal || "",
      step: message.step || 1,
      ...(message.meta || {}),
    });

    if (typeof window.WebGPTWebMCP?.augmentState === "function") {
      return window.WebGPTWebMCP.augmentState(state, document);
    }

    return state;
  }

  function runActionsFromMessage(message) {
    assertDeps();

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
