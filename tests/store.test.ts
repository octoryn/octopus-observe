import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryAuditStore,
  InMemoryObservationStore,
} from "../src/storage/memory.js";
import type { Observation } from "../src/index.js";
import type { AuditRecord } from "../src/core/audit.js";

function obs(overrides: Partial<Observation> & Pick<Observation, "id" | "at">): Observation {
  return {
    type: "ReviewSubmitted",
    ingestedAt: 0,
    actors: [],
    subjects: [],
    attributes: {},
    source: {},
    sourceEventId: overrides.id,
    versions: { envelope: "1.0", schema: "1.0", normalization: "1.0" },
    ...overrides,
  };
}

test("put then get round-trips", async () => {
  const store = new InMemoryObservationStore();
  const o = obs({ id: "obs_a", at: 10 });
  await store.put(o);
  assert.equal(await store.has("obs_a"), true);
  assert.deepEqual(await store.get("obs_a"), o);
  assert.equal(await store.count(), 1);
});

test("put is append-only: storing an existing id throws", async () => {
  const store = new InMemoryObservationStore();
  await store.put(obs({ id: "obs_a", at: 10 }));
  await assert.rejects(() => store.put(obs({ id: "obs_a", at: 20 })), /append-only/);
});

test("query filters by type", async () => {
  const store = new InMemoryObservationStore();
  await store.put(obs({ id: "obs_a", at: 10, type: "ReviewSubmitted" }));
  await store.put(obs({ id: "obs_b", at: 20, type: "DeployFinished" }));
  const reviews = await store.query({ types: ["ReviewSubmitted"] });
  assert.deepEqual(
    reviews.map((o) => o.id),
    ["obs_a"],
  );
});

test("query filters by time window (from inclusive, to exclusive)", async () => {
  const store = new InMemoryObservationStore();
  await store.put(obs({ id: "obs_a", at: 10 }));
  await store.put(obs({ id: "obs_b", at: 20 }));
  await store.put(obs({ id: "obs_c", at: 30 }));
  const window = await store.query({ from: 20, to: 30 });
  assert.deepEqual(
    window.map((o) => o.id),
    ["obs_b"],
  );
});

test("query filters by actor and subject refs", async () => {
  const store = new InMemoryObservationStore();
  await store.put(obs({ id: "obs_a", at: 10, actors: [{ type: "actor", id: "alice" }] }));
  await store.put(obs({ id: "obs_b", at: 20, actors: [{ type: "actor", id: "bob" }] }));
  const alice = await store.query({ actor: { id: "alice" } });
  assert.deepEqual(
    alice.map((o) => o.id),
    ["obs_a"],
  );
  const byType = await store.query({ actor: { type: "team", id: "alice" } });
  assert.equal(byType.length, 0);
});

test("query orders and limits", async () => {
  const store = new InMemoryObservationStore();
  await store.put(obs({ id: "obs_a", at: 10 }));
  await store.put(obs({ id: "obs_b", at: 20 }));
  await store.put(obs({ id: "obs_c", at: 30 }));
  const desc = await store.query({ order: "desc", limit: 2 });
  assert.deepEqual(
    desc.map((o) => o.id),
    ["obs_c", "obs_b"],
  );
});

test("query breaks ties by insertion order", async () => {
  const store = new InMemoryObservationStore();
  await store.put(obs({ id: "obs_a", at: 100 }));
  await store.put(obs({ id: "obs_b", at: 100 }));
  const asc = await store.query({ order: "asc" });
  assert.deepEqual(
    asc.map((o) => o.id),
    ["obs_a", "obs_b"],
  );
});

test("query rejects malformed bounds instead of silently corrupting results", async () => {
  const store = new InMemoryObservationStore();
  await store.put(obs({ id: "obs_a", at: 10 }));
  await store.put(obs({ id: "obs_b", at: 20 }));
  await assert.rejects(() => store.query({ limit: -1 }), RangeError);
  await assert.rejects(() => store.query({ limit: 1.5 }), RangeError);
  await assert.rejects(() => store.query({ from: NaN }), RangeError);
  await assert.rejects(() => store.query({ to: NaN }), RangeError);
  // A valid zero limit is allowed and returns nothing.
  assert.equal((await store.query({ limit: 0 })).length, 0);
});

test("audit store lists and filters", async () => {
  const store = new InMemoryAuditStore();
  const rec = (
    id: string,
    eventId: string,
    stage: AuditRecord["stage"],
    sequence: number,
  ): AuditRecord => ({
    id,
    stage,
    outcome: "passed",
    eventId,
    at: 0,
    sequence,
    previousHash: "genesis",
    hash: `hash-${id}`,
  });
  await store.append(rec("1", "evt-1", "validation", 0));
  await store.append(rec("2", "evt-1", "storage", 1));
  await store.append(rec("3", "evt-2", "validation", 2));

  assert.equal((await store.list({ eventId: "evt-1" })).length, 2);
  assert.equal((await store.list({ stage: "storage" })).length, 1);
  assert.equal((await store.list()).length, 3);
  assert.equal((await store.tail())?.id, "3");
});

test("audit store is append-only: sequence must advance", async () => {
  const store = new InMemoryAuditStore();
  const rec = (id: string, sequence: number): AuditRecord => ({
    id,
    stage: "validation",
    outcome: "passed",
    eventId: "e",
    at: 0,
    sequence,
    previousHash: "genesis",
    hash: `hash-${id}`,
  });
  await store.append(rec("a", 0));
  await store.append(rec("b", 1));
  // A non-advancing sequence (e.g. a forked chain) is rejected.
  await assert.rejects(() => store.append(rec("c", 1)), /append-only/);
  await assert.rejects(() => store.append(rec("d", 0)), /append-only/);
});
