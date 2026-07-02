import { randomUUID } from "node:crypto";
import type { AuditContent, AuditRecord, AuditStage, AuditOutcome } from "../core/audit.js";
import type { JsonObject } from "../core/json.js";
import type { Clock } from "../core/clock.js";
import { deepFreeze } from "../core/freeze.js";
import { type AuditSecret, GENESIS_HASH, computeAuditHash } from "../core/audit-chain.js";
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
 * Writes audit records to an {@link AuditStore}, stamping each with a unique id,
 * the current time, and its position in a tamper-evident hash chain.
 *
 * Emits are **serialized** through an internal queue so the chain stays
 * well-formed even under concurrent `ingest`, and the chain head is **seeded**
 * from the store's tail on first use, so an emitter attached to a store that
 * already holds records continues the existing chain rather than forking it. A
 * failed append does not advance the chain: the next emit reuses the same
 * `previousHash`/`sequence`, so no gap is created.
 */
export class AuditEmitter {
  private queue: Promise<void> = Promise.resolve();
  private seeded = false;
  private previousHash = GENESIS_HASH;
  private nextSequence = 0;

  constructor(
    private readonly store: AuditStore,
    private readonly clock: Clock,
    /** Optional HMAC key; when set, the chain is keyed (tamper-resistant). */
    private readonly secret?: AuditSecret,
  ) {}

  emit(entry: AuditEntry): Promise<void> {
    // Chain onto the queue so appends are strictly ordered, but surface this
    // call's own result (and error) to this caller.
    const result = this.queue.then(() => this.append(entry));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async append(entry: AuditEntry): Promise<void> {
    if (!this.seeded) {
      const tail = await this.store.tail();
      if (tail !== undefined) {
        this.previousHash = tail.hash;
        this.nextSequence = tail.sequence + 1;
      }
      this.seeded = true;
    }

    const content: AuditContent = {
      id: randomUUID(),
      stage: entry.stage,
      outcome: entry.outcome,
      eventId: entry.eventId,
      at: this.clock(),
      sequence: this.nextSequence,
      previousHash: this.previousHash,
      ...(entry.observationId !== undefined ? { observationId: entry.observationId } : {}),
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    };
    const record: AuditRecord = { ...content, hash: computeAuditHash(content, this.secret) };

    // Append first; only advance the chain head once the write succeeds, so a
    // failed append leaves no gap and can be safely retried.
    await this.store.append(deepFreeze(record));
    this.previousHash = record.hash;
    this.nextSequence += 1;
  }
}
