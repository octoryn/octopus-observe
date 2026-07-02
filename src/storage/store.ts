import type { Observation } from "../core/observation.js";
import type { AuditRecord, AuditStage } from "../core/audit.js";

/** Match observations that reference a given ref (by id, optionally by type). */
export interface RefMatch {
  readonly type?: string;
  readonly id: string;
}

/**
 * Query over stored observations. All criteria are ANDed.
 *
 * Numeric bounds must be well-formed: `from`/`to` finite numbers and `limit` a
 * non-negative integer. Implementations reject malformed bounds rather than
 * silently returning wrong results.
 */
export interface ObservationQuery {
  /** Restrict to these canonical types. */
  readonly types?: readonly string[];
  /** Lower bound on `at` (inclusive), epoch milliseconds. */
  readonly from?: number;
  /** Upper bound on `at` (exclusive), epoch milliseconds. */
  readonly to?: number;
  /** Only observations that include a matching actor. */
  readonly actor?: RefMatch;
  /** Only observations that include a matching subject. */
  readonly subject?: RefMatch;
  /** Sort order by `at`. Defaults to ascending. */
  readonly order?: "asc" | "desc";
  /** Maximum number of results. */
  readonly limit?: number;
}

/**
 * Append-only store of canonical observations. Implementations must preserve
 * immutability: an id, once stored, maps to exactly one observation forever.
 *
 * This is the storage seam. The in-memory implementation ships in-repo; other
 * backends (SQLite, Postgres, ...) are adapters that satisfy this interface.
 */
export interface ObservationStore {
  /** Whether an observation with this id already exists. */
  has(id: string): Promise<boolean>;
  /**
   * Persist an observation. Storing an id that already exists is an
   * append-only violation and must throw — the pipeline dedupes before calling
   * `put`, so this only fires on a programming error.
   */
  put(observation: Observation): Promise<void>;
  /** Fetch by id. */
  get(id: string): Promise<Observation | undefined>;
  /** Query with filtering, ordering, and limiting. */
  query(query?: ObservationQuery): Promise<readonly Observation[]>;
  /** Total number of stored observations. */
  count(): Promise<number>;
}

/**
 * Reject malformed query bounds loudly rather than silently returning wrong
 * results. A `NaN` bound (e.g. from `Date.parse` of bad input) would otherwise
 * be treated as "no bound", and a negative `limit` would drop rows from the end
 * — both silent data-correctness hazards for a trusted read path. Every
 * `ObservationStore` implementation should call this at the start of `query`.
 */
export function assertValidObservationQuery(query: ObservationQuery): void {
  for (const key of ["from", "to"] as const) {
    const value = query[key];
    if (value !== undefined && !Number.isFinite(value)) {
      throw new RangeError(`ObservationQuery.${key} must be a finite number`);
    }
  }
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 0)) {
    throw new RangeError("ObservationQuery.limit must be a non-negative integer");
  }
}

/** Query over the audit trail. */
export interface AuditQuery {
  readonly eventId?: string;
  readonly observationId?: string;
  readonly stage?: AuditStage;
  readonly limit?: number;
}

/**
 * Append-only store of audit records. Like observations, audit records are
 * never mutated once written. Records are stored and returned in append order,
 * which is the order the hash chain is defined over.
 */
export interface AuditStore {
  append(record: AuditRecord): Promise<void>;
  list(query?: AuditQuery): Promise<readonly AuditRecord[]>;
  /**
   * The most recently appended record, or `undefined` if empty. Used to resume
   * the hash chain (its `hash` and `sequence`) when a new emitter attaches to a
   * store that already holds records.
   */
  tail(): Promise<AuditRecord | undefined>;
}
