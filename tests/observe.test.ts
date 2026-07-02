import { test } from "node:test";
import assert from "node:assert/strict";
import { Observe, fixedClock } from "../src/index.js";
import { exampleValidators } from "../src/observations/index.js";
import { reviewEvent, FIXED_NOW } from "./helpers.js";

function makeObserve(options: { onUnknownKind?: "reject" | "skip" } = {}): Observe {
  return new Observe({
    validators: exampleValidators,
    clock: fixedClock(FIXED_NOW),
    ...options,
  });
}

test("accepts a valid event and stores the observation", async () => {
  const observe = makeObserve();
  const result = await observe.ingest(reviewEvent());
  assert.equal(result.status, "accepted");
  assert.equal(await observe.read.countObservations(), 1);
});

test("re-ingesting the same event is an idempotent duplicate", async () => {
  const observe = makeObserve();
  const first = await observe.ingest(reviewEvent());
  const second = await observe.ingest(reviewEvent());
  assert.equal(first.status, "accepted");
  assert.equal(second.status, "duplicate");
  assert.ok(first.status === "accepted" && second.status === "duplicate");
  assert.equal(first.observation.id, second.observation.id);
  assert.equal(await observe.read.countObservations(), 1);
});

test("rejects an invalid event and stores nothing", async () => {
  const observe = makeObserve();
  const result = await observe.ingest(
    reviewEvent({ payload: { pullRequest: "pr#1", decision: "nope" } }),
  );
  assert.equal(result.status, "rejected");
  assert.ok(result.status === "rejected");
  assert.equal(result.rejection.reason, "INVALID_PAYLOAD");
  assert.equal(await observe.read.countObservations(), 0);
});

test("unknown kind is rejected by default", async () => {
  const observe = makeObserve();
  const result = await observe.ingest(reviewEvent({ kind: "mystery.happened" }));
  assert.equal(result.status, "rejected");
  assert.ok(result.status === "rejected");
  assert.equal(result.rejection.reason, "UNKNOWN_KIND");
});

test("unknown kind is skipped under the skip policy", async () => {
  const observe = makeObserve({ onUnknownKind: "skip" });
  const result = await observe.ingest(reviewEvent({ kind: "mystery.happened" }));
  assert.equal(result.status, "skipped");
  assert.equal(await observe.read.countObservations(), 0);
});

test("emits a full audit trail for an accepted event", async () => {
  const observe = makeObserve();
  await observe.ingest(reviewEvent());
  const trail = await observe.read.getEventAudit("evt-1");
  const stages = trail.map((r) => `${r.stage}/${r.outcome}`);
  assert.deepEqual(stages, [
    "validation/passed",
    "normalization/passed",
    "attribution/passed",
    "dedupe/unique",
    "storage/stored",
  ]);
});

test("emits validation + rejection audit for a rejected event", async () => {
  const observe = makeObserve();
  await observe.ingest(reviewEvent({ occurredAt: "not-a-date" }));
  const trail = await observe.read.getEventAudit("evt-1");
  const stages = trail.map((r) => `${r.stage}/${r.outcome}`);
  assert.deepEqual(stages, ["validation/failed", "rejection/rejected"]);
  const rejection = trail.find((r) => r.stage === "rejection");
  assert.equal(rejection?.detail?.["reason"], "INVALID_TIMESTAMP");
});

test("emits a dedupe/duplicate record on re-ingest", async () => {
  const observe = makeObserve();
  await observe.ingest(reviewEvent());
  await observe.ingest(reviewEvent());
  const dedupe = await observe.read.queryAudit({ stage: "dedupe" });
  assert.deepEqual(
    dedupe.map((r) => r.outcome),
    ["unique", "duplicate"],
  );
});

test("duplicate re-ingest keeps a bounded audit trail (no repeated passed sequence)", async () => {
  const observe = makeObserve();
  await observe.ingest(reviewEvent());
  await observe.ingest(reviewEvent());
  await observe.ingest(reviewEvent());
  const trail = await observe.read.getEventAudit("evt-1");
  const stages = trail.map((r) => `${r.stage}/${r.outcome}`);
  // First accept (5 records) + two duplicates (2 records each) = 9, not 15.
  assert.deepEqual(stages, [
    "validation/passed",
    "normalization/passed",
    "attribution/passed",
    "dedupe/unique",
    "storage/stored",
    "validation/passed",
    "dedupe/duplicate",
    "validation/passed",
    "dedupe/duplicate",
  ]);
});

test("malformed envelope is rejected under a placeholder event id", async () => {
  const observe = makeObserve();
  const result = await observe.ingest({ not: "an event" });
  assert.equal(result.status, "rejected");
  const trail = await observe.read.getEventAudit("<unknown>");
  assert.equal(trail.length, 2);
});

test("ingestAll processes a batch in order", async () => {
  const observe = makeObserve();
  const results = await observe.ingestAll([
    reviewEvent({ eventId: "a" }),
    reviewEvent({ eventId: "b", payload: { pullRequest: "pr", decision: "bad" } }),
    reviewEvent({ eventId: "a" }), // duplicate of the first
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    ["accepted", "rejected", "duplicate"],
  );
});

test("stored observations are queryable through the read API", async () => {
  const observe = makeObserve();
  await observe.ingest(reviewEvent({ eventId: "a", occurredAt: "2026-07-01T08:00:00.000Z" }));
  await observe.ingest(
    reviewEvent({
      eventId: "b",
      kind: "deploy.finished",
      occurredAt: "2026-07-01T09:00:00.000Z",
      payload: { service: "svc", environment: "prod", status: "succeeded" },
      subjects: [{ type: "service", id: "svc" }],
    }),
  );
  const all = await observe.read.queryObservations({ order: "asc" });
  assert.deepEqual(
    all.map((o) => o.type),
    ["ReviewSubmitted", "DeployFinished"],
  );
  assert.deepEqual(observe.read.observationTypes(), [
    "DeployFinished",
    "IssueOpened",
    "ReviewSubmitted",
  ]);
});
