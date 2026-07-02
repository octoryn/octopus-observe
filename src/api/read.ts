import type { Observation } from "../core/observation.js";
import type { AuditRecord } from "../core/audit.js";
import type {
  AuditQuery,
  AuditStore,
  ObservationQuery,
  ObservationStore,
} from "../storage/store.js";

/**
 * The read side of Observe. Read-only by construction: it exposes stored
 * observations and their audit trail, and holds no mutating methods. Ingest is
 * the only way data enters; this is the only way it comes out.
 */
export class ReadApi {
  constructor(
    private readonly observations: ObservationStore,
    private readonly audit: AuditStore,
    private readonly knownTypes: readonly string[],
  ) {}

  /** Fetch a single observation by its deterministic id. */
  getObservation(id: string): Promise<Observation | undefined> {
    return this.observations.get(id);
  }

  /** Query observations with filtering, ordering, and limiting. */
  queryObservations(query?: ObservationQuery): Promise<readonly Observation[]> {
    return this.observations.query(query);
  }

  /** Number of stored observations. */
  countObservations(): Promise<number> {
    return this.observations.count();
  }

  /** The canonical observation types this instance can produce, sorted. */
  observationTypes(): readonly string[] {
    return this.knownTypes;
  }

  /** The full audit trail for one event, in emission order. */
  getEventAudit(eventId: string): Promise<readonly AuditRecord[]> {
    return this.audit.list({ eventId });
  }

  /** Query the audit trail across events. */
  queryAudit(query?: AuditQuery): Promise<readonly AuditRecord[]> {
    return this.audit.list(query);
  }
}
