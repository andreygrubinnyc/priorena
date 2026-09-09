# Schema-v6 controlled migration and release

**Status:** Current schema-v5 to schema-v6 operating runbook; no live action is authorized by this document

**Application boundary:** single-user, local-only, loopback `127.0.0.1:3100`

## Authority and privacy boundary

Source implementation, source publication, exact-revision merge, private-data
inspection, migration, runtime/process operation, LaunchAgent operation, and
release acceptance are separate boundaries. Resolve private values only in the
approved local operating context. Never place a private path, checksum, process
identity, Source value, plist, or operational log in Git, issues, pull requests,
screenshots, or public handoffs.

This runbook permits only a whole-document schema-v5 to schema-v6 migration.
It does not permit selective reconstruction, normalization, reconciliation,
in-place migration, a compatibility reader, dual writes, a second automatic
cutover, or deletion of the verified backup.

## Private placeholders

Every angle-bracket token is mandatory and has no default:

- `<AUTHORIZED_RELEASE_COMMIT>`: exact 40-character merged and revalidated
  source revision;
- `<SCHEMA_V5_RUNTIME>`: exact regular non-symlink mode-`0600` live data file;
- `<SCHEMA_V6_CANDIDATE>`: new, exclusive, same-source migration candidate;
- `<SOURCE_V5_SHA256>` and `<CANDIDATE_V6_SHA256>`: exact lowercase checksums;
- `<BACKUP_DIRECTORY>`: private existing non-symlink directory with sufficient
  space, outside the repository;
- `<RELEASE_ROOT>` and `<ROLLBACK_RELEASE_ROOT>`: exact validated source
  checkouts;
- `<PRIVATE_SOURCE_ROOT>` and `<PRIVATE_OPERATIONAL_LOG>`: exact approved private
  runtime paths;
- `<EXACT_PID>`: exact previously validated Priorena PID, or `none` only when
  absence is independently established;
- `<EXPECTED_COMMAND_FRAGMENT>`: exact `target-server/start.js` command
  fragment for the approved release; and
- `<STARTUP_CONFIGURATION>`: the complete explicit configuration required by
  `STARTUP_REBOOT_RESILIENCE.md` when a managed LaunchAgent exists.

Do not use shell substitutions, globs, mutable names, inferred paths, broad
process searches, or values copied from logs.

## Pre-migration gates

1. Require a clean detached release checkout at
   `<AUTHORIZED_RELEASE_COMMIT>` and a prepared, independently validated exact
   rollback checkout.
2. Run `npm ci`, `npm run verify:commit`, and `npm run verify:push` at the release
   commit. Every required GitHub check must also be successful.
3. Inspect the exact managed startup definition when present. Resolve any
   service-without-definition, mismatched definition, process, cwd, executable,
   listener, file-holder, or port state before continuing.
4. Validate the schema-v5 runtime boundary and record its private checksum,
   mode, size, and schema category without recording data values.
5. Establish a bounded no-user-write window. Any checksum change invalidates
   the candidate and the authority evidence.
6. Rehearse backup, migration-cutover, rollback, exact old-release startup, and
   read-only smoke using fictional temporary copies.

## Exclusive migration candidate

Create the candidate once at a destination that does not exist:

```text
npm run schema:migrate-v5-to-v6 -- \
  --source <SCHEMA_V5_RUNTIME> \
  --destination <SCHEMA_V6_CANDIDATE>
```

Record the returned source and candidate revisions privately. Revalidate the
pair before cutover:

```text
npm run release:validate-migration -- \
  --source <SCHEMA_V5_RUNTIME> \
  --candidate <SCHEMA_V6_CANDIDATE> \
  --expected-source-checksum <SOURCE_V5_SHA256> \
  --expected-candidate-checksum <CANDIDATE_V6_SHA256>
```

Validation must prove that the candidate is strict schema v6, is the exact
canonical migration of the unchanged schema-v5 source, preserves every prior
value and ordering, and adds only empty `decisions[]` and `risks[]`.

Run `npm run release:smoke` against the candidate with an isolated private log
and the exact private Source root. This smoke binds a temporary loopback port,
performs no write, closes its own server, and must leave both checksums
unchanged.

## Controlled live migration

Immediately before mutation, revalidate the exact runtime process, working
directory, command, executable, loopback listener, data-file holder, and port.
Stop only that validated process. If an exact managed LaunchAgent owns it,
coordinate the separately authorized exact agent operation so it cannot restart
during file replacement. Confirm the exact PID is absent, the file has no open
holder, port `3100` is unused, and the schema-v5 checksum remains authorized.

Perform one acknowledged migration cutover:

```text
npm run release:migrate-cutover-live -- \
  --live-runtime <SCHEMA_V5_RUNTIME> \
  --migration-candidate <SCHEMA_V6_CANDIDATE> \
  --expected-live-checksum <SOURCE_V5_SHA256> \
  --expected-candidate-checksum <CANDIDATE_V6_SHA256> \
  --backup-dir <BACKUP_DIRECTORY> \
  --release-commit <AUTHORIZED_RELEASE_COMMIT> \
  --expected-stopped-pid <EXACT_PID> \
  --expected-port 3100 \
  --acknowledgement APPROVE_ONE_SCHEMA_V6_MIGRATION_CUTOVER
```

When no Priorena process existed before cutover, use `none` only with the
additional exact pair:

```text
--no-running-process-ack NO_RUNNING_PRIORENA_PROCESS
```

The command revalidates the exact migration pair before creating a timestamped
byte-for-byte schema-v5 backup. It verifies and records the backup, atomically
installs only the exact candidate, syncs the containing directory, and records
the exact release revision and checksums privately. A failure after replacement
attempts one checksum-verified automatic data rollback. Any unverified rollback
is a hard stop.

## Activation and acceptance

Activate only `<AUTHORIZED_RELEASE_COMMIT>` using the previously approved
runtime model. If a managed LaunchAgent exists, follow the exact replacement or
registration-recovery path in `STARTUP_REBOOT_RESILIENCE.md`; never improvise a
`launchctl`, signal, or retry. Otherwise start the exact release directly with
the explicit schema-v6 data, Source-root, log, and port arguments.

Before any user write, require all of the following:

1. exact service and process identity, when applicable;
2. only `127.0.0.1:3100` listening;
3. root redirect, target shell/assets, safe headers, bounded Organization list,
   Portfolio, Today, Decisions, and Risks read behavior;
4. strict schema-v6 data checksum and mode unchanged by startup and smoke;
5. no external connection, telemetry, repository update, Source transmission,
   automatic Jira action, communication, Decision transition, or Risk
   transition; and
6. private acceptance record containing only the approved operational evidence.

The pending startup GET acceptance is part of this single post-cutover sequence;
it must not be repeated after an inconclusive or failed result without new exact
authority.

## Rollback and retention

Any failed post-cutover startup or read-only acceptance requires stopping only
the exact validated new runtime, verifying the retained backup checksum,
restoring it exactly once with `npm run release:restore`, activating the exact
rollback checkout, and repeating only the authorized read-only old-release
acceptance. Do not retry the schema-v6 cutover automatically.

After successful release acceptance, retain the pre-migration schema-v5 backup,
backup manifest, cutover record, and checksum evidence for 30 days. Their later
disposal is a separate exact private-data retention action.
