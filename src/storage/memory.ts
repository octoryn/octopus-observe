import type { Observation } from "../core/observation.js";
import type { TaggedRef } from "../core/refs.js";
import type { AuditRecord } from "../core/audit.js";
import {
  type ArchivedEvent,
  type AuditQuery,
  type AuditStore,
  type ObservationQuery,
  type ObservationStore,
  type RawEventArchive,
  type RefMatch,
  type ReplayQuery,
  assertValidObservationQuery,
  assertValidReplayQuery,
} from "./store.js";

/**
 * JSON-normalize a raw event for archival: a faithful, storage-agnostic copy
 * that later mutation of the caller's object cannot alter. Values outside JSON
 * (`undefined`, functions) archive as `null`, matching the SQLite adapter.
 */
function jsonCopy(event: unknown): unknown {
  const json = JSON.stringify(event);
  return json === undefined ? null : (JSON.parse(json) as unknown);
}

function refMatches(refs: readonly TaggedRef[], match: RefMatch): boolean {
  return refs.some(
    (ref) => ref.id === match.id && (match.type === undefined || ref.type === match.type),
  );
}

function observationMatches(observation: Observation, query: ObservationQuery): boolean {
  if (query.types !== undefined && !query.types.includes(observation.type)) {
    return false;
  }
  if (query.from !== undefined && observation.at < query.from) {
    return false;
  }
  if (query.to !== undefined && observation.at >= query.to) {
    return false;
  }
  if (query.actor !== undefined && !refMatches(observation.actors, query.actor)) {
    return false;
  }
  if (query.subject !== undefined && !refMatches(observation.subjects, query.subject)) {
    return false;
  }
  return true;
}

/**
 * In-memory {@link ObservationStore}.
 *
 * This is a first-class implementation, not a test double: it is what makes
 * Observe usable with no external dependency. Insertion order is preserved as a
 * stable tiebreaker so that queries are deterministic when timestamps collide.
 */
export class InMemoryObservationStore implements ObservationStore {
  private readonly byId = new Map<string, Observation>();
  /** Insertion sequence per id, for a stable secondary sort. */
  private readonly sequence = new Map<string, number>();
  private next = 0;

  has(id: string): Promise<boolean> {
    return Promise.resolve(this.byId.has(id));
  }

  put(observation: Observation): Promise<void> {
    if (this.byId.has(observation.id)) {
      return Promise.reject(
        new Error(`append-only violation: observation ${observation.id} already stored`),
      );
    }
    this.byId.set(observation.id, observation);
    this.sequence.set(observation.id, this.next++);
    return Promise.resolve();
  }

  get(id: string): Promise<Observation | undefined> {
    return Promise.resolve(this.byId.get(id));
  }

  query(query: ObservationQuery = {}): Promise<readonly Observation[]> {
    try {
      assertValidObservationQuery(query);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    const order = query.order ?? "asc";
    const direction = order === "asc" ? 1 : -1;

    const results = [...this.byId.values()]
      .filter((observation) => observationMatches(observation, query))
      .sort((a, b) => {
        if (a.at !== b.at) {
          return (a.at - b.at) * direction;
        }
        const seqA = this.sequence.get(a.id) ?? 0;
        const seqB = this.sequence.get(b.id) ?? 0;
        return (seqA - seqB) * direction;
      });

    const limited = query.limit === undefined ? results : results.slice(0, query.limit);
    return Promise.resolve(limited);
  }

  count(): Promise<number> {
    return Promise.resolve(this.byId.size);
  }
}

/** In-memory {@link AuditStore}. Records are appended and read in order. */
export class InMemoryAuditStore implements AuditStore {
  private readonly records: AuditRecord[] = [];

  append(record: AuditRecord): Promise<void> {
    // Append-only and strictly ordered: the sequence must advance. This catches
    // a forked chain (e.g. two emitters seeded from the same tail both minting
    // the same next sequence) rather than silently corrupting the trail.
    const last = this.records[this.records.length - 1];
    if (last !== undefined && record.sequence <= last.sequence) {
      return Promise.reject(
        new Error(
          `append-only violation: audit sequence ${record.sequence} does not advance past ${last.sequence}`,
        ),
      );
    }
    this.records.push(record);
    return Promise.resolve();
  }

  list(query: AuditQuery = {}): Promise<readonly AuditRecord[]> {
    let results = this.records.filter((record) => {
      if (query.eventId !== undefined && record.eventId !== query.eventId) {
        return false;
      }
      if (query.observationId !== undefined && record.observationId !== query.observationId) {
        return false;
      }
      if (query.stage !== undefined && record.stage !== query.stage) {
        return false;
      }
      return true;
    });
    if (query.limit !== undefined) {
      results = results.slice(0, query.limit);
    }
    return Promise.resolve(results);
  }

  tail(): Promise<AuditRecord | undefined> {
    return Promise.resolve(this.records[this.records.length - 1]);
  }
}

/** In-memory {@link RawEventArchive}. Faithful tape of raw inputs, in order. */
export class InMemoryRawEventArchive implements RawEventArchive {
  private readonly events: ArchivedEvent[] = [];
  /** Monotonic counter — never derived from length, so it never reuses. */
  private nextSequence = 0;

  archive(event: unknown, receivedAt: number): Promise<ArchivedEvent> {
    const record: ArchivedEvent = {
      sequence: this.nextSequence++,
      receivedAt,
      event: jsonCopy(event),
    };
    this.events.push(record);
    return Promise.resolve(record);
  }

  replay(query: ReplayQuery = {}): Promise<readonly ArchivedEvent[]> {
    try {
      assertValidReplayQuery(query);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    let results =
      query.fromSequence === undefined
        ? this.events
        : this.events.filter((e) => e.sequence >= (query.fromSequence as number));
    if (query.limit !== undefined) {
      results = results.slice(0, query.limit);
    }
    return Promise.resolve([...results]);
  }

  count(): Promise<number> {
    return Promise.resolve(this.events.length);
  }
}
