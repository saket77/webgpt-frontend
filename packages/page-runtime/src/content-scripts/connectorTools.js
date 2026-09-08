// Connector-tool registry (content-script world). Site-adapter connectors register an executor
// for each tool name they expose via provideTools(); the runner (runner/actions.js) dispatches an
// action whose `type` is a registered tool name to the matching executor. This is the runner-side
// half of the "provideTools" connector capability — the schema half travels in state.connectorTools.
//
// Loaded before the adapters so they can register at load time; executors reference the live DOM
// and runner primitives at act-time (passed in via ctx), so it has no load-order dependency on the
// runner modules.
(function () {
  if (
    globalThis.WebGPTConnectorTools &&
    typeof globalThis.WebGPTConnectorTools.run === "function"
  ) {
    return;
  }

  const handlers = new Map();
  const guardedHandlers = new Set();

  function register(name, execute, options = {}) {
    const key = typeof name === "string" ? name.trim() : "";
    if (!key || typeof execute !== "function") return;
    handlers.set(key, execute);
    if (options.requiresAuthorization === true) guardedHandlers.add(key);
    else guardedHandlers.delete(key);
  }

  function has(name) {
    return handlers.has(typeof name === "string" ? name.trim() : "");
  }

  function privateRoute(name) {
    try {
      return globalThis.WebGPTContentAdapters?.getPrivateToolRoutes?.()?.[name] || null;
    } catch {
      return null;
    }
  }

  function authorizedAction(name, action) {
    const route = privateRoute(name);
    if (!guardedHandlers.has(name) && !route?.requiresAuthorization) return action || {};
    if (!route?.requiresAuthorization) return null;

    const token = action?.__webgptAuthorizationToken;
    const consume = globalThis.WebGPTContentAdapters?.consumePrivateToolAuthorization;
    if (typeof consume !== "function" || !consume(name, token)) return null;

    const sanitized = { ...(action || {}) };
    delete sanitized.__webgptAuthorizationToken;
    return sanitized;
  }

  async function run(name, action, ctx) {
    const key = typeof name === "string" ? name.trim() : "";
    const execute = handlers.get(key);
    if (!execute) {
      return { ok: false, detail: `No connector tool registered for ${name}` };
    }
    const authorized = authorizedAction(key, action);
    if (!authorized) {
      return {
        ok: false,
        detail: `Connector tool ${key} requires one-use host authorization.`,
      };
    }
    return execute(authorized, ctx || {});
  }

  async function runPrivileged(name, action, ctx, authorizationToken) {
    return run(
      name,
      { ...(action || {}), __webgptAuthorizationToken: authorizationToken },
      ctx,
    );
  }

  globalThis.WebGPTConnectorTools = {
    register,
    has,
    run,
    runPrivileged,
    list() {
      return Array.from(handlers.keys());
    },
  };
})();
