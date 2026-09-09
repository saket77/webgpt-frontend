const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const source = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const REGISTRY_SOURCE = source(
  "packages/page-runtime/src/content-scripts/adapters/registry.js",
);
const CONNECTOR_SOURCE = source(
  "packages/page-runtime/src/content-scripts/connectorTools.js",
);
const JOB_DESCRIPTION_BODY = "Build reliable browser agents. ".repeat(900).trim();

const CASES = [
  {
    name: "Ashby",
    adapterFile: "ashby.js",
    url: "https://jobs.ashbyhq.com/example/application",
    readTool: "ashby_read_job_description",
    provides: {
      "job.description.read": "ashby_read_job_description",
      "application.read": "ashby_read_application",
      "application.fill": "ashby_fill_application_fields",
      "application.eeoc.fill": "ashby_fill_eeoc",
      "application.file.upload": "ashby_upload_application_file",
      "application.submit": "ashby_submit_application",
    },
    uploadTool: "ashby_upload_application_file",
    submitTool: "ashby_submit_application",
    adapterId: "ashby.application",
    fieldGroupKind: "ashby_application_field",
    uploadTargetId: "ashby_resume_input",
    uploadSelector: "#resume",
    submitTargetId: "ashby_submit",
    html: `<!doctype html><html><head>
      <script type="application/ld+json">{
        "@context":"https://schema.org",
        "@type":"JobPosting",
        "title":"Staff Product Engineer",
        "description":"<h2>About the role</h2><p>${JOB_DESCRIPTION_BODY}</p>",
        "hiringOrganization":{"name":"Example Labs"},
        "jobLocation":{"address":{"addressLocality":"Philadelphia","addressRegion":"PA"}},
        "jobLocationType":"TELECOMMUTE",
        "validThrough":"2026-12-31",
        "baseSalary":{"currency":"USD","value":{"minValue":150000,"maxValue":190000,"unitText":"YEAR"}}
      }</script>
    </head><body>
      <main class="ashby-job-posting-right-pane"><h1 class="ashby-job-posting-heading">Staff Product Engineer</h1>
      <div class="ashby-application-form-container">
        <div class="ashby-application-form-field-entry" data-field-path="full_name" data-top="0" data-height="40">
          <div class="ashby-application-form-question-title">Full Name</div>
          <input id="ashby_full_name" data-readiness-field required value="PRIVATE_CURRENT_VALUE">
        </div>
        <div class="ashby-application-form-field-entry" data-field-path="resume" data-top="0" data-height="100">
          <div class="ashby-application-form-question-title">Resume</div>
          <div class="ashby-application-form-input-file">
            <button id="ashby_upload" type="button" data-top="10">Upload File</button>
            <input id="resume" type="file" tabindex="-1" data-top="30" data-height="1" required
              style="border:0;clip:rect(0,0,0,0);clip-path:inset(50%);height:1px;overflow:hidden;position:absolute;width:1px">
            <span class="ashby-application-form-input-file-item-name" data-committed-file>resume.pdf</span>
          </div>
        </div>
        <button class="ashby-application-form-submit-button" type="submit" data-top="150">Submit Application</button>
      </div></main>
    </body></html>`,
    controls: [
      {
        id: "ashby_resume_button",
        selector: "#ashby_upload",
        tag: "button",
        type: "button",
        controlType: "button",
        visible: true,
        enabled: true,
        text: "Upload File",
        bounds: bounds(10),
      },
      {
        id: "ashby_resume_input",
        selector: "#resume",
        tag: "input",
        type: "file",
        controlType: "file",
        visible: true,
        enabled: true,
        bounds: bounds(30),
      },
      {
        id: "ashby_submit",
        selector: ".ashby-application-form-submit-button",
        tag: "button",
        type: "submit",
        controlType: "button",
        visible: true,
        enabled: true,
        text: "Submit Application",
        bounds: bounds(150),
      },
    ],
  },
  {
    name: "Greenhouse",
    adapterFile: "greenhouse.js",
    url: "https://job-boards.greenhouse.io/example/jobs/123",
    readTool: "greenhouse_read_job_description",
    provides: {
      "job.description.read": "greenhouse_read_job_description",
      "application.read": "greenhouse_read_application",
      "application.fill": "greenhouse_fill_application_fields",
      "application.eeoc.fill": "greenhouse_fill_eeoc",
      "application.file.upload": "greenhouse_upload_application_file",
      "application.submit": "greenhouse_submit_application",
    },
    uploadTool: "greenhouse_upload_application_file",
    submitTool: "greenhouse_submit_application",
    adapterId: "greenhouse.application",
    fieldGroupKind: "greenhouse_application_field",
    uploadTargetId: "greenhouse_resume_button",
    uploadSelector:
      '.file-upload:has(#resume) .secondary-button:has(label[for="resume"]) button',
    submitTargetId: "greenhouse_submit",
    html: `<!doctype html><html><body>
      <header><h1 class="job__title">Staff Product Engineer</h1><div class="job__company">Example Labs</div><div class="job__location">Philadelphia, PA</div></header>
      <main id="content"><section class="job__description"><h2>About the role</h2><p>${JOB_DESCRIPTION_BODY}</p></section>
        <form id="application-form" class="application--form">
          <section class="application--questions">
            <div class="field-wrapper" data-field-path="full_name" data-top="0" data-height="40">
              <label for="greenhouse_full_name">Full Name *</label>
              <input id="greenhouse_full_name" data-readiness-field required value="PRIVATE_CURRENT_VALUE">
            </div>
            <div class="field-wrapper" data-field-path="resume" data-top="0" data-height="100">
              <div id="upload-label-resume">Resume/CV *</div>
              <div class="file-upload"><div class="secondary-button">
                <button id="greenhouse_upload" type="button" data-top="10">Attach</button>
                <label for="resume" style="display:none">Attach</label>
                <input id="resume" type="file" data-top="30" style="display:none" required>
                <span class="file-upload__filename" data-committed-file>resume.pdf</span>
              </div></div>
            </div>
          </section>
          <button class="application--submit" type="submit" data-top="150">Submit application</button>
        </form>
      </main>
    </body></html>`,
    controls: [
      {
        id: "greenhouse_resume_button",
        selector: "#greenhouse_upload",
        tag: "button",
        type: "button",
        controlType: "button",
        visible: true,
        enabled: true,
        text: "Attach",
        bounds: bounds(10),
      },
      {
        id: "greenhouse_submit",
        selector: ".application--submit",
        tag: "button",
        type: "submit",
        controlType: "button",
        visible: true,
        enabled: true,
        text: "Submit application",
        bounds: bounds(150),
      },
    ],
  },
];

function bounds(top, height = 20) {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 640,
    bottom: top + height,
    width: 640,
    height,
    toJSON() {
      return this;
    },
  };
}

function createFixture(config) {
  const dom = new JSDOM(config.html, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: config.url,
  });
  const { window } = dom;
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return bounds(
      Number(this.getAttribute("data-top") || 0),
      Number(this.getAttribute("data-height") || 20),
    );
  };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.eval(REGISTRY_SOURCE);
  window.eval(CONNECTOR_SOURCE);
  window.eval(
    source(`packages/page-runtime/src/content-scripts/adapters/${config.adapterFile}`),
  );
  window.document.querySelector("form")?.addEventListener("submit", (event) =>
    event.preventDefault(),
  );
  return { dom, window };
}

function extract(fixture, config, meta = {}) {
  return fixture.window.WebGPTContentAdapters.enhanceState(
    {
      url: config.url,
      title: config.name,
      controls: config.controls,
      groups: [],
      visibleTextSummary: [],
    },
    meta,
  );
}

for (const config of CASES) {
  test(`${config.name} declares an exact host-private capability map`, (t) => {
    const fixture = createFixture(config);
    t.after(() => fixture.dom.window.close());

    const first = fixture.window.WebGPTContentAdapters.getAdapterProvides(
      config.adapterId,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(first)), config.provides);
    assert.equal(Object.isFrozen(first), true);

    const second = fixture.window.WebGPTContentAdapters.getAdapterProvides(
      config.adapterId,
    );
    assert.notEqual(first, second);
    assert.deepEqual(JSON.parse(JSON.stringify(second)), config.provides);
    assert.equal(
      fixture.window.WebGPTContentAdapters.getAdapterProvides("unknown.adapter"),
      null,
    );

    const plannerState = extract(fixture, config, {
      capabilities: { hostFileUpload: true, guardedSubmit: true },
    });
    const serializedState = JSON.stringify(plannerState);
    assert.equal(serializedState.includes('"provides"'), false);
    for (const capability of Object.keys(config.provides)) {
      assert.equal(serializedState.includes(capability), false);
    }
  });

  test(`${config.name} owns read, host-upload, and guarded-submit tool contracts`, async (t) => {
    const fixture = createFixture(config);
    t.after(() => fixture.dom.window.close());

    const normalState = extract(fixture, config);
    const plannerPosting = normalState.siteAdapter.jobPosting;
    assert.equal(Object.hasOwn(plannerPosting, "description"), false);
    assert.equal(plannerPosting.descriptionAvailableViaTool, true);
    assert.equal(plannerPosting.descriptionCharCount, 24_000);
    assert.equal(plannerPosting.descriptionTruncated, true);
    assert.ok(
      plannerPosting.descriptionOriginalCharCount >
        plannerPosting.descriptionCharCount,
    );
    assert.equal(JSON.stringify(normalState).includes(JOB_DESCRIPTION_BODY.slice(0, 120)), false);
    const normalNames = normalState.connectorTools.map(({ name }) => name);
    assert.ok(normalNames.includes(config.readTool));
    assert.equal(normalNames.includes(config.uploadTool), false);
    assert.equal(normalNames.includes(config.submitTool), false);
    assert.deepEqual(
      Object.keys(fixture.window.WebGPTContentAdapters.getPrivateToolRoutes()),
      [config.readTool],
    );
    assert.equal(fixture.window.WebGPTConnectorTools.has(config.submitTool), false);

    const privilegedState = extract(fixture, config, {
      capabilities: { hostFileUpload: true, guardedSubmit: true },
    });
    const names = privilegedState.connectorTools.map(({ name }) => name);
    assert.ok(names.includes(config.readTool));
    assert.ok(names.includes(config.uploadTool));
    assert.ok(names.includes(config.submitTool));
    assert.equal(JSON.stringify(privilegedState.connectorTools).includes("execution"), false);
    assert.equal("connectorToolRoutes" in privilegedState, false);

    const uploadSchema = privilegedState.connectorTools.find(
      ({ name }) => name === config.uploadTool,
    );
    assert.deepEqual(Array.from(uploadSchema.parameters.required), ["fieldKey", "filePath"]);
    assert.deepEqual(
      Array.from(uploadSchema.parameters.properties.fieldKey.enum),
      ["resume"],
    );

    const routes = fixture.window.WebGPTContentAdapters.getPrivateToolRoutes();
    assert.equal(routes[config.readTool].realm, "page");
    assert.equal(routes[config.readTool].capability, null);
    assert.equal(routes[config.readTool].effect, "read");
    assert.deepEqual(Array.from(routes[config.readTool].sensitiveArguments), []);
    assert.equal(routes[config.uploadTool].realm, "host");
    assert.equal(routes[config.uploadTool].capability, "browser.file-upload");
    assert.equal(routes[config.uploadTool].effect, "file-upload");
    assert.deepEqual(Array.from(routes[config.uploadTool].sensitiveArguments), ["filePath"]);
    assert.equal(routes[config.uploadTool].targets[0].targetId, config.uploadTargetId);
    assert.equal(routes[config.uploadTool].targets[0].selector, config.uploadSelector);
    if (config.name === "Ashby") {
      assert.deepEqual(
        JSON.parse(JSON.stringify(routes[config.uploadTool].targets[0].activation)),
        { kind: "file-input-picker" },
      );
      const pickerTarget = fixture.window.document.querySelector(
        routes[config.uploadTool].targets[0].selector,
      );
      assert.equal(pickerTarget?.tagName, "INPUT");
      assert.equal(pickerTarget?.type, "file");
      assert.equal(pickerTarget?.tabIndex, -1);
    } else {
      assert.equal("activation" in routes[config.uploadTool].targets[0], false);
    }
    assert.equal(
      routes[config.uploadTool].targets[0].verification.groupKind,
      config.fieldGroupKind,
    );
    assert.equal(fixture.window.WebGPTConnectorTools.has(config.uploadTool), false);
    assert.equal(fixture.window.WebGPTConnectorTools.has(config.submitTool), true);

    const submitRoute = routes[config.submitTool];
    assert.equal(submitRoute.realm, "page");
    assert.equal(submitRoute.capability, "guarded-submit");
    assert.equal(submitRoute.effect, "submit");
    assert.equal(submitRoute.requiresAuthorization, true);
    assert.equal(submitRoute.target.targetId, config.submitTargetId);
    assert.equal(
      fixture.window.document.querySelectorAll(submitRoute.target.selector).length,
      1,
    );
    assert.ok(submitRoute.authorizationToken);

    let clicked = false;
    const primitives = {
      async clickElement(element) {
        clicked = true;
        element.click();
      },
    };
    const denied = await fixture.window.WebGPTConnectorTools.run(
      config.submitTool,
      {},
      { primitives },
    );
    assert.equal(denied.ok, false);
    assert.equal(clicked, false);

    const submitted = await fixture.window.WebGPTConnectorTools.run(
      config.submitTool,
      { __webgptAuthorizationToken: submitRoute.authorizationToken },
      { state: privilegedState, primitives },
    );
    assert.equal(submitted.ok, true);
    assert.equal(submitted.submitted, true);
    assert.equal(clicked, true);

    const replay = await fixture.window.WebGPTConnectorTools.run(
      config.submitTool,
      { __webgptAuthorizationToken: submitRoute.authorizationToken },
      { primitives },
    );
    assert.equal(replay.ok, false);

    const read = await fixture.window.WebGPTConnectorTools.run(config.readTool, {}, {});
    assert.equal(read.ok, true);
    assert.equal(read.jobPosting.title, "Staff Product Engineer");
    assert.match(read.jobPosting.description, /Build reliable browser agents/);
    assert.doesNotMatch(read.jobPosting.description, /Resume\/CV|Submit application/);
    assert.equal(plannerPosting.descriptionCharCount, read.jobPosting.description.length);
    assert.equal(read.jobPosting.descriptionTruncated, true);
    assert.ok(
      read.jobPosting.descriptionOriginalCharCount >
        read.jobPosting.description.length,
    );
    assert.equal("descriptionAvailableViaTool" in read.jobPosting, false);
    assert.equal("descriptionCharCount" in read.jobPosting, false);

    const legacyState = {
      ...normalState,
      siteAdapter: {
        ...normalState.siteAdapter,
        jobPosting: read.jobPosting,
      },
    };
    const compactChars = JSON.stringify(normalState).length;
    const legacyChars = JSON.stringify(legacyState).length;
    assert.ok(
      (legacyChars - compactChars) / legacyChars >= 0.5,
      `${config.name} planner-state description reduction was below 50%`,
    );
    if (config.name === "Ashby") {
      assert.equal(read.jobPosting.jobLocationType, "TELECOMMUTE");
      assert.equal(read.jobPosting.validThrough, "2026-12-31");
      assert.deepEqual(JSON.parse(JSON.stringify(read.jobPosting.baseSalary)), {
        currency: "USD",
        value: { minValue: 150000, maxValue: 190000, unitText: "YEAR" },
      });
    }

    const freshDescription = `${config.name} freshly extracted description`;
    if (config.name === "Ashby") {
      const script = fixture.window.document.querySelector(
        'script[type="application/ld+json"]',
      );
      const structured = JSON.parse(script.textContent);
      structured.description = `<p>${freshDescription}</p>`;
      script.textContent = JSON.stringify(structured);
    } else {
      fixture.window.document.querySelector(".job__description").textContent =
        freshDescription;
    }
    const refreshedRead = await fixture.window.WebGPTConnectorTools.run(
      config.readTool,
      {},
      {},
    );
    assert.equal(refreshedRead.ok, true);
    assert.equal(refreshedRead.jobPosting.description, freshDescription);
  });

  test(`${config.name} discovers its read tool from a fresh full extraction`, (t) => {
    const fixture = createFixture(config);
    t.after(() => fixture.dom.window.close());
    const compactState = extract(fixture, config);
    assert.equal(Object.hasOwn(compactState.siteAdapter.jobPosting, "description"), false);

    if (config.name === "Ashby") {
      fixture.window.document
        .querySelector('script[type="application/ld+json"]')
        .remove();
      fixture.window.document
        .querySelector(".ashby-job-posting-right-pane")
        .classList.remove("ashby-job-posting-right-pane");
    } else {
      fixture.window.document.querySelector(".job__description").remove();
    }

    const adapter = fixture.window.WebGPTContentAdapters.list()[0];
    const tools = adapter.provideTools({
      state: compactState,
      document: fixture.window.document,
    });
    assert.equal(tools.some(({ schema, name }) => (schema?.name || name) === config.readTool), false);
  });

  test(`${config.name} publishes only a unique submit target and keeps fallback identity exact`, (t) => {
    const fallbackFixture = createFixture(config);
    t.after(() => fallbackFixture.dom.window.close());
    const fallbackButton = fallbackFixture.window.document.querySelector(
      "button[type='submit']",
    );
    fallbackButton.className = "";
    fallbackButton.id = `${config.adapterId.replace(/\W+/g, "_")}_fallback_submit`;
    const fallbackState = extract(fallbackFixture, config, {
      capabilities: { guardedSubmit: true },
    });
    const fallbackRoute =
      fallbackFixture.window.WebGPTContentAdapters.getPrivateToolRoutes()[
        config.submitTool
      ];
    assert.ok(
      fallbackState.connectorTools.some(({ name }) => name === config.submitTool),
    );
    assert.equal(fallbackRoute.target.targetId, config.submitTargetId);
    assert.equal(fallbackRoute.target.selector, `#${fallbackButton.id}`);
    assert.equal(
      fallbackFixture.window.document.querySelector(fallbackRoute.target.selector),
      fallbackButton,
    );

    const ambiguousFixture = createFixture(config);
    t.after(() => ambiguousFixture.dom.window.close());
    const original = ambiguousFixture.window.document.querySelector(
      "button[type='submit']",
    );
    const duplicate = original.cloneNode(true);
    duplicate.id = `${config.adapterId.replace(/\W+/g, "_")}_duplicate_submit`;
    original.parentElement.append(duplicate);
    const ambiguousState = extract(ambiguousFixture, config, {
      capabilities: { guardedSubmit: true },
    });
    assert.equal(
      ambiguousState.connectorTools.some(({ name }) => name === config.submitTool),
      false,
    );
    assert.equal(
      config.submitTool in
        ambiguousFixture.window.WebGPTContentAdapters.getPrivateToolRoutes(),
      false,
    );
    assert.equal(
      ambiguousState.controls.find(({ id }) => id === config.submitTargetId)
        ?.adapterHints?.[config.adapterId]?.protectedEffect,
      "submit",
    );

    const disabledFixture = createFixture(config);
    t.after(() => disabledFixture.dom.window.close());
    disabledFixture.window.document.querySelector("button[type='submit']").disabled = true;
    const disabledState = extract(disabledFixture, config, {
      capabilities: { guardedSubmit: true },
    });
    assert.equal(disabledState.siteAdapter.submitTargetId, config.submitTargetId);
    assert.equal(
      disabledState.connectorTools.some(({ name }) => name === config.submitTool),
      false,
    );
    assert.equal(
      disabledState.controls.find(({ id }) => id === config.submitTargetId)
        ?.adapterHints?.[config.adapterId]?.protectedEffect,
      "submit",
    );
  });

  test(`${config.name} submit rechecks required text and file state without returning values`, async (t) => {
    const fixture = createFixture(config);
    t.after(() => fixture.dom.window.close());
    let clicked = false;
    const primitives = {
      async clickElement() {
        clicked = true;
      },
    };

    let state = extract(fixture, config, {
      capabilities: { guardedSubmit: true },
    });
    let route = fixture.window.WebGPTContentAdapters.getPrivateToolRoutes()[
      config.submitTool
    ];
    const textInput = fixture.window.document.querySelector("[data-readiness-field]");
    textInput.value = "";
    const missingText = await fixture.window.WebGPTConnectorTools.run(
      config.submitTool,
      { __webgptAuthorizationToken: route.authorizationToken },
      { state, primitives },
    );
    assert.equal(missingText.ok, false);
    assert.equal(missingText.code, "APPLICATION_NOT_READY");
    assert.equal(clicked, false);
    assert.ok(
      missingText.missingRequiredFields.some(
        ({ fieldKey, fieldKind }) =>
          fieldKey === "full_name" && fieldKind !== "file",
      ),
    );
    assert.equal(JSON.stringify(missingText).includes("PRIVATE_CURRENT_VALUE"), false);
    assert.deepEqual(
      Object.keys(missingText.missingRequiredFields[0]).sort(),
      ["fieldKey", "fieldKind", "label"],
    );

    textInput.value = "PRIVATE_CURRENT_VALUE";
    fixture.window.document.querySelector("[data-committed-file]").remove();
    state = extract(fixture, config, {
      capabilities: { guardedSubmit: true },
    });
    route = fixture.window.WebGPTContentAdapters.getPrivateToolRoutes()[
      config.submitTool
    ];
    const missingFile = await fixture.window.WebGPTConnectorTools.run(
      config.submitTool,
      { __webgptAuthorizationToken: route.authorizationToken },
      { state, primitives },
    );
    assert.equal(missingFile.ok, false);
    assert.equal(missingFile.code, "APPLICATION_NOT_READY");
    assert.equal(clicked, false);
    assert.ok(
      missingFile.missingRequiredFields.some(
        ({ fieldKey, fieldKind }) => fieldKey === "resume" && fieldKind === "file",
      ),
    );
    assert.equal(JSON.stringify(missingFile).includes("resume.pdf"), false);
  });
}

test("registry keeps legacy adapters additive and clones host-private reads", (t) => {
  const dom = new JSDOM("<!doctype html><title>Registry</title>", {
    runScripts: "outside-only",
    url: "https://example.test/",
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.eval(REGISTRY_SOURCE);

  const legacy = {
    type: "function",
    name: "legacy_tool",
    description: "unchanged",
    parameters: { type: "object", properties: {} },
  };
  let receivedMeta;
  window.WebGPTContentAdapters.register({
    id: "example.adapter",
    match: () => true,
    enhanceState: ({ state }) => state,
    provideTools: ({ meta }) => {
      receivedMeta = meta;
      return [legacy];
    },
  });
  const meta = { capabilities: { custom: true } };
  const state = window.WebGPTContentAdapters.enhanceState(
    { url: window.location.href, controls: [], groups: [] },
    meta,
  );
  assert.equal(state.connectorTools[0], legacy);
  assert.equal(receivedMeta, meta);

  const legacyProvides = window.WebGPTContentAdapters.getAdapterProvides(
    "example.adapter",
  );
  assert.deepEqual(JSON.parse(JSON.stringify(legacyProvides)), {});
  assert.equal(Object.isFrozen(legacyProvides), true);
  assert.notEqual(
    legacyProvides,
    window.WebGPTContentAdapters.getAdapterProvides("example.adapter"),
  );
  assert.equal(
    window.WebGPTContentAdapters.getAdapterProvides("unknown.adapter"),
    null,
  );

  window.WebGPTContentAdapters.register({
    id: "namespaced.adapter",
    match: () => false,
    provides: { "calendar-event.create": "legacy_tool" },
  });
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        window.WebGPTContentAdapters.getAdapterProvides("namespaced.adapter"),
      ),
    ),
    { "calendar-event.create": "legacy_tool" },
  );

  assert.throws(
    () =>
      window.WebGPTContentAdapters.register({
        id: "invalid.adapter",
        match: () => true,
        provides: { invalid: "legacy_tool" },
      }),
    /invalid capability/,
  );
  assert.equal(
    window.WebGPTContentAdapters.getAdapterProvides("invalid.adapter"),
    null,
  );

  const first = window.WebGPTContentAdapters.getPrivateToolRoutes();
  first.mutated = true;
  assert.equal(
    window.WebGPTContentAdapters.getPrivateToolRoutes().mutated,
    undefined,
  );
});
