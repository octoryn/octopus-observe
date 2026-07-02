import { createHash, createHmac } from "node:crypto";
import type { AuditContent, AuditRecord } from "./audit.js";
import { type JsonObject, type JsonValue, stableStringify } from "./json.js";

/**
 * The `previousHash` of the very first record in a chain. A fixed, well-known
 * sentinel so the genesis link is itself verifiable.
 *
 * WIRE CONTRACT — frozen. This value is baked into every genesis record's
 * `previousHash`; changing it would invalidate all existing chains.
 */
export const GENESIS_HASH = "genesis";

/**
 * A secret key for HMAC (keyed) hashing. When present, hashes are
 * HMAC-SHA256(key, …) instead of plain SHA-256; see the trust-model note on
 * {@link verifyAuditChain}.
 */
export type AuditSecret = string | Uint8Array;

/**
 * Compute the tamper-evident hash of an audit record's content.
 *
 * The hash covers every content field (including `sequence` and `previousHash`)
 * in a key-order-independent way, so it is stable across serialization but
 * sensitive to any change in value, ordering, or chain position. When `secret`
 * is provided, an HMAC is used instead of a plain digest, so the hash cannot be
 * recomputed — and thus a chain cannot be forged — without the key.
 *
 * WIRE CONTRACT — frozen. The exact byte output (the canonical field set and
 * {@link stableStringify}'s encoding) is part of the audit format: records
 * hashed by one version must re-verify under another. Any change here is a
 * breaking change for previously-hashed records and requires a format version.
 */
export function computeAuditHash(content: AuditContent, secret?: AuditSecret): string {
  const canonical: JsonObject = {
    id: content.id,
    stage: content.stage,
    outcome: content.outcome,
    eventId: content.eventId,
    at: content.at,
    sequence: content.sequence,
    previousHash: content.previousHash,
  };
  if (content.observationId !== undefined) {
    canonical["observationId"] = content.observationId;
  }
  if (content.detail !== undefined) {
    canonical["detail"] = content.detail as JsonValue;
  }
  const serialized = stableStringify(canonical);
  const hasher = secret === undefined ? createHash("sha256") : createHmac("sha256", secret);
  return hasher.update(serialized).digest("hex");
}

/** The outcome of verifying an audit chain. */
export type ChainVerification =
  | { readonly ok: true; readonly length: number }
  | {
      readonly ok: false;
      /** Index of the first record that fails verification. */
      readonly brokenAt: number;
      readonly reason: "bad_hash" | "broken_link" | "bad_sequence";
    };

/**
 * Verify a chain of audit records in order. Confirms, for each record, that its
 * `sequence` is contiguous, its `previousHash` links to the prior record's
 * `hash` (or the genesis hash for the first), and its `hash` matches a fresh
 * recomputation of its content.
 *
 * TRUST MODEL. With no `secret`, the chain is **tamper-evident, not
 * tamper-proof**: it reliably detects any in-place edit, insertion, deletion,
 * or reordering by a party that does not recompute the chain — but the hash
 * function is public, so an adversary with write access to the store and this
 * code can fabricate an internally-consistent chain (or truncate a prefix and
 * renumber). To resist that, either (a) pass a `secret` so hashes are keyed
 * HMACs an attacker cannot reproduce, and/or (b) periodically anchor the head
 * hash (`records.at(-1)?.hash`) in an external trust boundary. `secret` must be
 * the same key used when the records were emitted.
 */
export function verifyAuditChain(
  records: readonly AuditRecord[],
  secret?: AuditSecret,
): ChainVerification {
  let expectedPrevious = GENESIS_HASH;
  for (let index = 0; index < records.length; index++) {
    const record = records[index] as AuditRecord;
    if (record.sequence !== index) {
      return { ok: false, brokenAt: index, reason: "bad_sequence" };
    }
    if (record.previousHash !== expectedPrevious) {
      return { ok: false, brokenAt: index, reason: "broken_link" };
    }
    const { hash, ...content } = record;
    if (computeAuditHash(content, secret) !== hash) {
      return { ok: false, brokenAt: index, reason: "bad_hash" };
    }
    expectedPrevious = record.hash;
  }
  return { ok: true, length: records.length };
}
