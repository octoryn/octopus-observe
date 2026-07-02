import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnvelope } from "../src/normalize/envelope.js";
import { reviewEvent } from "./helpers.js";

test("accepts a well-formed envelope", () => {
  const result = parseEnvelope(reviewEvent());
  assert.ok(result.ok);
  assert.equal(result.value.eventId, "evt-1");
  assert.equal(result.value.actors?.length, 1);
});

test("rejects a non-object", () => {
  const result = parseEnvelope("nope");
  assert.ok(!result.ok);
  assert.equal(result.error.reason, "MALFORMED_ENVELOPE");
});

test("reports every missing required field", () => {
  const result = parseEnvelope({});
  assert.ok(!result.ok);
  const paths = (result.error.issues ?? []).map((i) => i.path).sort();
  assert.deepEqual(paths, [
    "envelopeVersion",
    "eventId",
    "kind",
    "occurredAt",
    "payload",
    "schemaVersion",
  ]);
});

test("carries the eventId when it is readable", () => {
  const result = parseEnvelope({ eventId: "evt-x" });
  assert.ok(!result.ok);
  assert.equal(result.error.eventId, "evt-x");
});

test("payload present but null is structurally valid (validator's job to judge)", () => {
  const result = parseEnvelope(reviewEvent({ payload: null }));
  assert.ok(result.ok);
});

test("rejects malformed actor refs", () => {
  const result = parseEnvelope(reviewEvent({ actors: [{ type: "actor" }] as never }));
  assert.ok(!result.ok);
  assert.ok((result.error.issues ?? []).some((i) => i.path === "actors[0].id"));
});

test("rejects non-array actors", () => {
  const result = parseEnvelope(reviewEvent({ actors: "alice" as never }));
  assert.ok(!result.ok);
  assert.ok((result.error.issues ?? []).some((i) => i.path === "actors"));
});
