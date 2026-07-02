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
