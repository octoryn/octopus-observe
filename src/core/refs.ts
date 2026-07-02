import type { JsonObject } from "./json.js";

/**
 * Open tagged reference.
 *
 * Observe never enumerates the set of actor or subject kinds — that would
 * couple the core to a particular organization's vocabulary. Instead a ref is
 * an open `(type, id)` pair: `type` names the kind of thing ("actor", "team",
 * "service", "pull_request", "document", ...) and `id` identifies it within
 * that kind. Consumers that care about a specific kind match on `type`.
 */
export interface TaggedRef {
  /** Open vocabulary tag, e.g. "actor", "service", "pull_request". */
  readonly type: string;
  /** Canonical identifier within `type`. */
  readonly id: string;
  /** Optional non-identifying metadata carried alongside the ref. */
  readonly attributes?: JsonObject;
}

/**
 * A reference exactly as named by the source, before attribution resolves it
 * to a canonical {@link TaggedRef}. Structurally identical to `TaggedRef`, but
 * kept as a distinct type so the boundary between "as the source said" and
 * "resolved" is explicit in signatures.
 */
export interface RawRef {
  readonly type: string;
  readonly id: string;
  readonly attributes?: JsonObject;
}
