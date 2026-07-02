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
}
