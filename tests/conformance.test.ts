import { test as baseTest } from "node:test";
import { createRequire } from "node:module";
import { storeConformance } from "../src/conformance.js";
import {
  InMemoryObservationStore,
  InMemoryAuditStore,
  InMemoryRawEventArchive,
} from "../src/index.js";
import { createSqliteStores } from "../src/storage/sqlite.js";

// The in-memory stores must satisfy the full storage contract.
storeConformance("in-memory", {
  observations: () => new InMemoryObservationStore(),
  audit: () => new InMemoryAuditStore(),
  rawEvents: () => new InMemoryRawEventArchive(),
});

// So must the SQLite adapter — same suite, proving parity. Each factory call
// opens a fresh in-memory database. Skipped where node:sqlite is unavailable.
let sqliteAvailable = true;
try {
  createRequire(import.meta.url)("node:sqlite");
} catch {
  sqliteAvailable = false;
}

if (sqliteAvailable) {
  storeConformance("sqlite", {
    observations: () => createSqliteStores(":memory:").observations,
    audit: () => createSqliteStores(":memory:").audit,
    rawEvents: () => createSqliteStores(":memory:").rawEvents,
  });
} else {
  baseTest(
    "[conformance:sqlite] skipped",
    { skip: "node:sqlite unavailable (requires Node >= 22.5)" },
    () => {},
  );
}
