import type { ObservationEvent, EventSource } from "../core/event.js";
import type { RawRef } from "../core/refs.js";
import type { JsonObject } from "../core/json.js";
import type { Rejection, ValidationIssue } from "../core/rejection.js";
import { type Result, ok, err } from "../core/result.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseRefs(
  raw: unknown,
  field: string,
  issues: ValidationIssue[],
): readonly RawRef[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    issues.push({ path: field, message: "must be an array when present" });
    return undefined;
  }
  const refs: RawRef[] = [];
  raw.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      issues.push({ path: `${field}[${index}]`, message: "must be an object" });
      return;
    }
    if (!isNonEmptyString(entry["type"])) {
      issues.push({ path: `${field}[${index}].type`, message: "must be a non-empty string" });
    }
    if (!isNonEmptyString(entry["id"])) {
      issues.push({ path: `${field}[${index}].id`, message: "must be a non-empty string" });
    }
    const attributes = entry["attributes"];
    if (attributes !== undefined && !isPlainObject(attributes)) {
      issues.push({ path: `${field}[${index}].attributes`, message: "must be an object" });
    }
    if (isNonEmptyString(entry["type"]) && isNonEmptyString(entry["id"])) {
      refs.push(
        attributes === undefined
          ? { type: entry["type"], id: entry["id"] }
          : { type: entry["type"], id: entry["id"], attributes: attributes as JsonObject },
      );
    }
  });
  return refs;
}

function parseSource(raw: unknown, issues: ValidationIssue[]): EventSource | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isPlainObject(raw)) {
    issues.push({ path: "source", message: "must be an object when present" });
    return undefined;
  }
  const source: { system?: string; connector?: string; version?: string } = {};
  for (const key of ["system", "connector", "version"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      issues.push({ path: `source.${key}`, message: "must be a string when present" });
      continue;
    }
    source[key] = value;
  }
  return source;
}

/**
 * Structurally validate untrusted input into an {@link ObservationEvent}.
 *
 * This checks only the envelope contract — the presence and types of the
 * required fields — not the payload (that is a validator's job) and not the
 * timestamp's parseability (that is a separate, distinctly-reasoned check). A
 * failure here is always `MALFORMED_ENVELOPE`.
 */
export function parseEnvelope(input: unknown): Result<ObservationEvent, Rejection> {
  const issues: ValidationIssue[] = [];

  if (!isPlainObject(input)) {
    return err({
      reason: "MALFORMED_ENVELOPE",
      message: "event must be an object",
      issues: [{ path: "", message: "must be an object" }],
    });
  }

  const eventIdRaw = input["eventId"];
  const eventId = isNonEmptyString(eventIdRaw) ? eventIdRaw : undefined;
  if (eventId === undefined) {
    issues.push({ path: "eventId", message: "must be a non-empty string" });
  }
  if (!isNonEmptyString(input["envelopeVersion"])) {
    issues.push({ path: "envelopeVersion", message: "must be a non-empty string" });
  }
  if (!isNonEmptyString(input["schemaVersion"])) {
    issues.push({ path: "schemaVersion", message: "must be a non-empty string" });
  }
  if (!isNonEmptyString(input["kind"])) {
    issues.push({ path: "kind", message: "must be a non-empty string" });
  }
  if (!isNonEmptyString(input["occurredAt"])) {
    issues.push({ path: "occurredAt", message: "must be a non-empty string" });
  }
  if (!Object.prototype.hasOwnProperty.call(input, "payload")) {
    issues.push({ path: "payload", message: "is required" });
  }

  const actors = parseRefs(input["actors"], "actors", issues);
  const subjects = parseRefs(input["subjects"], "subjects", issues);
  const source = parseSource(input["source"], issues);

  if (issues.length > 0) {
    return err({
      reason: "MALFORMED_ENVELOPE",
      message: "event envelope is malformed",
      ...(eventId !== undefined ? { eventId } : {}),
      issues,
    });
  }

  const event: ObservationEvent = {
    eventId: input["eventId"] as string,
    envelopeVersion: input["envelopeVersion"] as string,
    schemaVersion: input["schemaVersion"] as string,
    kind: input["kind"] as string,
    occurredAt: input["occurredAt"] as string,
    payload: input["payload"],
    ...(source !== undefined ? { source } : {}),
    ...(actors !== undefined ? { actors } : {}),
    ...(subjects !== undefined ? { subjects } : {}),
  };
  return ok(event);
}
