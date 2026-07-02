import type { JsonObject } from "./json.js";

/**
 * The pipeline stages that emit audit records. Every event produces a trail of
 * these, so the fate of any input is fully explainable after the fact.
 */
export type AuditStage =
  | "validation"
  | "normalization"
  | "attribution"
  | "dedupe"
  | "rejection"
  | "storage";

/** The outcome recorded for a stage. */
export type AuditOutcome =
  | "passed"
  | "failed"
  | "rejected"
  | "unique"
  | "duplicate"
  | "stored"
  | "skipped";

/**
 * An immutable audit record. Audit records are append-only observations *about
 * the pipeline itself* — they are logs, not domain observations, and carry no
 * recommendation. They exist so that "what happened to event X?" always has an
 * answer.
 *
 * Records form a **tamper-evident hash chain**: each record's `hash` is computed
 * over its own content plus the `previousHash` of the record before it, so any
 * insertion, deletion, reordering, or edit anywhere in the trail invalidates
 * every subsequent `hash`. See `core/audit-chain.ts`.
 */
export interface AuditRecord {
  /** Unique id for this record. */
  readonly id: string;
  /** Which stage emitted it. */
  readonly stage: AuditStage;
  /** The stage's outcome. */
  readonly outcome: AuditOutcome;
  /** The event this record concerns. */
  readonly eventId: string;
  /** The resulting observation id, once one exists. */
  readonly observationId?: string;
  /** When the record was emitted (epoch milliseconds, from the clock). */
  readonly at: number;
  /** Structured, stage-specific detail. */
  readonly detail?: JsonObject;
  /** 0-based position of this record in the chain. */
  readonly sequence: number;
  /** `hash` of the preceding record, or the genesis hash for the first record. */
  readonly previousHash: string;
  /** Tamper-evident hash over this record's content and `previousHash`. */
  readonly hash: string;
}

/** The fields of an {@link AuditRecord} that the hash is computed over. */
export type AuditContent = Omit<AuditRecord, "hash">;
