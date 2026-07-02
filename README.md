# Observe

> Standalone observation intake and normalization. Observe turns raw external
> events into **trusted, canonical, immutable observations** — and nothing more.

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

It has **zero runtime dependencies** and **no dependency** on
`octopus-blackboard`, `octopus-experience`, or any workflow runtime. The repo is
fully usable on its own. The boundary is the `ObservationEvent` shape — not any
connector SDK.

## Install & build

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test (46 tests)
npm run build       # emit dist/
```

Requires Node ≥ 20.

## Quickstart

```ts
import { Observe, exampleValidators } from "@octopus/observe";

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

# After building, the `observe` bin is available:
node dist/cli.js events.ndjson
```

Exit code is `1` if any event was rejected, `0` otherwise.

## Defining your own observation types

A `Validator` owns one `(kind, schemaVersion)` pair and turns an untrusted
payload into canonical attributes:

```ts
import { PayloadChecker, type Validator } from "@octopus/observe";

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

## Extension points

Exactly three — everything else is closed:

1. **Validators** — add input kinds / schema versions.
2. **Storage adapters** — implement `ObservationStore` / `AuditStore` (an
   in-memory default ships in-repo).
3. **Resolver** — implement `Resolver` for cross-source identity resolution (the
   default is pass-through identity).

## Design

The authoritative architecture and contracts live in
[`docs/DESIGN.md`](docs/DESIGN.md). Read it before making changes — code is
written against that spec.

## License

MIT
