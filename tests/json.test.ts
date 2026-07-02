import { test } from "node:test";
import assert from "node:assert/strict";
import { stableStringify, type JsonValue } from "../src/index.js";

test("object keys are emitted in sorted order at every level", () => {
  const a = stableStringify({ b: 1, a: { d: 2, c: 3 } });
  const b = stableStringify({ a: { c: 3, d: 2 }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":3,"d":2},"b":1}');
});

test("strings, objects, and arrays cannot collide across types", () => {
  assert.notEqual(stableStringify({ a: 1 } as JsonValue), stableStringify('{"a":1}'));
  assert.notEqual(stableStringify([1, 2] as JsonValue), stableStringify("1,2"));
});

// The property both the audit chain and observation integrity rely on: the hash
// input is identical before and after a JSON storage round-trip.
function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

test("serialization is stable across a JSON round-trip for edge values", () => {
  const cases: unknown[] = [
    { score: NaN, ok: true },
    { score: Infinity },
    { score: -Infinity },
    { x: undefined, y: 1 },
    { list: [1, undefined, 3] },
    { nested: { z: -0, w: null } },
    { big: 1e21, small: 0.1 },
    {},
    [],
  ];
  for (const value of cases) {
    assert.equal(
      stableStringify(value as JsonValue),
      stableStringify(roundTrip(value) as JsonValue),
      `unstable across round-trip: ${JSON.stringify(value)}`,
    );
  }
});

test("matches JSON.stringify value canonicalization (non-finite → null, undefined omitted)", () => {
  assert.equal(stableStringify({ a: NaN } as JsonValue), '{"a":null}');
  assert.equal(stableStringify({ a: Infinity } as JsonValue), '{"a":null}');
  assert.equal(stableStringify({ a: undefined, b: 1 } as unknown as JsonValue), '{"b":1}');
  assert.equal(stableStringify([undefined] as unknown as JsonValue), "[null]");
});
