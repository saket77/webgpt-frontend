(function () {
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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

    if (message?.type === "WEBGPT_EXTRACT_STATE") {
      try {
        assertDeps();

        const state = window.WebGPTExtractState({
          goal: message.goal || "",
          step: message.step || 1,
          ...(message.meta || {}),
        });

        sendResponse({
          ok: true,
          state,
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error?.message || String(error),
        });
      }
      return false;
    }

    if (message?.type === "WEBGPT_RUN_ACTIONS") {
      try {
        assertDeps();

        window.WebGPTRunner.runActions(
          message.state || {},
          Array.isArray(message.actions) ? message.actions : [],
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
