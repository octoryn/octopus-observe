import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyEvidence } from "octopus-evidence";
import { Observe, fixedClock, toEvidence, type Observation } from "../src/index.js";
import { exampleValidators } from "../src/observations/index.js";
import { reviewEvent, FIXED_NOW } from "./helpers.js";

async function ingestOne(): Promise<Observation> {
  const observe = new Observe({ validators: exampleValidators, clock: fixedClock(FIXED_NOW) });
  const result = await observe.ingest(reviewEvent());
  assert.ok(result.status === "accepted");
  return result.observation;
}

test("an observation projected to evidence verifies", async () => {
  const obs = await ingestOne();
  const ev = toEvidence(obs);
  assert.ok(verifyEvidence(ev));
});

test("the evidence reflects the observation's kind, subject, actor, and content", async () => {
  const obs = await ingestOne();
  const ev = toEvidence(obs);

  assert.equal(ev.kind, `observation:${obs.type}`);

  // Subjects are narrowed to { type, id } evidence refs.
  assert.deepEqual(
    ev.subject,
    obs.subjects.map((s) => ({ type: s.type, id: s.id })),
  );
  assert.deepEqual(ev.subject, [{ type: "pull_request", id: "pr#1" }]);

  // Actor is the observation's first actor.
  assert.deepEqual(ev.actor, { type: "actor", id: "alice" });

  // Content is the observation's canonical attributes.
  assert.deepEqual(ev.content, obs.attributes);

  // Provenance carries the source system and the canonical timestamp.
  assert.equal(ev.provenance.source, "github");
  assert.equal(ev.provenance.at, new Date(obs.at).toISOString());
});

test("evidence survives a JSON round-trip and still verifies", async () => {
  const obs = await ingestOne();
  const ev = toEvidence(obs);
  const roundTripped = JSON.parse(JSON.stringify(ev)) as typeof ev;
  assert.ok(verifyEvidence(roundTripped));
});

test("an integritySecret round-trips: verifies with the key, fails without", async () => {
  const obs = await ingestOne();
  const ev = toEvidence(obs, { integritySecret: "bridge-key" });
  assert.ok(verifyEvidence(ev, "bridge-key"));
  assert.ok(!verifyEvidence(ev, "wrong-key"));
  assert.ok(!verifyEvidence(ev)); // unkeyed verify of a keyed evidence
});

test("tampering with the projected evidence content is detected", async () => {
  const obs = await ingestOne();
  const ev = toEvidence(obs);
  const tampered = { ...ev, content: { ...(ev.content as object), decision: "rejected" } };
  assert.ok(!verifyEvidence(tampered as typeof ev));
});

test("an observation with no actors projects evidence with no actor", async () => {
  const observe = new Observe({ validators: exampleValidators, clock: fixedClock(FIXED_NOW) });
  const result = await observe.ingest(reviewEvent({ actors: [] }));
  assert.ok(result.status === "accepted");
  const ev = toEvidence(result.observation);
  assert.equal(ev.actor, undefined);
  assert.ok(verifyEvidence(ev));
});
