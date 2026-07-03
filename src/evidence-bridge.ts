/**
 * OUTPUT bridge: an {@link Observation} → an octopus-evidence `Evidence`.
 *
 * This is the "Observe = evidence collection" edge made real. An observation is
 * Observe's trusted, canonical, immutable fact; `toEvidence` re-frames one as a
 * verifiable {@link Evidence} envelope so it can flow through the rest of the
 * Octopus stack (Blackboard timelines it, Runtime approves on it, Inspect
 * validates it) under the shared cryptographic contract of the first-party
 * `octopus-evidence` primitive.
 *
 * The bridge is a pure, lossless projection: it copies the observation's
 * identity (type), subjects, actor, canonical attributes, source system, and
 * canonical timestamp into the evidence shape and lets `createEvidence` stamp
 * the deterministic id and integrity hash. It does NOT touch the observation —
 * the observation's own `id`, `integrity`, and audit trail are unchanged.
 */
import { createEvidence, type Evidence, type Ref } from "octopus-evidence";
import type { Observation } from "./core/observation.js";
import type { TaggedRef } from "./core/refs.js";

/** Options for {@link toEvidence}. */
export interface ToEvidenceOptions {
  /**
   * Key the evidence integrity hash (HMAC) so no field can be forged or altered
   * without the secret. Passed straight through to `createEvidence`; verify the
   * resulting evidence with the same secret.
   */
  readonly integritySecret?: string;
}

/**
 * Project an {@link Observation} into a verifiable {@link Evidence} envelope.
 *
 * The mapping:
 * - `kind` = `observation:${observation.type}` — an evidence kind that names the
 *   observation type it was derived from.
 * - `subject` = the observation's subjects, each narrowed to an evidence
 *   `{ type, id }` `Ref` (non-identifying ref attributes are dropped).
 * - `actor` = the observation's first actor, if any, as an evidence `Ref`.
 * - `content` = the observation's canonical attributes (its validated payload).
 * - `provenance` = `{ source: the observation's source system, at: its
 *   canonical timestamp }` — the observation's UTC instant rendered as an
 *   RFC 3339 string.
 *
 * `createEvidence` stamps the deterministic id and integrity; `integritySecret`
 * is passed through unchanged.
 */
export function toEvidence(observation: Observation, options: ToEvidenceOptions = {}): Evidence {
  const subject: Ref[] = observation.subjects.map(toRef);
  const [firstActor] = observation.actors;

  return createEvidence(
    {
      kind: `observation:${observation.type}`,
      subject,
      ...(firstActor ? { actor: toRef(firstActor) } : {}),
      content: observation.attributes,
      provenance: {
        source: observation.source.system ?? "unknown",
        at: new Date(observation.at).toISOString(),
      },
    },
    options.integritySecret !== undefined ? { integritySecret: options.integritySecret } : {},
  );
}

/** Narrow a resolved {@link TaggedRef} to an evidence `Ref` (`type` + `id`). */
function toRef(ref: TaggedRef): Ref {
  return { type: ref.type, id: ref.id };
}
