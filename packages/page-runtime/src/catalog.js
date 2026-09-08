import { PAGE_RUNTIME_ADAPTER_SCRIPT_FILES } from "./layers.js";

export const PAGE_RUNTIME_SCHEMA_VERSION = 1;
export const PAGE_RUNTIME_ABI = "webgpt-page-runtime-iife-v1";
export const PAGE_RUNTIME_PACKAGE_NAME = "@webgpt-mundhada/page-runtime";
export const PAGE_RUNTIME_RELEASE_VERSION = "1.0.0-rc.1";

const ADAPTER_CANDIDATE_HINTS = {
  "canvas.quiz": {
    priority: 100,
    matchHints: {
      hostnameSuffixes: [".instructure.com", ".canvaslms.com"],
      pathnamePatterns: ["/quizzes/"],
      domSelectors: ["#questions", "#question_list", ".quiz-submission"],
    },
  },
  "yelp.local": {
    priority: 90,
    matchHints: {
      hostnames: ["yelp.com"],
      hostnameSuffixes: [".yelp.com"],
    },
  },
  "ncm_movie_calendar.local": {
    priority: 80,
    matchHints: {
      hostnames: ["moviereleasecalendar.ncm.com"],
      domSelectors: [
        "ngx-movie-filter-results",
        "ngx-movie-view-detail",
        "[id^='detailContainer']",
      ],
    },
  },
  "docusign.local": {
    priority: 85,
    matchHints: {
      hostnames: ["apps.docusign.com"],
      hostnameSuffixes: [".apps.docusign.com"],
      pathnamePatterns: ["/send"],
    },
  },
  "dotloop.local": {
    priority: 80,
    matchHints: {
      hostnames: ["dotloop.com"],
      hostnameSuffixes: [".dotloop.com"],
      domSelectors: ["body.Loops", ".document-editor", "#loop-card-grid"],
    },
  },
  "ashby.application": {
    priority: 85,
    matchHints: {
      protocols: ["https:"],
      hostnames: ["ashbyhq.com", "jobs.ashbyhq.com"],
      hostnameSuffixes: [".ashbyhq.com"],
      domSelectors: [
        ".ashby-application-form-container",
        ".ashby-job-posting-right-pane",
        ".ashby-job-posting-heading",
      ],
    },
  },
  "greenhouse.application": {
    priority: 84,
    matchHints: {
      protocols: ["https:"],
      hostnames: [
        "job-boards.greenhouse.io",
        "job-boards.eu.greenhouse.io",
        "boards.greenhouse.io",
      ],
      hostnameSuffixes: [".greenhouse.io"],
      pathnamePatterns: ["^/[^/]+/jobs/[^/]+/?$"],
      domSelectors: ["form#application-form", "form.application--form"],
    },
  },
  "investorgain.ipo_gmp_report": {
    priority: 75,
    matchHints: {
      hostnames: ["investorgain.com", "www.investorgain.com"],
      pathnamePatterns: ["/report/(live-ipo-gmp|ipo-gmp-live)/331"],
    },
  },
  "eprocure.latest_active_tenders": {
    priority: 70,
    matchHints: {
      hostnames: ["eprocure.gov.in"],
      hostnameSuffixes: [".eprocure.gov.in"],
      searchParams: {
        page: ["FrontEndLatestActiveTendersOrgwise"],
      },
    },
  },
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function definitionFor(adapterId, sourceFile) {
  const candidate = ADAPTER_CANDIDATE_HINTS[adapterId];
  if (!candidate) {
    throw new Error(`Missing page-runtime catalog metadata for ${adapterId}`);
  }

  return deepFreeze({
    id: adapterId,
    version: PAGE_RUNTIME_RELEASE_VERSION,
    runtimeAbi: PAGE_RUNTIME_ABI,
    priority: candidate.priority,
    matchHints: structuredClone(candidate.matchHints),
    sourceFile,
    artifact: {
      file: `assets/adapters/${adapterId}.js`,
    },
  });
}

export const PAGE_RUNTIME_ADAPTER_DEFINITIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(PAGE_RUNTIME_ADAPTER_SCRIPT_FILES).map(
      ([adapterId, sourceFile]) => [adapterId, definitionFor(adapterId, sourceFile)],
    ),
  ),
);

export function getPageRuntimeAdapterDefinition(adapterId) {
  return Object.hasOwn(PAGE_RUNTIME_ADAPTER_DEFINITIONS, adapterId)
    ? PAGE_RUNTIME_ADAPTER_DEFINITIONS[adapterId]
    : null;
}

export function listPageRuntimeAdapters() {
  return Object.freeze(
    Object.values(PAGE_RUNTIME_ADAPTER_DEFINITIONS).map((definition) =>
      deepFreeze(structuredClone(definition)),
    ),
  );
}
