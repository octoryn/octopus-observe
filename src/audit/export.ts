import type { AuditRecord } from "../core/audit.js";

/**
 * Serialize an audit trail as newline-delimited JSON (NDJSON) — one record per
 * line, in chain order. NDJSON is the lingua franca for shipping events into a
 * SIEM or log pipeline (Splunk, Elastic, Loki, etc.): each line is an
 * independently-parseable JSON object, and the hash-chain fields
 * (`sequence` / `previousHash` / `hash`) travel with each record so the
 * destination can re-verify integrity with {@link verifyAuditChain}.
 *
 * Records are emitted verbatim and in the order given; pass them as returned by
 * `AuditStore.list()` (append order) to preserve the chain.
 */
export function exportAuditNdjson(records: readonly AuditRecord[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n");
}
