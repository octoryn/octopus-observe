import type { Observation } from "./core/observation.js";
import type { Rejection } from "./core/rejection.js";
import type { JsonObject } from "./core/json.js";
import { type Clock, systemClock } from "./core/clock.js";
import { NORMALIZATION_VERSION, SUPPORTED_ENVELOPE_VERSIONS } from "./core/versions.js";
import type { Validator } from "./validate/validator.js";
import { ValidatorRegistry } from "./validate/registry.js";
import { type Resolver, identityResolver } from "./normalize/resolver.js";
import { Normalizer } from "./normalize/normalizer.js";
import { type TimestampPolicy, DEFAULT_TIMESTAMP_POLICY } from "./normalize/timestamp.js";
import type { AuditSecret } from "./core/audit-chain.js";
import {
  InMemoryAuditStore,
  InMemoryObservationStore,
} from "./storage/memory.js";
import type { AuditStore, ObservationStore, RawEventArchive } from "./storage/store.js";
import { AuditEmitter } from "./audit/emitter.js";
import { ReadApi } from "./api/read.js";

/** Policy for events whose `kind` has no registered validator. */
export type UnknownKindPolicy = "reject" | "skip";

/** Configuration for an {@link Observe} instance. */
export interface ObserveOptions {
  /** Validators to register. Each owns one `(kind, schemaVersion)` pair. */
  readonly validators: readonly Validator[];
  /** Observation store. Defaults to an in-memory store. */
  readonly observationStore?: ObservationStore;
  /** Audit store. Defaults to an in-memory store. */
  readonly auditStore?: AuditStore;
  /**
   * Optional raw-event archive. When provided, every raw input is taped to it
   * (before normalization) so backfill / re-normalization has a source of the
   * original events. Attaching an archive never changes the observations Observe
   * produces — it is a separate side-channel, not part of the observation line.
   */
  readonly rawEventArchive?: RawEventArchive;
  /** Attribution resolver. Defaults to the identity resolver. */
  readonly resolver?: Resolver;
  /** Time source. Defaults to the system clock. */
  readonly clock?: Clock;
  /** Normalization contract version. Defaults to the built-in version. */
  readonly normalizationVersion?: string;
  /** Accepted envelope versions. Defaults to the built-in supported set. */
  readonly supportedEnvelopeVersions?: readonly string[];
  /**
   * How `occurredAt` is parsed. Defaults to `"rfc3339"` — a mandatory timezone
   * offset, for canonical, region-independent timestamps. Use `"lenient"` to
   * knowingly accept looser (potentially non-canonical) timestamps.
   */
  readonly timestampPolicy?: TimestampPolicy;
  /**
   * Optional HMAC key for the audit hash chain. When set, audit hashes are
   * keyed so the chain cannot be forged without the key (tamper-resistant, not
   * merely tamper-evident). Use the same key when calling `verifyAuditChain`.
   */
  readonly auditSecret?: AuditSecret;
  /**
   * What to do with an unknown `kind`. `"reject"` (default) treats it as a
   * validation failure; `"skip"` quietly drops it (recorded in the audit trail)
   * without producing a rejection — useful for firehoses of mixed events.
   */
  readonly onUnknownKind?: UnknownKindPolicy;
}

/** The outcome of ingesting one event. */
export type IngestResult =
  /** A new canonical observation was produced and stored. */
  | { readonly status: "accepted"; readonly observation: Observation }
  /** The event mapped to an observation that already exists; nothing changed. */
  | { readonly status: "duplicate"; readonly observation: Observation }
  /** The event failed validation and was rejected. */
  | { readonly status: "rejected"; readonly rejection: Rejection }
  /** The event's kind is unknown and the policy is `"skip"`. */
  | { readonly status: "skipped"; readonly reason: "unknown_kind"; readonly eventId: string };

/** Audit `eventId` used when the envelope was too malformed to carry one. */
const UNKNOWN_EVENT_ID = "<unknown>";

/**
 * `Observe` — the standalone observation intake and normalization pipeline.
 *
 * ```
 * Raw event → Validation → Normalization → Attribution → Deduplication
 *           → Canonical observation → Storage → Read API
 * ```
 *
 * Feed it untrusted {@link ObservationEvent}s via {@link Observe.ingest}; read
 * trusted, canonical, immutable observations (and the full audit trail) via
 * {@link Observe.read}. It executes nothing, plans nothing, remembers nothing
 * beyond the observations it stores, and derives no organizational signals.
 */
export class Observe {
  private readonly normalizer: Normalizer;
  private readonly emitter: AuditEmitter;
  private readonly observationStore: ObservationStore;
  private readonly rawEventArchive: RawEventArchive | undefined;
  private readonly clock: Clock;
  private readonly onUnknownKind: UnknownKindPolicy;
  /** Read-only access to stored observations and their audit trail. */
  readonly read: ReadApi;

  constructor(options: ObserveOptions) {
    const registry = new ValidatorRegistry(options.validators);
    const observationStore = options.observationStore ?? new InMemoryObservationStore();
    const auditStore = options.auditStore ?? new InMemoryAuditStore();
    const clock = options.clock ?? systemClock;

    this.observationStore = observationStore;
    this.rawEventArchive = options.rawEventArchive;
    this.clock = clock;
    this.onUnknownKind = options.onUnknownKind ?? "reject";
    this.emitter = new AuditEmitter(auditStore, clock, options.auditSecret);
    this.normalizer = new Normalizer({
      registry,
      resolver: options.resolver ?? identityResolver,
      clock,
      normalizationVersion: options.normalizationVersion ?? NORMALIZATION_VERSION,
      supportedEnvelopeVersions:
        options.supportedEnvelopeVersions ?? SUPPORTED_ENVELOPE_VERSIONS,
      timestampPolicy: options.timestampPolicy ?? DEFAULT_TIMESTAMP_POLICY,
    });
    this.read = new ReadApi(observationStore, auditStore, registry.observationTypes());
  }

  /**
   * Ingest one untrusted event, driving it through the full pipeline.
   *
   * Every *input-level* outcome is returned as an {@link IngestResult} — a bad
   * event is `rejected`, never thrown. It may still reject its promise if a
   * storage or audit *adapter* throws (e.g. disk full, connection lost): that
   * is an infrastructure error, deliberately distinct from an input rejection,
   * and is the caller's to handle or retry. The bundled in-memory stores only
   * throw on an append-only violation, which the dedupe step prevents.
   */
  async ingest(input: unknown): Promise<IngestResult> {
    // Tape the raw input first, if an archive is attached. This is a separate
    // side-channel: it never affects the observation produced below. A failed
    // archive is an infrastructure error (surfaced to the caller), so we never
    // silently drop from the tape while proceeding to store an observation.
    if (this.rawEventArchive !== undefined) {
      await this.rawEventArchive.archive(input, this.clock());
    }

    const result = this.normalizer.normalize(input);

    if (!result.ok) {
      return this.handleRejection(result.error);
    }

    const observation = result.value;
    const eventId = observation.sourceEventId;

    // Validation passed.
    await this.emitter.emit({
      stage: "validation",
      outcome: "passed",
      eventId,
      observationId: observation.id,
    });

    // Deduplication first: deterministic ids make re-ingest idempotent, and
    // short-circuiting here keeps a redelivered event's audit trail bounded
    // (validation/passed → dedupe/duplicate) instead of re-emitting the full
    // accepted sequence on every redelivery.
    if (await this.observationStore.has(observation.id)) {
      await this.emitter.emit({
        stage: "dedupe",
        outcome: "duplicate",
        eventId,
        observationId: observation.id,
      });
      const existing = (await this.observationStore.get(observation.id)) ?? observation;
      return { status: "duplicate", observation: existing };
    }

    // A genuinely new observation: record the stages that produced and stored it.
    await this.emitter.emit({
      stage: "normalization",
      outcome: "passed",
      eventId,
      observationId: observation.id,
    });
    await this.emitter.emit({
      stage: "attribution",
      outcome: "passed",
      eventId,
      observationId: observation.id,
      detail: { actors: observation.actors.length, subjects: observation.subjects.length },
    });
    await this.emitter.emit({
      stage: "dedupe",
      outcome: "unique",
      eventId,
      observationId: observation.id,
    });

    // Storage.
    await this.observationStore.put(observation);
    await this.emitter.emit({
      stage: "storage",
      outcome: "stored",
      eventId,
      observationId: observation.id,
    });

    return { status: "accepted", observation };
  }

  /** Ingest many events in order. Ordering matters for dedupe determinism. */
  async ingestAll(inputs: Iterable<unknown>): Promise<IngestResult[]> {
    const results: IngestResult[] = [];
    for (const input of inputs) {
      results.push(await this.ingest(input));
    }
    return results;
  }

  private async handleRejection(rejection: Rejection): Promise<IngestResult> {
    const eventId = rejection.eventId ?? UNKNOWN_EVENT_ID;

    if (rejection.reason === "UNKNOWN_KIND" && this.onUnknownKind === "skip") {
      await this.emitter.emit({
        stage: "validation",
        outcome: "skipped",
        eventId,
        detail: { reason: rejection.reason, message: rejection.message },
      });
      return { status: "skipped", reason: "unknown_kind", eventId };
    }

    await this.emitter.emit({
      stage: "validation",
      outcome: "failed",
      eventId,
      detail: { reason: rejection.reason },
    });
    await this.emitter.emit({
      stage: "rejection",
      outcome: "rejected",
      eventId,
      detail: this.rejectionDetail(rejection),
    });

    return { status: "rejected", rejection };
  }

  private rejectionDetail(rejection: Rejection): JsonObject {
    const detail: JsonObject = { reason: rejection.reason, message: rejection.message };
    if (rejection.issues !== undefined) {
      detail["issues"] = rejection.issues.map(
        (issue): JsonObject => ({ path: issue.path, message: issue.message }),
      );
    }
    return detail;
  }
}
