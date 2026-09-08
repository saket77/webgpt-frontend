const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

const CASES = [
  {
    name: "Ashby",
    adapterId: "ashby.application",
    url: "https://jobs.ashbyhq.com/example/application",
    readTool: "ashby_read_job_description",
    html: `<!doctype html><html><head><title>Staff Runtime Engineer</title></head><body>
      <aside aria-label="Browser assistance">
        <h2>Application help</h2>
        <div role="group" aria-label="Cookie preferences">
          <p>Cookie settings remain available while you complete the form.</p>
          <button type="button">Dismiss cookie banner</button>
        </div>
      </aside>
      <main class="ashby-job-posting-right-pane">
        <h1 class="ashby-job-posting-heading">Staff Runtime Engineer</h1>
        <section class="ashby-job-posting-description">
          <h2>About the role</h2>
          <p>JD_DENSITY_MARKER Build deterministic browser runtimes with compact semantic observations.</p>
          <h3>What you will do</h3>
          <ul><li>Own adapter-first state extraction.</li><li>Verify every page action.</li></ul>
        </section>
        <div class="ashby-application-form-container">
          <div class="ashby-application-form-field-entry" data-field-path="full_name">
            <div class="ashby-application-form-question-title">Full Name</div>
            <input id="full_name" required>
          </div>
          <button class="ashby-application-form-submit-button" type="submit">Submit Application</button>
        </div>
      </main>
    </body></html>`,
  },
  {
    name: "Greenhouse",
    adapterId: "greenhouse.application",
    url: "https://job-boards.greenhouse.io/example/jobs/123",
    readTool: "greenhouse_read_job_description",
    html: `<!doctype html><html><head>
      <title>Job Application for Staff Runtime Engineer at Example Labs</title>
    </head><body>
      <header>
        <h1 class="job__title">Staff Runtime Engineer</h1>
        <div class="job__company">Example Labs</div>
        <div class="job__location">Remote</div>
      </header>
      <aside aria-label="Browser assistance">
        <h2>Application help</h2>
        <div role="group" aria-label="Cookie preferences">
          <p>Cookie settings remain available while you complete the form.</p>
          <button type="button">Dismiss cookie banner</button>
        </div>
      </aside>
      <main id="content">
        <section class="job__description">
          <h2>About the role</h2>
          <p>JD_DENSITY_MARKER Build deterministic browser runtimes with compact semantic observations.</p>
          <h3>What you will do</h3>
          <ul><li>Own adapter-first state extraction.</li><li>Verify every page action.</li></ul>
        </section>
        <form id="application-form" class="application--form">
          <section class="application--questions">
            <div class="field-wrapper" data-field-path="full_name">
              <label for="full_name">Full Name *</label>
              <input id="full_name" required>
            </div>
          </section>
          <button class="application--submit" type="submit">Submit application</button>
        </form>
      </main>
    </body></html>`,
  },
];

async function loadSelectiveRuntime(window, adapterId) {
  const { pageRuntimeScriptFilesFor } = await import(
    "../packages/page-runtime/src/layers.js"
  );
  for (const relativePath of pageRuntimeScriptFilesFor([adapterId])) {
    window.eval(
      fs.readFileSync(
        path.join(ROOT, "packages/page-runtime/src", relativePath),
        "utf8",
      ),
    );
  }
}

function createDom(config) {
  const dom = new JSDOM(config.html, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: config.url,
  });
  const { window } = dom;
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
  window.HTMLElement.prototype.scrollIntoView = () => {};
  return dom;
}

for (const config of CASES) {
  test(`${config.name} selective runtime removes duplicate JD chunks after full extraction`, async (t) => {
    const dom = createDom(config);
    t.after(() => dom.window.close());
    await loadSelectiveRuntime(dom.window, config.adapterId);

    const state = dom.window.WebGPTExtractState({ goal: "prepare application" });
    assert.deepEqual(Array.from(state.adapterInfo.activeAdapterIds), [config.adapterId]);

    const plannerPosting = state.siteAdapter.jobPosting;
    assert.equal(Object.hasOwn(plannerPosting, "description"), false);
    assert.equal(plannerPosting.descriptionAvailableViaTool, true);
    assert.equal(plannerPosting.descriptionTruncated, false);
    assert.equal(
      plannerPosting.descriptionCharCount,
      plannerPosting.descriptionOriginalCharCount,
    );

    assert.doesNotMatch(JSON.stringify(state.visibleTextSummary), /JD_DENSITY_MARKER/);
    assert.doesNotMatch(JSON.stringify(state.groups), /JD_DENSITY_MARKER/);
    assert.doesNotMatch(JSON.stringify(state.headings), /About the role|What you will do/);

    assert.match(JSON.stringify(state.visibleTextSummary), /Cookie settings remain available/);
    assert.ok(
      state.groups.some((group) => group.label === "Cookie preferences"),
      "non-JD generic groups remain available as fallback context",
    );
    assert.ok(state.headings.includes("Application help"));
    assert.ok(
      state.controls.some((control) => /Dismiss cookie banner/i.test(control.text)),
      "non-JD generic controls remain available",
    );

    const readResult = await dom.window.WebGPTConnectorTools.run(
      config.readTool,
      {},
      {},
    );
    assert.equal(readResult.ok, true);
    assert.match(readResult.jobPosting.description, /JD_DENSITY_MARKER/);
    assert.equal(readResult.jobPosting.descriptionTruncated, false);
    assert.equal(
      readResult.jobPosting.description.length,
      readResult.jobPosting.descriptionOriginalCharCount,
    );
  });
}
