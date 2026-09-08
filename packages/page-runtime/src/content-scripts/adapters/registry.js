(function () {
  const adapters = [];
  let privateToolRoutes = Object.freeze({});

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

  function clonePrivateRoute(route) {
    try {
      return JSON.parse(JSON.stringify(route));
    } catch {
      return null;
    }
  }

  function authorizationToken() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    if (typeof globalThis.crypto?.getRandomValues === "function") {
      const values = new Uint32Array(4);
      globalThis.crypto.getRandomValues(values);
      return `webgpt-${Array.from(values, (value) => value.toString(16)).join("-")}`;
    }
    return `webgpt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function modelToolSchema(descriptor) {
    if (descriptor?.schema && typeof descriptor.schema === "object") {
      return descriptor.schema;
    }
    if (!Object.prototype.hasOwnProperty.call(descriptor || {}, "execution")) {
      return descriptor;
    }
    const { execution: _privateExecution, ...schema } = descriptor;
    return schema;
  }

  // Collect function-tool schemas exposed by active connectors via provideTools(). These ride in
  // state.connectorTools and are merged into the planner's tool set on the backend (toolsForStep).
  // Execution routes are intentionally removed first: selectors, host routing, and verification
  // details are host-only data, available through getPrivateToolRoutes() after the extraction.
  function collectConnectorTools(activeAdapters, state, context, errors) {
    const tools = [];
    const routes = {};
    const seen = new Set();

    for (const adapter of activeAdapters) {
      if (typeof adapter.provideTools !== "function") continue;

      try {
        const provided = adapter.provideTools({
          state,
          meta: context.meta,
          document: context.document,
          url: context.url,
        });

        if (!Array.isArray(provided)) continue;

        for (const descriptor of provided) {
          if (!descriptor || typeof descriptor !== "object") continue;
          const tool = modelToolSchema(descriptor);
          const name = typeof tool?.name === "string" ? tool.name.trim() : "";
          if (!name || seen.has(name)) continue;
          seen.add(name);
          tools.push(tool);
          if (descriptor.execution && typeof descriptor.execution === "object") {
            const route = clonePrivateRoute({
              ...descriptor.execution,
              toolName: name,
              adapterId: adapter.id,
            });
            if (route) {
              if (route.realm === "page" && route.requiresAuthorization === true) {
                route.authorizationToken = authorizationToken();
              }
              routes[name] = route;
            }
          }
          if (tools.length >= 32) return { tools, routes };
        }
      } catch (error) {
        errors.push({
          adapterId: adapter.id,
          stage: "provideTools",
          error: errorMessage(error),
        });
        console.warn("[WebGPT][adapter.provideTools] failed", adapter.id, error);
      }
    }

    return { tools, routes };
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

    const { tools: connectorTools, routes } = collectConnectorTools(
      active,
      nextState,
      context,
      errors,
    );
    privateToolRoutes = Object.freeze(routes);
    if (connectorTools.length) {
      nextState = { ...nextState, connectorTools };
    }

    return applyAdapterInfo(nextState, appliedAdapterIds, errors);
  }

  globalThis.WebGPTContentAdapters = {
    register,
    getActiveAdapters,
    enhanceState,
    getPrivateToolRoutes() {
      return clonePrivateRoute(privateToolRoutes) || {};
    },
    consumePrivateToolAuthorization(toolName, token) {
      const name = typeof toolName === "string" ? toolName.trim() : "";
      const route = privateToolRoutes[name];
      if (
        !route ||
        route.realm !== "page" ||
        route.requiresAuthorization !== true ||
        typeof token !== "string" ||
        !token ||
        token !== route.authorizationToken
      ) {
        return false;
      }

      const nextRoutes = { ...privateToolRoutes };
      nextRoutes[name] = {
        ...route,
        authorizationToken: "",
        authorizationConsumed: true,
      };
      privateToolRoutes = Object.freeze(nextRoutes);
      return true;
    },
    list() {
      return adapters.slice();
    },
  };
})();
