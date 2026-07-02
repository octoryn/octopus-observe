import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Observe, fixedClock, verifyAuditChain } from "../src/index.js";
import { createSqliteStores } from "../src/storage/sqlite.js";
import { exampleValidators } from "../src/observations/index.js";
import { reviewEvent, FIXED_NOW } from "./helpers.js";

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
