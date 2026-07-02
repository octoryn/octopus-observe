import type { Observation } from "./core/observation.js";
import type { Rejection } from "./core/rejection.js";
import type { Clock } from "./core/clock.js";
import { systemClock } from "./core/clock.js";
import { NORMALIZATION_VERSION, SUPPORTED_ENVELOPE_VERSIONS } from "./core/versions.js";
import type { Validator } from "./validate/validator.js";
import { ValidatorRegistry } from "./validate/registry.js";
import { type Resolver, identityResolver } from "./normalize/resolver.js";
import { Normalizer } from "./normalize/normalizer.js";
import { type TimestampPolicy, DEFAULT_TIMESTAMP_POLICY } from "./normalize/timestamp.js";

/**
 * Inputs for a re-normalization pass. Mirrors the normalization-relevant subset
 * of `ObserveOptions`; deliberately storage-free.
 */
export interface RenormalizeOptions {
  readonly validators: readonly Validator[];
  /** Target normalization version. Defaults to the built-in version. */
  readonly normalizationVersion?: string;
  readonly resolver?: Resolver;
  readonly clock?: Clock;
  readonly supportedEnvelopeVersions?: readonly string[];
  readonly timestampPolicy?: TimestampPolicy;
}

/** The result of a re-normalization pass, partitioned by outcome. */
export interface RenormalizeResult {
  readonly observations: readonly Observation[];
  readonly rejections: readonly Rejection[];
}

/**
 * Re-normalize a stream of (previously-seen) events under a normalization
 * version, without touching storage.
 *
 * This is the backfill / migration primitive. Re-normalization requires the
 * original events — an `Observation` does not retain its source payload — so
 * they must come from an upstream replay or a raw-event archive. Because the
 * observation id is scoped by normalization version, re-normalizing under a new
 * version produces observations with **new ids** that coexist with the old
 * ones rather than overwriting them (observations are immutable); a reader then
 * chooses which version to read. Feed the results to a store via `put`, or to
 * `Observe.ingestAll` if you also want a fresh audit trail.
 *
 * Pure and deterministic given a fixed clock, so a backfill can be dry-run and
 * reproduced.
 */
export function renormalize(
  events: Iterable<unknown>,
  options: RenormalizeOptions,
): RenormalizeResult {
  const normalizer = new Normalizer({
    registry: new ValidatorRegistry(options.validators),
    resolver: options.resolver ?? identityResolver,
    clock: options.clock ?? systemClock,
    normalizationVersion: options.normalizationVersion ?? NORMALIZATION_VERSION,
    supportedEnvelopeVersions: options.supportedEnvelopeVersions ?? SUPPORTED_ENVELOPE_VERSIONS,
    timestampPolicy: options.timestampPolicy ?? DEFAULT_TIMESTAMP_POLICY,
  });

  const observations: Observation[] = [];
  const rejections: Rejection[] = [];
  for (const event of events) {
    const result = normalizer.normalize(event);
    if (result.ok) {
      observations.push(result.value);
    } else {
      rejections.push(result.error);
    }
  }
  return { observations, rejections };
}
