(function () {
  const ns = window.WebGPTRunnerModules || {};

  if (!ns.actions || typeof ns.actions.runActions !== "function") {
    throw new Error("WebGPTRunner modules not loaded correctly.");
  }

  window.WebGPTRunner = {
    runActions: ns.actions.runActions,
    runReplaySteps: ns.replayRunner.runReplaySteps,
  };
})();
