const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

function adapterSource(name) {
  return fs.readFileSync(
    path.join(
      ROOT,
      `packages/page-runtime/src/content-scripts/adapters/${name}.js`,
    ),
    "utf8",
  );
}

function bounds(top, height = 20) {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 600,
    bottom: top + height,
    width: 600,
    height,
    toJSON() {
      return this;
    },
  };
}

function createFixture({ name, url, html, controls, filesById = {} }) {
  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url,
  });
  const { window } = dom;
  const adapters = [];

  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return bounds(Number(this.getAttribute("data-top") || 0), Number(this.getAttribute("data-height") || 20));
  };
  for (const [id, files] of Object.entries(filesById)) {
    Object.defineProperty(window.document.getElementById(id), "files", {
      configurable: true,
      value: files.map((fileName) => ({ name: fileName })),
    });
  }
  window.WebGPTContentAdapters = {
    register(adapter) {
      adapters.push(adapter);
    },
  };
  window.WebGPTConnectorTools = { register() {} };
  window.eval(adapterSource(name));
  assert.equal(adapters.length, 1);

  const state = adapters[0].enhanceState({
    state: { controls, groups: [], visibleTextSummary: [] },
    document: window.document,
    url,
  });
  return { dom, state };
}

function uploadGroups(state, kind) {
  return state.groups.filter(
    (group) => group.kind === kind && group.fieldKind === "file",
  );
}

test("Greenhouse publishes exact per-field upload triggers and committed filenames", (t) => {
  const fixture = createFixture({
    name: "greenhouse",
    url: "https://job-boards.greenhouse.io/example/jobs/123",
    html: `<!doctype html><html><body>
      <form id="application-form">
        <section class="application--questions">
          <div class="field-wrapper" data-field-path="resume" data-top="0" data-height="100">
            <div id="upload-label-resume">Resume/CV *</div>
            <div class="file-upload">
              <div class="secondary-button">
                <button type="button" data-top="10">Attach</button>
                <label class="visually-hidden" for="resume" style="display:none">Attach</label>
                <input id="resume" type="file" data-top="30" style="display:none">
              </div>
              <button type="button" data-top="50">Dropbox</button>
              <button type="button" data-top="70">Google Drive</button>
            </div>
          </div>
          <div class="field-wrapper" data-field-path="cover_letter" data-top="120" data-height="100">
            <div class="upload-label">Cover Letter</div>
            <div class="file-upload">
              <div class="secondary-button">
                <button type="button" data-top="130">Attach</button>
                <label class="visually-hidden" for="cover_letter" style="display:none">Attach</label>
                <input id="cover_letter" type="file" data-top="150" style="display:none">
              </div>
              <button type="button" data-top="170">Dropbox</button>
              <button type="button" data-top="190">Enter manually</button>
            </div>
            <span class="file-upload__filename">Tailored Cover Letter.pdf</span>
          </div>
        </section>
        <div class="application--submit"><button type="submit">Submit application</button></div>
      </form>
    </body></html>`,
    filesById: { resume: ["Tailored Resume.pdf"] },
    controls: [
      { id: "gh_resume_button", selector: "button", tag: "button", type: "button", controlType: "button", visible: true, enabled: true, bounds: bounds(10) },
      { id: "gh_resume_input", selector: "#resume", tag: "input", type: "file", controlType: "textbox", visible: true, enabled: true, bounds: bounds(30) },
      { id: "gh_cover_button", selector: "button", tag: "button", type: "button", controlType: "button", visible: true, enabled: true, bounds: bounds(130) },
      { id: "gh_cover_input", selector: "#cover_letter", tag: "input", type: "file", controlType: "textbox", visible: true, enabled: true, bounds: bounds(150) },
    ],
  });
  t.after(() => fixture.dom.window.close());

  const groups = uploadGroups(fixture.state, "greenhouse_application_field");
  assert.equal(groups.length, 2);
  const resume = groups.find((field) => field.fieldKey === "resume");
  const coverLetter = groups.find((field) => field.fieldKey === "cover_letter");

  assert.equal(resume.uploadTriggerTargetId, "gh_resume_button");
  assert.equal(resume.label, "Resume/CV");
  assert.ok(resume.controlIds.includes(resume.uploadTriggerTargetId));
  assert.equal(resume.currentValue, "Tailored Resume.pdf");
  assert.equal(resume.committedFilename, "Tailored Resume.pdf");
  assert.equal(resume.answered, true);
  assert.equal(coverLetter.uploadTriggerTargetId, "gh_cover_button");
  assert.equal(coverLetter.label, "Cover Letter");
  assert.equal(coverLetter.currentValue, "Tailored Cover Letter.pdf");
  assert.equal(coverLetter.committedFilename, "Tailored Cover Letter.pdf");
  assert.ok(fixture.state.siteAdapter.uploadTargetIds.includes("gh_resume_button"));
  assert.ok(fixture.state.siteAdapter.uploadTargetIds.includes("gh_cover_button"));

  const resumeControl = fixture.state.controls.find(
    (control) => control.id === "gh_resume_button",
  );
  const coverControl = fixture.state.controls.find(
    (control) => control.id === "gh_cover_button",
  );
  assert.equal(
    resumeControl.selector,
    '.file-upload:has(#resume) .secondary-button:has(label[for="resume"]) button',
  );
  assert.equal(
    coverControl.selector,
    '.file-upload:has(#cover_letter) .secondary-button:has(label[for="cover_letter"]) button',
  );
});

test("Greenhouse upload discovery fails closed when two visible triggers are provable", (t) => {
  const fixture = createFixture({
    name: "greenhouse",
    url: "https://job-boards.greenhouse.io/example/jobs/123",
    html: `<!doctype html><html><body>
      <form id="application-form">
        <section class="application--questions">
          <div class="field-wrapper" data-field-path="resume" data-top="0" data-height="100">
            <label>Resume/CV *</label>
            <button id="attach_primary" type="button" data-top="10">Attach</button>
            <button id="attach_secondary" type="button" data-top="40">Attach</button>
            <input id="resume" type="file" data-top="70" style="display:none">
          </div>
        </section>
        <div class="application--submit"><button type="submit">Submit application</button></div>
      </form>
    </body></html>`,
    controls: [
      { id: "ambiguous_primary", selector: "#attach_primary", tag: "button", type: "button", controlType: "button", visible: true, enabled: true, text: "Attach", bounds: bounds(10) },
      { id: "ambiguous_secondary", selector: "#attach_secondary", tag: "button", type: "button", controlType: "button", visible: true, enabled: true, text: "Attach", bounds: bounds(40) },
    ],
  });
  t.after(() => fixture.dom.window.close());

  const [resume] = uploadGroups(fixture.state, "greenhouse_application_field");
  assert.ok(resume);
  assert.equal(resume.uploadTriggerTargetId, "");
  assert.equal(
    fixture.state.controls.find(({ id }) => id === "ambiguous_primary").selector,
    "#attach_primary",
  );
  assert.equal(
    fixture.state.controls.find(({ id }) => id === "ambiguous_secondary").selector,
    "#attach_secondary",
  );
  assert.equal(
    fixture.state.siteAdapter.uploadTargetIds.includes("ambiguous_primary"),
    false,
  );
  assert.equal(
    fixture.state.siteAdapter.uploadTargetIds.includes("ambiguous_secondary"),
    false,
  );
});

test("Greenhouse does not publish a hidden file input as an upload trigger", (t) => {
  const fixture = createFixture({
    name: "greenhouse",
    url: "https://job-boards.greenhouse.io/example/jobs/123",
    html: `<!doctype html><html><body>
      <form id="application-form">
        <section class="application--questions">
          <div class="field-wrapper" data-field-path="resume" data-top="0" data-height="100">
            <label>Resume/CV *</label>
            <input id="resume" type="file" data-top="20" style="display:none">
          </div>
        </section>
        <div class="application--submit"><button type="submit">Submit application</button></div>
      </form>
    </body></html>`,
    controls: [
      { id: "hidden_resume_input", selector: "#resume", tag: "input", type: "file", controlType: "file", visible: false, enabled: true, label: "Resume", bounds: bounds(20) },
    ],
  });
  t.after(() => fixture.dom.window.close());

  const [resume] = uploadGroups(fixture.state, "greenhouse_application_field");
  assert.ok(resume);
  assert.equal(resume.uploadTriggerTargetId, "");
  assert.equal(
    fixture.state.siteAdapter.uploadTargetIds.includes("hidden_resume_input"),
    false,
  );
});

test("Greenhouse retains a committed filename after the upload input disappears", (t) => {
  const fixture = createFixture({
    name: "greenhouse",
    url: "https://job-boards.greenhouse.io/example/jobs/123",
    html: `<!doctype html><html><body>
      <form id="application-form">
        <section class="application--questions">
          <div class="field-wrapper" data-field-path="resume" data-top="0" data-height="100">
            <label>Resume/CV *</label>
            <span class="file-upload__filename">Committed Resume.pdf</span>
            <button type="button" data-top="40">Remove file</button>
          </div>
        </section>
        <div class="application--submit"><button type="submit">Submit application</button></div>
      </form>
    </body></html>`,
    controls: [
      { id: "remove_resume", selector: "button", tag: "button", type: "button", controlType: "button", visible: true, enabled: true, text: "Remove file", bounds: bounds(40) },
    ],
  });
  t.after(() => fixture.dom.window.close());

  const [resume] = uploadGroups(fixture.state, "greenhouse_application_field");
  assert.ok(resume);
  assert.equal(resume.currentValue, "Committed Resume.pdf");
  assert.equal(resume.committedFilename, "Committed Resume.pdf");
  assert.equal(resume.answered, true);
  assert.equal(resume.uploadTriggerTargetId, "");
});

test("Greenhouse retains the stable resume key from its upload label after upload", (t) => {
  const fixture = createFixture({
    name: "greenhouse",
    url: "https://job-boards.greenhouse.io/example/jobs/123",
    html: `<!doctype html><html><body>
      <form id="application-form">
        <section class="application--questions">
          <div class="field-wrapper" data-top="0" data-height="100">
            <div class="file-upload" aria-labelledby="upload-label-resume" aria-required="true">
              <div id="upload-label-resume" class="label upload-label">Resume/CV *</div>
              <div class="file-upload__filename">
                <p>Live Tailored Resume.pdf</p>
                <button type="button" aria-label="Remove file"></button>
              </div>
            </div>
          </div>
        </section>
        <div class="application--submit"><button type="submit">Submit application</button></div>
      </form>
    </body></html>`,
    controls: [
      { id: "remove_resume", selector: "button[aria-label='Remove file']", tag: "button", type: "button", controlType: "button", visible: true, enabled: true, text: "", bounds: bounds(40) },
    ],
  });
  t.after(() => fixture.dom.window.close());

  const [resume] = uploadGroups(fixture.state, "greenhouse_application_field");
  assert.ok(resume);
  assert.equal(resume.fieldKey, "resume");
  assert.equal(resume.label, "Resume/CV");
  assert.equal(resume.currentValue, "Live Tailored Resume.pdf");
  assert.equal(resume.committedFilename, "Live Tailored Resume.pdf");
  assert.equal(resume.answered, true);
  assert.equal(resume.required, true);
  assert.equal(resume.uploadTriggerTargetId, "");
});

test("Ashby prefers the exact native file input over its visible upload button", (t) => {
  const fixture = createFixture({
    name: "ashby",
    url: "https://jobs.ashbyhq.com/example/application",
    html: `<!doctype html><html><body>
      <div class="ashby-application-form-container">
        <div class="ashby-application-form-field-entry" data-field-path="_systemfield_resume" data-top="0" data-height="100">
          <div class="ashby-application-form-question-title">Resume</div>
          <div class="ashby-application-form-input-file">
            <button type="button" data-top="10">Upload File</button>
            <input id="_systemfield_resume" type="file" tabindex="-1" data-top="30" data-height="1"
              style="border:0;clip:rect(0,0,0,0);clip-path:inset(50%);height:1px;overflow:hidden;position:absolute;width:1px">
            <span class="ashby-application-form-input-file-item-name">Ashby Resume.pdf</span>
          </div>
        </div>
        <button class="ashby-application-form-submit-button" type="submit">Submit Application</button>
      </div>
    </body></html>`,
    controls: [
      { id: "ashby_resume_button", selector: "button", tag: "button", type: "button", controlType: "button", visible: true, enabled: true, bounds: bounds(10) },
      { id: "ashby_resume_input", selector: "#_systemfield_resume", tag: "input", type: "file", controlType: "textbox", visible: true, enabled: true, bounds: bounds(30) },
    ],
  });
  t.after(() => fixture.dom.window.close());

  const [resume] = uploadGroups(fixture.state, "ashby_application_field");
  assert.ok(resume);
  assert.equal(resume.uploadTriggerTargetId, "ashby_resume_input");
  assert.ok(resume.controlIds.includes("ashby_resume_input"));
  assert.equal(resume.currentValue, "Ashby Resume.pdf");
  assert.equal(resume.committedFilename, "Ashby Resume.pdf");
  assert.ok(
    fixture.state.siteAdapter.uploadTargetIds.includes("ashby_resume_input"),
  );
  assert.equal(
    fixture.state.controls.find(
      (control) => control.id === "ashby_resume_input",
    ).selector,
    "#_systemfield_resume",
  );
});
