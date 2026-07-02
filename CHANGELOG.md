# Changelog

All notable changes to Observe are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
semantic versioning once it reaches 1.0. Every release was hardened by an
independent adversarial ("red-team") review before landing.

## [0.3.0] — 2026-07-02

### Added
- **Retention / erasure** as a first-class API: `RawEventArchive.pruneBefore(sequence)`
  removes the oldest prefix of the tape and returns how many events were pruned.
  It is deliberately **prefix-only** (no predicate/arbitrary delete) so the
  tape's audit semantics are preserved — the remainder stays an ordered suffix,
  `fromSequence` bookmarks past the cut stay valid, and sequences are never
  reused. This gives a plaintext archive that may hold PII/PHI a clean retention
  path. Implemented for both the in-memory and SQLite archives.
- `assertValidPruneSequence` guard, exported alongside the other query guards.
- **CI** (`.github/workflows/ci.yml`) across Node 20/22/24, running typecheck,
  tests, and build.

### Changed
- The SQLite adapter now **lazily loads** `node:sqlite` (type-only import at
  module scope). Importing `@octopus/observe/sqlite` on a runtime without it
  (Node < 22.5) no longer throws at load — the error surfaces only when a store
  is created — so the full test suite runs on Node 20 with the SQLite suite
  auto-skipping.

## [0.2.0] — 2026-07-02

### Added
- **Optional raw-event archive** (`RawEventArchive` port) — a faithful,
  append-only tape of raw inputs, used as a backfill source. Kept strictly off
  the observation line: attaching one never changes the observation produced
  (byte-identical), it holds raw input only, and a failed archive write is an
  infrastructure error that stores nothing downstream. In-memory and SQLite
  implementations; `createSqliteStores` returns one.

### Fixed (red-team)
- SQLite archive sequence uses `AUTOINCREMENT` (never reused, safe under
  pruning) instead of a `COUNT(*)`-derived key that could wedge or reuse.
- `replay()` validates its bounds (`assertValidReplayQuery`) so backends no
  longer diverge on malformed `limit` / `fromSequence`.

## [0.1.0] — 2026-07-02

### Added
- **SQLite persistence adapter** (`@octopus/observe/sqlite`) on Node's built-in
  `node:sqlite` — zero npm dependencies, isolated from the core entry.
- **Strict RFC 3339 timestamps** with a mandatory timezone offset by default
  (region-independent canonical `at`); `"lenient"` opt-out.
- **Backfill primitive** `renormalize()` — pure, dry-runnable re-normalization
  that yields new, version-scoped, coexisting observations.
- **Tamper-evident audit hash chain** (`verifyAuditChain`), with an optional
  keyed-HMAC mode (`auditSecret`) for tamper-resistance, and `exportAuditNdjson`
  for SIEM ingestion.

### Fixed (red-team)
- Strict timestamp parser validates field ranges and computes the instant
  directly — no `Date.parse` roll-over (e.g. Feb 30 is rejected, not shifted).
- Injective observation-id hashing; append-only enforcement on the audit store.

## [0.0.0] — 2026-07-02 (v0)

### Added
- Core intake and normalization pipeline: raw event → validation →
  normalization → attribution → deduplication → canonical observation → storage
  → read API.
- Immutable, deep-frozen observations with deterministic ids (idempotent
  re-ingest); validation as the only rejecting stage; complete per-event audit
  trail; pluggable storage with an in-memory default; example validators, a CLI,
  and the design doc.
