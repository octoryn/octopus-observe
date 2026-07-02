/**
 * Observe — standalone observation intake and normalization.
 *
 * Turns raw external events into trusted, canonical, immutable observations:
 *
 *   Raw event → Validation → Normalization → Attribution → Deduplication
 *             → Canonical observation → Storage → Read API
 *
 * It does not execute, plan, orchestrate, remember user experience, or derive
 * organizational signals. It has no dependency on the rest of the Octopus
 * ecosystem and is usable entirely on its own.
 */

// Pipeline entry point.
export { Observe } from "./observe.js";
export type {
  ObserveOptions,
  IngestResult,
  UnknownKindPolicy,
} from "./observe.js";

// Core contracts.
export type { ObservationEvent, EventSource } from "./core/event.js";
export type { Observation, ObservationVersions } from "./core/observation.js";
export type { TaggedRef, RawRef } from "./core/refs.js";
export type { JsonValue, JsonObject, JsonPrimitive } from "./core/json.js";
export type {
  Rejection,
  RejectionReason,
  ValidationIssue,
} from "./core/rejection.js";
export type {
  AuditRecord,
  AuditStage,
  AuditOutcome,
} from "./core/audit.js";
export type { Result } from "./core/result.js";
export { ok, err } from "./core/result.js";

// Versions.
export {
  NORMALIZATION_VERSION,
  SUPPORTED_ENVELOPE_VERSIONS,
} from "./core/versions.js";
export type { EnvelopeVersion } from "./core/versions.js";

// Time.
export { type Clock, systemClock, fixedClock } from "./core/clock.js";

// Validation.
export type { Validator, ValidationResult } from "./validate/validator.js";
export { ValidatorRegistry } from "./validate/registry.js";
export type { ValidatorLookup } from "./validate/registry.js";
export { PayloadChecker } from "./validate/checker.js";

// Attribution.
export type { Resolver } from "./normalize/resolver.js";
export { identityResolver } from "./normalize/resolver.js";

// Normalizer (advanced / direct use).
export { Normalizer } from "./normalize/normalizer.js";
export type { NormalizerDeps } from "./normalize/normalizer.js";
export { parseEnvelope } from "./normalize/envelope.js";

// Storage.
export type {
  ObservationStore,
  AuditStore,
  ObservationQuery,
  AuditQuery,
  RefMatch,
} from "./storage/store.js";
export {
  InMemoryObservationStore,
  InMemoryAuditStore,
} from "./storage/memory.js";

// Read API.
export { ReadApi } from "./api/read.js";

// Example observation types.
export {
  exampleValidators,
  reviewSubmittedValidator,
  deployFinishedValidator,
  issueOpenedValidator,
} from "./observations/index.js";
