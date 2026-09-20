import test from "node:test";
import assert from "node:assert/strict";

import { normalizeDomExecutionResult } from "../apps/extension-host/src/background/runtime/executionResult.js";

test("nested recoverable action failures make the extension batch recoverably fail", () => {
  const execution = normalizeDomExecutionResult({
    ok: true,
    summary: "Actions executed with 1 recoverable connector failure(s).",
    results: [
      {
        action: { type: "ashby_fill_application_fields" },
        result: {
          ok: false,
          recoverable: true,
          detail: "No application fields were filled.",
        },
      },
    ],
  });

  assert.equal(execution.ok, false);
  assert.equal(execution.recoverable, true);
  assert.equal(
    execution.summary,
    "Actions executed with 1 recoverable connector failure(s).",
  );
  assert.equal(execution.error, "No application fields were filled.");
});

test("successful nested action results remain successful", () => {
  const original = {
    ok: true,
    summary: "All actions executed.",
    results: [{ result: { ok: true } }],
  };

  assert.equal(normalizeDomExecutionResult(original), original);
});

test("non-recoverable nested failures report their actual detail", () => {
  const execution = normalizeDomExecutionResult({
    ok: true,
    summary: "All actions executed.",
    results: [{ result: { ok: false, detail: "Field is no longer present." } }],
  });

  assert.equal(execution.ok, false);
  assert.equal(execution.recoverable, false);
  assert.equal(execution.summary, "Field is no longer present.");
  assert.equal(execution.error, "Field is no longer present.");
});
