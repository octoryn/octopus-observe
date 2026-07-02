/**
 * How `occurredAt` is parsed into a canonical instant.
 *
 * - `"rfc3339"` (default) — require a full RFC 3339 timestamp **with an explicit
 *   timezone** (`Z` or `±HH:MM`), and validate every field's range so the
 *   instant is unambiguous. This is the only way to get a machine- and
 *   region-independent canonical `at`, which matters for audit, cross-region
 *   intake, and compliance. The instant is computed directly from the validated
 *   fields — never via a lenient parser that would silently roll over an
 *   out-of-range date (e.g. Feb 30 → Mar 2).
 * - `"lenient"` — accept anything the runtime's `Date.parse` accepts. Offered as
 *   an explicit opt-out for pipelines that knowingly ingest looser sources; such
 *   timestamps may be interpreted in the local zone or silently normalized, and
 *   are therefore not canonical across machines.
 */
export type TimestampPolicy = "rfc3339" | "lenient";

/** The default timestamp policy: strict RFC 3339 with a mandatory timezone. */
export const DEFAULT_TIMESTAMP_POLICY: TimestampPolicy = "rfc3339";

/**
 * RFC 3339 date-time with a **mandatory** timezone offset, captured field by
 * field. A fractional second part is allowed. Leap seconds (`:60`) are not
 * accepted — JS `Date` cannot represent them.
 */
const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|([+-])(\d{2}):(\d{2}))$/;

/** Why a timestamp could not be turned into a canonical instant. */
export type TimestampError = "not_rfc3339" | "unparseable";

export type TimestampResult =
  | { readonly ok: true; readonly at: number }
  | { readonly ok: false; readonly error: TimestampError };

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1] as number;
}

/**
 * Strictly parse an RFC 3339 timestamp with a timezone offset, validating field
 * ranges and computing the epoch-millisecond instant directly. Returns
 * `not_rfc3339` for anything that is not a well-formed, in-range RFC 3339
 * date-time with an offset. Never rolls an out-of-range field over.
 */
function parseRfc3339(value: string): TimestampResult {
  const match = RFC3339.exec(value);
  if (match === null) {
    return { ok: false, error: "not_rfc3339" };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7]; // e.g. ".123" or undefined
  const tz = match[8] as string;

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return { ok: false, error: "not_rfc3339" };
  }

  let offsetMinutes = 0;
  if (tz !== "Z" && tz !== "z") {
    const sign = match[9] === "-" ? -1 : 1;
    const offsetHour = Number(match[10]);
    const offsetMin = Number(match[11]);
    if (offsetHour > 23 || offsetMin > 59) {
      return { ok: false, error: "not_rfc3339" };
    }
    offsetMinutes = sign * (offsetHour * 60 + offsetMin);
  }

  // Fields are validated, so Date.UTC cannot roll over.
  let at = Date.UTC(year, month - 1, day, hour, minute, second);
  if (fraction !== undefined) {
    at += Math.round(Number(fraction) * 1000);
  }
  at -= offsetMinutes * 60_000;
  return { ok: true, at };
}

/**
 * Parse `occurredAt` into epoch milliseconds under the given policy. Pure.
 */
export function parseTimestamp(value: string, policy: TimestampPolicy): TimestampResult {
  if (policy === "rfc3339") {
    return parseRfc3339(value);
  }
  const at = Date.parse(value);
  return Number.isNaN(at) ? { ok: false, error: "unparseable" } : { ok: true, at };
}
