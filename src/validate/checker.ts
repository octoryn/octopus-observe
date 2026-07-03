import type { JsonObject, JsonValue } from "../core/json.js";
import { asJsonValue } from "../core/json.js";
import type { ValidationIssue } from "../core/rejection.js";
import type { ValidationResult } from "./validator.js";

/**
 * A tiny, dependency-free helper for hand-writing payload validators.
 *
 * Observe deliberately ships no schema-library dependency: the validator
 * contract is small, and a runtime dependency here would be a long-lived
 * coupling for little gain. `PayloadChecker` collects field-level issues and
 * builds the canonical attribute bag as it goes.
 *
 * Typical use:
 *
 * ```ts
 * const c = PayloadChecker.of(payload);
 * if (!c) return invalidRoot();
 * const pr = c.string("pullRequest");
 * const decision = c.enum("decision", ["approved", "rejected"] as const);
 * return c.result();
 * ```
 */
export class PayloadChecker {
  private readonly issues: ValidationIssue[] = [];
  private readonly attributes: JsonObject = {};

  private constructor(private readonly obj: Record<string, unknown>) {}

  /** Begin checking a payload, or return `undefined` if it is not an object. */
  static of(payload: unknown): PayloadChecker | undefined {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return undefined;
    }
    return new PayloadChecker(payload as Record<string, unknown>);
  }

  private fail(path: string, message: string): void {
    this.issues.push({ path: `payload.${path}`, message });
  }

  private read(field: string): unknown {
    return Object.prototype.hasOwnProperty.call(this.obj, field) ? this.obj[field] : undefined;
  }

  /** Require a non-empty string; records the value into attributes when valid. */
  string(field: string, opts: { readonly optional?: boolean } = {}): string | undefined {
    const value = this.read(field);
    if (value === undefined) {
      if (!opts.optional) this.fail(field, "is required");
      return undefined;
    }
    if (typeof value !== "string" || value.length === 0) {
      this.fail(field, "must be a non-empty string");
      return undefined;
    }
    this.attributes[field] = value;
    return value;
  }

  /** Require a finite number (optionally an integer). */
  number(
    field: string,
    opts: { readonly optional?: boolean; readonly integer?: boolean } = {},
  ): number | undefined {
    const value = this.read(field);
    if (value === undefined) {
      if (!opts.optional) this.fail(field, "is required");
      return undefined;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.fail(field, "must be a finite number");
      return undefined;
    }
    if (opts.integer && !Number.isInteger(value)) {
      this.fail(field, "must be an integer");
      return undefined;
    }
    this.attributes[field] = value;
    return value;
  }

  /** Require a boolean. */
  boolean(field: string, opts: { readonly optional?: boolean } = {}): boolean | undefined {
    const value = this.read(field);
    if (value === undefined) {
      if (!opts.optional) this.fail(field, "is required");
      return undefined;
    }
    if (typeof value !== "boolean") {
      this.fail(field, "must be a boolean");
      return undefined;
    }
    this.attributes[field] = value;
    return value;
  }

  /** Require the value to be one of `values`. */
  enum<const T extends string>(
    field: string,
    values: readonly T[],
    opts: { readonly optional?: boolean } = {},
  ): T | undefined {
    const value = this.read(field);
    if (value === undefined) {
      if (!opts.optional) this.fail(field, "is required");
      return undefined;
    }
    if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
      this.fail(field, `must be one of: ${values.join(", ")}`);
      return undefined;
    }
    this.attributes[field] = value;
    return value as T;
  }

  /**
   * Require an arbitrary, open-ended JSON value (object, array, or primitive).
   *
   * Unlike the typed field helpers this places no shape constraint on the
   * value beyond being finite, plain JSON — useful for genuinely open fields
   * such as tool arguments or results. The value is coerced to its canonical,
   * storage-safe form (see {@link asJsonValue}) before being recorded.
   */
  json(field: string, opts: { readonly optional?: boolean } = {}): JsonValue | undefined {
    const value = this.read(field);
    if (value === undefined) {
      if (!opts.optional) this.fail(field, "is required");
      return undefined;
    }
    const coerced = asJsonValue(value);
    if (coerced === undefined) {
      this.fail(field, "must be a JSON value");
      return undefined;
    }
    this.attributes[field] = coerced;
    return coerced;
  }

  /** Set a computed attribute that is not a direct payload field. */
  set(field: string, value: JsonValue): void {
    this.attributes[field] = value;
  }

  /** Whether any issues have been recorded so far. */
  get valid(): boolean {
    return this.issues.length === 0;
  }

  /**
   * Finish checking. Returns the collected attributes when valid, otherwise the
   * accumulated issues.
   */
  result(): ValidationResult {
    if (this.issues.length > 0) {
      return { ok: false, issues: this.issues };
    }
    return { ok: true, attributes: this.attributes };
  }
}
