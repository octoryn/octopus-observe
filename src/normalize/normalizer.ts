import type { ObservationEvent } from "../core/event.js";
import type { Observation, ObservationVersions } from "../core/observation.js";
import type { Rejection } from "../core/rejection.js";
import type { TaggedRef } from "../core/refs.js";
import { type Result, ok, err } from "../core/result.js";
import type { Clock } from "../core/clock.js";
import { observationId } from "../core/ids.js";
import { deepFreeze } from "../core/freeze.js";
import { type ObservationContent, computeObservationHash } from "../core/observation-integrity.js";
import type { AuditSecret } from "../core/audit-chain.js";
import type { ValidatorRegistry } from "../validate/registry.js";
import type { Resolver } from "./resolver.js";
import { parseEnvelope } from "./envelope.js";
import { type TimestampPolicy, parseTimestamp } from "./timestamp.js";

/** Dependencies of the normalizer, all injected. */
export interface NormalizerDeps {
  readonly registry: ValidatorRegistry;
  readonly resolver: Resolver;
  readonly clock: Clock;
  readonly normalizationVersion: string;
  readonly supportedEnvelopeVersions: readonly string[];
  readonly timestampPolicy: TimestampPolicy;
  /** Optional HMAC key for observation integrity hashes. */
  readonly integritySecret?: AuditSecret;
}

/**
 * The normalizer turns untrusted input into a trusted, canonical, immutable
 * {@link Observation} — or a {@link Rejection}. It is the only component
 * allowed to reject input, and every rejection it returns is, by definition, a
 * validation-stage failure.
 *
 * It performs validation, normalization, and attribution as one pure step
 * (given its injected dependencies). It does not dedupe, store, or emit audit
 * records — that orchestration belongs to the {@link Observe} pipeline.
 */
export class Normalizer {
  constructor(private readonly deps: NormalizerDeps) {}

  normalize(input: unknown): Result<Observation, Rejection> {
    // --- Validation: envelope structure ------------------------------------
    const parsed = parseEnvelope(input);
    if (!parsed.ok) {
      return parsed;
    }
    const event = parsed.value;

    // --- Validation: envelope version --------------------------------------
    if (!this.deps.supportedEnvelopeVersions.includes(event.envelopeVersion)) {
      return err({
        reason: "UNSUPPORTED_ENVELOPE_VERSION",
        message: `unsupported envelopeVersion "${event.envelopeVersion}"; supported: ${this.deps.supportedEnvelopeVersions.join(", ")}`,
        eventId: event.eventId,
      });
    }

    // --- Validation: kind + schema version ---------------------------------
    const lookup = this.deps.registry.lookup(event.kind, event.schemaVersion);
    if (lookup.status === "unknown_kind") {
      return err({
        reason: "UNKNOWN_KIND",
        message: `no validator registered for kind "${event.kind}"`,
        eventId: event.eventId,
      });
    }
    if (lookup.status === "schema_mismatch") {
      return err({
        reason: "SCHEMA_VERSION_MISMATCH",
        message: `kind "${event.kind}" has no validator for schemaVersion "${event.schemaVersion}"; known: ${lookup.known.join(", ")}`,
        eventId: event.eventId,
      });
    }
    const validator = lookup.validator;

    // --- Validation: payload -----------------------------------------------
    const validated = validator.validate(event.payload);
    if (!validated.ok) {
      return err({
        reason: "INVALID_PAYLOAD",
        message: `payload failed validation for kind "${event.kind}"`,
        eventId: event.eventId,
        issues: validated.issues,
      });
    }

    // --- Validation: timestamp ---------------------------------------------
    const timestamp = parseTimestamp(event.occurredAt, this.deps.timestampPolicy);
    if (!timestamp.ok) {
      const message =
        timestamp.error === "not_rfc3339"
          ? `occurredAt "${event.occurredAt}" must be an RFC 3339 timestamp with a timezone offset (e.g. a trailing "Z")`
          : `occurredAt "${event.occurredAt}" is not a parseable timestamp`;
      return err({ reason: "INVALID_TIMESTAMP", message, eventId: event.eventId });
    }
    const at = timestamp.at;

    // --- Attribution -------------------------------------------------------
    const actors = this.resolveRefs(event, "actors");
    const subjects = this.resolveRefs(event, "subjects");

    // --- Normalization: assemble canonical observation ---------------------
    const type = validator.observationType;
    const id = observationId(event.eventId, type, this.deps.normalizationVersion);

    const versions: ObservationVersions = {
      envelope: event.envelopeVersion,
      schema: event.schemaVersion,
      normalization: this.deps.normalizationVersion,
      ...(event.source?.version !== undefined ? { source: event.source.version } : {}),
    };

    const content: ObservationContent = {
      id,
      type,
      at,
      ingestedAt: this.deps.clock(),
      actors,
      subjects,
      attributes: validated.attributes,
      source: event.source ?? {},
      sourceEventId: event.eventId,
      versions,
    };

    const observation: Observation = {
      ...content,
      integrity: computeObservationHash(content, this.deps.integritySecret),
    };

    return ok(deepFreeze(observation));
  }

  private resolveRefs(event: ObservationEvent, field: "actors" | "subjects"): readonly TaggedRef[] {
    const raw = event[field] ?? [];
    const resolve =
      field === "actors"
        ? this.deps.resolver.resolveActor.bind(this.deps.resolver)
        : this.deps.resolver.resolveSubject.bind(this.deps.resolver);
    // Re-own each resolved ref: cloning the attributes means the subsequent
    // deep-freeze can never freeze caller-owned or resolver-owned state, and a
    // resolver that returns a shared/live object cannot leak mutability into
    // (or have its state frozen by) a stored observation.
    return raw.map((ref) => {
      const resolved = resolve(ref);
      return resolved.attributes === undefined
        ? { type: resolved.type, id: resolved.id }
        : {
            type: resolved.type,
            id: resolved.id,
            attributes: structuredClone(resolved.attributes),
          };
    });
  }
}
