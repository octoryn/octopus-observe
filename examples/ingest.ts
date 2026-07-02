/**
 * Runnable example: feed a mix of events through Observe and inspect the
 * canonical observations and audit trail.
 *
 *   npm run example
 */
import { Observe, exampleValidators, fixedClock, type ObservationEvent } from "../src/index.js";

const events: (ObservationEvent | unknown)[] = [
  {
    eventId: "evt-1",
    envelopeVersion: "1.0",
    schemaVersion: "1.0",
    kind: "review.submitted",
    occurredAt: "2026-07-01T09:30:00.000Z",
    source: { system: "github", connector: "gh-webhook", version: "2022-11-28" },
    payload: { pullRequest: "octopus-observe#42", decision: "approved", comments: 3 },
    actors: [{ type: "actor", id: "alice" }],
    subjects: [{ type: "pull_request", id: "octopus-observe#42" }],
  },
  {
    eventId: "evt-2",
    envelopeVersion: "1.0",
    schemaVersion: "1.0",
    kind: "deploy.finished",
    occurredAt: "2026-07-01T10:15:00.000Z",
    source: { system: "ci", version: "v3" },
    payload: {
      service: "observe-api",
      environment: "production",
      status: "failed",
      durationMs: 42000,
    },
    subjects: [{ type: "service", id: "observe-api" }],
  },
  // Re-delivery of evt-1 — deterministic id makes this an idempotent duplicate.
  {
    eventId: "evt-1",
    envelopeVersion: "1.0",
    schemaVersion: "1.0",
    kind: "review.submitted",
    occurredAt: "2026-07-01T09:30:00.000Z",
    payload: { pullRequest: "octopus-observe#42", decision: "approved", comments: 3 },
    actors: [{ type: "actor", id: "alice" }],
  },
  // Invalid payload — rejected at validation.
  {
    eventId: "evt-3",
    envelopeVersion: "1.0",
    schemaVersion: "1.0",
    kind: "review.submitted",
    occurredAt: "2026-07-01T11:00:00.000Z",
    payload: { pullRequest: "octopus-observe#43", decision: "loved-it" },
  },
];

async function main(): Promise<void> {
  const observe = new Observe({
    validators: exampleValidators,
    // Fixed clock so the example output is deterministic.
    clock: fixedClock(Date.parse("2026-07-02T00:00:00.000Z")),
  });

  const results = await observe.ingestAll(events);

  console.log("=== ingest results ===");
  for (const result of results) {
    if (result.status === "accepted" || result.status === "duplicate") {
      console.log(
        `${result.status.padEnd(10)} ${result.observation.type} (${result.observation.id})`,
      );
    } else if (result.status === "rejected") {
      console.log(
        `${"rejected".padEnd(10)} ${result.rejection.reason}: ${result.rejection.message}`,
      );
    } else {
      console.log(`${"skipped".padEnd(10)} ${result.eventId}`);
    }
  }

  console.log("\n=== stored observations (chronological) ===");
  const observations = await observe.read.queryObservations({ order: "asc" });
  for (const obs of observations) {
    console.log(
      `${new Date(obs.at).toISOString()}  ${obs.type.padEnd(16)} actors=[${obs.actors
        .map((a) => `${a.type}:${a.id}`)
        .join(", ")}]`,
    );
  }

  console.log("\n=== audit trail for evt-1 ===");
  for (const record of await observe.read.getEventAudit("evt-1")) {
    console.log(`  ${record.stage}/${record.outcome}`);
  }

  console.log(`\ntotal observations stored: ${await observe.read.countObservations()}`);
  console.log(`known types: ${observe.read.observationTypes().join(", ")}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
