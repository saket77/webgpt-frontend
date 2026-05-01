(function () {
  const adapters = [];

  function errorMessage(error) {
    return error?.message || String(error);
  }

  function register(adapter) {
    if (!adapter || typeof adapter !== "object") {
      throw new Error("Content adapter must be an object.");
    }

    if (!adapter.id || typeof adapter.id !== "string") {
      throw new Error("Content adapter requires a string id.");
    }

    if (typeof adapter.match !== "function") {
      throw new Error(`Content adapter ${adapter.id} requires match().`);
    }

    const existingIndex = adapters.findIndex((item) => item.id === adapter.id);
    if (existingIndex >= 0) {
      adapters.splice(existingIndex, 1, adapter);
    } else {
      adapters.push(adapter);
    }

    adapters.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
  }

  function buildContext(state, meta = {}) {
    return {
      state,
      meta,
      url: state?.url || location.href,
      title: state?.title || document.title,
      document,
      window,
    };
  }

  function getActiveAdapters(context) {
    const active = [];
    const errors = [];
    const matchContext = {
      url: context.url,
      document: context.document,
    };

    for (const adapter of adapters) {
      try {
        if (adapter.match(matchContext)) {
          active.push(adapter);
        }
      } catch (error) {
        errors.push({
          adapterId: adapter.id,
          stage: "match",
          error: errorMessage(error),
        });
        console.warn("[WebGPT][adapter.match] failed", adapter.id, error);
      }
    }

    return { active, errors };
  }

  function applyAdapterInfo(state, appliedAdapterIds, errors) {
    if (!appliedAdapterIds.length && !errors.length) {
      return state;
    }

    return {
      ...state,
      adapterInfo: {
        ...(state.adapterInfo || {}),
        activeAdapterIds: appliedAdapterIds,
        errors,
      },
    };
  }

  function enhanceState(state, meta = {}) {
    const context = buildContext(state, meta);
    const { active, errors } = getActiveAdapters(context);
    const appliedAdapterIds = [];
    let nextState = state;

    for (const adapter of active) {
      if (typeof adapter.enhanceState !== "function") {
        continue;
      }

      try {
        const result = adapter.enhanceState({
          state: nextState,
          document: context.document,
          url: context.url,
        });

        if (result && typeof result === "object") {
          nextState = result;
        }

        appliedAdapterIds.push(adapter.id);
      } catch (error) {
        errors.push({
          adapterId: adapter.id,
          stage: "enhanceState",
          error: errorMessage(error),
        });
        console.warn("[WebGPT][adapter.enhanceState] failed", adapter.id, error);
      }
    }

    return applyAdapterInfo(nextState, appliedAdapterIds, errors);
  }

  globalThis.WebGPTContentAdapters = {
    register,
    getActiveAdapters,
    enhanceState,
    list() {
      return adapters.slice();
    },
  };
})();
