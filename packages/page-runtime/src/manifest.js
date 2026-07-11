export const PAGE_RUNTIME_SCRIPT_FILES = [
  "content-scripts/webMcp.js",
  "content-scripts/connectorTools.js",
  "content-scripts/extract-state/domUtils.js",
  "content-scripts/extract-state/elementMetadata.js",
  "content-scripts/extract-state/controlBuilders.js",
  "content-scripts/extract-state/pageBuilders.js",
  "content-scripts/extract-state/scrollBuilders.js",
  "content-scripts/adapters/registry.js",
  "content-scripts/adapters/canvasQuiz.js",
  "content-scripts/adapters/yelp.js",
  "content-scripts/adapters/ncmMovieCalendar.js",
  "content-scripts/adapters/docusign.js",
  "content-scripts/adapters/dotloop.js",
  "content-scripts/adapters/ashby.js",
  "content-scripts/adapters/greenhouse.js",
  "content-scripts/adapters/investorGainIpo.js",
  "content-scripts/adapters/eprocure.js",
  "content-scripts/extractState.js",
  "content-scripts/runner/domUtils.js",
  "content-scripts/runner/elementSnapshot.js",
  "content-scripts/runner/candidates.js",
  "content-scripts/runner/controlScoring.js",
  "content-scripts/runner/resolver.js",
  "content-scripts/runner/scrollResolver.js",
  "content-scripts/runner/primitives.js",
  "content-scripts/runner/trace.js",
  "content-scripts/runner/collectionExtractor.js",
  "content-scripts/runner/actions.js",
  "content-scripts/runner/replayRunner.js",
  "content-scripts/runner.js"
];

export const EXTENSION_BRIDGE_SCRIPT_FILES = [
  "content-scripts/agent.js"
];

export const EXTENSION_CONTENT_SCRIPT_FILES = [
  ...PAGE_RUNTIME_SCRIPT_FILES,
  ...EXTENSION_BRIDGE_SCRIPT_FILES
];
