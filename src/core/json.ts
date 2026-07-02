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
 * output. Used for hashing, where key order must not affect the result.
 * `undefined` object properties are omitted (as `JSON.stringify` does).
 */
export function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key] as JsonValue)}`);
  return `{${entries.join(",")}}`;
}
