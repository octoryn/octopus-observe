import type { JsonObject } from "./json.js";
import type { EventSource } from "./event.js";
import type { TaggedRef } from "./refs.js";

/**
 * The set of contract versions that produced an observation. Every derived
 * value can name the exact contracts behind it, which is what makes schema
 * evolution auditable rather than destructive.
 */
export interface ObservationVersions {
  /** Envelope version of the source event. */
  readonly envelope: string;
  /** Payload schema version validated for this observation's type. */
  readonly schema: string;
  /** Version of the normalization contract that produced this observation. */
  readonly normalization: string;
  /** Version of the source system, if the event declared one. */
  readonly source?: string;
}

/**
 * `Observation` is the trusted, canonical, immutable output of the pipeline.
 *
 * Once produced, an observation is never mutated. Corrections arrive as new
 * events and become new observations; the record is append-only. Observations
 * are deep-frozen at creation, and their `id` is a deterministic function of
 * their source event, type, and normalization version, so re-ingesting the same
 * event is idempotent.
 */
export interface Observation {
  /**
   * Deterministic id: `hash(sourceEventId, type, normalizationVersion)`. Stable
   * across re-ingest of the same event under the same normalization contract.
   */
  readonly id: string;

  /** Canonical observation type, e.g. "ReviewSubmitted". */
  readonly type: string;

  /** Source event time normalized to a UTC instant (epoch milliseconds). */
  readonly at: number;

  /** When Observe ingested the event (epoch milliseconds, from the clock). */
  readonly ingestedAt: number;

  /** Resolved participants. */
  readonly actors: readonly TaggedRef[];

  /** Resolved subjects. */
  readonly subjects: readonly TaggedRef[];

  /** Validated, typed attributes produced by the type's validator. */
  readonly attributes: JsonObject;

  /** Provenance of the originating event. */
  readonly source: EventSource;

  /** Back-pointer to the originating event for audit. */
  readonly sourceEventId: string;

  /** The contract versions that produced this observation. */
  readonly versions: ObservationVersions;

  /**
   * Tamper-evidence hash over all of this observation's content (every field
   * except `integrity` itself). Lets a reader detect if a stored observation
   * was altered after the fact — e.g. an attribute edited directly in the
   * database — independently of the deterministic `id`. See
   * `core/observation-integrity.ts`; optionally keyed (HMAC) for
   * tamper-resistance, not just evidence.
   */
  readonly integrity: string;
}
