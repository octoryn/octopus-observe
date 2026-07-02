import { test } from "node:test";
import assert from "node:assert/strict";
import { Normalizer } from "../src/normalize/normalizer.js";
import { ValidatorRegistry } from "../src/validate/registry.js";
import { identityResolver, type Resolver } from "../src/normalize/resolver.js";
import { fixedClock } from "../src/core/clock.js";
import { exampleValidators } from "../src/observations/index.js";
import type { Rejection } from "../src/index.js";
import { reviewEvent, FIXED_NOW } from "./helpers.js";

function makeNormalizer(overrides: { normalizationVersion?: string } = {}): Normalizer {
  return new Normalizer({
    registry: new ValidatorRegistry(exampleValidators),
    resolver: identityResolver,
    clock: fixedClock(FIXED_NOW),
    normalizationVersion: overrides.normalizationVersion ?? "1.0",
    supportedEnvelopeVersions: ["1.0"],
    timestampPolicy: "rfc3339",
  });
}

function reasonOf(result: { ok: false; error: Rejection } | { ok: true }): string {
  assert.ok(!result.ok);
  return result.error.reason;
}

test("normalizes a valid event into a canonical observation", () => {
  const result = makeNormalizer().normalize(reviewEvent());
  assert.ok(result.ok);
  const obs = result.value;
  assert.equal(obs.type, "ReviewSubmitted");
  assert.equal(obs.at, Date.parse("2026-07-01T09:30:00.000Z"));
  assert.equal(obs.ingestedAt, FIXED_NOW);
  assert.equal(obs.sourceEventId, "evt-1");
  assert.deepEqual(obs.attributes, { pullRequest: "pr#1", decision: "approved" });
  assert.deepEqual(obs.actors, [{ type: "actor", id: "alice" }]);
  assert.deepEqual(obs.versions, {
    envelope: "1.0",
    schema: "1.0",
    normalization: "1.0",
    source: "2022-11-28",
  });
});

test("produced observation is deeply frozen", () => {
  const result = makeNormalizer().normalize(reviewEvent());
  assert.ok(result.ok);
  assert.ok(Object.isFrozen(result.value));
  assert.ok(Object.isFrozen(result.value.attributes));
  assert.ok(Object.isFrozen(result.value.actors));
});

test("rejects an unsupported envelope version", () => {
  const result = makeNormalizer().normalize(reviewEvent({ envelopeVersion: "9.9" }));
  assert.equal(reasonOf(result), "UNSUPPORTED_ENVELOPE_VERSION");
});

test("rejects an unknown kind", () => {
  const result = makeNormalizer().normalize(reviewEvent({ kind: "mystery.happened" }));
  assert.equal(reasonOf(result), "UNKNOWN_KIND");
});

test("rejects a schema version with no matching validator", () => {
  const result = makeNormalizer().normalize(reviewEvent({ schemaVersion: "2.0" }));
  assert.equal(reasonOf(result), "SCHEMA_VERSION_MISMATCH");
});

test("rejects an invalid payload with issues", () => {
  const result = makeNormalizer().normalize(
    reviewEvent({ payload: { pullRequest: "pr#1", decision: "loved-it" } }),
  );
  assert.ok(!result.ok);
  assert.equal(result.error.reason, "INVALID_PAYLOAD");
  assert.ok((result.error.issues ?? []).some((i) => i.path === "payload.decision"));
});

test("rejects an unparseable timestamp", () => {
  const result = makeNormalizer().normalize(reviewEvent({ occurredAt: "not-a-date" }));
  assert.equal(reasonOf(result), "INVALID_TIMESTAMP");
});

test("omits the source version when the event declares none", () => {
  const result = makeNormalizer().normalize(reviewEvent({ source: { system: "github" } }));
  assert.ok(result.ok);
  assert.equal(result.value.versions.source, undefined);
});

test("re-owns resolver output: shared resolver state is neither frozen nor leaked", () => {
  const shared = { tenant: "acme" };
  const resolver: Resolver = {
    resolveActor: (raw) => ({ type: raw.type, id: raw.id, attributes: shared }),
    resolveSubject: (raw) => ({ type: raw.type, id: raw.id }),
  };
  const normalizer = new Normalizer({
    registry: new ValidatorRegistry(exampleValidators),
    resolver,
    clock: fixedClock(FIXED_NOW),
    normalizationVersion: "1.0",
    supportedEnvelopeVersions: ["1.0"],
    timestampPolicy: "rfc3339",
  });

  const result = normalizer.normalize(reviewEvent());
  assert.ok(result.ok);
  const actorAttrs = result.value.actors[0]?.attributes;
  assert.deepEqual(actorAttrs, { tenant: "acme" });
  // The observation owns a frozen copy, independent of the resolver's object.
  assert.ok(Object.isFrozen(actorAttrs));
  assert.notEqual(actorAttrs, shared);
  // The resolver's shared object is left untouched (not frozen).
  assert.ok(!Object.isFrozen(shared));
  shared.tenant = "changed";
  assert.equal((result.value.actors[0]?.attributes as { tenant: string }).tenant, "acme");
});

test("normalization version participates in the observation id", () => {
  const v1 = makeNormalizer({ normalizationVersion: "1.0" }).normalize(reviewEvent());
  const v2 = makeNormalizer({ normalizationVersion: "2.0" }).normalize(reviewEvent());
  assert.ok(v1.ok && v2.ok);
  assert.notEqual(v1.value.id, v2.value.id);
});
