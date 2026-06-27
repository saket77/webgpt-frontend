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

  function register(name, execute) {
    const key = typeof name === "string" ? name.trim() : "";
    if (!key || typeof execute !== "function") return;
    handlers.set(key, execute);
  }

  function has(name) {
    return handlers.has(typeof name === "string" ? name.trim() : "");
  }

  async function run(name, action, ctx) {
    const execute = handlers.get(typeof name === "string" ? name.trim() : "");
    if (!execute) {
      return { ok: false, detail: `No connector tool registered for ${name}` };
    }
    return execute(action || {}, ctx || {});
  }

  globalThis.WebGPTConnectorTools = {
    register,
    has,
    run,
    list() {
      return Array.from(handlers.keys());
    },
  };
})();
