/**
 * First-class adapters that map agent-stack happenings into Observe's canonical
 * {@link ObservationEvent} intake shape.
 *
 * Connectors deliberately live *outside* Observe's trust boundary: an adapter's
 * only job is to build a well-formed {@link ObservationEvent}. The event is
 * still untrusted and must pass validation — these adapters simply collapse the
 * time-to-first-value of hand-writing that mapping for the two most common
 * agent inputs:
 *
 *   - an MCP (or MCP-shaped) tool call → `agent.tool_called`
 *   - any other generic agent step     → `agent.action`
 *
 * The matching validators live in `../observations/` and are exported together
 * as `agentEventValidators`; register them so the adapter output is accepted.
 *
 * The adapters are pure and dependency-free: they read only their arguments and
 * return a fresh, frozen envelope. `args`, `result`, and `detail` are coerced
 * to canonical, storage-safe JSON (non-JSON values are dropped) so the produced
 * payload always validates.
 */
import type { ObservationEvent, EventSource } from "../core/event.js";
import type { RawRef } from "../core/refs.js";
import type { JsonValue } from "../core/json.js";
import { asJsonValue, stableStringify } from "../core/json.js";

/** Envelope contract version the adapters emit. */
const ENVELOPE_VERSION = "1.0";
/** Payload schema version the adapters emit; matches the bundled validators. */
const SCHEMA_VERSION = "1.0";
/** Connector name recorded on `source.connector` for provenance. */
const CONNECTOR = "agent-events";

/** Event `kind` for an MCP / tool-call happening. */
export const AGENT_TOOL_CALLED_KIND = "agent.tool_called";
/** Event `kind` for a generic agent action. */
export const AGENT_ACTION_KIND = "agent.action";

/**
 * A single agent identity, in the source's own terms. Mapped onto the event's
 * `actors` as a `RawRef` of type `"agent"` before attribution resolves it.
 */
export interface AgentActor {
  /** Stable identifier of the agent, e.g. a session id or agent name. */
  readonly id: string;
  /** Optional non-identifying metadata (model, role, ...). */
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/** Fields common to every agent-event adapter input. */
interface AgentEventBase {
  /**
   * Stable id for this happening. Re-emitting the same id yields the same
   * observation (idempotent). When omitted, a deterministic id is derived from
   * the event's identifying fields.
   */
  readonly eventId?: string;
  /** When it happened. A `Date` or ISO-8601 string; defaults to "now". */
  readonly occurredAt?: Date | string;
  /** The agent that acted. */
  readonly agent?: AgentActor;
  /** Upstream system the event describes, e.g. "claude-code". */
  readonly system?: string;
  /** Extra subjects (things acted on), in the source's own terms. */
  readonly subjects?: readonly RawRef[];
}

/** Input for {@link mcpToolCallEvent}. */
export interface McpToolCallInput extends AgentEventBase {
  /** The tool that was invoked, e.g. "search" or "read_file". */
  readonly tool: string;
  /** Invocation protocol; defaults to "mcp". */
  readonly protocol?: string;
  /** The tool/MCP server the tool belongs to, if known. */
  readonly server?: string;
  /** Arguments passed to the tool (coerced to canonical JSON). */
  readonly args?: unknown;
  /** Result returned by the tool (coerced to canonical JSON). */
  readonly result?: unknown;
  /** Whether the call ended in an error. */
  readonly isError?: boolean;
}

/** Input for {@link agentActionEvent}. */
export interface AgentActionInput extends AgentEventBase {
  /** What the agent did, e.g. "plan", "message", "edit_file". */
  readonly action: string;
  /** How the action ended. */
  readonly status?: "ok" | "error" | "pending";
  /** Open-ended structured context (coerced to canonical JSON). */
  readonly detail?: unknown;
}

/**
 * Build a valid {@link ObservationEvent} for an MCP (or MCP-shaped) tool call.
 *
 * ```ts
 * const event = mcpToolCallEvent({
 *   tool: "search",
 *   server: "docs",
 *   args: { query: "octopus" },
 *   result: { hits: 3 },
 *   agent: { id: "session-7" },
 *   occurredAt: "2026-07-01T09:30:00.000Z",
 * });
 * await observe.ingest(event); // → accepted "AgentToolCalled"
 * ```
 */
export function mcpToolCallEvent(input: McpToolCallInput): ObservationEvent {
  const payload: Record<string, JsonValue> = { tool: input.tool };
  payload["protocol"] = input.protocol ?? "mcp";
  if (input.server !== undefined) payload["server"] = input.server;
  if (input.isError !== undefined) payload["isError"] = input.isError;
  assignJson(payload, "args", input.args);
  assignJson(payload, "result", input.result);

  const identity = [input.tool, payload["protocol"], input.server ?? "", agentId(input.agent)];
  return buildEvent(AGENT_TOOL_CALLED_KIND, input, payload, identity, [
    { type: "tool", id: input.tool },
  ]);
}

/**
 * Build a valid {@link ObservationEvent} for a generic agent action.
 *
 * ```ts
 * const event = agentActionEvent({
 *   action: "plan",
 *   status: "ok",
 *   detail: { steps: 4 },
 *   agent: { id: "session-7" },
 * });
 * await observe.ingest(event); // → accepted "AgentAction"
 * ```
 */
export function agentActionEvent(input: AgentActionInput): ObservationEvent {
  const payload: Record<string, JsonValue> = { action: input.action };
  if (input.status !== undefined) payload["status"] = input.status;
  assignJson(payload, "detail", input.detail);

  const identity = [input.action, input.status ?? "", agentId(input.agent)];
  return buildEvent(AGENT_ACTION_KIND, input, payload, identity, []);
}

/** Coerce and assign an optional open-JSON field, dropping non-JSON input. */
function assignJson(target: Record<string, JsonValue>, field: string, raw: unknown): void {
  if (raw === undefined) return;
  const value = asJsonValue(raw);
  if (value !== undefined) target[field] = value;
}

function agentId(agent: AgentActor | undefined): string {
  return agent?.id ?? "";
}

/** Assemble the shared envelope, filling defaults and honouring exactOptional. */
function buildEvent(
  kind: string,
  base: AgentEventBase,
  payload: Record<string, JsonValue>,
  identity: readonly string[],
  extraSubjects: readonly RawRef[],
): ObservationEvent {
  const occurredAt = toIsoString(base.occurredAt);
  const eventId = base.eventId ?? deriveEventId(kind, occurredAt, identity, payload);

  const source: EventSource =
    base.system !== undefined
      ? { system: base.system, connector: CONNECTOR }
      : { connector: CONNECTOR };

  const actors: RawRef[] = [];
  if (base.agent !== undefined) {
    actors.push(toAgentRef(base.agent));
  }

  const subjects: RawRef[] = [...extraSubjects, ...(base.subjects ?? [])];

  const event: ObservationEvent = {
    eventId,
    envelopeVersion: ENVELOPE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    kind,
    occurredAt,
    payload,
    source,
    ...(actors.length > 0 ? { actors } : {}),
    ...(subjects.length > 0 ? { subjects } : {}),
  };
  return Object.freeze(event);
}

function toAgentRef(agent: AgentActor): RawRef {
  const attributes =
    agent.attributes === undefined ? undefined : asJsonValue({ ...agent.attributes });
  if (attributes !== undefined && isJsonObject(attributes) && Object.keys(attributes).length > 0) {
    return { type: "agent", id: agent.id, attributes };
  }
  return { type: "agent", id: agent.id };
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toIsoString(value: Date | string | undefined): string {
  if (value === undefined) return new Date().toISOString();
  if (typeof value === "string") return value;
  // An Invalid Date (e.g. `new Date(NaN)`, a common upstream-parse outcome)
  // throws `RangeError` from `toISOString()`. Stay defensive: fall back to a
  // non-throwing string so the envelope is still built and the downstream
  // timestamp validator cleanly rejects it rather than the adapter crashing.
  if (Number.isNaN(value.getTime())) return String(value);
  return value.toISOString();
}

/**
 * Derive a stable, deterministic event id from the event's identifying fields
 * when the caller supplied none. Same inputs → same id → idempotent ingest.
 * This is a readable, dependency-free fingerprint, not a cryptographic hash;
 * callers that need collision resistance should pass their own `eventId`.
 */
function deriveEventId(
  kind: string,
  occurredAt: string,
  identity: readonly string[],
  payload: Record<string, JsonValue>,
): string {
  // Fold the canonical payload into the fingerprint so that two structurally
  // distinct happenings (e.g. same tool, different `args`; or actions differing
  // only in `detail`) at the same instant derive different ids and both ingest,
  // while an identical re-emit still collapses to the same id and dedupes.
  const material = [kind, occurredAt, ...identity, stableStringify(payload)].join(" ");
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const digest = (hash >>> 0).toString(16).padStart(8, "0");
  return `agent-${kind.replace(/[^a-z0-9]+/gi, "-")}-${digest}`;
}
