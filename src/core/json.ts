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
