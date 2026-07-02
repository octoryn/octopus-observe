/**
 * Version constants owned by Observe.
 *
 * There are four independent version axes in the system (see docs/DESIGN.md):
 *
 *  - envelope      — the shape of `ObservationEvent` (declared per event)
 *  - schema        — the shape of a `kind`'s payload (declared per event,
 *                    understood by a validator)
 *  - normalization — the version of Observe's normalization contract (owned
 *                    here, stamped onto every observation)
 *  - source        — the upstream system's version (declared per event, opaque)
 *
 * Observe owns exactly one of these: the normalization version.
 */

/** The envelope version this build understands. */
export type EnvelopeVersion = "1.0";

/** Envelope versions accepted by default. */
export const SUPPORTED_ENVELOPE_VERSIONS: readonly string[] = ["1.0"];

/**
 * Version of Observe's normalization contract. Bump this when the meaning of
 * normalization changes (e.g. a new canonical field, a changed timestamp rule).
 * Observations carry it, and it participates in the deterministic id, so a bump
 * re-derives observations rather than silently mutating existing ones.
 */
export const NORMALIZATION_VERSION = "1.0";
