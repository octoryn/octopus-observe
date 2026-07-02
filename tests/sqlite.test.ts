import { test as baseTest } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Observe, fixedClock, verifyAuditChain } from "../src/index.js";
import { createSqliteStores } from "../src/storage/sqlite.js";
import { exampleValidators } from "../src/observations/index.js";
import { reviewEvent, FIXED_NOW } from "./helpers.js";

// The SQLite adapter needs Node's built-in node:sqlite (Node >= 22.5). Probe for
// the module *only* (no store side effects) so this suite skips gracefully where
// it is absent, while a genuine adapter break on a capable runtime still fails
// loudly rather than being masked as "unavailable".
let skip: string | false = false;
try {
  createRequire(import.meta.url)("node:sqlite");
} catch {
  skip = "node:sqlite unavailable (requires Node >= 22.5)";
}
const test = (name: string, fn: () => void | Promise<void>): void => {
  baseTest(name, { skip }, fn);
};

const deployEvent = (eventId: string) =>
  reviewEvent({
    eventId,
    kind: "deploy.finished",
    payload: { service: "svc", environment: "prod", status: "succeeded" },
    subjects: [{ type: "service", id: "svc" }],
  });

test("Observe works end-to-end on SQLite stores (in-memory db)", async () => {
  const stores = createSqliteStores(":memory:");
  try {
    const observe = new Observe({
      validators: exampleValidators,
      observationStore: stores.observations,
      auditStore: stores.audit,
      clock: fixedClock(FIXED_NOW),
    });
    assert.equal((await observe.ingest(reviewEvent({ eventId: "a" }))).status, "accepted");
    assert.equal((await observe.ingest(reviewEvent({ eventId: "a" }))).status, "duplicate");
    assert.equal((await observe.ingest(deployEvent("b"))).status, "accepted");
    assert.equal(await observe.read.countObservations(), 2);

    const reviews = await observe.read.queryObservations({ types: ["ReviewSubmitted"] });
    assert.deepEqual(reviews.map((o) => o.sourceEventId), ["a"]);

    const trail = await observe.read.queryAudit();
    assert.ok(verifyAuditChain(trail).ok);
  } finally {
    stores.close();
  }
});

test("SQLite store enforces append-only and immutability", async () => {
  const stores = createSqliteStores(":memory:");
  try {
    const observe = new Observe({
      validators: exampleValidators,
      observationStore: stores.observations,
      auditStore: stores.audit,
      clock: fixedClock(FIXED_NOW),
    });
    const result = await observe.ingest(reviewEvent({ eventId: "a" }));
    assert.ok(result.status === "accepted");
    // Direct duplicate put bypasses dedupe and must be rejected by the store.
    await assert.rejects(() => stores.observations.put(result.observation), /append-only/);
    // Hydrated observations are frozen.
    const fetched = await stores.observations.get(result.observation.id);
    assert.ok(fetched && Object.isFrozen(fetched));
  } finally {
    stores.close();
  }
});

test("SQLite query filters by actor and time window", async () => {
  const stores = createSqliteStores(":memory:");
  try {
    const observe = new Observe({
      validators: exampleValidators,
      observationStore: stores.observations,
      auditStore: stores.audit,
      clock: fixedClock(FIXED_NOW),
    });
    await observe.ingest(reviewEvent({ eventId: "a", occurredAt: "2026-07-01T08:00:00Z" }));
    await observe.ingest(
      reviewEvent({
        eventId: "b",
        occurredAt: "2026-07-01T10:00:00Z",
        actors: [{ type: "actor", id: "bob" }],
      }),
    );
    const alice = await stores.observations.query({ actor: { id: "alice" } });
    assert.deepEqual(alice.map((o) => o.sourceEventId), ["a"]);

    const window = await stores.observations.query({
      from: Date.parse("2026-07-01T09:00:00Z"),
    });
    assert.deepEqual(window.map((o) => o.sourceEventId), ["b"]);

    await assert.rejects(() => stores.observations.query({ limit: -1 }), RangeError);
  } finally {
    stores.close();
  }
});

test("SQLite audit store rejects duplicate ids and sequences (forked chain)", async () => {
  const stores = createSqliteStores(":memory:");
  try {
    const rec = (id: string, sequence: number) => ({
      id,
      stage: "validation" as const,
      outcome: "passed" as const,
      eventId: "e",
      at: 0,
      sequence,
      previousHash: "genesis",
      hash: `hash-${id}`,
    });
    await stores.audit.append(rec("a", 0));
    // Same sequence from a second (forked) emitter must fail loudly.
    await assert.rejects(() => stores.audit.append(rec("b", 0)), /append-only/);
    // Same id must fail too.
    await assert.rejects(() => stores.audit.append(rec("a", 1)), /append-only/);
  } finally {
    stores.close();
  }
});

test("SQLite raw-event archive tapes, replays, and drives backfill", async () => {
  const stores = createSqliteStores(":memory:");
  try {
    const observe = new Observe({
      validators: exampleValidators,
      observationStore: stores.observations,
      auditStore: stores.audit,
      rawEventArchive: stores.rawEvents,
      clock: fixedClock(FIXED_NOW),
    });
    await observe.ingest(reviewEvent({ eventId: "a" }));
    await observe.ingest({ garbage: true }); // rejected but still taped
    assert.equal(await stores.rawEvents.count(), 2);

    const taped = await stores.rawEvents.replay();
    assert.equal(taped.length, 2);
    // Sequence is an opaque, strictly-increasing ordinal (1-based in SQLite).
    assert.ok((taped[0] as { sequence: number }).sequence < (taped[1] as { sequence: number }).sequence);
    assert.deepEqual(taped[1]?.event, { garbage: true });

    await assert.rejects(() => stores.rawEvents.replay({ limit: -1 }), RangeError);
    await assert.rejects(() => stores.rawEvents.replay({ limit: 1.5 }), RangeError);
    await assert.rejects(() => stores.rawEvents.replay({ fromSequence: -1 }), RangeError);
  } finally {
    stores.close();
  }
});

test("pruning the archive never wedges or reuses a sequence", async () => {
  const stores = createSqliteStores(":memory:");
  try {
    const a = await stores.rawEvents.archive({ n: 0 }, 0);
    await stores.rawEvents.archive({ n: 1 }, 1);
    // Retention/PII purge of an old row must be safe.
    stores.db.exec(`DELETE FROM raw_events WHERE sequence = ${a.sequence}`);
    const c = await stores.rawEvents.archive({ n: 2 }, 2); // must not throw
    // New sequence is strictly greater than any ever used — never reused.
    assert.ok(c.sequence > a.sequence + 1);
    assert.equal(await stores.rawEvents.count(), 2);
  } finally {
    stores.close();
  }
});

test("SQLite pruneBefore is an audit-safe prefix delete that never reuses sequences", async () => {
  const stores = createSqliteStores(":memory:");
  try {
    const a = await stores.rawEvents.archive({ i: 0 }, 0);
    await stores.rawEvents.archive({ i: 1 }, 1);
    const c = await stores.rawEvents.archive({ i: 2 }, 2);

    const removed = await stores.rawEvents.pruneBefore(c.sequence);
    assert.equal(removed, 2); // a and b pruned
    assert.equal(await stores.rawEvents.count(), 1);
    const remaining = await stores.rawEvents.replay();
    assert.deepEqual(remaining.map((e) => e.sequence), [c.sequence]);

    // A later append gets a strictly greater sequence — never a pruned one.
    const d = await stores.rawEvents.archive({ i: 3 }, 3);
    assert.ok(d.sequence > c.sequence);
    assert.ok(d.sequence > a.sequence);

    await assert.rejects(() => stores.rawEvents.pruneBefore(-1), RangeError);
  } finally {
    stores.close();
  }
});

test("raw-event archive survives a reconnect", async () => {
  const dir = mkdtempSync(join(tmpdir(), "observe-archive-"));
  const file = join(dir, "observe.db");
  try {
    {
      const stores = createSqliteStores(file);
      const observe = new Observe({
        validators: exampleValidators,
        observationStore: stores.observations,
        auditStore: stores.audit,
        rawEventArchive: stores.rawEvents,
        clock: fixedClock(FIXED_NOW),
      });
      await observe.ingest(reviewEvent({ eventId: "a" }));
      stores.close();
    }
    const stores2 = createSqliteStores(file);
    try {
      assert.equal(await stores2.rawEvents.count(), 1);
      const replayed = await stores2.rawEvents.replay();
      assert.equal((replayed[0]?.event as { eventId: string }).eventId, "a");
    } finally {
      stores2.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("data and the audit chain survive a reconnect", async () => {
  const dir = mkdtempSync(join(tmpdir(), "observe-sqlite-"));
  const file = join(dir, "observe.db");
  try {
    {
      const stores = createSqliteStores(file);
      const observe = new Observe({
        validators: exampleValidators,
        observationStore: stores.observations,
        auditStore: stores.audit,
        clock: fixedClock(FIXED_NOW),
      });
      await observe.ingest(reviewEvent({ eventId: "a" }));
      await observe.ingest(deployEvent("b"));
      stores.close();
    }

    const stores2 = createSqliteStores(file);
    try {
      const observe2 = new Observe({
        validators: exampleValidators,
        observationStore: stores2.observations,
        auditStore: stores2.audit,
        clock: fixedClock(FIXED_NOW),
      });
      // Data persisted.
      assert.equal(await observe2.read.countObservations(), 2);
      // A new emitter resumes the existing chain rather than forking it.
      await observe2.ingest(reviewEvent({ eventId: "c" }));
      const trail = await observe2.read.queryAudit();
      assert.ok(verifyAuditChain(trail).ok);
      // Sequences are contiguous across the reconnect boundary.
      assert.deepEqual(
        trail.map((r) => r.sequence),
        trail.map((_, i) => i),
      );
    } finally {
      stores2.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
