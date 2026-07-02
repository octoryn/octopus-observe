import type { Validator } from "./validator.js";

/** Lookup outcome for a `(kind, schemaVersion)` pair. */
export type ValidatorLookup =
  | { readonly status: "found"; readonly validator: Validator }
  | { readonly status: "unknown_kind" }
  | {
      readonly status: "schema_mismatch";
      /** Schema versions registered for the kind, for a helpful message. */
      readonly known: readonly string[];
    };

/**
 * An immutable registry of validators, keyed by kind and then schema version.
 *
 * Keying on both axes lets multiple schema versions of the same kind coexist —
 * a requirement for evolving payload schemas without a breaking change. The
 * registry is built once from a list of validators and never mutated
 * afterwards.
 */
export class ValidatorRegistry {
  private readonly byKind: ReadonlyMap<string, ReadonlyMap<string, Validator>>;

  constructor(validators: readonly Validator[]) {
    const byKind = new Map<string, Map<string, Validator>>();
    for (const validator of validators) {
      let byVersion = byKind.get(validator.kind);
      if (byVersion === undefined) {
        byVersion = new Map<string, Validator>();
        byKind.set(validator.kind, byVersion);
      }
      const existing = byVersion.get(validator.schemaVersion);
      if (existing !== undefined) {
        throw new Error(
          `duplicate validator for kind "${validator.kind}" schemaVersion "${validator.schemaVersion}"`,
        );
      }
      byVersion.set(validator.schemaVersion, validator);
    }
    this.byKind = byKind;
  }

  /** Resolve the validator for a kind and schema version. */
  lookup(kind: string, schemaVersion: string): ValidatorLookup {
    const byVersion = this.byKind.get(kind);
    if (byVersion === undefined) {
      return { status: "unknown_kind" };
    }
    const validator = byVersion.get(schemaVersion);
    if (validator === undefined) {
      return { status: "schema_mismatch", known: [...byVersion.keys()] };
    }
    return { status: "found", validator };
  }

  /** All observation types this registry can produce, sorted. */
  observationTypes(): readonly string[] {
    const types = new Set<string>();
    for (const byVersion of this.byKind.values()) {
      for (const validator of byVersion.values()) {
        types.add(validator.observationType);
      }
    }
    return [...types].sort();
  }
}
