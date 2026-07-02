import type { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import type { Observation } from "../core/observation.js";
import type { AuditRecord } from "../core/audit.js";
import { deepFreeze } from "../core/freeze.js";
import {
  type ArchivedEvent,
  type AuditQuery,
  type AuditStore,
  type ObservationQuery,
  type ObservationStore,
  type RawEventArchive,
  type ReplayQuery,
  assertValidObservationQuery,
  assertValidReplayQuery,
  assertValidPruneSequence,
} from "./store.js";

/**
 * SQLite persistence for Observe, built on Node's built-in `node:sqlite` — so it
 * adds **no npm dependency**. `node:sqlite` is currently an experimental Node
 * feature and emits an `ExperimentalWarning` on first use; it is loaded only
 * when this module is imported (via the `@octopus/observe/sqlite` entry point),
 * so the core library stays free of it.
 *
 * Both stores preserve Observe's invariants: observations are append-only (a
 * duplicate id throws), immutable (deep-frozen on read), and the audit trail is
 * returned in append order so its hash chain stays verifiable. The synchronous
 * `node:sqlite` calls are wrapped to satisfy the async store interfaces.
 */

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

/**
 * Lazily resolve the built-in SQLite module. Kept out of module-load so that
 * merely importing this entry point on a runtime without `node:sqlite` (Node
 * < 22.5) does not throw — the error surfaces only when a store is actually
 * created.
 */
function loadDatabaseSync(): typeof DatabaseSync {
  const require = createRequire(import.meta.url);
  return (require("node:sqlite") as typeof import("node:sqlite")).DatabaseSync;
}

/** Open one SQLite connection and return the stores backed by it. */
export interface SqliteStores {
  readonly db: DatabaseSync;
  readonly observations: SqliteObservationStore;
  readonly audit: SqliteAuditStore;
  /** The optional raw-event archive, backed by the same connection. */
  readonly rawEvents: SqliteRawEventArchive;
  /** Close the underlying database connection. */
  close(): void;
}

/**
 * Open SQLite-backed stores (observations, audit, and a raw-event archive)
 * sharing one connection. Pass a file path for durable storage or `":memory:"`
 * for an ephemeral db.
 */
export function createSqliteStores(location: string): SqliteStores {
  const DatabaseSyncCtor = loadDatabaseSync();
  const db = new DatabaseSyncCtor(location);
  db.exec("PRAGMA journal_mode = WAL;");
  return {
    db,
    observations: new SqliteObservationStore(db),
    audit: new SqliteAuditStore(db),
    rawEvents: new SqliteRawEventArchive(db),
    close: () => db.close(),
  };
}

/** SQLite-backed {@link ObservationStore}. */
export class SqliteObservationStore implements ObservationStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS observations (
        seq  INTEGER PRIMARY KEY AUTOINCREMENT,
        id   TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        at   INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_obs_type ON observations(type);
      CREATE INDEX IF NOT EXISTS idx_obs_at ON observations(at);
      CREATE TABLE IF NOT EXISTS observation_refs (
        observation_id TEXT NOT NULL,
        role     TEXT NOT NULL,
        ref_type TEXT NOT NULL,
        ref_id   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_refs_lookup
        ON observation_refs(role, ref_id, ref_type, observation_id);
    `);
  }

  has(id: string): Promise<boolean> {
    const row = this.db.prepare("SELECT 1 FROM observations WHERE id = ? LIMIT 1").get(id);
    return Promise.resolve(row !== undefined);
  }

  async put(observation: Observation): Promise<void> {
    this.db.exec("BEGIN");
    try {
      try {
        this.db
          .prepare("INSERT INTO observations (id, type, at, data) VALUES (?, ?, ?, ?)")
          .run(observation.id, observation.type, observation.at, JSON.stringify(observation));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new Error(`append-only violation: observation ${observation.id} already stored`);
        }
        throw error;
      }
      const insertRef = this.db.prepare(
        "INSERT INTO observation_refs (observation_id, role, ref_type, ref_id) VALUES (?, ?, ?, ?)",
      );
      for (const actor of observation.actors) {
        insertRef.run(observation.id, "actor", actor.type, actor.id);
      }
      for (const subject of observation.subjects) {
        insertRef.run(observation.id, "subject", subject.type, subject.id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  get(id: string): Promise<Observation | undefined> {
    const row = this.db.prepare("SELECT data FROM observations WHERE id = ?").get(id) as
      | { data: string }
      | undefined;
    return Promise.resolve(row === undefined ? undefined : this.hydrate(row.data));
  }

  async query(query: ObservationQuery = {}): Promise<readonly Observation[]> {
    assertValidObservationQuery(query);

    const where: string[] = [];
    const params: (string | number)[] = [];

    if (query.types !== undefined && query.types.length > 0) {
      where.push(`type IN (${query.types.map(() => "?").join(", ")})`);
      params.push(...query.types);
    }
    if (query.from !== undefined) {
      where.push("at >= ?");
      params.push(query.from);
    }
    if (query.to !== undefined) {
      where.push("at < ?");
      params.push(query.to);
    }
    if (query.actor !== undefined) {
      where.push(this.refExists("actor", query.actor.type));
      params.push(query.actor.id);
      if (query.actor.type !== undefined) params.push(query.actor.type);
    }
    if (query.subject !== undefined) {
      where.push(this.refExists("subject", query.subject.type));
      params.push(query.subject.id);
      if (query.subject.type !== undefined) params.push(query.subject.type);
    }

    const direction = (query.order ?? "asc") === "asc" ? "ASC" : "DESC";
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    let sql = `SELECT data FROM observations ${whereClause} ORDER BY at ${direction}, seq ${direction}`;
    if (query.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(query.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as { data: string }[];
    return rows.map((row) => this.hydrate(row.data));
  }

  count(): Promise<number> {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM observations").get() as { c: number };
    return Promise.resolve(row.c);
  }

  private refExists(role: "actor" | "subject", withType: string | undefined): string {
    const typeClause = withType !== undefined ? "AND r.ref_type = ?" : "";
    return (
      `EXISTS (SELECT 1 FROM observation_refs r ` +
      `WHERE r.observation_id = observations.id AND r.role = '${role}' AND r.ref_id = ? ${typeClause})`
    );
  }

  private hydrate(data: string): Observation {
    return deepFreeze(JSON.parse(data) as Observation);
  }
}

/** SQLite-backed {@link AuditStore}. */
export class SqliteAuditStore implements AuditStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit (
        seq            INTEGER PRIMARY KEY AUTOINCREMENT,
        id             TEXT NOT NULL UNIQUE,
        stage          TEXT NOT NULL,
        outcome        TEXT NOT NULL,
        event_id       TEXT NOT NULL,
        observation_id TEXT,
        sequence       INTEGER NOT NULL UNIQUE,
        data           TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_event ON audit(event_id);
      CREATE INDEX IF NOT EXISTS idx_audit_stage ON audit(stage);
    `);
  }

  async append(record: AuditRecord): Promise<void> {
    try {
      this.db
        .prepare(
          "INSERT INTO audit (id, stage, outcome, event_id, observation_id, sequence, data) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          record.id,
          record.stage,
          record.outcome,
          record.eventId,
          record.observationId ?? null,
          record.sequence,
          JSON.stringify(record),
        );
    } catch (error) {
      // Append-only: a duplicate id or sequence means a forked/replayed chain.
      if (isUniqueViolation(error)) {
        throw new Error(
          `append-only violation: audit record ${record.id} (sequence ${record.sequence}) already stored`,
        );
      }
      throw error;
    }
  }

  list(query: AuditQuery = {}): Promise<readonly AuditRecord[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.eventId !== undefined) {
      where.push("event_id = ?");
      params.push(query.eventId);
    }
    if (query.observationId !== undefined) {
      where.push("observation_id = ?");
      params.push(query.observationId);
    }
    if (query.stage !== undefined) {
      where.push("stage = ?");
      params.push(query.stage);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    let sql = `SELECT data FROM audit ${whereClause} ORDER BY seq ASC`;
    if (query.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(query.limit);
    }
    const rows = this.db.prepare(sql).all(...params) as { data: string }[];
    return Promise.resolve(rows.map((row) => deepFreeze(JSON.parse(row.data) as AuditRecord)));
  }

  tail(): Promise<AuditRecord | undefined> {
    const row = this.db.prepare("SELECT data FROM audit ORDER BY seq DESC LIMIT 1").get() as
      | { data: string }
      | undefined;
    return Promise.resolve(
      row === undefined ? undefined : deepFreeze(JSON.parse(row.data) as AuditRecord),
    );
  }
}

/** SQLite-backed {@link RawEventArchive}. A durable, ordered tape of raw inputs. */
export class SqliteRawEventArchive implements RawEventArchive {
  constructor(private readonly db: DatabaseSync) {
    // AUTOINCREMENT guarantees sequences are monotonic and never reused, even
    // after rows are pruned — so retention/erasure deletes are safe and can
    // never wedge future appends or silently reuse a bookmarked sequence.
    db.exec(`
      CREATE TABLE IF NOT EXISTS raw_events (
        sequence    INTEGER PRIMARY KEY AUTOINCREMENT,
        received_at INTEGER NOT NULL,
        event       TEXT NOT NULL
      );
    `);
  }

  archive(event: unknown, receivedAt: number): Promise<ArchivedEvent> {
    const json = JSON.stringify(event);
    const stored = json === undefined ? "null" : json;
    const info = this.db
      .prepare("INSERT INTO raw_events (received_at, event) VALUES (?, ?)")
      .run(receivedAt, stored);
    const sequence = Number(info.lastInsertRowid);
    return Promise.resolve({ sequence, receivedAt, event: JSON.parse(stored) as unknown });
  }

  replay(query: ReplayQuery = {}): Promise<readonly ArchivedEvent[]> {
    try {
      assertValidReplayQuery(query);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    const params: number[] = [];
    let sql = "SELECT sequence, received_at, event FROM raw_events";
    if (query.fromSequence !== undefined) {
      sql += " WHERE sequence >= ?";
      params.push(query.fromSequence);
    }
    sql += " ORDER BY sequence ASC";
    if (query.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(query.limit);
    }
    const rows = this.db.prepare(sql).all(...params) as {
      sequence: number;
      received_at: number;
      event: string;
    }[];
    return Promise.resolve(
      rows.map((row) => ({
        sequence: row.sequence,
        receivedAt: row.received_at,
        event: JSON.parse(row.event) as unknown,
      })),
    );
  }

  count(): Promise<number> {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM raw_events").get() as { c: number };
    return Promise.resolve(row.c);
  }

  pruneBefore(beforeSequence: number): Promise<number> {
    try {
      assertValidPruneSequence(beforeSequence);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    // Prefix delete. AUTOINCREMENT keeps sqlite_sequence's high-water mark, so
    // pruned sequences are never reused by later inserts.
    const info = this.db.prepare("DELETE FROM raw_events WHERE sequence < ?").run(beforeSequence);
    return Promise.resolve(Number(info.changes));
  }
}
