/**
 * A single problem found while validating input, located by a dotted path into
 * the offending structure (e.g. `payload.decision`).
 */
export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Why an event was rejected. Validation is the only stage allowed to reject, so
 * every rejection carries one of these reasons and, where relevant, the
 * specific issues that caused it.
 */
export type RejectionReason =
  /** The envelope is not a well-formed `ObservationEvent`. */
  | "MALFORMED_ENVELOPE"
  /** `envelopeVersion` is not one this build understands. */
  | "UNSUPPORTED_ENVELOPE_VERSION"
  /** No validator is registered for the event's `kind`. */
  | "UNKNOWN_KIND"
  /** A validator exists for the kind, but not for the event's `schemaVersion`. */
  | "SCHEMA_VERSION_MISMATCH"
  /** `occurredAt` is not a parseable timestamp. */
  | "INVALID_TIMESTAMP"
  /** The payload failed the type's validator. */
  | "INVALID_PAYLOAD";

/**
 * A structured rejection. Rejections are returned, never thrown, and are always
 * mirrored into the audit trail.
 */
export interface Rejection {
  readonly reason: RejectionReason;
  readonly message: string;
  /** The offending event's id, when the envelope was intact enough to read it. */
  readonly eventId?: string;
  /** Field-level issues, for `INVALID_PAYLOAD` / `MALFORMED_ENVELOPE`. */
  readonly issues?: readonly ValidationIssue[];
}
