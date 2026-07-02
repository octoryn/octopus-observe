import type { ObservationEvent } from "../src/index.js";

/** A valid `review.submitted` event, overridable per test. */
export function reviewEvent(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    eventId: "evt-1",
    envelopeVersion: "1.0",
    schemaVersion: "1.0",
    kind: "review.submitted",
    occurredAt: "2026-07-01T09:30:00.000Z",
    source: { system: "github", version: "2022-11-28" },
    payload: { pullRequest: "pr#1", decision: "approved" },
    actors: [{ type: "actor", id: "alice" }],
    subjects: [{ type: "pull_request", id: "pr#1" }],
    ...overrides,
  };
}

/** A fixed instant used across tests. */
export const FIXED_NOW = Date.parse("2026-07-02T00:00:00.000Z");
