**English** | [简体中文](SECURITY.zh-CN.md)

# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities.

Report privately via GitHub Security Advisories ("Report a vulnerability" on the
repository's Security tab) or email **security@octopusos.ai**. Include a
description, reproduction steps, and impact. We aim to acknowledge within a few
business days.

## Scope notes

Observe is a **trusted-fact entry layer**: it turns untrusted external events
into canonical, immutable observations. A few areas are security-relevant by
design:

- **Untrusted boundary.** `ingest` accepts arbitrary input and must never crash
  on hostile input — validation is the only stage that rejects, and every
  outcome is a returned result (`accepted` / `duplicate` / `rejected` /
  `skipped`), never an exception. This is exercised by an adversarial fuzz suite
  (malformed envelopes, non-finite numbers, hostile keys like `__proto__`, deep
  nesting, unicode). Report any input that throws, crashes, or pollutes a
  prototype.
- **Tamper-evidence and secrets.** The audit trail is a hash chain and each
  observation carries an `integrity` hash. **Unkeyed, these are tamper-*evident*,
  not tamper-*proof*** — the hash is public, so an adversary with write access to
  the store can fabricate an internally-consistent record. For real resistance,
  supply an `auditSecret` / `integritySecret` (keyed HMAC) and verify with the
  same key; protect and rotate that key like any signing secret. A key rotation
  re-bases future hashes — it does not retroactively re-verify old records.
- **Raw-event archive is a plaintext surface.** The optional `RawEventArchive`
  tapes raw inputs verbatim and may contain PII/PHI or secrets. Apply
  encryption-at-rest, access control, and a retention window (`pruneBefore`) per
  your compliance needs. It is off by default.
- **No network egress.** Observe performs no outbound I/O and has zero runtime
  dependencies. Getting events in, and shipping audit/observations out, is the
  operator's (and connectors') responsibility — as is protecting stored data.

## Supported versions

This project is pre-1.0; only the latest version receives fixes.
