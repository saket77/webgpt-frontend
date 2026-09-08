const fs = require("node:fs");
const path = require("node:path");
const { createHash, webcrypto } = require("node:crypto");
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

function fixtureHtml() {
  return `<!doctype html><html><body>
    <form id="application-form" class="application--form">
      <section class="application--questions">
        <div class="field-wrapper" data-field-path="first_name">
          <label for="first_name">First Name *</label>
          <input id="first_name" name="first_name" required>
        </div>
        <div class="field-wrapper" data-field-path="question_story">
          <label for="question_story">Why are you interested?</label>
          <textarea id="question_story" name="question_story"></textarea>
        </div>
        <div class="field-wrapper" data-field-path="preferred_office">
          <label for="preferred_office">Preferred office</label>
          <select id="preferred_office" name="preferred_office">
            <option value="">Select an office</option>
            <option value="remote">Remote Hub</option>
            <option value="central">Central Office</option>
          </select>
        </div>
        <div class="field-wrapper" data-field-path="remote_preference">
          <label>Preferred working style</label>
          <input id="work_remote" type="radio" name="working_style" value="Remote">
          <label for="work_remote">Remote</label>
          <input id="work_hybrid" type="radio" name="working_style" value="Hybrid">
          <label for="work_hybrid">Hybrid</label>
        </div>
        <div class="field-wrapper" data-field-path="talent_community">
          <label for="talent_community">Join the talent community</label>
          <input id="talent_community" type="checkbox" name="talent_community">
        </div>
        <div class="field-wrapper" data-field-path="candidate_location">
          <label for="location_input">Location</label>
          <div class="select">
            <div class="select__control">
              <input id="location_input" class="select__input" role="combobox" aria-expanded="true" aria-controls="location-options">
            </div>
            <div id="location-options" role="listbox">
              <div role="option">Remote - United States</div>
              <div role="option">Hybrid - United States</div>
            </div>
            <div class="select__single-value"></div>
          </div>
        </div>
        <fieldset class="phone-input">
          <div class="phone-input__country">
            <div class="select__container" data-field-path="country">
              <label for="country">Country calling code</label>
              <div class="select">
                <div class="select__control">
                  <input id="country" class="select__input" role="combobox" aria-expanded="true" aria-controls="country-options">
                </div>
                <div id="country-options" role="listbox">
                  <div role="option">United States +1</div>
                  <div role="option">Canada +1</div>
                </div>
                <div class="select__single-value"></div>
              </div>
            </div>
          </div>
          <div class="phone-input__phone">
            <div class="text-input-wrapper">
              <div class="input-wrapper" data-field-path="phone">
                <label for="phone">Phone Number</label>
                <input id="phone" name="phone" type="tel">
              </div>
            </div>
          </div>
        </fieldset>
        <div class="field-wrapper" data-field-path="question_authorization">
          <label>Are you legally authorized to work in the United States?</label>
          <label for="authorized_yes">Yes</label>
          <input id="authorized_yes" type="radio" name="authorized" value="Yes">
          <label for="authorized_no">No</label>
          <input id="authorized_no" type="radio" name="authorized" value="No">
        </div>
        <div class="field-wrapper" data-field-path="cover_letter">
          <label>Cover Letter</label>
          <input id="cover_letter" type="file">
          <button id="cover_letter_manual" type="button">Enter manually</button>
        </div>
      </section>
      <section class="education--container">
        <div class="education--form">
          <div class="select" data-field-path="education_school">
            <label for="school--0">School</label>
            <div class="select__control">
              <input id="school--0" class="select__input" role="combobox" aria-expanded="true" aria-controls="school-options">
            </div>
            <div id="school-options" role="listbox">
              <div role="option">Example University</div>
              <div role="option">Sample Technical College</div>
            </div>
            <div class="select__single-value"></div>
          </div>
        </div>
      </section>
      <section class="eeoc__container">
        <div class="eeoc__question__wrapper">
          <div class="select">
            <label for="hispanic_ethnicity">Are you Hispanic/Latino?</label>
            <div class="select__control">
              <input id="hispanic_ethnicity" class="select__input" role="combobox" aria-expanded="true" aria-controls="hispanic-options">
            </div>
            <div id="hispanic-options" role="listbox">
              <div role="option">Decline to self-identify</div>
              <div role="option">Yes</div>
            </div>
            <div class="select__single-value"></div>
          </div>
        </div>
      </section>
      <section id="demographic-section" class="demographic--container">
        <div class="select">
          <label for="custom_gender_identity">Gender identity</label>
          <div class="select__control">
            <input id="custom_gender_identity" class="select__input" role="combobox" aria-expanded="true" aria-controls="custom-gender-options">
          </div>
          <div id="custom-gender-options" role="listbox">
            <div role="option">Decline to self-identify</div>
            <div role="option">Non-binary</div>
          </div>
          <div class="select__single-value"></div>
        </div>
      </section>
      <button class="application--submit" type="submit">Submit application</button>
    </form>
  </body></html>`;
}

function createFixture() {
  const dom = new JSDOM(fixtureHtml(), {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "https://job-boards.greenhouse.io/example/jobs/123",
  });
  const { window } = dom;
  const adapters = [];
  const handlers = new Map();
  const clickLog = [];

  Object.defineProperty(window, "crypto", { value: webcrypto });
  window.TextEncoder = TextEncoder;

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
  window.WebGPTContentAdapters = {
    register(adapter) {
      adapters.push(adapter);
    },
  };
  window.WebGPTConnectorTools = {
    register(name, handler) {
      handlers.set(name, handler);
    },
  };
  window.eval(GREENHOUSE_SOURCE);

  const primitives = {
    async fillElement(input, value) {
      if (input.tagName === "SELECT") {
        const option = Array.from(input.options).find(
          (candidate) =>
            candidate.value === String(value) ||
            candidate.textContent.trim() === String(value),
        );
        input.value = option?.value || "";
      } else if (input.id === "phone") {
        const national = String(value).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
        input.value = `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
      } else {
        input.value = String(value);
      }
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    },
    async clickElement(element) {
      clickLog.push(element.textContent.trim() || element.id || element.tagName);
      element.click();
      if (element.getAttribute("role") === "option") {
        const container = element.closest(".select");
        container.querySelector(".select__single-value").textContent =
          element.textContent;
        if (container.querySelector("#country")) {
          window.document.getElementById("phone").value = "";
        }
        if (
          container.querySelector("#hispanic_ethnicity") &&
          element.textContent.trim() === "Decline to self-identify" &&
          !window.document.getElementById("race")
        ) {
          window.document
            .querySelector(".eeoc__container")
            .insertAdjacentHTML(
              "beforeend",
              `<div class="eeoc__question__wrapper">
                <div class="select">
                  <label for="race">Please identify your race</label>
                  <div class="select__control">
                    <input id="race" class="select__input" role="combobox" aria-expanded="true" aria-controls="race-options">
                  </div>
                  <div id="race-options" role="listbox">
                    <div role="option">Decline to self-identify</div>
                    <div role="option">Two or More Races (Not Hispanic or Latino)</div>
                  </div>
                  <div class="select__single-value"></div>
                </div>
              </div>`,
            );
        }
      }
      if (element.id === "cover_letter_manual") {
        element.closest(".field-wrapper").insertAdjacentHTML(
          "beforeend",
          '<textarea id="cover_letter_text" name="cover_letter_text"></textarea>',
        );
      }
    },
  };

  assert.equal(adapters.length, 1);
  return {
    dom,
    window,
    adapter: adapters[0],
    handlers,
    primitives,
    clickLog,
  };
}

function toolSchemaKeys(tools, name) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool);
  return Object.keys(tool.parameters.properties.fieldValues.properties);
}

test("Greenhouse application connector fills each supported normal field kind", async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.dom.window.close());

  const tools = fixture.adapter.provideTools({
    document: fixture.window.document,
  });
  const schemaKeys = toolSchemaKeys(
    tools,
    "greenhouse_fill_application_fields",
  );
  assert.ok(schemaKeys.includes("first_name"));
  assert.ok(schemaKeys.includes("question_story"));
  assert.ok(schemaKeys.includes("preferred_office"));
  assert.ok(schemaKeys.includes("remote_preference"));
  assert.ok(schemaKeys.includes("talent_community"));
  assert.ok(schemaKeys.includes("candidate_location"));
  assert.ok(schemaKeys.includes("education_school"));
  assert.equal(schemaKeys.includes("question_authorization"), true);
  assert.equal(schemaKeys.includes("custom_gender_identity"), false);
  assert.equal(schemaKeys.includes("cover_letter"), false);

  const enhanced = fixture.adapter.enhanceState({
    state: { controls: [], groups: [], visibleTextSummary: [] },
    document: fixture.window.document,
    url: fixture.window.location.href,
  });
  const fieldGroups = enhanced.groups.filter(
    (group) => group.kind === "greenhouse_application_field",
  );
  for (const fieldKey of [
    "first_name",
    "preferred_office",
    "remote_preference",
    "talent_community",
    "candidate_location",
    "education_school",
  ]) {
    assert.equal(
      fieldGroups.find((field) => field.fieldKey === fieldKey)?.connectorTool,
      "greenhouse_fill_application_fields",
    );
  }
  assert.equal(
    fieldGroups.find(
      (field) => field.fieldKey === "custom_gender_identity",
    )?.connectorTool,
    "greenhouse_fill_eeoc",
  );

  const fillApplication = fixture.handlers.get(
    "greenhouse_fill_application_fields",
  );
  const result = await fillApplication(
    {
      fieldValues: {
        first_name: "Taylor",
        question_story: "I build reliable browser agents.",
        preferred_office: "Remote Hub",
        remote_preference: "Hybrid",
        talent_community: "true",
        candidate_location: "Remote - United States",
        education_school: "Example University",
      },
    },
    { primitives: fixture.primitives },
  );

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.deepEqual(Array.from(result.failed), []);
  assert.equal(result.fieldValues.first_name, "Taylor");
  assert.equal(
    result.fieldValues.question_story,
    "I build reliable browser agents.",
  );
  assert.equal(result.fieldValues.preferred_office, "Remote Hub");
  assert.equal(result.fieldValues.remote_preference, "Hybrid");
  assert.equal(result.fieldValues.talent_community, "true");
  assert.equal(result.fieldValues.candidate_location, "Remote - United States");
  assert.equal(
    result.fieldValues.education_school,
    "Example University",
  );
  assert.equal(
    result.fieldTargets.first_name.groupTargetId,
    "site:greenhouse.application:field:first_name",
  );
  assert.equal(fixture.window.document.getElementById("first_name").value, "Taylor");
  assert.equal(
    fixture.window.document.getElementById("preferred_office").value,
    "remote",
  );
  assert.equal(fixture.window.document.getElementById("work_hybrid").checked, true);
  assert.equal(
    fixture.window.document.getElementById("talent_community").checked,
    true,
  );
  assert.equal(
    fixture.window.document
      .querySelector("#location_input")
      .closest(".select")
      .querySelector(".select__single-value").textContent,
    "Remote - United States",
  );
  assert.equal(
    fixture.window.document
      .querySelector("#school--0")
      .closest(".select")
      .querySelector(".select__single-value").textContent,
    "Example University",
  );

  const authorized = await fillApplication(
    { fieldValues: { question_authorization: "Yes" } },
    { primitives: fixture.primitives },
  );
  assert.equal(authorized.ok, true);
  assert.equal(authorized.committed, true);
  assert.deepEqual(Array.from(authorized.failed), []);
  assert.equal(authorized.fieldValues.question_authorization, "Yes");
  assert.equal(
    fixture.window.document.getElementById("authorized_yes").checked,
    true,
  );
});

test("Greenhouse verifies long textarea values exactly and returns value-free evidence", async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.dom.window.close());
  const fillApplication = fixture.handlers.get(
    "greenhouse_fill_application_fields",
  );
  const longAnswer = `${"I build deterministic browser runtimes with adapter-first state. ".repeat(9)}Exact tail.`;
  assert.ok(longAnswer.length > 360);

  const result = await fillApplication(
    { fieldValues: { question_story: longAnswer } },
    { primitives: fixture.primitives },
  );

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.deepEqual(Array.from(result.failed), []);
  assert.equal(
    fixture.window.document.getElementById("question_story").value,
    longAnswer,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.fieldEvidence.question_story)),
    {
      normalizedLength: longAnswer.length,
      utf8ByteLength: Buffer.byteLength(longAnswer),
      digestAlgorithm: "sha256",
      digest: createHash("sha256").update(longAnswer).digest("hex"),
      verificationMode: "exact_normalized_text",
    },
  );

  const enhanced = fixture.adapter.enhanceState({
    state: { controls: [], groups: [], visibleTextSummary: [] },
    document: fixture.window.document,
    url: fixture.window.location.href,
  });
  const plannerField = enhanced.groups.find(
    (group) =>
      group.kind === "greenhouse_application_field" &&
      group.fieldKey === "question_story",
  );
  assert.ok(plannerField.currentValue.length <= 362);
  assert.match(plannerField.currentValue, /\.\.\.$/);
  assert.equal(plannerField.currentValue.includes("Exact tail."), false);

  const truncatedFixture = createFixture();
  t.after(() => truncatedFixture.dom.window.close());
  const truncated = await truncatedFixture.handlers.get(
    "greenhouse_fill_application_fields",
  )(
    { fieldValues: { question_story: longAnswer } },
    {
      primitives: {
        async fillElement(input, value) {
          input.value = String(value).slice(0, 360);
        },
      },
    },
  );
  assert.equal(truncated.ok, false);
  assert.equal(truncated.committed, false);
  assert.deepEqual(Array.from(truncated.failed), ["question_story"]);
  assert.equal(truncated.fieldEvidence.question_story, undefined);
});

test("Greenhouse application connector reports partial failures and continues known fields", async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.dom.window.close());

  const result = await fixture.handlers.get(
    "greenhouse_fill_application_fields",
  )(
    {
      fieldValues: {
        missing_field: "unsupported",
        first_name: "Taylor",
      },
    },
    { primitives: fixture.primitives },
  );

  assert.equal(result.ok, true);
  assert.equal(result.committed, false);
  assert.equal(result.recoverable, true);
  assert.equal(result.continueBatch, true);
  assert.deepEqual(Array.from(result.failed), ["missing_field"]);
  assert.equal(result.fieldValues.first_name, "Taylor");
  assert.equal(result.fieldTargets.missing_field, undefined);
  assert.equal(
    result.fieldTargets.first_name.groupTargetId,
    "site:greenhouse.application:field:first_name",
  );
});

test("Greenhouse fills phone country before the national number survives rerender", async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.dom.window.close());

  const result = await fixture.handlers.get(
    "greenhouse_fill_application_fields",
  )(
    {
      fieldValues: {
        phone: "+1 202-555-0142",
        country: "United States +1",
      },
    },
    { primitives: fixture.primitives },
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.committed, true);
  assert.deepEqual(
    Array.from(result.results, ({ fieldKey }) => fieldKey),
    ["country", "phone"],
  );
  assert.equal(result.fieldValues.country, "United States +1");
  assert.equal(result.fieldValues.phone, "(202) 555-0142");
  assert.equal(
    fixture.window.document.getElementById("phone").value,
    "(202) 555-0142",
  );
});

test("Greenhouse EEOC connector fills conditional standard and custom demographic selects", async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.dom.window.close());

  const tools = fixture.adapter.provideTools({
    document: fixture.window.document,
  });
  const schemaKeys = toolSchemaKeys(tools, "greenhouse_fill_eeoc");
  assert.ok(schemaKeys.includes("hispanic_ethnicity"));
  assert.ok(schemaKeys.includes("race"));
  assert.ok(schemaKeys.includes("custom_gender_identity"));

  const result = await fixture.handlers.get("greenhouse_fill_eeoc")(
    {
      fieldValues: {
        hispanic_ethnicity: "Decline to self-identify",
        race: "Decline to self-identify",
        custom_gender_identity: "Decline to self-identify",
      },
    },
    { primitives: fixture.primitives },
  );
  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(result.fieldValues.hispanic_ethnicity, "Decline to self-identify");
  assert.equal(
    result.fieldValues.race,
    "Decline to self-identify",
  );
  assert.equal(result.fieldValues.custom_gender_identity, "Decline to self-identify");
  assert.ok(
    fixture.clickLog.indexOf("Decline to self-identify") <
      fixture.clickLog.lastIndexOf("Decline to self-identify"),
  );
  assert.equal(
    fixture.window.document
      .querySelector("#race")
      .closest(".select")
      .querySelector(".select__single-value").textContent,
    "Decline to self-identify",
  );
  assert.equal(
    result.fieldTargets.race.matchMode,
    "greenhouse_eeoc_select",
  );
  assert.equal(
    result.fieldTargets.custom_gender_identity.matchMode,
    "greenhouse_demographic_select",
  );
});

test("Greenhouse cover-letter connector opens manual entry and keeps it out of normal fill", async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.dom.window.close());

  assert.ok(
    fixture.adapter
      .provideTools({ document: fixture.window.document })
      .some(({ name }) => name === "greenhouse_write_cover_letter"),
  );

  const letterText = "Dear hiring team,\n\nI build reliable browser agents.\n\nSincerely,\nTaylor";
  const result = await fixture.handlers.get("greenhouse_write_cover_letter")(
    { letterText },
    { primitives: fixture.primitives },
  );

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(
    fixture.window.document.getElementById("cover_letter_text").value,
    letterText,
  );
  const normalKeysAfterExpansion = toolSchemaKeys(
    fixture.adapter.provideTools({ document: fixture.window.document }),
    "greenhouse_fill_application_fields",
  );
  assert.equal(normalKeysAfterExpansion.includes("cover_letter"), false);
});
