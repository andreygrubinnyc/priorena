# Schema-v5 Initiative and Workstream cutover

**Status:** Current controlled-cutover runbook
**Date:** 2026-08-14

## Authorization boundary

Merging the schema-v5 source pull request does not authorize a live runtime reset. Do not modify, migrate, normalize, replace, stop, start, or restart the live runtime during source review and merge readiness.

The live reset is eligible only after the source pull request is merged and the separate readiness procedure is completed. The reset requires the exact authorization phrase defined by the controlling release authority. A source merge alone is insufficient.

## Release shape

The release accepts only strict `schemaVersion: 5` data. Schema v4 fails closed. The staged seed must be generated outside Git and outside the live runtime location from the merged release candidate. It contains one generic Organization, one generic Workspace, four generic Initiatives, and no Workstreams or operational records.

The release tooling must report and verify the staged seed checksum, byte size, mode `0600`, IDs, names, schema version, and exact counts before any reset can be authorized.

## Pre-reset evidence

From an exact detached checkout of merged `origin/main`:

1. Install locked dependencies.
2. Run the full test, build, commit, push, dependency-audit, security, and release-rehearsal gates.
3. Generate the generic schema-v5 seed in a private temporary location.
4. Validate and smoke the staged seed on `127.0.0.1` without touching the live runtime.
5. Reconfirm the live runtime is still the authorized empty generic schema-v4 fingerprint and counts.
6. Record that source merge authorization and runtime-reset authorization remain separate.

Any live fingerprint mismatch, failed audit, unverified process state, or unavailable dependency check blocks reset readiness.

## Authorized reset sequence

Execute this section only after the exact separate runtime-reset authorization:

1. Revalidate the merged commit and staged seed.
2. Identify and validate only the exact Priorena process, working directory, loopback port, and live file.
3. Stop only that validated process; do not use broad process termination.
4. Create a timestamped byte-for-byte backup outside the repository and verify its SHA-256 checksum.
5. Verify that the primary checkout is on `main`, clean, and still at the recorded pre-release commit. Fetch `origin`, confirm `origin/main` is the exact authorized merged commit, and update primary `main` by fast-forward-only while the validated process remains stopped.
6. Do not merge, rebase, reset, force-push, or discard local changes during the primary update. If the primary update fails, leave the live runtime unchanged, restart the old release from its unchanged checkout, verify its read-only smoke, and stop the reset procedure.
7. Revalidate that the primary checkout is clean at the exact authorized merged commit.
8. Atomically replace the stopped live file with the already validated schema-v5 seed.
9. Start the exact merged application on `127.0.0.1` and run API and browser acceptance checks.
10. If acceptance fails, stop the validated new process, restore the verified schema-v4 backup exactly once, start the pinned schema-v4 rollback application, and verify it read-only.

Never attempt a second automatic schema-v5 reset after rollback.

## Acceptance

Acceptance verifies strict schema v5, the exact generic hierarchy, empty operational collections, current Initiative and Workstream UI/API terminology, local Jira mapping management, search, Today, Briefings, export, backup, and scoped AI context. It also verifies loopback-only binding, no automatic Jira or communication action, no telemetry, and no private values in repository artifacts.

Retain the staged schema-v5 seed and verified schema-v4 backup as directed by the controlling authority. Historical backups are not migration sources and are never normalized into schema v5.
