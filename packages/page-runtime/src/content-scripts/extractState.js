(function () {
  const ns = (globalThis.WebGPTExtractStateModules =
    globalThis.WebGPTExtractStateModules || {});

  if (!ns.controlBuilders || !ns.pageBuilders || !ns.scrollBuilders) {
    throw new Error("Extract state modules not loaded correctly.");
  }

  const { buildControls } = ns.controlBuilders;
  const { buildHeadings, buildVisibleTextSummary, buildOverlays, buildGroups } =
    ns.pageBuilders;
  const { buildScrollState, buildScrollableContainers } = ns.scrollBuilders;
  const adapterRegistry = globalThis.WebGPTContentAdapters || null;

  function extractState(meta = {}) {
    const controls = buildControls();
    const scrollableContainers = buildScrollableContainers();

    const state = {
      goal: meta.goal || "",
      step: meta.step || 1,
      url: location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      scroll: buildScrollState(),
      headings: buildHeadings(),
      visibleTextSummary: buildVisibleTextSummary(),
      overlays: buildOverlays(controls),
      groups: buildGroups(),
      controls,
      scrollableContainers,
      timestamp: new Date().toISOString(),
    };

    if (adapterRegistry?.enhanceState) {
      return adapterRegistry.enhanceState(state, meta);
    }

    return state;
  }

  globalThis.WebGPTExtractState = extractState;
})();
