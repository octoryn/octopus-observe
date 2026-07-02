import type { RawRef } from "./refs.js";

/**
 * Provenance of an event, as declared by whatever produced it. Observe records
 * this for audit but never interprets it to make decisions — the boundary is
 * the event shape, not the connector.
 */
export interface EventSource {
  /** The upstream system the event describes, e.g. "github", "jira". */
  readonly system?: string;
  /** The connector/emitter that mapped the source into an event envelope. */
  readonly connector?: string;
  /** Version of the source system or its schema, opaque to Observe. */
  readonly version?: string;
}

/**
 * `ObservationEvent` is the untrusted input at the Observe boundary.
 *
 * An external connector (which does NOT live in this repository) is responsible
 * for mapping some raw upstream happening into this envelope. Even so, an event
 * is untrusted: it may be malformed, duplicated, out of order, carry an
 * unsupported version, or reference an unknown kind. Only the {@link Normalizer}
 * (via validation) is allowed to reject it.
 *
 * The contract is deliberately small: `eventId`, `kind`, `occurredAt`,
 * `envelopeVersion`, and `schemaVersion` plus a `payload`. Everything else is
 * best-effort metadata.
 */
export interface ObservationEvent {
  /**
   * Stable id assigned by the emitter. Used for idempotent, deterministic
   * observation ids: re-delivering the same event never creates a second
   * observation.
   */
  readonly eventId: string;

  /**
   * Version of THIS envelope contract (the shape of `ObservationEvent`
   * itself). Observe dispatches on it so multiple envelope versions can be
   * accepted at once. See {@link EnvelopeVersion}.
   */
  readonly envelopeVersion: string;

  /**
   * Version of the `payload` schema for this `kind`. Validators declare which
   * schema version they understand; a mismatch is a rejection, never a silent
   * best-effort parse.
   */
  readonly schemaVersion: string;

  /** Logical kind of the happening, e.g. "review.submitted", "deploy.finished". */
  readonly kind: string;

  /** When it happened, per the source. ISO-8601 string. */
  readonly occurredAt: string;

  /** Untrusted, source-shaped payload. Interpreted only by a validator. */
  readonly payload: unknown;

  /** Provenance metadata; recorded for audit, never used for control flow. */
  readonly source?: EventSource;

  /** Participants as named by the source, before attribution. */
  readonly actors?: readonly RawRef[];

  /** What the event is about, as named by the source, before attribution. */
  readonly subjects?: readonly RawRef[];
}
