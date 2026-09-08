const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const GREENHOUSE_SOURCE = fs.readFileSync(
  path.join(
    ROOT,
    "packages/page-runtime/src/content-scripts/adapters/greenhouse.js",
  ),
  "utf8",
);

test("Greenhouse publishes compact planner metadata when JSON-LD is absent", (t) => {
  const dom = new JSDOM(
    `<!doctype html><html><head>
      <title>Job Application for Senior Software Engineer at Gametime</title>
      <meta property="og:title" content="Senior Software Engineer">
      <link rel="canonical" href="https://job-boards.greenhouse.io/gametime/jobs/123">
    </head><body>
      <header>
        <h1 class="job__title">Senior Software Engineer</h1>
        <div class="job__location">United States</div>
      </header>
      <main id="content">
        <h2>About the role</h2>
        <p>Build reliable consumer products and agent-backed workflows.</p>
        <h3>What you will do</h3>
        <ul><li>Ship end-to-end features.</li><li>Own production quality.</li></ul>
        <form id="application-form" class="application--form">
          <section class="application--questions">
            <div class="field-wrapper" data-field-path="first_name">
              <label for="first_name">First Name Private Answer</label>
              <input id="first_name" value="Sensitive Value">
            </div>
          </section>
          <button class="application--submit" type="submit">Submit application</button>
        </form>
      </main>
    </body></html>`,
    {
      pretendToBeVisual: true,
      runScripts: "outside-only",
      url: "https://job-boards.greenhouse.io/gametime/jobs/123",
    },
  );
  t.after(() => dom.window.close());

  const { window } = dom;
  const adapters = [];
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 640,
      bottom: 40,
      width: 640,
      height: 40,
      toJSON() {
        return this;
      },
    };
  };
  window.WebGPTContentAdapters = {
    register(adapter) {
      adapters.push(adapter);
    },
  };
  window.WebGPTConnectorTools = { register() {} };
  window.eval(GREENHOUSE_SOURCE);

  assert.equal(window.document.querySelectorAll('script[type="application/ld+json"]').length, 0);
  assert.equal(adapters.length, 1);
  const state = adapters[0].enhanceState({
    state: { controls: [], groups: [], visibleTextSummary: [] },
    document: window.document,
    url: window.location.href,
  });
  const posting = state.siteAdapter.jobPosting;

  assert.equal(posting["@type"], "JobPosting");
  assert.equal(posting.source, "greenhouse_dom");
  assert.equal(posting.title, "Senior Software Engineer");
  assert.equal(posting.company, "Gametime");
  assert.equal(posting.location, "United States");
  assert.equal(posting.hiringOrganization.name, "Gametime");
  assert.equal(posting.jobLocation.address.addressLocality, "United States");
  assert.equal(
    posting.url,
    "https://job-boards.greenhouse.io/gametime/jobs/123",
  );
  const fullDescription = [
    "About the role",
    "Build reliable consumer products and agent-backed workflows.",
    "What you will do",
    "- Ship end-to-end features.",
    "- Own production quality.",
  ].join("\n");
  assert.equal(Object.hasOwn(posting, "description"), false);
  assert.equal(posting.descriptionAvailableViaTool, true);
  assert.equal(posting.descriptionCharCount, fullDescription.length);
  assert.equal(posting.descriptionTruncated, false);
  assert.equal(posting.descriptionOriginalCharCount, fullDescription.length);
  assert.doesNotMatch(
    JSON.stringify(state),
    /Ship end-to-end features|Own production quality/,
  );
});
