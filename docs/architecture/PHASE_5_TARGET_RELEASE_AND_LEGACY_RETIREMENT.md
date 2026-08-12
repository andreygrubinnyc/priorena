# Phase 5 target release and legacy retirement

**Status:** source-controlled release candidate

**Application boundary:** single-user, local-only, `127.0.0.1`

**Hierarchy:** Organization → PM Workspace → Scope → Work Item

**Persistence:** strict `schemaVersion: 2`

## Release application

`target-server/start.js` is the production launcher and `target-server/app.js` is the only release application. Startup requires explicit data-file, Source-root, and private-log paths. Before listening, it requires private file/directory modes and validates the complete version-2 document. Malformed JSON, an unsupported version, a legacy root, a symlink endpoint, or permissive modes fail without normalizing or writing the supplied file.

The launcher binds only to `127.0.0.1`. The release root redirects to `/target/`; only allowlisted target assets and `/api/v2` routes are mounted. Every route receives loopback Host validation, same-origin and Fetch Metadata protection for mutation, bounded body handling, safe headers, an explicit method allowlist, and bounded in-memory local throttling.

Operational logs use a caller-selected file outside Git, mode `0600`, a one-MiB bound, allowlisted fields, hashed path identities, and no record payloads, Source text, Evidence excerpts, manual input, secrets, or tokens. Repository-exclusion checks canonicalize the repository and the nearest existing output ancestor before any directory or file creation, so an outside-looking symlink cannot redirect logs or other private artifacts into the working tree.

## Frozen target contract

Version 2 remains frozen for this release. The application contains no data migration, legacy parser, compatibility fallback, dual read/write, name-based identity, global ordinary export, public all-Organization backup, Jira writer, message sender, provider call, automatic Finalize, or automatic communication path.

Ordinary export and backup remain Organization-scoped. AI-context assembly is a pure bounded local service for one validated Workspace; the release UI exposes no provider execution seam.

The only current import JSON version is `target-v3`. Input produces separate proposals and never infers Scope identity from display text.

## Legacy retirement

The former root server, combined Project/Epic domain, old feed adapter, bulk module, parallel Briefing implementation, old root UI, demo-session implementation, fixtures, and superseded tests are removed after parity proof. The exact replacement map and deleted-test accounting are in `docs/release/PHASE_5_LEGACY_RETIREMENT_COVERAGE.md`.

The release regression scan covers active model, server, UI, tooling, test, and fixture files. Narrow exceptions exist only where the strict target validator or its negative tests must name a rejected legacy field/value, and where temporary rehearsal data intentionally represents the rollback source. Architecture, audit, and release history are documentation-only exceptions.

## Private bootstrap separation

`scripts/release/bootstrap-seed.js` accepts one explicit private input file and writes one explicit staged seed. Both must be outside the repository; the input must use mode `0600`. The input has exact Organization, Workspace, and Scope fields only. IDs and serialized output are deterministic, the complete target schema is validated, and all operational/history collections are empty.

The tool prints only checksum, size, mode, and collection counts. It contains no customer values, default customer identity, private path, or live destination. It never writes to the live runtime.

## Release operations

Release file operations use Node built-ins and existing dependencies only. They require explicit canonical paths, `0600` regular non-symlink files, bounded sizes, expected SHA-256 values, sufficient free space, and destinations outside Git. Backups use a unique timestamp, copy to a private temporary file, synchronize, verify bytes and checksum, hard-link to a non-overwriting final name, synchronize the directory, and write a private manifest. Verified backups are never deleted by the operational tooling.

Replacement and restore write a private same-directory temporary file, synchronize it, recheck the live checksum immediately before rename, atomically rename, synchronize the parent directory, and verify final bytes, checksum, and mode. A post-rename tool failure triggers one checksum-verified rollback attempt and never a second cutover.

Process control requires exact PID, command fragment, working directory, executable/command output, and listening-port evidence. Stopped-writer guards require the expected PID to be absent plus no holder of the live file and no listener on the expected port. No broad process-kill command exists.

The rollback rehearsal uses `git archive` to extract the exact known pre-Phase-5 revision into a disposable non-worktree directory. It verifies the extracted server Git object, installs only that revision's committed lockfile dependencies, starts the rollback application on `127.0.0.1` against restored fictional bytes, verifies PID/command/cwd/port evidence, runs read-only rollback smoke, confirms the runtime checksum is unchanged, and stops the exact child. The archive copy is only rehearsal material; the detached operational rollback checkout remains a post-merge authorization step.

## Authorization gates

Source publication does not merge the pull request. Merge requires the exact authorization defined by the controlled Phase 5 workflow. Private seed generation, rollback-checkout preparation, and release-readiness packaging occur only after that merge authorization.

The live runtime remains untouched until the later exact clean-cutover authorization. The final backup is not created before that authorization. Any fingerprint change, unsafe process identity, insufficient disk space, failed check, or unexpected repository state aborts before replacement.

## Non-blocking backlog

- Multi-process storage locking remains outside the supported single-user architecture.
- Hosted or multi-user operation requires a separate threat model and implementation.
- Optional target-safe AI drafting would require a separately approved bounded execution seam.
