**English** | [简体中文](README.zh-CN.md)

# Observe

[![CI](https://github.com/octoryn/octopus-observe/actions/workflows/ci.yml/badge.svg)](https://github.com/octoryn/octopus-observe/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/octoryn/octopus-observe?sort=semver)](https://github.com/octoryn/octopus-observe/releases/latest)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](.nvmrc)
[![Built on octopus-evidence](https://img.shields.io/badge/built%20on-octopus--evidence-7c9cff.svg)](https://github.com/octoryn/octopus-evidence)

> Standalone observation intake and normalization. Observe turns raw external
> events into **trusted, canonical, immutable observations** — and nothing more.

> **Part of [Octopus Core](https://github.com/octoryn) — the open infrastructure stack for governed AI.** One job per repo, along the agent lifecycle: [Scout](https://github.com/octoryn/octopus-scout) · [Observe](https://github.com/octoryn/octopus-observe) · [Experience](https://github.com/octoryn/octopus-experience) · [Blackboard](https://github.com/octoryn/octopus-blackboard) · [Runtime](https://github.com/octoryn/octopus-runtime) · [Replay](https://github.com/octoryn/octopus-replay) — with [Inspect](https://github.com/octoryn/octopus-inspect) governing every stage. The whole stack rides one root primitive — the shared **[Evidence](https://github.com/octoryn/octopus-evidence)** atom, the canonical, tamper-evident root category every stage speaks.
>
> **This repo — Observe · Observe:** Turn untrusted events into trusted observations.

```
Raw event → Validation → Normalization → Attribution → Deduplication
          → Canonical observation → Storage → Read API
```

Feed Observe untrusted events from anywhere (Git, issues, reviews, deploys,
emails, …). It validates them, normalizes them into a canonical shape,
attributes their actors and subjects, deduplicates them idempotently, and stores
immutable observations you can query back — with a full audit trail of what
happened to every event.

## Boundaries

Observe **does not** execute actions, plan, orchestrate, remember user
experience, or derive organizational signals. Deriving signals (review-latency
trends, ownership drift, health indices) is a *downstream* system that consumes
Observe's output. Observe stops at the canonical observation.

It has **no dependency** on `octopus-blackboard`, `octopus-experience`, or any
workflow runtime. The boundary is the `ObservationEvent` shape — not any
connector SDK.

It has **zero third-party dependencies**: its only runtime dependency is the
first-party [`octopus-evidence`](https://github.com/octoryn/octopus-evidence)
primitive (itself zero-dependency), which provides the canonical hashing the
whole stack shares — and which the `toEvidence` bridge uses to project an
observation into a verifiable `Evidence` envelope. The repo is otherwise fully
usable on its own.

## Install & build

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test (154 tests)
npm run build       # emit dist/
```

Requires Node ≥ 20. The optional SQLite adapter uses Node's built-in
`node:sqlite` and works on Node ≥ 22.

Timestamps are enforced to RFC 3339 with a timezone offset by default (so
canonical times are region-independent); pass `timestampPolicy: "lenient"` to
opt out.

## Quickstart

```ts
import { Observe, exampleValidators } from "octopus-observe";

const observe = new Observe({ validators: exampleValidators });

const result = await observe.ingest({
  eventId: "evt-1",
  envelopeVersion: "1.0",
  schemaVersion: "1.0",
  kind: "review.submitted",
  occurredAt: "2026-07-01T09:30:00.000Z",
  source: { system: "github", version: "2022-11-28" },
  payload: { pullRequest: "octopus-observe#42", decision: "approved", comments: 3 },
  actors: [{ type: "actor", id: "alice" }],
  subjects: [{ type: "pull_request", id: "octopus-observe#42" }],
});

// result.status is "accepted" | "duplicate" | "rejected" | "skipped"
if (result.status === "accepted") {
  console.log(result.observation.id); // obs_<sha256…>, deterministic
}

// Read back, filtered.
const reviews = await observe.read.queryObservations({
  types: ["ReviewSubmitted"],
  order: "asc",
});

// Explain what happened to an event.
const trail = await observe.read.getEventAudit("evt-1");
// → validation/passed → normalization/passed → attribution/passed
//   → dedupe/unique → storage/stored
```

Re-ingesting the same `eventId` returns `{ status: "duplicate" }` and stores
nothing new — deterministic ids make ingest idempotent.

## CLI

```bash
# From a JSON array or NDJSON file, or stdin:
npm run cli -- events.ndjson --audit
cat events.ndjson | npm run cli -- --audit
npm run cli -- --json          # machine-readable output

# After building, the `octopus-observe` bin is available:
octopus-observe events.ndjson
```

Exit code is `1` if any event was rejected, `0` otherwise.

## Agent events (ready-made intake)

You don't have to hand-write intake for the agent stack. Two built-in adapters
turn common agent happenings into canonical, ingestible `ObservationEvent`s:

```ts
import { Observe, exampleValidators, mcpToolCallEvent, agentEventValidators } from "octopus-observe";

const observe = new Observe({ validators: [...exampleValidators, ...agentEventValidators] });

await observe.ingest(
  mcpToolCallEvent({
    tool: "search",
    server: "docs",
    args: { query: "cats" },
    result: { hits: 3 },
    actor: { id: "claude-code" },
    occurredAt: "2026-07-03T09:30:00.000Z",
  }),
); // → accepted as an "AgentToolCalled" observation
```

`mcpToolCallEvent(...)` and `agentActionEvent(...)` build valid, frozen envelopes
(deterministic ids that fold the payload, so distinct calls don't collide);
register `agentEventValidators` so they're accepted. The boundary is unchanged —
these only construct the `ObservationEvent`; ingestion, dedupe, and audit are
identical to any other event.

## Defining your own observation types

A `Validator` owns one `(kind, schemaVersion)` pair and turns an untrusted
payload into canonical attributes:

```ts
import { PayloadChecker, type Validator } from "octopus-observe";

const mergeValidator: Validator = {
  kind: "pr.merged",
  observationType: "PullRequestMerged",
  schemaVersion: "1.0",
  validate(payload) {
    const c = PayloadChecker.of(payload);
    if (!c) return { ok: false, issues: [{ path: "payload", message: "must be an object" }] };
    c.string("pullRequest");
    c.number("additions", { optional: true, integer: true });
    return c.result();
  },
};

const observe = new Observe({ validators: [mergeValidator] });
```

## Persistence (SQLite)

The core ships an in-memory store; a durable SQLite adapter is available from a
separate entry point (so importing the core never loads the experimental
`node:sqlite`) and adds **no npm dependency**:

```ts
import { Observe, exampleValidators } from "octopus-observe";
import { createSqliteStores } from "octopus-observe/sqlite";

const stores = createSqliteStores("./observe.db"); // or ":memory:"
const observe = new Observe({
  validators: exampleValidators,
  observationStore: stores.observations,
  auditStore: stores.audit,
});

// … ingest …
stores.close();
```

Reopen the same file later and both the observations and the audit hash chain
resume exactly where they left off. Implement `ObservationStore` / `AuditStore`
yourself for any other backend.

## Tamper-evident audit

Every event's audit records form a **hash chain** (`sequence`, `previousHash`,
`hash`). Any edit, insertion, deletion, or reordering breaks it:

```ts
import { verifyAuditChain, exportAuditNdjson } from "octopus-observe";

const trail = await observe.read.queryAudit();
const check = verifyAuditChain(trail);          // { ok: true } or { ok: false, brokenAt, reason }

const ndjson = exportAuditNdjson(trail);        // ship to a SIEM / log pipeline
```

By default this is **tamper-evident** (detects casual/in-place tampering) but
not tamper-proof — the hash is public. For deployments that don't trust the
store, pass an `auditSecret` to make the chain a keyed HMAC that can't be forged
without the key:

```ts
const observe = new Observe({ validators, auditSecret: process.env.AUDIT_KEY });
// verify with the same key:
verifyAuditChain(await observe.read.queryAudit(), process.env.AUDIT_KEY);
```

## Observation integrity

Every observation carries an `integrity` hash over its content, so a stored
observation altered after the fact (e.g. an attribute edited directly in the DB)
is detectable — independently of the deterministic `id`:

```ts
import { verifyObservation } from "octopus-observe";

const obs = await observe.read.getObservation(id);
verifyObservation(obs); // false if any field was tampered with
```

Like the audit chain, it's tamper-evident by default; pass `integritySecret` to
`Observe` for a keyed HMAC that can't be forged without the key (verify with the
same key). The audit trail proves what *happened*; observation integrity proves
each stored fact is *unaltered*.

## Raw-event archive (optional)

Re-normalizing history needs the original events (an observation doesn't retain
its source payload). Attach an **optional** `RawEventArchive` — a faithful tape
of raw inputs, kept strictly off the observation line (the observation produced
is byte-identical whether or not an archive is attached, and the archive holds
raw input, never observations):

```ts
import { Observe, InMemoryRawEventArchive } from "octopus-observe";
// or use the durable one: createSqliteStores(...).rawEvents

const archive = new InMemoryRawEventArchive();
const observe = new Observe({ validators, rawEventArchive: archive });
```

Because it's a plaintext tape that may hold PII/PHI, retention is first-class.
`pruneBefore` removes the oldest prefix (audit-safe — it never punches holes,
and sequences are never reused):

```ts
// Keep only events at/after a cut sequence (e.g. computed from an age window):
const removed = await archive.pruneBefore(cutSequence);
```

## Backfill / re-normalization

Observations are immutable and their id is scoped by normalization version, so
re-normalizing under a new version produces **new, coexisting** observations
rather than rewriting history. `renormalize` is the pure, dry-runnable primitive
— replay the archive (or an upstream source) through it, then `put` the results:

```ts
import { renormalize } from "octopus-observe";

const archived = await archive.replay();
const { observations, rejections } = renormalize(
  archived.map((e) => e.event),
  { validators, normalizationVersion: "2.0" },
);
```

The end-to-end shape is `archive.replay()` → `renormalize` → `store.put`. See
[`docs/DESIGN.md`](docs/DESIGN.md) §6.1 and §8.1 for the boundary discipline and
the full migration playbook.

## Verifying a storage adapter

Writing your own `ObservationStore` / `AuditStore` / `RawEventArchive`? A
reusable conformance suite proves it satisfies the same contract the built-ins
do — round-tripping full records, ANDed filters, empty-store reads, append-only
semantics, and audit-safe pruning. Point it at your factories in a
`node --test` file:

```ts
import { storeConformance } from "octopus-observe/conformance";
import { MyPostgresObservationStore } from "./my-adapter.js";

storeConformance("postgres", {
  observations: () => new MyPostgresObservationStore(freshTestDb()),
});
```

The suite is adversarial by design: an adapter that drops a field, ORs its
filters, or mishandles a cold store fails rather than passing on partial
coverage.

## Extension points

Exactly three — everything else is closed:

1. **Validators** — add input kinds / schema versions.
2. **Storage adapters** — implement `ObservationStore` / `AuditStore` / the
   optional `RawEventArchive` (in-memory and SQLite defaults ship in-repo).
3. **Resolver** — implement `Resolver` for cross-source identity resolution (the
   default is pass-through identity).

## Design

The authoritative architecture and contracts live in
[`docs/DESIGN.md`](docs/DESIGN.md). Read it before making changes — code is
written against that spec.

## License

[Apache-2.0](LICENSE) © Octoryn.
