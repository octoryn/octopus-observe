**English** | [简体中文](CHANGELOG.zh-CN.md)

# Changelog

All notable changes to Observe are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
semantic versioning once it reaches 1.0. Every release was hardened by an
independent adversarial ("red-team") review before landing.

## [0.7.0] — 2026-07-02

### Changed
- **License is now AGPL-3.0-or-later** (was MIT), aligning with the Octoryn
  ecosystem. If you need a permissive license for embedding, raise it before
  depending on this version.

### Added
- **Open-source release packaging** to the ecosystem standard: full
  `package.json` metadata (author, repository, homepage, bugs, keywords),
  bilingual docs (English canonical + `*.zh-CN.md` siblings with a language
  switcher) for the README, CHANGELOG, and design doc, README badges, and
  `SECURITY.md` / `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md`.
- **Lint + format tooling:** ESLint (flat config) and Prettier, with
  `.editorconfig`, `.prettierrc.json`, `.nvmrc`, and `format` / `format:check` /
  `lint` scripts. CI now runs format-check and lint alongside typecheck, test,
  and build across Node 20 / 22 / 24. A `coverage` script uses Node's built-in
  test coverage.

## [0.6.0] — 2026-07-02

### Added
- **Adversarial boundary fuzzing.** A property-based suite feeds thousands of
  hostile/random inputs (malformed envelopes, non-finite numbers, `undefined`,
  hostile keys like `__proto__`, deep nesting, unicode) — keyed and unkeyed —
  through `ingest` and asserts the core promises of a trusted entry layer:
  `ingest` never throws (every outcome is a returned result), every accepted
  observation self-verifies (including after a JSON round-trip), re-ingest is
  idempotent, the audit hash chain stays valid over the entire hostile run, and
  there is no prototype pollution. Runs from a fixed seed so any failure is
  reproducible.

### Changed
- Package `version` aligned to the changelog (was `0.1.0`) for the first
  publishable release.

## [0.5.0] — 2026-07-02

### Added
- **Observation content integrity.** Every observation now carries an
  `integrity` hash over all of its content, so a stored observation that was
  altered after the fact (e.g. an attribute edited directly in the database) is
  detectable with `verifyObservation(obs, secret?)` — independently of the
  deterministic `id`. Optional keyed HMAC (`integritySecret` on `Observe` /
  `renormalize`) upgrades it from tamper-evidence to tamper-resistance, matching
  the audit chain's model. This makes the observations themselves self-verifying,
  completing the trust story (the audit trail *about* them was already
  tamper-evident). `computeObservationHash` / `verifyObservation` are exported;
  their encoding is a frozen wire contract.

## [0.4.0] — 2026-07-02

### Added
- **Storage conformance suite** (`@octopus/observe/conformance`): a reusable,
  adversarial contract test battery for `ObservationStore` / `AuditStore` /
  `RawEventArchive`, so any third-party adapter can prove parity rather than
  being trusted on faith. Run against the in-memory and SQLite backends in-repo.

### Changed
- The in-memory audit store now enforces id-uniqueness (matching SQLite's
  `UNIQUE(id)`), so append-only semantics are identical across backends.

### Notes
- The conformance suite was hardened after its own multi-agent review found 12
  coverage gaps (single-filter-only tests, no field-fidelity deep-equality, no
  empty-store or `receivedAt` checks, …). It now round-trips full records,
  exercises ANDed filters, empty-store reads, and append-only value survival —
  verified to *fail* deliberately-broken adapters, not just pass the good ones.

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
