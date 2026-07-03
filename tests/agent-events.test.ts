import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Observe,
  fixedClock,
  exampleValidators,
  agentEventValidators,
  mcpToolCallEvent,
  agentActionEvent,
  AGENT_TOOL_CALLED_KIND,
  AGENT_ACTION_KIND,
} from "../src/index.js";
import { FIXED_NOW } from "./helpers.js";

function makeObserve(): Observe {
  return new Observe({
    validators: [...exampleValidators, ...agentEventValidators],
    clock: fixedClock(FIXED_NOW),
  });
}

test("mcpToolCallEvent produces an envelope that ingests as AgentToolCalled", async () => {
  const observe = makeObserve();
  const event = mcpToolCallEvent({
    tool: "search",
    server: "docs",
    args: { query: "octopus" },
    result: { hits: 3 },
    isError: false,
    agent: { id: "session-7" },
    system: "claude-code",
    occurredAt: "2026-07-01T09:30:00.000Z",
  });

  const result = await observe.ingest(event);
  assert.equal(result.status, "accepted");
  assert.ok(result.status === "accepted");
  const obs = result.observation;
  assert.equal(obs.type, "AgentToolCalled");
  assert.equal(obs.attributes["tool"], "search");
  assert.equal(obs.attributes["protocol"], "mcp");
  assert.equal(obs.attributes["server"], "docs");
  assert.equal(obs.attributes["isError"], false);
  assert.deepEqual(obs.attributes["args"], { query: "octopus" });
  assert.deepEqual(obs.attributes["result"], { hits: 3 });
  // Agent travels as an actor; tool as a subject.
  assert.deepEqual(
    obs.actors.map((a) => `${a.type}:${a.id}`),
    ["agent:session-7"],
  );
  assert.ok(obs.subjects.some((s) => s.type === "tool" && s.id === "search"));
  assert.equal(await observe.read.countObservations(), 1);
});

test("mcpToolCallEvent defaults protocol to mcp and requires only a tool", async () => {
  const observe = makeObserve();
  const event = mcpToolCallEvent({ tool: "ping", occurredAt: "2026-07-01T09:30:00.000Z" });
  assert.equal(event.kind, AGENT_TOOL_CALLED_KIND);
  const result = await observe.ingest(event);
  assert.equal(result.status, "accepted");
  assert.ok(result.status === "accepted");
  assert.equal(result.observation.attributes["protocol"], "mcp");
});

test("agentActionEvent produces an envelope that ingests as AgentAction", async () => {
  const observe = makeObserve();
  const event = agentActionEvent({
    action: "plan",
    status: "ok",
    detail: { steps: 4, notes: ["a", "b"] },
    agent: { id: "session-7", attributes: { model: "opus" } },
    occurredAt: "2026-07-01T10:00:00.000Z",
  });
  assert.equal(event.kind, AGENT_ACTION_KIND);

  const result = await observe.ingest(event);
  assert.equal(result.status, "accepted");
  assert.ok(result.status === "accepted");
  const obs = result.observation;
  assert.equal(obs.type, "AgentAction");
  assert.equal(obs.attributes["action"], "plan");
  assert.equal(obs.attributes["status"], "ok");
  assert.deepEqual(obs.attributes["detail"], { steps: 4, notes: ["a", "b"] });
  assert.deepEqual(
    obs.actors.map((a) => `${a.type}:${a.id}`),
    ["agent:session-7"],
  );
});

test("derived event ids make re-emitting the same happening an idempotent duplicate", async () => {
  const observe = makeObserve();
  const first = mcpToolCallEvent({
    tool: "search",
    args: { query: "x" },
    occurredAt: "2026-07-01T09:30:00.000Z",
  });
  const again = mcpToolCallEvent({
    tool: "search",
    args: { query: "x" },
    occurredAt: "2026-07-01T09:30:00.000Z",
  });
  assert.equal(first.eventId, again.eventId);
  const r1 = await observe.ingest(first);
  const r2 = await observe.ingest(again);
  assert.equal(r1.status, "accepted");
  assert.equal(r2.status, "duplicate");
  assert.equal(await observe.read.countObservations(), 1);
});

test("derived ids distinguish structurally-different events at the same instant", async () => {
  const observe = makeObserve();
  // Same tool, same instant, differing only in `args` — must NOT collide.
  const a = mcpToolCallEvent({
    tool: "search",
    args: { query: "one" },
    occurredAt: "2026-07-01T09:30:00.000Z",
  });
  const b = mcpToolCallEvent({
    tool: "search",
    args: { query: "two" },
    occurredAt: "2026-07-01T09:30:00.000Z",
  });
  assert.notEqual(a.eventId, b.eventId);

  const ra = await observe.ingest(a);
  const rb = await observe.ingest(b);
  assert.equal(ra.status, "accepted");
  assert.equal(rb.status, "accepted");
  assert.equal(await observe.read.countObservations(), 2);

  // An identical re-emit of `a` still dedupes to the same derived id.
  const again = mcpToolCallEvent({
    tool: "search",
    args: { query: "one" },
    occurredAt: "2026-07-01T09:30:00.000Z",
  });
  assert.equal(again.eventId, a.eventId);
  const rAgain = await observe.ingest(again);
  assert.equal(rAgain.status, "duplicate");
  assert.equal(await observe.read.countObservations(), 2);
});

test("an Invalid Date does not throw and cleanly fails timestamp validation", async () => {
  const observe = makeObserve();
  // A common upstream-parse outcome; the adapter must build an envelope, not throw.
  let event: ReturnType<typeof mcpToolCallEvent>;
  assert.doesNotThrow(() => {
    event = mcpToolCallEvent({ tool: "search", occurredAt: new Date(NaN) });
  });
  const result = await observe.ingest(event!);
  assert.equal(result.status, "rejected");
  assert.ok(result.status === "rejected");
  assert.equal(result.rejection.reason, "INVALID_TIMESTAMP");
  assert.equal(await observe.read.countObservations(), 0);
});

test("a caller-supplied eventId overrides the derived one", () => {
  const event = agentActionEvent({ action: "message", eventId: "my-id" });
  assert.equal(event.eventId, "my-id");
});

test("non-JSON fields in args are dropped so the payload still validates", async () => {
  const observe = makeObserve();
  const event = mcpToolCallEvent({
    tool: "run",
    // A function is not representable in JSON; it must be silently dropped.
    args: { keep: 1, drop: () => 0 },
    occurredAt: "2026-07-01T09:30:00.000Z",
  });
  const result = await observe.ingest(event);
  assert.equal(result.status, "accepted");
  assert.ok(result.status === "accepted");
  assert.deepEqual(result.observation.attributes["args"], { keep: 1 });
});

test("adapters emit the connector name for provenance", () => {
  const event = agentActionEvent({ action: "message" });
  assert.equal(event.source?.connector, "agent-events");
});

test("the emitted envelope is frozen (adapter output is not mutated downstream)", () => {
  const event = mcpToolCallEvent({ tool: "search" });
  assert.ok(Object.isFrozen(event));
});
