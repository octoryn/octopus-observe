import { createHash } from "node:crypto";

const OBSERVATION_ID_PREFIX = "obs_";

/**
 * Deterministic observation id.
 *
 * The id is a function of the source event id, the canonical observation type,
 * and the normalization version — and nothing else. Two consequences:
 *
 *  - Re-ingesting the same event under the same normalization version yields
 *    the same id, so dedupe makes ingest idempotent.
 *  - Bumping the normalization version yields a *different* id, so a changed
 *    normalization contract re-derives observations instead of silently
 *    overwriting existing (immutable) ones.
 *
 * The three inputs are JSON-encoded as an array before hashing so the encoding
 * is injective: no combination of field contents (spaces, separators, etc.) can
 * make two logically-distinct inputs hash to the same id.
 */
export function observationId(
  sourceEventId: string,
  observationType: string,
  normalizationVersion: string,
): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify([sourceEventId, observationType, normalizationVersion]));
  return OBSERVATION_ID_PREFIX + hash.digest("hex");
}
