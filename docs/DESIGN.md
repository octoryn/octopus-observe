**English** | [简体中文](DESIGN.zh-CN.md)

# Observe — Architecture & Contracts

Status: **v0.1** · Owner: Observe · Last updated: 2026-07-02

This is the authoritative design document. Code is written *against* this spec.
When the two disagree, this document is wrong until updated — fix it here first,
then change the code.

---

## 1. What Observe is

**Observe turns raw external events into trusted, canonical, immutable
observations.** That is the whole North Star.

```
Raw event → Validation → Normalization → Attribution → Deduplication
          → Canonical observation → Storage → Read API
```

An external connector (which does **not** live in this repository) maps some
upstream happening into an `ObservationEvent` and hands it to Observe. From that
boundary inward, Observe validates it, normalizes it into a canonical shape,
attributes its actors and subjects, deduplicates it, and stores an immutable
`Observation` that can be read back through a query API — with a full audit
trail of what happened to every event.

### 1.1 What it is *not* (enforced boundaries)

Observe does not, and must never:

- **Execute** actions or cause outside side effects.
- **Plan** — no goals, next-steps, or workflow.
- **Orchestrate** — no agents, routing, or coordination.
- **Remember user experience** — it stores observations and their audit trail;
  that is an append-only record, not a memory of interactions.
- **Derive organizational signals** — computing review-latency trends,
  ownership drift, health indices, etc. is a *downstream* concern. Observe stops
  at the canonical observation. (Signal derivation is a separate system that
  consumes Observe's output; it is out of scope here.)

If a proposed feature requires any of the above, it does not belong in this
repository.

### 1.2 Independence

Zero dependency on `octopus-blackboard`, `octopus-experience`, or any workflow
runtime — and, in fact, **zero runtime dependencies at all**. The package builds,
tests, and runs end-to-end in-memory with nothing else present. Integration is
the operating system's concern; the boundary is `ObservationEvent`, not any
connector SDK.

---

## 2. The pipeline

Each stage is a one-way boundary. Data flows forward only; nothing downstream
writes back upstream.

| Stage             | Input → Output                     | Responsibility                                                        |
|-------------------|------------------------------------|-----------------------------------------------------------------------|
| **Validation**    | `unknown` → structural event       | Envelope shape, envelope version, kind+schema lookup, payload, timestamp. **The only stage allowed to reject.** |
| **Normalization** | event → canonical fields           | Canonical type, timestamp → epoch ms, version stamping, deterministic id. |
| **Attribution**   | raw refs → tagged refs             | Resolve actors/subjects to canonical refs (pluggable; default identity). |
| **Deduplication** | observation → unique?              | Deterministic id lookup; re-ingest of the same event is idempotent.   |
| **Storage**       | observation → persisted            | Append-only persistence (pluggable; default in-memory).               |
| **Read API**      | query → observations / audit       | Read-only access to stored observations and the audit trail.          |

Validation, normalization, and attribution are implemented as one pure step
(the `Normalizer`) given injected dependencies; deduplication, storage, and
audit emission are orchestrated by the `Observe` pipeline. Every stage transition
emits an audit record (§7).

---

## 3. Core concepts

A strict two-record progression: **Event → Observation**.

### 3.1 ObservationEvent — untrusted input

The raw record at the boundary. Already mapped into Observe's envelope shape by
a connector, but still untrusted: it may be malformed, duplicated, out of order,
carry an unsupported version, or reference an unknown kind.

Contract (see `src/core/event.ts`): `eventId`, `envelopeVersion`, `schemaVersion`,
`kind`, `occurredAt`, `payload`, plus optional `source`, `actors`, `subjects`.
The `payload` is typed `unknown` — it is interpreted only by a validator.

`occurredAt` must be an RFC 3339 timestamp **with an explicit timezone offset**
(e.g. a trailing `Z` or `±HH:MM`). This is enforced by default (`timestampPolicy:
"rfc3339"`): an offset-less date-time is interpreted per the JS runtime and so is
not canonical across machines or regions, which matters for audit and
compliance, and is therefore rejected as `INVALID_TIMESTAMP`. A `"lenient"`
policy is available as an explicit opt-out for pipelines that knowingly ingest
looser sources.

### 3.2 Observation — trusted, canonical, immutable

The output of the pipeline (see `src/core/observation.ts`). Key properties:

- **Immutable.** Deep-frozen at creation. Corrections arrive as new events and
  become new observations; the record is append-only.
- **Deterministic id.** `id = sha256(sourceEventId, type, normalizationVersion)`.
  Re-ingesting the same event under the same normalization version yields the
  same id (idempotent dedupe); bumping the normalization version yields a *new*
  id (re-derivation, never in-place mutation).
- **Attributed.** `actors` and `subjects` are resolved to canonical
  {@link TaggedRef}s so downstream consumers can aggregate across sources.
- **Versioned.** Carries the envelope, schema, normalization, and (optional)
  source versions that produced it.

### 3.3 Open tagged refs

Observe never enumerates the set of actor/subject kinds — that would couple the
core to one organization's vocabulary. A ref is an open `(type, id)` pair:
`type` names the kind ("actor", "team", "service", "pull_request", ...) and `id`
identifies within it. Consumers match on `type`.

### 3.4 Observation integrity

The deterministic `id` establishes *identity* (for dedup), not *integrity*: it
is a function of `(sourceEventId, type, normalizationVersion)`, so it would not
change if someone edited an attribute of a stored observation directly in the
database. To close that gap, every observation also carries an `integrity` hash
over **all** of its content (every field except `integrity` itself), computed at
ingest and serialized key-order-independently (`stableStringify`) so it is
stable across storage round-trips but sensitive to any value change.
`verifyObservation(obs, secret?)` recomputes and compares.

This mirrors the audit chain's trust model (§7.1): unkeyed it is
**tamper-evident** (detects edits/corruption by anyone who does not recompute);
supply an `integritySecret` and the hash becomes a keyed HMAC that cannot be
forged without the key — **tamper-resistant**. The audit trail proves what
*happened* to an event; observation integrity proves each stored fact is
*unaltered*. `computeObservationHash` / `stableStringify` are frozen wire
contracts. The hash covers `ingestedAt`, so re-normalizing the same event under
a different clock yields a different integrity — expected, since `ingestedAt` is
part of the record and `verifyObservation` always uses the stored value.

---

## 4. Validation

The boundary between untrusted outside and trusted inside, and the **only** stage
allowed to reject. Every rejection carries a structured `RejectionReason`:

| Reason                          | Meaning                                                     |
|---------------------------------|-------------------------------------------------------------|
| `MALFORMED_ENVELOPE`            | Not a well-formed `ObservationEvent`.                       |
| `UNSUPPORTED_ENVELOPE_VERSION`  | `envelopeVersion` not understood by this build.             |
| `UNKNOWN_KIND`                  | No validator registered for the `kind`.                     |
| `SCHEMA_VERSION_MISMATCH`       | Kind known, but not for the event's `schemaVersion`.        |
| `INVALID_TIMESTAMP`             | `occurredAt` is not parseable.                              |
| `INVALID_PAYLOAD`               | Payload failed the type's validator (issues attached).      |

Rejections are **returned, never thrown**, and always mirrored into the audit
trail. Unknown kinds are rejected by default; a `skip` policy is available for
mixed firehoses (recorded in audit, no rejection).

A **Validator** owns one `(kind, schemaVersion)` pair and is pure: given an
untrusted payload, it returns either the canonical attributes or field-level
issues. It does not resolve refs, read the clock, or touch storage. Adding an
input kind = registering one validator. This is the input-side extension point.

---

## 5. Attribution

Resolves raw refs into canonical tagged refs — the seam where cross-source
identity resolution (e.g. unifying `github:alice` and `email:alice@corp`) would
live. Resolution is pure and total: it always returns a ref and never throws for
ordinary input; unknown identities pass through. The default `identityResolver`
is pass-through, keeping Observe fully usable standalone.

---

## 6. Storage

Two append-only stores behind interfaces (see `src/storage/store.ts`):

- `ObservationStore` — `has` / `put` / `get` / `query` / `count`. `put` on an
  existing id is an append-only violation and throws (the pipeline dedupes
  first, so this only fires on a programming error).
- `AuditStore` — `append` / `list`.

The in-memory implementations ship in-repo and are **first-class**, not test
doubles — they are what make Observe usable with no external dependency.
`ObservationQuery` supports filtering by type(s), time window (`from` inclusive,
`to` exclusive), actor/subject ref, plus ordering and limiting; malformed bounds
(`NaN` / negative limit) are rejected loudly rather than silently returning
wrong results (`assertValidObservationQuery`, shared by all adapters).

A **SQLite adapter** ships in-repo at the `octopus-observe/sqlite` entry point
(`createSqliteStores(location)`). It is built on Node's built-in `node:sqlite`,
so it adds **no npm dependency**; that module is experimental and is loaded only
when this adapter is imported, keeping the core entry free of it. It preserves
every invariant: append-only (`put` on an existing id throws), immutable
(observations deep-frozen on read), audit records returned in append order so
the hash chain (§7) stays verifiable across process restarts. Further backends
(Postgres, ...) are adapters that satisfy the same interfaces.

### 6.1 Raw-event archive (optional, separate port)

`RawEventArchive` is an **optional** port, separate from the observation and
audit stores. It is a faithful, append-only **tape of raw inputs** as received
at the boundary — untrusted, un-normalized, in arrival order. Its sole purpose
is to give backfill (§8.1) a source of the original events, since an
`Observation` does not retain its source payload.

Boundary discipline — the archive must never pollute the observation line:

- The archive holds **raw input**, never canonical observations. The two never
  mix types or tables.
- Attaching an archive **does not change the observations Observe produces** —
  the observation is byte-identical with or without it (verified by test). The
  archive is written first, purely as a side-channel.
- The archive **normalizes nothing**. Replayed events go back through
  `renormalize`; the archive is dumb storage.
- A failed archive write is an infrastructure error (§9.3) surfaced to the
  caller, so the tape is never silently skipped while an observation is stored.

In-memory and SQLite implementations ship in-repo; `createSqliteStores` returns
one alongside the observation and audit stores, sharing the connection.

Properties and operational notes:

- **Sequence** is a monotonically-increasing, unique, opaque ordinal (in-memory
  0-based, SQLite 1-based via `AUTOINCREMENT`). It is **never reused**, even
  after rows are pruned, so a bookmark (`fromSequence`) can never silently
  skip or double-count. Do not assume a starting value or gap-freeness.
- **Faithful copy.** Events are stored as a JSON copy immune to later caller
  mutation; both backends use identical `JSON.stringify` semantics. Inputs must
  therefore be JSON-serializable — a non-serializable input (a `bigint`, a
  circular object) fails archival as an infrastructure error rather than being
  stored lossily.
- **Compliance surface & retention.** Unlike the audit chain (which stores
  reasons/detail, never payloads), the archive is a **full plaintext tape of raw
  inputs** — it may contain PII/PHI or secrets. Attaching one changes the
  deployment's data-retention profile: apply encryption/access-control per
  policy. Retention/erasure is a **first-class operation**: `pruneBefore(sequence)`
  removes the oldest prefix and returns the count pruned. It is prefix-only by
  design (never a middle slice), so it preserves the tape's audit semantics —
  the remainder is still an ordered suffix, bookmarks past the cut stay valid,
  and the never-reused sequence means pruning leaves harmless gaps and never
  wedges future appends. Arbitrary/predicate deletion is intentionally not
  offered. Build a policy (by age or count) by reading `replay()` to find the
  cut sequence, then calling `pruneBefore`. Growth is otherwise unbounded (one
  payload per ingested event, including rejected ones).

---

## 7. Audit

Every event produces a trail so that "what happened to event X?" always has an
answer. Audit records (see `src/core/audit.ts`) are emitted for:

- **accepted event:** `validation/passed → normalization/passed →
  attribution/passed → dedupe/unique → storage/stored`
- **duplicate event:** `validation/passed → dedupe/duplicate` (no storage; the
  duplicate is short-circuited at dedupe so a redelivered event's trail stays
  bounded rather than re-emitting the full accepted sequence each time)
- **rejected event:** `validation/failed → rejection/rejected`
- **skipped unknown kind:** `validation/skipped`

Audit records are append-only logs *about the pipeline itself*. They carry no
recommendation. When an envelope is too malformed to carry an `eventId`, its
audit records use the sentinel event id `<unknown>`.

### 7.1 Tamper-evidence

Audit records form a **hash chain**. Each record carries `sequence` (0-based
position), `previousHash` (the prior record's `hash`, or `GENESIS_HASH` for the
first), and `hash` — over the record's content (key-order-independent) plus its
`previousHash`. Any edit, insertion, deletion, or reordering breaks the chain:
`verifyAuditChain(records)` recomputes every hash and checks sequence contiguity
and link continuity, returning the first index that fails.

The chain is maintained by the single audit write path (`AuditEmitter`): emits
are serialized so the chain is well-formed under concurrent ingest, and the
head is **seeded from the store's tail** on first use, so an emitter attached to
a store that already holds records (e.g. after a restart on SQLite) continues
the existing chain rather than forking it. A failed append does not advance the
chain, so it leaves no gap. The stores independently enforce append-only
ordering (the in-memory store requires the sequence to advance; SQLite has
`UNIQUE` constraints on audit `id` and `sequence`), so a genuinely forked chain
— e.g. two emitters seeded from the same tail — fails loudly instead of silently
corrupting the trail.

**Trust model.** By default the hash is a plain SHA-256, which makes the chain
**tamper-evident, not tamper-proof**: it reliably detects in-place edits,
reordering, and deletion by anyone who does not recompute the chain, but the
hash function is public, so an adversary with write access and the code could
fabricate an internally-consistent chain. For deployments that do not trust the
store, pass an `auditSecret`: hashes become keyed HMAC-SHA256 that cannot be
reproduced — and thus a chain cannot be forged — without the key (verify with
the same key). Independently, the head hash (`records.at(-1)?.hash`) can be
periodically anchored in an external trust boundary. `computeAuditHash`,
`stableStringify`, and `GENESIS_HASH` are **frozen wire contracts**: their exact
output is part of the audit format so records hashed under one build re-verify
under another.

### 7.2 Export

`exportAuditNdjson(records)` serializes a trail as newline-delimited JSON, the
lingua franca for shipping into a SIEM or log pipeline. The hash-chain fields
travel with each record, so the destination can re-verify integrity with
`verifyAuditChain`. Transport (to a SIEM, object store, etc.) lives outside the
core — Observe emits the bytes; it does not push them anywhere.

---

## 8. Versioning & schema evolution

Four independent version axes, so evolution is auditable rather than destructive:

- **Envelope version** (`ObservationEvent.envelopeVersion`) — the shape of the
  envelope. Validation dispatches on it; multiple versions can be accepted at
  once.
- **Schema version** (`ObservationEvent.schemaVersion`) — the payload shape for
  a kind. Validators are keyed by `(kind, schemaVersion)`, so multiple schema
  versions of one kind coexist.
- **Normalization version** — owned by Observe, stamped on every observation,
  and part of the deterministic id. Bumping it re-derives observations under new
  ids instead of mutating existing (immutable) ones.
- **Source version** (`ObservationEvent.source.version`) — the upstream
  system's version, opaque to Observe, recorded for audit.

Invariants: records are immutable, ids are deterministic, and every observation
names the exact contract versions that produced it. Evolution happens by
appending new-versioned records, never by mutating old ones.

### 8.1 Migration, backfill & re-normalization

Because observations are immutable and their id is scoped by normalization
version, "changing how we normalize" is never an in-place edit. The playbook:

- **Adding a `kind` or a new `schemaVersion`** is purely additive — register a
  validator. Existing observations are untouched; new events flow through the
  new validator. No migration.
- **Changing how an existing `kind` normalizes** is a **normalization-version
  bump**. Ship the new-version normalizer; from then on, new events produce
  observations under the new version. Old observations remain valid, immutable,
  and tagged with the old version.
- **Backfill** (re-deriving history under the new version) is an explicit,
  auditable action, not an automatic rewrite. Because an `Observation` does not
  retain its source payload, backfill needs the **original events** — from the
  optional `RawEventArchive` (§6.1) if one was attached, or replayed from
  upstream. Feed them through `renormalize(events, { normalizationVersion, ... })`,
  a pure, storage-free, dry-runnable pass that returns the new observations
  (with new, version-scoped ids) and any rejections. Then `put` them: they
  **coexist** with the old-version observations rather than overwriting them.
  The end-to-end shape is `archive.replay()` → `renormalize` → `store.put`.
- **Reading across versions.** Since both versions' observations share
  `sourceEventId` and `type` but differ in `id` and `versions.normalization`, a
  reader chooses which normalization version to consult; a cutover is a reader
  policy, and the old records can be retired on the operator's schedule.

The design deliberately keeps re-normalization *outside* automatic ingest: a
backfill that silently rewrote history would violate immutability and make the
audit trail lie. Observe gives you the primitive (`renormalize`) and the
guarantees (new ids, coexistence, provenance); the orchestration of a migration
is an operational decision.

---

## 9. Deliberate boundaries & limitations

Choices made for v0, recorded so they stay intentional:

1. **Timestamps** are enforced to RFC 3339 with a mandatory timezone offset by
   default (§3.1), so canonical `at` values are region-independent. The
   `"lenient"` policy is an explicit, documented opt-out; use it knowingly.
2. **Single-writer assumption.** `ingest` is safe to call sequentially (and
   `ingestAll` guarantees order for dedupe determinism). The in-memory store is
   not designed for concurrent `ingest` of the *same* event id in flight; the
   SQLite adapter's `UNIQUE` constraint makes a duplicate `put` fail atomically,
   but a fully concurrent-safe check-then-write across processes would need an
   adapter-level upsert. The audit emitter serializes its own writes, so the
   hash chain is safe under concurrent ingest within a process.
3. **Infrastructure errors vs input rejections.** Every *input-level* outcome is
   returned as an `IngestResult` (`accepted` / `duplicate` / `rejected` /
   `skipped`) — a bad event is never thrown. `ingest` may still reject its
   promise if a storage or audit *adapter* throws (disk full, lost connection,
   append-only violation). That is deliberately kept distinct: reporting an
   infrastructure failure as a `rejected` input would wrongly tell the caller
   the event was invalid. Adapter failures are the caller's to handle or retry.
4. **Audit record ids** are random UUIDs (audit is a log, not addressed by id);
   only observation ids are deterministic. Integrity is guaranteed by the hash
   chain (§7.1), not by the id.
5. **Attributes are JSON.** Observation attributes and audit details are plain
   JSON so observations stay serializable, comparable, and storage-agnostic.

---

## 10. Module layout

Single package, `octopus-observe`. One responsibility per module; dependencies
point inward toward `core`, which has none.

```
src/
  core/          # domain types & pure helpers — no I/O
    event.ts         # ObservationEvent (untrusted input)
    observation.ts   # Observation (canonical output)
    refs.ts          # open tagged refs
    json.ts          # JSON value model
    rejection.ts     # rejection reasons & issues
    audit.ts         # audit record types
    result.ts        # Result type
    versions.ts      # version constants
    ids.ts           # deterministic observation id
    clock.ts         # injectable clock
    freeze.ts        # deep freeze
    audit-chain.ts   # hash-chain compute & verify
  validate/      # the input-side extension point
    validator.ts     # Validator interface
    registry.ts      # (kind, schemaVersion) registry
    checker.ts       # dependency-free payload checker
  normalize/     # envelope parsing, attribution, normalization
    envelope.ts
    resolver.ts      # attribution seam (default identity)
    timestamp.ts     # RFC 3339 timestamp policy
    normalizer.ts    # validation + normalization + attribution
  storage/       # interfaces + adapters
    store.ts         # interfaces + shared query validation
    memory.ts        # in-memory default
    sqlite.ts        # SQLite adapter (octopus-observe/sqlite)
  audit/
    emitter.ts       # stamps, hash-chains & writes audit records
    export.ts        # NDJSON / SIEM export
  api/
    read.ts          # read-only query API
  observations/  # example validators (illustrative, not canonical)
  migrate.ts     # renormalize (backfill primitive)
  observe.ts     # the Observe pipeline (orchestration)
  cli.ts         # runnable CLI
  index.ts       # public surface (core; SQLite is a separate entry point)
```

---

## 11. Extension points

Exactly three, and no more. Everything else is closed.

1. **Validators** (`validate/`) — add an input kind / schema version.
2. **Storage adapters** (`storage/store.ts`) — swap persistence for the
   observation store, audit store, and the optional `RawEventArchive` port. Any
   adapter can prove it satisfies the contract with the reusable conformance
   suite (`octopus-observe/conformance`), which the in-memory and SQLite
   backends both pass; it is adversarial (full-record fidelity, ANDed filters,
   empty-store reads, append-only survival) so partial implementations fail.
3. **Resolver** (`normalize/resolver.ts`) — cross-source identity resolution.

Connectors are explicitly *not* an extension point here; they live outside the
repository. The boundary is `ObservationEvent`.
