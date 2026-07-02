/**
 * Recursively freeze a value so that observations are immutable in fact, not
 * just by type. Cheap for the small plain-object/array structures Observe
 * produces; never called on cyclic data (observations are acyclic JSON).
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
