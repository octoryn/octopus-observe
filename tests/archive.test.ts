import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Observe,
  InMemoryRawEventArchive,
  renormalize,
  fixedClock,
  type ArchivedEvent,
  type RawEventArchive,
} from "../src/index.js";
import { exampleValidators } from "../src/observations/index.js";
import { reviewEvent, FIXED_NOW } from "./helpers.js";

test("archive assigns contiguous sequences and replays in order", async () => {
  const archive = new InMemoryRawEventArchive();
  await archive.archive({ n: 0 }, 100);
  await archive.archive({ n: 1 }, 101);
  await archive.archive({ n: 2 }, 102);
  const all = await archive.replay();
  assert.deepEqual(
    all.map((e) => e.sequence),
    [0, 1, 2],
  );
  assert.deepEqual(
    all.map((e) => (e.event as { n: number }).n),
    [0, 1, 2],
  );
  assert.equal(await archive.count(), 3);
});

test("replay honors fromSequence and limit", async () => {
  const archive = new InMemoryRawEventArchive();
  for (let i = 0; i < 5; i++) await archive.archive({ i }, i);
  assert.deepEqual(
    (await archive.replay({ fromSequence: 3 })).map((e) => e.sequence),
    [3, 4],
  );
  assert.deepEqual(
    (await archive.replay({ limit: 2 })).map((e) => e.sequence),
    [0, 1],
  );
});

test("replay rejects malformed bounds", async () => {
  const archive = new InMemoryRawEventArchive();
  await archive.archive({ n: 0 }, 0);
  await assert.rejects(() => archive.replay({ limit: -1 }), RangeError);
  await assert.rejects(() => archive.replay({ limit: 1.5 }), RangeError);
  await assert.rejects(() => archive.replay({ fromSequence: -1 }), RangeError);
  await assert.rejects(() => archive.replay({ fromSequence: 1.5 }), RangeError);
});

test("pruneBefore removes the oldest prefix and preserves the suffix", async () => {
  const archive = new InMemoryRawEventArchive();
  for (let i = 0; i < 5; i++) await archive.archive({ i }, i); // sequences 0..4

  const removed = await archive.pruneBefore(2);
  assert.equal(removed, 2); // 0 and 1 removed
  assert.equal(await archive.count(), 3);
  const remaining = await archive.replay();
  assert.deepEqual(
    remaining.map((e) => e.sequence),
    [2, 3, 4],
  ); // ordered suffix, unchanged ids
});

test("pruneBefore never reuses a sequence for future appends", async () => {
  const archive = new InMemoryRawEventArchive();
  await archive.archive({ i: 0 }, 0);
  await archive.archive({ i: 1 }, 1);
  await archive.pruneBefore(2); // removes everything so far
  assert.equal(await archive.count(), 0);
  const next = await archive.archive({ i: 2 }, 2);
  assert.equal(next.sequence, 2); // monotonic counter, not reused from 0
  // A bookmark past the cut still works.
  assert.deepEqual(
    (await archive.replay({ fromSequence: 2 })).map((e) => e.sequence),
    [2],
  );
});

test("pruneBefore is a no-op below the floor and total above the ceiling", async () => {
  const archive = new InMemoryRawEventArchive();
  for (let i = 0; i < 3; i++) await archive.archive({ i }, i);
  assert.equal(await archive.pruneBefore(0), 0); // nothing older than 0
  assert.equal(await archive.count(), 3);
  assert.equal(await archive.pruneBefore(999), 3); // everything is older than 999
  assert.equal(await archive.count(), 0);
});

test("pruneBefore validates its argument", async () => {
  const archive = new InMemoryRawEventArchive();
  await assert.rejects(() => archive.pruneBefore(-1), RangeError);
  await assert.rejects(() => archive.pruneBefore(1.5), RangeError);
});

test("archive stores a faithful copy immune to later mutation", async () => {
  const archive = new InMemoryRawEventArchive();
  const event = { kind: "x", nested: { v: 1 } };
  await archive.archive(event, 0);
  event.nested.v = 999; // mutate the caller's object afterwards
  const stored = (await archive.replay())[0]?.event as { nested: { v: number } };
  assert.equal(stored.nested.v, 1);
});

test("attaching an archive does not change the observation produced", async () => {
  const withArchive = new Observe({
    validators: exampleValidators,
    clock: fixedClock(FIXED_NOW),
    rawEventArchive: new InMemoryRawEventArchive(),
  });
  const without = new Observe({ validators: exampleValidators, clock: fixedClock(FIXED_NOW) });

  const a = await withArchive.ingest(reviewEvent());
  const b = await without.ingest(reviewEvent());
  assert.ok(a.status === "accepted" && b.status === "accepted");
  // The observation line is unaffected by the side-channel archive.
  assert.deepEqual(a.observation, b.observation);
});

test("the archive tapes every raw input, including rejected ones", async () => {
  const archive = new InMemoryRawEventArchive();
  const observe = new Observe({
    validators: exampleValidators,
    clock: fixedClock(FIXED_NOW),
    rawEventArchive: archive,
  });
  await observe.ingest(reviewEvent({ eventId: "ok" }));
  await observe.ingest({ not: "an event" }); // rejected (malformed envelope)
  await observe.ingest(
    reviewEvent({ eventId: "bad", payload: { pullRequest: "p", decision: "x" } }),
  ); // rejected payload

  assert.equal(await archive.count(), 3); // all three taped
  assert.equal(await observe.read.countObservations(), 1); // only the valid one stored
  const taped = await archive.replay();
  assert.deepEqual(taped[1]?.event, { not: "an event" });
});

test("a failing archive surfaces as an infrastructure error and stores nothing", async () => {
  const failing: RawEventArchive = {
    archive: () => Promise.reject(new Error("disk full")),
    replay: () => Promise.resolve([]),
    count: () => Promise.resolve(0),
    pruneBefore: () => Promise.resolve(0),
  };
  const observe = new Observe({
    validators: exampleValidators,
    clock: fixedClock(FIXED_NOW),
    rawEventArchive: failing,
  });
  await assert.rejects(() => observe.ingest(reviewEvent()), /disk full/);
  assert.equal(await observe.read.countObservations(), 0);
});

test("backfill: replay the archive through renormalize under a new version", async () => {
  const archive = new InMemoryRawEventArchive();
  const observe = new Observe({
    validators: exampleValidators,
    clock: fixedClock(FIXED_NOW),
    rawEventArchive: archive,
    normalizationVersion: "1.0",
  });
  await observe.ingestAll([reviewEvent({ eventId: "a" }), reviewEvent({ eventId: "b" })]);
  const v1 = await observe.read.queryObservations({ order: "asc" });

  // Re-normalize the taped originals under a new version — pure, no storage.
  const archived: readonly ArchivedEvent[] = await archive.replay();
  const { observations, rejections } = renormalize(
    archived.map((e) => e.event),
    { validators: exampleValidators, clock: fixedClock(FIXED_NOW), normalizationVersion: "2.0" },
  );
  assert.equal(rejections.length, 0);
  assert.equal(observations.length, 2);
  // New version → new, coexisting ids; old observations untouched.
  assert.notEqual(observations[0]?.id, v1[0]?.id);
  assert.equal(observations[0]?.versions.normalization, "2.0");
});
