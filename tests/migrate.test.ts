import { test } from "node:test";
import assert from "node:assert/strict";
import { renormalize, fixedClock } from "../src/index.js";
import { exampleValidators } from "../src/observations/index.js";
import { reviewEvent, FIXED_NOW } from "./helpers.js";

test("renormalize partitions events into observations and rejections", () => {
  const result = renormalize(
    [
      reviewEvent({ eventId: "a" }),
      reviewEvent({ eventId: "b", payload: { pullRequest: "p", decision: "bad" } }),
      reviewEvent({ eventId: "c" }),
    ],
    { validators: exampleValidators, clock: fixedClock(FIXED_NOW) },
  );
  assert.equal(result.observations.length, 2);
  assert.equal(result.rejections.length, 1);
  assert.equal(result.rejections[0]?.reason, "INVALID_PAYLOAD");
});

test("a new normalization version produces new, coexisting ids", () => {
  const events = [reviewEvent({ eventId: "a" })];
  const v1 = renormalize(events, {
    validators: exampleValidators,
    clock: fixedClock(FIXED_NOW),
    normalizationVersion: "1.0",
  });
  const v2 = renormalize(events, {
    validators: exampleValidators,
    clock: fixedClock(FIXED_NOW),
    normalizationVersion: "2.0",
  });
  assert.notEqual(v1.observations[0]?.id, v2.observations[0]?.id);
  assert.equal(v1.observations[0]?.versions.normalization, "1.0");
  assert.equal(v2.observations[0]?.versions.normalization, "2.0");
});

test("renormalize is deterministic under a fixed clock", () => {
  const events = [reviewEvent({ eventId: "a" }), reviewEvent({ eventId: "b" })];
  const first = renormalize(events, {
    validators: exampleValidators,
    clock: fixedClock(FIXED_NOW),
  });
  const second = renormalize(events, {
    validators: exampleValidators,
    clock: fixedClock(FIXED_NOW),
  });
  assert.deepEqual(first.observations, second.observations);
});
