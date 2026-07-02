import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Observe,
  fixedClock,
  verifyAuditChain,
  computeAuditHash,
  exportAuditNdjson,
  GENESIS_HASH,
  type AuditRecord,
} from "../src/index.js";
import { exampleValidators } from "../src/observations/index.js";
import { reviewEvent, FIXED_NOW } from "./helpers.js";

async function trailFor(events: unknown[]): Promise<readonly AuditRecord[]> {
  const observe = new Observe({ validators: exampleValidators, clock: fixedClock(FIXED_NOW, 1) });
  await observe.ingestAll(events);
  return observe.read.queryAudit();
}

test("an emitted trail is a valid, contiguous, genesis-rooted chain", async () => {
  const trail = await trailFor([
    reviewEvent({ eventId: "a" }),
    reviewEvent({ eventId: "b", payload: { pullRequest: "p", decision: "bad" } }),
    reviewEvent({ eventId: "a" }),
  ]);
  const result = verifyAuditChain(trail);
  assert.ok(result.ok);
  assert.equal(result.length, trail.length);
  assert.equal(trail[0]?.previousHash, GENESIS_HASH);
  assert.equal(trail[0]?.sequence, 0);
});

test("detects an edited record", async () => {
  const trail = [...(await trailFor([reviewEvent()]))];
  const target = trail[2] as AuditRecord;
  trail[2] = { ...target, outcome: "failed" }; // tamper without recomputing hash
  const result = verifyAuditChain(trail);
  assert.ok(!result.ok);
  assert.equal(result.brokenAt, 2);
  assert.equal(result.reason, "bad_hash");
});

test("detects a deleted record (broken link)", async () => {
  const trail = [...(await trailFor([reviewEvent()]))];
  trail.splice(2, 1); // drop one record
  const result = verifyAuditChain(trail);
  assert.ok(!result.ok);
  assert.equal(result.reason, "bad_sequence");
});

test("detects reordering", async () => {
  const trail = [...(await trailFor([reviewEvent()]))];
  const a = trail[1] as AuditRecord;
  const b = trail[2] as AuditRecord;
  trail[1] = b;
  trail[2] = a;
  const result = verifyAuditChain(trail);
  assert.ok(!result.ok);
});

test("even a self-consistent forged record cannot relink the chain", async () => {
  const trail = [...(await trailFor([reviewEvent()]))];
  const target = trail[2] as AuditRecord;
  // Recompute the hash so the record is internally consistent...
  const forgedContent = { ...target, outcome: "failed" as const };
  const { hash: _drop, ...content } = forgedContent;
  const forged: AuditRecord = { ...forgedContent, hash: computeAuditHash(content) };
  trail[2] = forged;
  // ...but its previousHash no longer matches record #1's hash chain forward,
  // and record #3's previousHash no longer matches the forged hash.
  const result = verifyAuditChain(trail);
  assert.ok(!result.ok);
  assert.equal(result.brokenAt, 3);
  assert.equal(result.reason, "broken_link");
});

test("NDJSON export round-trips and re-verifies", async () => {
  const trail = await trailFor([reviewEvent()]);
  const ndjson = exportAuditNdjson(trail);
  const lines = ndjson.split("\n");
  assert.equal(lines.length, trail.length);
  const parsed = lines.map((line) => JSON.parse(line) as AuditRecord);
  assert.ok(verifyAuditChain(parsed).ok);
});

test("an empty chain verifies", () => {
  assert.ok(verifyAuditChain([]).ok);
});

test("keyed (HMAC) chain verifies only with the right secret", async () => {
  const observe = new Observe({
    validators: exampleValidators,
    clock: fixedClock(FIXED_NOW, 1),
    auditSecret: "top-secret-key",
  });
  await observe.ingest(reviewEvent());
  const trail = await observe.read.queryAudit();

  assert.ok(verifyAuditChain(trail, "top-secret-key").ok);
  // Wrong key, or no key, must not verify a keyed chain.
  assert.ok(!verifyAuditChain(trail, "wrong-key").ok);
  assert.ok(!verifyAuditChain(trail).ok);
});

test("without the secret, a forged keyed record cannot be re-hashed to pass", async () => {
  const secret = "top-secret-key";
  const observe = new Observe({
    validators: exampleValidators,
    clock: fixedClock(FIXED_NOW, 1),
    auditSecret: secret,
  });
  await observe.ingest(reviewEvent());
  const trail = [...(await observe.read.queryAudit())];

  // An attacker without the secret recomputes the hash with a plain digest.
  const target = trail[2] as AuditRecord;
  const forgedContent = { ...target, outcome: "failed" as const };
  const { hash: _drop, ...content } = forgedContent;
  trail[2] = { ...forgedContent, hash: computeAuditHash(content) }; // no secret
  assert.ok(!verifyAuditChain(trail, secret).ok);
});
