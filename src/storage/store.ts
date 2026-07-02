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

/**
 * One raw input as received at the boundary, wrapped with archival metadata.
 * The `event` is the untrusted input verbatim — the archive is a faithful tape,
 * not a normalized record.
 */
export interface ArchivedEvent {
  /**
   * Archive position, assigned by the archive. A monotonically-increasing,
   * unique ordinal — treat it as opaque for `fromSequence` bookmarks. Do not
   * assume a particular starting value or that it is gap-free: the in-memory
   * archive is 0-based, the SQLite archive is 1-based, and pruning may leave
   * gaps (a pruned sequence is never reused).
   */
  readonly sequence: number;
  /** When the event was received (epoch milliseconds, from the clock). */
  readonly receivedAt: number;
  /** The raw input as received (JSON value). */
  readonly event: unknown;
}

/** Query over the raw-event archive, by archive sequence. */
export interface ReplayQuery {
  /** Only events at or after this archive sequence (inclusive). */
  readonly fromSequence?: number;
  /** Maximum number of events. */
  readonly limit?: number;
}

/**
 * Reject malformed replay bounds, so archive backends behave identically on bad
 * input rather than diverging (`slice` vs `LIMIT` semantics). Every
 * `RawEventArchive` implementation should call this at the start of `replay`.
 */
export function assertValidReplayQuery(query: ReplayQuery): void {
  for (const key of ["fromSequence", "limit"] as const) {
    const value = query[key];
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new RangeError(`ReplayQuery.${key} must be a non-negative integer`);
    }
  }
}

/** Guard for {@link RawEventArchive.pruneBefore}'s `beforeSequence` argument. */
export function assertValidPruneSequence(beforeSequence: number): void {
  if (!Number.isInteger(beforeSequence) || beforeSequence < 0) {
    throw new RangeError("pruneBefore(beforeSequence) requires a non-negative integer");
  }
}

/**
 * Append-only archive of raw events — an **optional, separate port** from the
 * observation and audit stores.
 *
 * It exists so that backfill / re-normalization has a source of the original
 * events (an `Observation` does not retain its source payload). It is
 * deliberately kept off the observation line: attaching an archive never
 * changes the observations Observe produces, and the archive holds untrusted
 * raw input, never canonical observations. Replayed events are fed back through
 * `renormalize` — the archive itself normalizes nothing.
 */
export interface RawEventArchive {
  /** Archive one raw input, returning the stored record (with its sequence). */
  archive(event: unknown, receivedAt: number): Promise<ArchivedEvent>;
  /** Replay archived events in sequence order, for backfill. */
  replay(query?: ReplayQuery): Promise<readonly ArchivedEvent[]>;
  /** Total number of archived events. */
  count(): Promise<number>;
  /**
   * Retention / erasure: remove every event whose `sequence` is **strictly
   * less than** `beforeSequence`, and return how many were removed.
   *
   * This is deliberately a **prefix delete only** — it removes the oldest tape,
   * never a middle slice — so the tape's audit semantics are preserved: what
   * remains is still an ordered, gap-free-from-the-cut suffix, `fromSequence`
   * bookmarks at or after the cut stay valid, and because sequences are never
   * reused, future appends continue monotonically. Predicate/arbitrary deletion
   * is intentionally not offered, as it would punch holes in the tape.
   *
   * Use it to enforce a retention window over a plaintext archive that may hold
   * PII/PHI (compute the cut sequence from `replay()` by age or count, then
   * prune). `beforeSequence` must be a non-negative integer.
   */
  pruneBefore(beforeSequence: number): Promise<number>;
}
