import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Observe,
  fixedClock,
  verifyObservation,
  computeObservationHash,
  type Observation,
} from "../src/index.js";
import { exampleValidators } from "../src/observations/index.js";
import { reviewEvent, FIXED_NOW } from "./helpers.js";

async function ingestOne(options: { integritySecret?: string } = {}): Promise<Observation> {
  const observe = new Observe({
    validators: exampleValidators,
    clock: fixedClock(FIXED_NOW),
    ...options,
  });
  const result = await observe.ingest(reviewEvent());
  assert.ok(result.status === "accepted");
  return result.observation;
}

test("a produced observation verifies against its own integrity hash", async () => {
  const obs = await ingestOne();
  assert.ok(verifyObservation(obs));
});

test("integrity survives a JSON round-trip (storage-stable)", async () => {
  const obs = await ingestOne();
  const roundTripped = JSON.parse(JSON.stringify(obs)) as Observation;
  assert.ok(verifyObservation(roundTripped));
});

test("tampering with any content field is detected", async () => {
  const obs = await ingestOne();
  const tamperedAttrs: Observation = {
    ...obs,
    attributes: { ...obs.attributes, decision: "rejected" },
  };
  assert.ok(!verifyObservation(tamperedAttrs));

  const tamperedTime: Observation = { ...obs, at: obs.at + 1 };
  assert.ok(!verifyObservation(tamperedTime));

  const tamperedActors: Observation = { ...obs, actors: [{ type: "actor", id: "mallory" }] };
  assert.ok(!verifyObservation(tamperedActors));

  const tamperedId: Observation = { ...obs, id: "obs_forged" };
  assert.ok(!verifyObservation(tamperedId));
});

test("the hash is key-order independent", async () => {
  const obs = await ingestOne();
  const { integrity, ...content } = obs;
  // Rebuild the content object with keys in a different insertion order.
  const reordered = {
    versions: content.versions,
    attributes: content.attributes,
    id: content.id,
    subjects: content.subjects,
    at: content.at,
    actors: content.actors,
    ingestedAt: content.ingestedAt,
    source: content.source,
    sourceEventId: content.sourceEventId,
    type: content.type,
  };
  assert.equal(computeObservationHash(reordered), integrity);
});

test("distinct observations have distinct integrity hashes", async () => {
  const observe = new Observe({ validators: exampleValidators, clock: fixedClock(FIXED_NOW) });
  const a = await observe.ingest(reviewEvent({ eventId: "a" }));
  const b = await observe.ingest(reviewEvent({ eventId: "b" }));
  assert.ok(a.status === "accepted" && b.status === "accepted");
  assert.notEqual(a.observation.integrity, b.observation.integrity);
});

test("keyed (HMAC) integrity verifies only with the right secret", async () => {
  const obs = await ingestOne({ integritySecret: "obs-key" });
  assert.ok(verifyObservation(obs, "obs-key"));
  assert.ok(!verifyObservation(obs, "wrong-key"));
  assert.ok(!verifyObservation(obs)); // unkeyed verify of a keyed observation
});

test("without the secret, a forged keyed observation cannot be re-hashed to pass", async () => {
  const secret = "obs-key";
  const obs = await ingestOne({ integritySecret: secret });
  const { integrity: _drop, ...content } = obs;
  const forged: Observation = {
    ...content,
    attributes: { ...content.attributes, decision: "rejected" },
    integrity: computeObservationHash({ ...content, attributes: { decision: "rejected" } }), // no secret
  };
  assert.ok(!verifyObservation(forged, secret));
});
