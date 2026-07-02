import { test } from "node:test";
import assert from "node:assert/strict";
import { PayloadChecker } from "../src/validate/checker.js";

test("rejects non-object payloads", () => {
  assert.equal(PayloadChecker.of(null), undefined);
  assert.equal(PayloadChecker.of(42), undefined);
  assert.equal(PayloadChecker.of("x"), undefined);
  assert.equal(PayloadChecker.of([]), undefined);
});

test("collects required fields into attributes", () => {
  const c = PayloadChecker.of({ name: "obs", count: 3 });
  assert.ok(c);
  c.string("name");
  c.number("count", { integer: true });
  const result = c.result();
  assert.ok(result.ok);
  assert.deepEqual(result.attributes, { name: "obs", count: 3 });
});

test("reports issues for missing and mistyped fields", () => {
  const c = PayloadChecker.of({ count: "not-a-number" });
  assert.ok(c);
  c.string("name");
  c.number("count");
  const result = c.result();
  assert.ok(!result.ok);
  assert.deepEqual(
    result.issues.map((i) => i.path),
    ["payload.name", "payload.count"],
  );
});

test("optional fields may be absent but are validated when present", () => {
  const present = PayloadChecker.of({ note: "hi" });
  assert.ok(present);
  present.string("note", { optional: true });
  assert.ok(present.result().ok);

  const absent = PayloadChecker.of({});
  assert.ok(absent);
  absent.string("note", { optional: true });
  const absentResult = absent.result();
  assert.ok(absentResult.ok);
  assert.deepEqual(absentResult.attributes, {});

  const wrong = PayloadChecker.of({ note: 5 });
  assert.ok(wrong);
  wrong.string("note", { optional: true });
  assert.ok(!wrong.result().ok);
});

test("enum accepts only listed values", () => {
  const ok = PayloadChecker.of({ decision: "approved" });
  assert.ok(ok);
  ok.enum("decision", ["approved", "rejected"] as const);
  assert.ok(ok.result().ok);

  const bad = PayloadChecker.of({ decision: "maybe" });
  assert.ok(bad);
  bad.enum("decision", ["approved", "rejected"] as const);
  assert.ok(!bad.result().ok);
});

test("integer check rejects non-integers", () => {
  const c = PayloadChecker.of({ n: 1.5 });
  assert.ok(c);
  c.number("n", { integer: true });
  assert.ok(!c.result().ok);
});
