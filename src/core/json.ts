/**
 * JSON value model.
 *
 * Observation attributes and audit details are constrained to plain JSON so
 * that observations remain serializable, comparable, and storage-agnostic.
 * Nothing in Observe ever puts a class instance, function, or `undefined`
 * inside an attribute bag.
 */

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * Deterministic JSON serialization: object keys are emitted in sorted order at
 * every level, so two structurally-equal values always produce byte-identical
 * output regardless of key order. Used for hashing.
 *
 * Value canonicalization matches `JSON.stringify` exactly, so the result is
 * stable across a `JSON.stringify`/`JSON.parse` storage round-trip: non-finite
 * numbers (`NaN`, `±Infinity`) serialize to `null`, and object properties whose
 * value is `undefined` / a function / a symbol are omitted (array elements of
 * those kinds become `null`). This means a value that cannot survive JSON
 * storage is hashed as the form it will actually be stored as — the one caveat
 * being that such values are lossy (e.g. `NaN` and `Infinity` both hash as
 * `null`), so attribute values should be finite JSON (the built-in
 * {@link PayloadChecker} already guarantees this).
 */
export function stableStringify(value: JsonValue): string {
  return serialize(value);
}

/**
 * Coerce an untrusted value into a canonical {@link JsonValue}, or return
 * `undefined` if it cannot be represented as finite, plain JSON.
 *
 * This is a boundary helper for connectors and validators handling open-ended
 * fields (e.g. arbitrary tool arguments/results): it accepts only JSON
 * primitives, plain arrays, and plain objects, rejects non-finite numbers,
 * functions, symbols, bigints, class instances, and cycles, and drops object
 * keys whose value is `undefined` (mirroring JSON semantics). The returned
 * value is a fresh structure that serializes losslessly via
 * {@link stableStringify} — it never mutates or retains the input.
 */
export function asJsonValue(value: unknown): JsonValue | undefined {
  return coerce(value, new Set());
}

function coerce(value: unknown, seen: Set<object>): JsonValue | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
      return value;
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : undefined;
    case "object": {
      const obj = value as object;
      if (seen.has(obj)) return undefined;
      seen.add(obj);
      try {
        if (Array.isArray(value)) {
          const out: JsonValue[] = [];
          for (const item of value) {
            const coerced = coerce(item, seen);
            // JSON renders an omitted array element as null.
            out.push(coerced === undefined ? null : coerced);
          }
          return out;
        }
        if (
          Object.getPrototypeOf(value) !== Object.prototype &&
          Object.getPrototypeOf(value) !== null
        ) {
          return undefined;
        }
        const record = value as Record<string, unknown>;
        const out: JsonObject = {};
        for (const key of Object.keys(record)) {
          const coerced = coerce(record[key], seen);
          if (coerced !== undefined) out[key] = coerced;
        }
        return out;
      } finally {
        seen.delete(obj);
      }
    }
    default:
      // undefined, function, symbol, bigint.
      return undefined;
  }
}

function isOmitted(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      return Number.isFinite(value) ? String(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "bigint":
      throw new TypeError("Do not know how to serialize a BigInt");
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v) => (isOmitted(v) ? "null" : serialize(v))).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const v = record[key];
        if (isOmitted(v)) continue;
        parts.push(`${JSON.stringify(key)}:${serialize(v)}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      // undefined / function / symbol at the top level (JSON.stringify → undefined).
      return "null";
  }
}
