/**
 * Storage conformance suite.
 *
 * A reusable battery of contract tests for the three storage ports
 * ({@link ObservationStore}, {@link AuditStore}, {@link RawEventArchive}). It
 * lets *any* adapter — the built-in in-memory and SQLite ones, or a third
 * party's Postgres/DynamoDB/… implementation — prove it satisfies the same
 * contract the pipeline relies on, rather than each adapter being trusted on
 * faith.
 *
 * The suite is deliberately adversarial: it round-trips **full records** (not
 * just ids), exercises **compound (ANDed) filters**, **empty-store** reads, and
 * **field fidelity**, so an adapter that drops a field, ORs its filters, or
 * mishandles a cold store fails rather than passing on partial coverage.
 *
 * Usage (in a test file run under `node --test`):
 *
 * ```ts
 * import { storeConformance } from "@octopus/observe/conformance";
 * import { InMemoryObservationStore } from "@octopus/observe";
 *
 * storeConformance("in-memory", {
 *   observations: () => new InMemoryObservationStore(),
 * });
 * ```
 *
 * Each function registers `node:test` cases; call them at module top level. The
 * factories must return a *fresh, empty* store on every call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Observation } from "./core/observation.js";
import type { AuditRecord } from "./core/audit.js";
import { deepFreeze } from "./core/freeze.js";
import type {
  AuditStore,
  ObservationStore,
  RawEventArchive,
} from "./storage/store.js";

// Observations reach a store already deep-frozen by the pipeline, carrying a
// full set of populated fields; fixtures do the same so field fidelity is
// actually exercised (not just id/at).
function observation(over: Partial<Observation> & Pick<Observation, "id" | "at">): Observation {
  return deepFreeze({
    type: "ReviewSubmitted",
    ingestedAt: 5,
    actors: [{ type: "actor", id: "alice", attributes: { team: "core" } }],
    subjects: [{ type: "pull_request", id: "pr#1" }],
    attributes: { pullRequest: "pr#1", decision: "approved", comments: 3 },
    source: { system: "github", version: "2022-11-28" },
    sourceEventId: over.id,
    versions: { envelope: "1.0", schema: "1.0", normalization: "1.0", source: "2022-11-28" },
    integrity: `integrity-${over.id}`,
    ...over,
  });
}

function auditRecord(sequence: number, over: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: `rec-${sequence}`,
    stage: "validation",
    outcome: "passed",
    eventId: "evt",
    observationId: "obs_x",
    at: 1000 + sequence,
    sequence,
    previousHash: sequence === 0 ? "genesis" : `hash-${sequence - 1}`,
    hash: `hash-${sequence}`,
    detail: { note: "ok" },
    ...over,
  };
}

/** Contract tests for an {@link ObservationStore}. */
export function observationStoreConformance(
  label: string,
  makeStore: () => ObservationStore,
): void {
  const name = (s: string): string => `[conformance:${label}] ObservationStore ${s}`;

  test(name("empty store: query is [], count is 0, get is undefined"), async () => {
    const store = makeStore();
    assert.deepEqual(await store.query(), []);
    assert.equal(await store.count(), 0);
    assert.equal(await store.get("missing"), undefined);
    assert.equal(await store.has("missing"), false);
  });

  test(name("round-trips the full observation with field fidelity"), async () => {
    const store = makeStore();
    const o = observation({ id: "obs_a", at: 10 });
    await store.put(o);
    // Deep-equal, not just id/at: an adapter that drops attributes/actors/
    // subjects/source/versions must fail here.
    assert.deepEqual(await store.get("obs_a"), o);
    assert.deepEqual((await store.query())[0], o);
    assert.equal(await store.count(), 1);
    const fetched = await store.get("obs_a");
    assert.ok(fetched && Object.isFrozen(fetched));
  });

  test(name("is append-only and preserves the original on a rejected duplicate"), async () => {
    const store = makeStore();
    const original = observation({ id: "obs_a", at: 10, attributes: { v: 1 } });
    await store.put(original);
    await assert.rejects(
      () => store.put(observation({ id: "obs_a", at: 20, attributes: { v: 2 } })),
      /append-only/,
    );
    // The rejected write must not have overwritten the stored value.
    assert.deepEqual(await store.get("obs_a"), original);
    assert.equal(await store.count(), 1);
  });

  test(name("filters by type, time window, actor, subject"), async () => {
    const store = makeStore();
    await store.put(observation({ id: "obs_a", at: 10, type: "ReviewSubmitted" }));
    await store.put(observation({ id: "obs_b", at: 20, type: "DeployFinished" }));
    assert.deepEqual((await store.query({ types: ["DeployFinished"] })).map((o) => o.id), ["obs_b"]);
    assert.deepEqual((await store.query({ from: 20, to: 30 })).map((o) => o.id), ["obs_b"]);
    assert.deepEqual((await store.query({ to: 20 })).map((o) => o.id), ["obs_a"]); // to is exclusive
    assert.deepEqual((await store.query({ actor: { id: "alice" } })).map((o) => o.id).sort(), [
      "obs_a",
      "obs_b",
    ]);
  });

  test(name("ANDs multiple filter criteria (not OR)"), async () => {
    const store = makeStore();
    await store.put(
      observation({ id: "match", at: 10, type: "DeployFinished", actors: [{ type: "actor", id: "alice" }] }),
    );
    await store.put(
      observation({ id: "wrong_actor", at: 11, type: "DeployFinished", actors: [{ type: "actor", id: "bob" }] }),
    );
    await store.put(
      observation({ id: "wrong_type", at: 12, type: "ReviewSubmitted", actors: [{ type: "actor", id: "alice" }] }),
    );
    // Only the row matching BOTH type AND actor may be returned.
    const result = await store.query({ types: ["DeployFinished"], actor: { id: "alice" } });
    assert.deepEqual(result.map((o) => o.id), ["match"]);
    // A type+time compound as well.
    assert.deepEqual(
      (await store.query({ types: ["DeployFinished"], from: 11 })).map((o) => o.id),
      ["wrong_actor"],
    );
  });

  test(name("orders by time, limits, and breaks ties by insertion order"), async () => {
    const store = makeStore();
    for (const at of [10, 20, 30]) await store.put(observation({ id: `obs_${at}`, at }));
    assert.deepEqual((await store.query({ order: "desc", limit: 2 })).map((o) => o.at), [30, 20]);
    assert.deepEqual((await store.query({ order: "asc" })).map((o) => o.at), [10, 20, 30]);

    const tie = makeStore();
    await tie.put(observation({ id: "first", at: 100 }));
    await tie.put(observation({ id: "second", at: 100 }));
    assert.deepEqual((await tie.query({ order: "asc" })).map((o) => o.id), ["first", "second"]);
    assert.deepEqual((await tie.query({ order: "desc" })).map((o) => o.id), ["second", "first"]);
  });

  test(name("rejects every malformed query bound"), async () => {
    const store = makeStore();
    await store.put(observation({ id: "obs_a", at: 10 }));
    await assert.rejects(() => store.query({ limit: -1 }), RangeError);
    await assert.rejects(() => store.query({ limit: 1.5 }), RangeError);
    await assert.rejects(() => store.query({ from: NaN }), RangeError);
    await assert.rejects(() => store.query({ to: NaN }), RangeError);
    assert.equal((await store.query({ limit: 0 })).length, 0);
  });
}

/** Contract tests for an {@link AuditStore}. */
export function auditStoreConformance(label: string, makeStore: () => AuditStore): void {
  const name = (s: string): string => `[conformance:${label}] AuditStore ${s}`;

  test(name("empty store: list is [], tail is undefined"), async () => {
    const store = makeStore();
    assert.deepEqual(await store.list(), []);
    assert.equal(await store.tail(), undefined);
  });

  test(name("appends and lists full records in order with field fidelity"), async () => {
    const store = makeStore();
    const r0 = auditRecord(0);
    const r1 = auditRecord(1, { stage: "storage", outcome: "stored" });
    await store.append(r0);
    await store.append(r1);
    // Deep-equal the whole records: hash/previousHash/at/detail/observationId
    // must survive, not just sequence.
    assert.deepEqual(await store.list(), [r0, r1]);
    assert.deepEqual(await store.tail(), r1);
  });

  test(name("filters by eventId, stage, observationId (ANDed) preserving order"), async () => {
    const store = makeStore();
    await store.append(auditRecord(0, { eventId: "e1", stage: "validation" }));
    await store.append(auditRecord(1, { eventId: "e1", stage: "storage", observationId: "obs_1" }));
    await store.append(auditRecord(2, { eventId: "e2", stage: "validation" }));
    assert.deepEqual((await store.list({ eventId: "e1" })).map((r) => r.sequence), [0, 1]);
    assert.equal((await store.list({ stage: "storage" })).length, 1);
    assert.equal((await store.list({ observationId: "obs_1" })).length, 1);
    // Compound: eventId AND stage together, not either.
    assert.deepEqual(
      (await store.list({ eventId: "e1", stage: "validation" })).map((r) => r.sequence),
      [0],
    );
    assert.equal((await store.list({ limit: 1 })).length, 1);
  });

  test(name("is append-only: rejects a non-advancing sequence and a duplicate id"), async () => {
    const store = makeStore();
    await store.append(auditRecord(0));
    await store.append(auditRecord(1));
    await assert.rejects(() => store.append(auditRecord(1, { id: "other" })), /append-only/);
    await assert.rejects(() => store.append(auditRecord(2, { id: "rec-0" })), /append-only/);
  });
}

/** Contract tests for a {@link RawEventArchive}. */
export function rawEventArchiveConformance(
  label: string,
  makeArchive: () => RawEventArchive,
): void {
  const name = (s: string): string => `[conformance:${label}] RawEventArchive ${s}`;

  test(name("empty archive: replay is [], count is 0"), async () => {
    const archive = makeArchive();
    assert.deepEqual(await archive.replay(), []);
    assert.equal(await archive.count(), 0);
  });

  test(name("archives with monotonic sequence, preserving event and receivedAt"), async () => {
    const archive = makeArchive();
    const a = await archive.archive({ n: 0 }, 100);
    const b = await archive.archive({ n: 1 }, 101);
    assert.ok(b.sequence > a.sequence);
    // receivedAt round-trips on both the return value and the replay.
    assert.equal(a.receivedAt, 100);
    const all = await archive.replay();
    assert.deepEqual(all.map((e) => (e.event as { n: number }).n), [0, 1]);
    assert.deepEqual(all.map((e) => e.receivedAt), [100, 101]);
    assert.equal(await archive.count(), 2);
  });

  test(name("stores a faithful copy immune to later mutation"), async () => {
    const archive = makeArchive();
    const event = { nested: { v: 1 } };
    await archive.archive(event, 0);
    event.nested.v = 999;
    const stored = (await archive.replay())[0]?.event as { nested: { v: number } };
    assert.equal(stored.nested.v, 1);
  });

  test(name("replay honors fromSequence (inclusive) and limit, and rejects bad bounds"), async () => {
    const archive = makeArchive();
    const seqs: number[] = [];
    for (let i = 0; i < 4; i++) seqs.push((await archive.archive({ i }, i)).sequence);
    assert.deepEqual(
      (await archive.replay({ fromSequence: seqs[2] as number })).map((e) => e.sequence),
      seqs.slice(2),
    );
    assert.equal((await archive.replay({ limit: 1 })).length, 1);
    await assert.rejects(() => archive.replay({ limit: -1 }), RangeError);
    await assert.rejects(() => archive.replay({ limit: 1.5 }), RangeError);
    await assert.rejects(() => archive.replay({ fromSequence: -1 }), RangeError);
    await assert.rejects(() => archive.replay({ fromSequence: 1.5 }), RangeError);
  });

  test(name("pruneBefore is an audit-safe prefix delete that never reuses sequences"), async () => {
    const archive = makeArchive();
    const seqs: number[] = [];
    for (let i = 0; i < 4; i++) seqs.push((await archive.archive({ i }, i)).sequence);
    const removed = await archive.pruneBefore(seqs[2] as number);
    assert.equal(removed, 2);
    assert.deepEqual((await archive.replay()).map((e) => e.sequence), seqs.slice(2));
    assert.equal(await archive.count(), 2);
    await assert.rejects(() => archive.pruneBefore(-1), RangeError);

    // Prune the rest, then confirm a later append still gets a fresh sequence.
    await archive.pruneBefore((seqs[3] as number) + 1);
    assert.equal(await archive.count(), 0);
    const next = await archive.archive({ i: 4 }, 4);
    assert.ok(next.sequence > (seqs[3] as number));
  });
}

/** Factories for the stores a {@link storeConformance} run should cover. */
export interface ConformanceFactories {
  readonly observations?: () => ObservationStore;
  readonly audit?: () => AuditStore;
  readonly rawEvents?: () => RawEventArchive;
}

/**
 * Run the conformance suites for whichever stores are provided. A convenience
 * over calling the three functions individually.
 */
export function storeConformance(label: string, factories: ConformanceFactories): void {
  if (factories.observations) observationStoreConformance(label, factories.observations);
  if (factories.audit) auditStoreConformance(label, factories.audit);
  if (factories.rawEvents) rawEventArchiveConformance(label, factories.rawEvents);
}
