import { randomUUID } from "node:crypto";
import type { AuditRecord, AuditStage, AuditOutcome } from "../core/audit.js";
import type { JsonObject } from "../core/json.js";
import type { Clock } from "../core/clock.js";
import { deepFreeze } from "../core/freeze.js";
import type { AuditStore } from "../storage/store.js";

/** The fields a caller supplies when emitting an audit record. */
export interface AuditEntry {
  readonly stage: AuditStage;
  readonly outcome: AuditOutcome;
  readonly eventId: string;
  readonly observationId?: string;
  readonly detail?: JsonObject;
}

/**
 * Writes audit records to an {@link AuditStore}, stamping each with a unique id
 * and the current time from the injected clock. Every meaningful transition in
 * the pipeline goes through here, so the audit trail is complete by
 * construction rather than by remembering to log.
 */
export class AuditEmitter {
  constructor(
    private readonly store: AuditStore,
    private readonly clock: Clock,
  ) {}

  emit(entry: AuditEntry): Promise<void> {
    const record: AuditRecord = {
      id: randomUUID(),
      at: this.clock(),
      stage: entry.stage,
      outcome: entry.outcome,
      eventId: entry.eventId,
      ...(entry.observationId !== undefined ? { observationId: entry.observationId } : {}),
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    };
    // Audit records are immutable once emitted, like observations.
    return this.store.append(deepFreeze(record));
  }
}
