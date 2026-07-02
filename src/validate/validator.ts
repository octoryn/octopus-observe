import type { JsonObject } from "../core/json.js";
import type { ValidationIssue } from "../core/rejection.js";

/**
 * The result of validating a payload: either the typed, canonical attributes to
 * store, or the specific issues that make the payload invalid.
 */
export type ValidationResult =
  | { readonly ok: true; readonly attributes: JsonObject }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/**
 * A `Validator` owns the contract for one `(kind, schemaVersion)` pair. It is
 * the single extension point of the input side: to support a new kind of event,
 * register a new validator.
 *
 * A validator's job is narrow and pure: given an untrusted payload, either
 * reject it with issues or return the canonical attributes for its
 * `observationType`. It does not resolve refs, read the clock, or touch
 * storage.
 */
export interface Validator {
  /** The event `kind` this validator handles, e.g. "review.submitted". */
  readonly kind: string;
  /** The canonical observation type it produces, e.g. "ReviewSubmitted". */
  readonly observationType: string;
  /** The payload `schemaVersion` it understands. */
  readonly schemaVersion: string;
  /** Validate an untrusted payload into canonical attributes. Must be pure. */
  validate(payload: unknown): ValidationResult;
}
