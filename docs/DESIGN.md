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

`occurredAt` must be a parseable timestamp. It **should** carry an explicit
timezone offset (e.g. a trailing `Z`); an ISO date-time without an offset is
interpreted per the JS runtime and is therefore discouraged for canonical data.
See §9 for the rationale and the boundary this draws.

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
doubles — they are what make Observe usable with no external dependency. Other
backends (SQLite, Postgres, ...) are adapters that satisfy these interfaces.
`ObservationQuery` supports filtering by type(s), time window (`from` inclusive,
`to` exclusive), actor/subject ref, plus ordering and limiting.

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

---

## 9. Deliberate boundaries & limitations

Choices made for v0, recorded so they stay intentional:

1. **Timestamp parsing** uses the runtime's `Date.parse` (ISO-8601). A date-time
   without a timezone offset is runtime-interpreted and thus non-canonical
   across machines; connectors are expected to emit offset-qualified instants
   (our examples use `Z`). Making Observe *reject* offset-less date-times is a
   candidate hardening for a future normalization version — deferred rather than
   guessed, because it is a normalization-version-bumping behavior change.
2. **Single-writer assumption.** `ingest` is safe to call sequentially (and
   `ingestAll` guarantees order for dedupe determinism). The in-memory store is
   not designed for concurrent `ingest` of the *same* event id in flight; a
   persistent adapter with atomic insert-if-absent would lift this.
5. **Infrastructure errors vs input rejections.** Every *input-level* outcome is
   returned as an `IngestResult` (`accepted` / `duplicate` / `rejected` /
   `skipped`) — a bad event is never thrown. `ingest` may still reject its
   promise if a storage or audit *adapter* throws (disk full, lost connection,
   append-only violation). That is deliberately kept distinct: reporting an
   infrastructure failure as a `rejected` input would wrongly tell the caller
   the event was invalid. Adapter failures are the caller's to handle or retry.
3. **Audit record ids** are random UUIDs (audit is a log, not addressed by id);
   only observation ids are deterministic.
4. **Attributes are JSON.** Observation attributes and audit details are plain
   JSON so observations stay serializable, comparable, and storage-agnostic.

---

## 10. Module layout

Single package, `@octopus/observe`. One responsibility per module; dependencies
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
  validate/      # the input-side extension point
    validator.ts     # Validator interface
    registry.ts      # (kind, schemaVersion) registry
    checker.ts       # dependency-free payload checker
  normalize/     # envelope parsing, attribution, normalization
    envelope.ts
    resolver.ts      # attribution seam (default identity)
    normalizer.ts    # validation + normalization + attribution
  storage/       # interfaces + in-memory defaults
    store.ts
    memory.ts
  audit/
    emitter.ts       # stamps & writes audit records
  api/
    read.ts          # read-only query API
  observations/  # example validators (illustrative, not canonical)
  observe.ts     # the Observe pipeline (orchestration)
  cli.ts         # runnable CLI
  index.ts       # public surface
```

---

## 11. Extension points

Exactly three, and no more. Everything else is closed.

1. **Validators** (`validate/`) — add an input kind / schema version.
2. **Storage adapters** (`storage/store.ts`) — swap persistence.
3. **Resolver** (`normalize/resolver.ts`) — cross-source identity resolution.

Connectors are explicitly *not* an extension point here; they live outside the
repository. The boundary is `ObservationEvent`.
