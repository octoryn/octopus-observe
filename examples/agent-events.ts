/**
 * Runnable example: map agent-stack happenings into Observe with the built-in
 * agent-event adapters, instead of hand-writing the envelope.
 *
 *   npx tsx examples/agent-events.ts
 */
import {
  Observe,
  fixedClock,
  agentEventValidators,
  mcpToolCallEvent,
  agentActionEvent,
} from "../src/index.js";

async function main(): Promise<void> {
  const observe = new Observe({
    // Register the validators that accept what the adapters produce.
    validators: agentEventValidators,
    clock: fixedClock(Date.parse("2026-07-02T00:00:00.000Z")),
  });

  const events = [
    // An MCP tool call — one function call, no envelope boilerplate.
    mcpToolCallEvent({
      tool: "search",
      server: "docs",
      args: { query: "octopus observe" },
      result: { hits: 3 },
      agent: { id: "session-7", attributes: { model: "opus" } },
      system: "claude-code",
      occurredAt: "2026-07-01T09:30:00.000Z",
    }),
    // A generic agent action.
    agentActionEvent({
      action: "plan",
      status: "ok",
      detail: { steps: 4 },
      agent: { id: "session-7" },
      occurredAt: "2026-07-01T09:31:00.000Z",
    }),
  ];

  const results = await observe.ingestAll(events);

  console.log("=== ingest results ===");
  for (const result of results) {
    if (result.status === "accepted" || result.status === "duplicate") {
      console.log(
        `${result.status.padEnd(10)} ${result.observation.type} (${result.observation.id})`,
      );
    } else if (result.status === "rejected") {
      console.log(
        `${"rejected".padEnd(10)} ${result.rejection.reason}: ${result.rejection.message}`,
      );
    } else {
      console.log(`${"skipped".padEnd(10)} ${result.eventId}`);
    }
  }

  console.log("\n=== stored observations ===");
  for (const obs of await observe.read.queryObservations({ order: "asc" })) {
    const actors = obs.actors.map((a) => `${a.type}:${a.id}`).join(", ");
    console.log(
      `${obs.type.padEnd(16)} actors=[${actors}] attrs=${JSON.stringify(obs.attributes)}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
