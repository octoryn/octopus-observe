import type { RawRef, TaggedRef } from "../core/refs.js";

/**
 * Attribution resolves raw refs (as named by the source) into canonical tagged
 * refs. This is the seam where cross-source identity resolution would live —
 * e.g. mapping "github:alice" and "email:alice@corp" to one canonical actor.
 *
 * Resolution is pure and total: it always returns a ref (it may not know a
 * better identity than the one it was given). It must never throw for ordinary
 * input; unknown identities pass through rather than failing the pipeline.
 */
export interface Resolver {
  resolveActor(raw: RawRef): TaggedRef;
  resolveSubject(raw: RawRef): TaggedRef;
}

function passthrough(raw: RawRef): TaggedRef {
  return raw.attributes === undefined
    ? { type: raw.type, id: raw.id }
    : { type: raw.type, id: raw.id, attributes: raw.attributes };
}

/**
 * The default resolver: identity. Every raw ref becomes a tagged ref with the
 * same `type` and `id`. This keeps Observe fully usable standalone; real
 * cross-source resolution is provided by supplying a different `Resolver`.
 */
export const identityResolver: Resolver = {
  resolveActor: passthrough,
  resolveSubject: passthrough,
};
