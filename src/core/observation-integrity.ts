import { createHash, createHmac } from "node:crypto";
import type { Observation } from "./observation.js";
import { type JsonObject, type JsonValue, stableStringify } from "./json.js";
import type { AuditSecret } from "./audit-chain.js";

/** The content of an observation the integrity hash is computed over. */
export type ObservationContent = Omit<Observation, "integrity">;

/**
 * Compute the tamper-evidence hash of an observation's content.
 *
 * Covers every field except `integrity` (including `id`, timestamps, actors,
 * subjects, attributes, source, and versions), serialized key-order-independently
 * so it is stable across storage round-trips but sensitive to any change in
 * value. When `secret` is provided, an HMAC is used, so the hash — and thus a
 * forged observation — cannot be reproduced without the key.
 *
 * WIRE CONTRACT — frozen. The canonical field set and {@link stableStringify}'s
 * encoding are part of the observation format: an observation hashed by one
 * build must re-verify under another. Any change is a breaking change for
 * previously-stored observations.
 */
export function computeObservationHash(content: ObservationContent, secret?: AuditSecret): string {
  // Explicit field allowlist (not a structural spread), so a future field added
  // to Observation cannot silently enter this frozen wire contract, and an extra
  // enumerable property on `content` cannot change the hash.
  const canonical: JsonObject = {
    id: content.id,
    type: content.type,
    at: content.at,
    ingestedAt: content.ingestedAt,
    actors: content.actors as unknown as JsonValue,
    subjects: content.subjects as unknown as JsonValue,
    attributes: content.attributes,
    source: content.source as unknown as JsonValue,
    sourceEventId: content.sourceEventId,
    versions: content.versions as unknown as JsonValue,
  };
  const serialized = stableStringify(canonical);
  const hasher = secret === undefined ? createHash("sha256") : createHmac("sha256", secret);
  return hasher.update(serialized).digest("hex");
}

/**
 * Verify that an observation's `integrity` hash matches a fresh recomputation of
 * its content. Returns `false` if any field was altered after the observation
 * was produced. Pass the same `secret` used at ingest for keyed observations.
 */
export function verifyObservation(observation: Observation, secret?: AuditSecret): boolean {
  const { integrity, ...content } = observation;
  return computeObservationHash(content, secret) === integrity;
}
