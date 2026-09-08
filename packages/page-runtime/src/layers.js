export const PAGE_RUNTIME_WEBMCP_SCRIPT_FILES = Object.freeze([
  "content-scripts/webMcp.js",
]);

export const PAGE_RUNTIME_PRELUDE_SCRIPT_FILES = Object.freeze([
  "content-scripts/connectorTools.js",
  "content-scripts/extract-state/domUtils.js",
  "content-scripts/extract-state/elementMetadata.js",
  "content-scripts/extract-state/controlBuilders.js",
  "content-scripts/extract-state/pageBuilders.js",
  "content-scripts/extract-state/scrollBuilders.js",
  "content-scripts/adapters/registry.js",
]);

// This insertion order is both the packaged adapter catalog and the order used
// by the existing extension and Browserbase aggregate runtime.
export const PAGE_RUNTIME_ADAPTER_SCRIPT_FILES = Object.freeze({
  "canvas.quiz": "content-scripts/adapters/canvasQuiz.js",
  "yelp.local": "content-scripts/adapters/yelp.js",
  "ncm_movie_calendar.local": "content-scripts/adapters/ncmMovieCalendar.js",
  "docusign.local": "content-scripts/adapters/docusign.js",
  "dotloop.local": "content-scripts/adapters/dotloop.js",
  "ashby.application": "content-scripts/adapters/ashby.js",
  "greenhouse.application": "content-scripts/adapters/greenhouse.js",
  "investorgain.ipo_gmp_report": "content-scripts/adapters/investorGainIpo.js",
  "eprocure.latest_active_tenders": "content-scripts/adapters/eprocure.js",
});

export const PAGE_RUNTIME_ADAPTER_IDS = Object.freeze(
  Object.keys(PAGE_RUNTIME_ADAPTER_SCRIPT_FILES),
);

export const PAGE_RUNTIME_TAIL_SCRIPT_FILES = Object.freeze([
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
  "content-scripts/runner.js",
]);

export function canonicalPageRuntimeAdapterIds(adapterIds = []) {
  if (!Array.isArray(adapterIds)) {
    throw new TypeError("page-runtime adapterIds must be an array");
  }

  const selected = new Set();
  for (const adapterId of adapterIds) {
    if (typeof adapterId !== "string" || !adapterId.trim()) {
      throw new TypeError("page-runtime adapterIds must contain non-empty strings");
    }
    if (!Object.hasOwn(PAGE_RUNTIME_ADAPTER_SCRIPT_FILES, adapterId)) {
      throw new TypeError(`Unknown page-runtime adapter: ${adapterId}`);
    }
    if (selected.has(adapterId)) {
      throw new TypeError(`Duplicate page-runtime adapter: ${adapterId}`);
    }
    selected.add(adapterId);
  }

  return Object.freeze(
    PAGE_RUNTIME_ADAPTER_IDS.filter((adapterId) => selected.has(adapterId)),
  );
}

export function pageRuntimeScriptFilesFor(adapterIds = [], options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("page-runtime options must be an object");
  }
  const includeWebMcp = options.includeWebMcp ?? false;
  if (typeof includeWebMcp !== "boolean") {
    throw new TypeError("includeWebMcp must be a boolean");
  }
  const canonicalAdapterIds = canonicalPageRuntimeAdapterIds(adapterIds);
  const selected = new Set(canonicalAdapterIds);

  return Object.freeze([
    ...(includeWebMcp ? PAGE_RUNTIME_WEBMCP_SCRIPT_FILES : []),
    ...PAGE_RUNTIME_PRELUDE_SCRIPT_FILES,
    ...Object.entries(PAGE_RUNTIME_ADAPTER_SCRIPT_FILES)
      .filter(([adapterId]) => selected.has(adapterId))
      .map(([, sourceFile]) => sourceFile),
    ...PAGE_RUNTIME_TAIL_SCRIPT_FILES,
  ]);
}
