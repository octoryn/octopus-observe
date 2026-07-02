#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Observe, type IngestResult } from "./index.js";
import { exampleValidators } from "./observations/index.js";

const USAGE = `observe — ingest observation events and print the results

Usage:
  observe [file]         Read events from <file> (JSON array or NDJSON)
  observe < events.ndjson  Read events from stdin
  observe --help

Options:
  --audit    Also print the full audit trail
  --json     Print machine-readable JSON instead of a summary
  --help     Show this help

Events are validated against the bundled example types
(review.submitted, deploy.finished, issue.opened).`;

interface CliArgs {
  readonly file?: string;
  readonly audit: boolean;
  readonly json: boolean;
  readonly help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let file: string | undefined;
  let audit = false;
  let json = false;
  let help = false;
  for (const arg of argv) {
    if (arg === "--audit") audit = true;
    else if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (!arg.startsWith("-") && file === undefined) file = arg;
  }
  return { audit, json, help, ...(file !== undefined ? { file } : {}) };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Parse either a JSON array of events or newline-delimited JSON. */
function parseEvents(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("top-level JSON must be an array of events");
    }
    return parsed;
  }
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (cause) {
        throw new Error(`invalid JSON on line ${index + 1}: ${(cause as Error).message}`);
      }
    });
}

function summarize(result: IngestResult): string {
  switch (result.status) {
    case "accepted":
      return `accepted   ${result.observation.type.padEnd(16)} ${result.observation.id}`;
    case "duplicate":
      return `duplicate  ${result.observation.type.padEnd(16)} ${result.observation.id}`;
    case "skipped":
      return `skipped    unknown kind (event ${result.eventId})`;
    case "rejected":
      return `rejected   ${result.rejection.reason.padEnd(16)} ${result.rejection.message}`;
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const raw = args.file !== undefined ? await readFile(args.file, "utf8") : await readStdin();
  const events = parseEvents(raw);

  const observe = new Observe({ validators: exampleValidators });
  const results = await observe.ingestAll(events);

  if (args.json) {
    const observations = await observe.read.queryObservations();
    const audit = args.audit ? await observe.read.queryAudit() : undefined;
    process.stdout.write(
      `${JSON.stringify({ results, observations, ...(audit ? { audit } : {}) }, null, 2)}\n`,
    );
    return exitCode(results);
  }

  const counts = { accepted: 0, duplicate: 0, rejected: 0, skipped: 0 };
  for (const result of results) {
    counts[result.status] += 1;
    process.stdout.write(`${summarize(result)}\n`);
  }

  process.stdout.write(
    `\n${events.length} event(s): ${counts.accepted} accepted, ${counts.duplicate} duplicate, ` +
      `${counts.rejected} rejected, ${counts.skipped} skipped\n`,
  );

  if (args.audit) {
    process.stdout.write(`\naudit trail:\n`);
    const audit = await observe.read.queryAudit();
    for (const record of audit) {
      const obs = record.observationId ? ` obs=${record.observationId}` : "";
      process.stdout.write(`  [${record.stage}/${record.outcome}] event=${record.eventId}${obs}\n`);
    }
  }

  return exitCode(results);
}

function exitCode(results: readonly IngestResult[]): number {
  return results.some((r) => r.status === "rejected") ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`observe: ${(error as Error).message}\n`);
    process.exitCode = 2;
  },
);
