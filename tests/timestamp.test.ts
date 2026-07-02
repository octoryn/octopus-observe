import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTimestamp } from "../src/normalize/timestamp.js";
import { Observe, fixedClock } from "../src/index.js";
import { exampleValidators } from "../src/observations/index.js";
import { reviewEvent, FIXED_NOW } from "./helpers.js";

test("rfc3339 policy requires a timezone offset", () => {
  assert.ok(parseTimestamp("2026-07-01T09:30:00Z", "rfc3339").ok);
  assert.ok(parseTimestamp("2026-07-01T09:30:00.123Z", "rfc3339").ok);
  assert.ok(parseTimestamp("2026-07-01T09:30:00+10:00", "rfc3339").ok);

  const offsetless = parseTimestamp("2026-07-01T09:30:00", "rfc3339");
  assert.ok(!offsetless.ok);
  assert.equal(offsetless.error, "not_rfc3339");

  const dateOnly = parseTimestamp("2026-07-01", "rfc3339");
  assert.ok(!dateOnly.ok);
});

test("rfc3339 rejects out-of-range fields instead of rolling them over", () => {
  // The critical case: Feb 30 must NOT silently become Mar 2.
  assert.ok(!parseTimestamp("2026-02-30T00:00:00Z", "rfc3339").ok);
  assert.ok(!parseTimestamp("2026-01-01T24:00:00Z", "rfc3339").ok);
  assert.ok(!parseTimestamp("2026-13-01T00:00:00Z", "rfc3339").ok);
  assert.ok(!parseTimestamp("2026-00-01T00:00:00Z", "rfc3339").ok);
  assert.ok(!parseTimestamp("2026-01-32T00:00:00Z", "rfc3339").ok);
  assert.ok(!parseTimestamp("2026-01-01T00:60:00Z", "rfc3339").ok);
  assert.ok(!parseTimestamp("2026-06-30T23:59:60Z", "rfc3339").ok); // leap second not represented
  assert.ok(!parseTimestamp("2026-07-02T12:00:00+99:99", "rfc3339").ok);
});

test("rfc3339 honors leap-year day validity", () => {
  assert.ok(parseTimestamp("2024-02-29T00:00:00Z", "rfc3339").ok); // 2024 is a leap year
  assert.ok(!parseTimestamp("2026-02-29T00:00:00Z", "rfc3339").ok); // 2026 is not
  assert.ok(!parseTimestamp("2100-02-29T00:00:00Z", "rfc3339").ok); // century non-leap
  assert.ok(parseTimestamp("2000-02-29T00:00:00Z", "rfc3339").ok); // 400-divisible leap
});

test("rfc3339 computes the offset instant correctly (no local-zone drift)", () => {
  const z = parseTimestamp("2026-07-01T00:00:00Z", "rfc3339");
  const plus = parseTimestamp("2026-07-01T10:00:00+10:00", "rfc3339");
  const minus = parseTimestamp("2026-06-30T19:00:00-05:00", "rfc3339");
  assert.ok(z.ok && plus.ok && minus.ok);
  assert.equal(plus.at, z.at); // 10:00+10:00 == 00:00Z
  assert.equal(minus.at, z.at); // 19:00-05:00 == 00:00Z
  assert.equal(z.at, Date.UTC(2026, 6, 1, 0, 0, 0));
});

test("rfc3339 preserves fractional seconds", () => {
  const r = parseTimestamp("2026-07-01T00:00:00.250Z", "rfc3339");
  assert.ok(r.ok);
  assert.equal(r.at, Date.UTC(2026, 6, 1, 0, 0, 0) + 250);
});

test("lenient policy accepts what Date.parse accepts", () => {
  assert.ok(parseTimestamp("2026-07-01T09:30:00", "lenient").ok);
  assert.ok(parseTimestamp("2026-07-01", "lenient").ok);
  assert.ok(!parseTimestamp("not-a-date", "lenient").ok);
});

test("both policies produce identical instants for offset-qualified input", () => {
  const strict = parseTimestamp("2026-07-01T09:30:00Z", "rfc3339");
  const lenient = parseTimestamp("2026-07-01T09:30:00Z", "lenient");
  assert.ok(strict.ok && lenient.ok);
  assert.equal(strict.at, lenient.at);
});

test("Observe rejects offset-less timestamps by default (rfc3339)", async () => {
  const observe = new Observe({ validators: exampleValidators, clock: fixedClock(FIXED_NOW) });
  const result = await observe.ingest(reviewEvent({ occurredAt: "2026-07-01T09:30:00" }));
  assert.equal(result.status, "rejected");
  assert.ok(result.status === "rejected");
  assert.equal(result.rejection.reason, "INVALID_TIMESTAMP");
});

test("Observe accepts offset-less timestamps under the lenient policy", async () => {
  const observe = new Observe({
    validators: exampleValidators,
    clock: fixedClock(FIXED_NOW),
    timestampPolicy: "lenient",
  });
  const result = await observe.ingest(reviewEvent({ occurredAt: "2026-07-01T09:30:00" }));
  assert.equal(result.status, "accepted");
});
