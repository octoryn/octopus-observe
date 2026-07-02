**English** | [简体中文](CONTRIBUTING.zh-CN.md)

# Contributing to Observe

Thanks for your interest in contributing. This guide covers the basics.

## Development setup

```bash
npm install
npm test        # node --test
```

Requires Node ≥ 20 for the core; the optional SQLite adapter and its tests need
Node ≥ 22 (they self-skip on older runtimes).

## Before opening a PR

Run the full local gate — CI runs the same checks on Node 20 / 22 / 24:

```bash
npm run typecheck      # tsc --noEmit under full strict flags, must be clean
npm run format:check   # prettier
npm run lint           # eslint
npm test               # node --test
npm run build          # emits dist/
```

- **Type safety:** the project is `strict` (with `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `noUncheckedIndexedAccess`). No `any` escapes unless
  unavoidable and commented.
- **Zero runtime dependencies:** the core and its adapters use Node built-ins
  only (the SQLite adapter uses the built-in `node:sqlite`). Do not add a runtime
  dependency without a very strong reason.
- **Boundaries are the point.** Observe only observes: it must never execute,
  plan, orchestrate, remember user experience, or derive organizational signals.
  A PR that crosses those lines will be declined regardless of quality.
- **Tests:** new behavior needs tests, and they must be hermetic (no network,
  unique temp dirs, cleaned up). Use the injected `Clock` (`fixedClock`) for
  determinism — never wall-clock time in assertions.
- **New storage adapter?** Prove it with the conformance suite:
  `storeConformance("your-backend", { observations: () => fresh() })` from
  `@octopus/observe/conformance`. It is adversarial by design — a partial
  implementation fails.

## Project layout

See [docs/DESIGN.md](docs/DESIGN.md) for the authoritative architecture, the
module map, and the boundaries. Code is written against that spec; update it
first when contracts change.

## Commit / PR

- Keep PRs focused. Describe what changed and why.
- Update `CHANGELOG.md` for user-facing changes.
- Update the relevant docs (`README.md`, `docs/`) when you change the public API
  or CLI surface. Docs are bilingual (English canonical + `*.zh-CN.md` sibling);
  update both when practical.

## Reporting bugs / security issues

File a normal issue for bugs. For security vulnerabilities, follow
[SECURITY.md](SECURITY.md) instead of opening a public issue.
