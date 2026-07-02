import { test } from "node:test";
import assert from "node:assert/strict";
import { observationId } from "../src/core/ids.js";

test("observation id is deterministic for the same inputs", () => {
  const a = observationId("evt-1", "ReviewSubmitted", "1.0");
  const b = observationId("evt-1", "ReviewSubmitted", "1.0");
  assert.equal(a, b);
});

test("observation id changes with the normalization version", () => {
  const v1 = observationId("evt-1", "ReviewSubmitted", "1.0");
  const v2 = observationId("evt-1", "ReviewSubmitted", "2.0");
  assert.notEqual(v1, v2);
});

test("observation id changes with the event id and type", () => {
  const base = observationId("evt-1", "ReviewSubmitted", "1.0");
  assert.notEqual(base, observationId("evt-2", "ReviewSubmitted", "1.0"));
  assert.notEqual(base, observationId("evt-1", "DeployFinished", "1.0"));
});

test("encoding is injective across field boundaries", () => {
  // A shifted boundary between fields must not collide: ("A B","T") and
  // ("A","B T") would coincide under naive space-delimited concatenation.
  assert.notEqual(
    observationId("A B", "T", "1.0"),
    observationId("A", "B T", "1.0"),
  );
  // A version string containing a space must not collide with a shifted type.
  assert.notEqual(
    observationId("e", "T", "1.0 beta"),
    observationId("e", "T 1.0", "beta"),
  );
});

test("observation id is prefixed and hex", () => {
  const id = observationId("evt-1", "ReviewSubmitted", "1.0");
  assert.match(id, /^obs_[0-9a-f]{64}$/);
});
