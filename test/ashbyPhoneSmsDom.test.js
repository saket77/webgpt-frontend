const fs = require("node:fs");
const path = require("node:path");
const { createHash, webcrypto } = require("node:crypto");
const test = require("node:test");
const assert = require("node:assert/strict");

const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const ASHBY_SOURCE = fs.readFileSync(
  path.join(
    ROOT,
    "packages/page-runtime/src/content-scripts/adapters/ashby.js",
  ),
  "utf8",
);

const FIELD_PATH = "c056fccb-fe8a-4203-b6a2-c27aa2945ace";
const PHONE_KEY = `${FIELD_PATH}::phone`;
const SMS_KEY = `${FIELD_PATH}::sms_consent`;

function fixtureHtml() {
  return `<!doctype html><html><body>
    <div class="ashby-application-form-container">
      <div class="ashby-application-form-field-entry" data-field-path="${FIELD_PATH}">
        <div class="ashby-application-form-question-title">Phone Number</div>
        <label for="${FIELD_PATH}">Phone Number</label>
        <input id="${FIELD_PATH}" name="${FIELD_PATH}" type="tel" required>
        <p>Check Yes or No to indicate your agreement to receive text message updates.</p>
        <label><input type="radio" name="communicationConsent" value="Yes" required>Yes - I consent to receiving text messages</label>
        <label><input type="radio" name="communicationConsent" value="No">No - I do not consent to receiving text messages</label>
      </div>
      <div class="ashby-application-form-field-entry" data-field-path="why_role">
        <div class="ashby-application-form-question-title">Why are you interested?</div>
        <label for="why_role">Why are you interested?</label>
        <textarea id="why_role" name="why_role"></textarea>
      </div>
      <button type="submit" class="ashby-application-form-submit-button">Submit Application</button>
    </div>
  </body></html>`;
}

function createFixture() {
  const dom = new JSDOM(fixtureHtml(), {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "https://jobs.ashbyhq.com/example/application",
  });
  const { window } = dom;
  const adapters = [];
  const handlers = new Map();
  const primitiveCalls = [];

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
  window.eval(ASHBY_SOURCE);

  const primitives = {
    async fillElement(input, value) {
      primitiveCalls.push({ type: "fill", tagName: input.tagName, value });
      input.value = String(value);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    },
    async clickElement(element) {
      primitiveCalls.push({ type: "click", tagName: element.tagName });
      element.click();
    },
  };

  assert.equal(adapters.length, 1);
  return {
    dom,
    window,
    adapter: adapters[0],
    handlers,
    primitives,
    primitiveCalls,
  };
}

function extract(fixture) {
  return fixture.adapter.enhanceState({
    state: { controls: [], groups: [], visibleTextSummary: [] },
    document: fixture.window.document,
    url: fixture.window.location.href,
  });
}

function logicalFields(state) {
  return state.groups.filter(
    (group) =>
      group.kind === "ashby_application_field" &&
      group.fieldPath === FIELD_PATH,
  );
}

test("Ashby emits independent phone and SMS state from one physical field root", (t) => {
  const fixture = createFixture();
  t.after(() => fixture.dom.window.close());

  assert.equal(fixture.window.document.querySelector("form"), null);
  assert.deepEqual(Array.from(fixture.handlers.keys()).sort(), [
    "ashby_fill_application_fields",
    "ashby_fill_eeoc",
    "ashby_read_job_description",
  ]);

  const state = extract(fixture);
  const fields = logicalFields(state);
  assert.equal(fields.length, 2);
  assert.deepEqual(
    Array.from(fields, (field) => field.fieldKey).sort(),
    [PHONE_KEY, SMS_KEY].sort(),
  );
  assert.ok(fields.every((field) => field.fieldPath === FIELD_PATH));
  assert.notEqual(fields[0].targetId, fields[1].targetId);

  const phone = fields.find((field) => field.fieldKey === PHONE_KEY);
  assert.equal(phone.logicalKind, "phone");
  assert.equal(phone.fieldKind, "tel");
  assert.equal(phone.required, true);
  assert.equal(phone.answered, false);
  assert.deepEqual(Array.from(phone.optionTexts), []);

  const sms = fields.find((field) => field.fieldKey === SMS_KEY);
  assert.equal(sms.logicalKind, "sms_consent");
  assert.equal(sms.fieldKind, "single_select");
  assert.equal(sms.required, true);
  assert.equal(sms.answered, false);
  assert.deepEqual(Array.from(sms.optionTexts), [
    "Yes - I consent to receiving text messages",
    "No - I do not consent to receiving text messages",
  ]);

  const applicationTool = fixture.adapter
    .provideTools({ document: fixture.window.document })
    .find(({ name }) => name === "ashby_fill_application_fields");
  assert.ok(applicationTool);
  const schemaKeys = Object.keys(
    applicationTool.parameters.properties.fieldValues.properties,
  );
  assert.ok(schemaKeys.includes(PHONE_KEY));
  assert.ok(schemaKeys.includes(SMS_KEY));
  assert.equal(schemaKeys.includes(FIELD_PATH), false);
});

test("the existing Ashby connector fills and verifies both logical parts", async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.dom.window.close());
  const fillApplication = fixture.handlers.get("ashby_fill_application_fields");

  const ambiguous = await fillApplication(
    { fieldValues: { [FIELD_PATH]: "+1 000 000 0000" } },
    { primitives: fixture.primitives },
  );
  assert.deepEqual(Array.from(ambiguous.failed), [FIELD_PATH]);
  assert.equal(fixture.window.document.querySelector("input[type='tel']").value, "");

  const result = await fillApplication(
    {
      fieldValues: {
        [PHONE_KEY]: "+1 215 555 0100",
        [SMS_KEY]: "No - I do not consent to receiving text messages",
      },
    },
    { primitives: fixture.primitives },
  );

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.deepEqual(Array.from(result.failed), []);
  assert.equal(result.fieldValues[PHONE_KEY], "+1 215 555 0100");
  assert.equal(result.fieldValues[SMS_KEY], "No");
  assert.equal(fixture.window.document.querySelector("input[type='tel']").value, "+1 215 555 0100");
  assert.equal(
    fixture.window.document.querySelector("input[value='No']").checked,
    true,
  );
  assert.equal(
    fixture.window.document.querySelector("input[value='Yes']").checked,
    false,
  );
  assert.deepEqual(
    fixture.primitiveCalls.map(({ type }) => type),
    ["fill", "click"],
  );

  const verified = logicalFields(extract(fixture));
  const phone = verified.find((field) => field.fieldKey === PHONE_KEY);
  const sms = verified.find((field) => field.fieldKey === SMS_KEY);
  assert.equal(phone.answered, true);
  assert.equal(phone.currentValue, "+1 215 555 0100");
  assert.equal(sms.answered, true);
  assert.equal(sms.currentValue, "No");
  assert.equal(sms.selectedValue, "No");
  assert.equal(verified.every((field) => field.required && field.answered), true);
});

test("Ashby verifies long textarea values exactly and returns value-free evidence", async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.dom.window.close());
  const fillApplication = fixture.handlers.get("ashby_fill_application_fields");
  const longAnswer = `${"I build deterministic browser runtimes with adapter-first state. ".repeat(9)}Exact tail.`;
  assert.ok(longAnswer.length > 360);

  const result = await fillApplication(
    { fieldValues: { why_role: longAnswer } },
    { primitives: fixture.primitives },
  );

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.deepEqual(Array.from(result.failed), []);
  assert.equal(fixture.window.document.getElementById("why_role").value, longAnswer);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.fieldEvidence.why_role)),
    {
      normalizedLength: longAnswer.length,
      utf8ByteLength: Buffer.byteLength(longAnswer),
      digestAlgorithm: "sha256",
      digest: createHash("sha256").update(longAnswer).digest("hex"),
      verificationMode: "exact_normalized_text",
    },
  );

  const state = extract(fixture);
  const plannerField = state.groups.find(
    (group) =>
      group.kind === "ashby_application_field" && group.fieldKey === "why_role",
  );
  assert.ok(plannerField.currentValue.length <= 362);
  assert.match(plannerField.currentValue, /\.\.\.$/);
  assert.equal(plannerField.currentValue.includes("Exact tail."), false);

  const truncatedFixture = createFixture();
  t.after(() => truncatedFixture.dom.window.close());
  const truncated = await truncatedFixture.handlers.get(
    "ashby_fill_application_fields",
  )(
    { fieldValues: { why_role: longAnswer } },
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
  assert.deepEqual(Array.from(truncated.failed), ["why_role"]);
  assert.equal(truncated.fieldEvidence.why_role, undefined);
});
