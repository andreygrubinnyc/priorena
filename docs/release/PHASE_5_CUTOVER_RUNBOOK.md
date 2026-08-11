# Phase 5 controlled cutover runbook

This runbook is repository-safe. Replace every placeholder with values from the private release-readiness manifest. Never copy those values into Git, issues, pull-request comments, or public logs.

## Gates

Do not use this runbook until:

1. the Phase 5 pull request is merged normally and merged `main` is fully revalidated;
2. the private staged seed is generated, checksum-verified, and smoke-tested outside the repository;
3. the rollback application checkout is prepared and smoke-tested at `316759d9073a004e8478d027d93df268b3827fdb`;
4. the live fingerprint still matches the private readiness manifest;
5. the exact Priorena process/port evidence, backup directory, disk space, commands, and abort conditions are recorded;
6. the user supplies the exact clean-cutover authorization required by the controlled workflow.

This is one controlled attempt. It authorizes no migration, selective restoration, backup deletion, or second automatic cutover.

Before PR readiness, `npm run release:rollback-rehearsal` separately extracts the exact rollback revision with `git archive` into a disposable temporary directory, verifies its server object, installs its committed lockfile, and starts and smokes that application against restored fictional bytes. This rehearsal does not prepare the later operational detached checkout and never uses the live runtime.

## Preflight

- Confirm clean local `main` equals `origin/main` at the manifest release commit.
- Recompute staged-seed and live checksums and compare them byte-for-byte with the manifest.
- Confirm every private path is explicit and outside Git where required.
- Confirm the backup directory is a private non-symlink directory with sufficient free space.
- Confirm the rollback checkout is present, clean, and still starts against a temporary legacy-shaped copy.
- Confirm no unexpected process owns the expected port.
- Abort on any mismatch before stopping or writing.

## Identify and stop Priorena

Inspect the exact process:

```bash
npm run release:process -- inspect \
  --pid <PID> \
  --expected-cwd <RELEASE_CHECKOUT> \
  --expected-command <TARGET_START_COMMAND_FRAGMENT> \
  --expected-port <PORT>
```

Stop only the validated PID:

```bash
npm run release:process -- stop \
  --pid <PID> \
  --expected-cwd <RELEASE_CHECKOUT> \
  --expected-command <TARGET_START_COMMAND_FRAGMENT> \
  --expected-port <PORT> \
  --acknowledgement STOP_VALIDATED_PRIORENA_PROCESS
```

The command sends `SIGTERM` only after all evidence matches. It never escalates to a broad or stronger signal. If the exact process cannot be identified or does not stop, abort and request direction.

Recompute the live checksum after stop. Abort if it changed.

## Backup and atomic replacement

The live cutover command performs the timestamped verified backup and atomic replacement together:

```bash
npm run release:cutover-live -- \
  --live-runtime <LIVE_RUNTIME_FILE> \
  --staged-seed <STAGED_VERSION_2_SEED> \
  --expected-live-checksum <LIVE_SHA256> \
  --expected-seed-checksum <SEED_SHA256> \
  --backup-dir <PRIVATE_BACKUP_DIRECTORY> \
  --release-commit <FULL_RELEASE_COMMIT> \
  --expected-stopped-pid <STOPPED_PID_OR_none> \
  --expected-port <PORT> \
  --acknowledgement APPROVE_ONE_LIVE_CUTOVER
```

When no Priorena process was running, also supply:

```text
--no-running-process-ack NO_RUNNING_PRIORENA_PROCESS
```

The command fails unless the expected PID is absent, the live file has no holder, and the expected port has no listener. It validates the seed, creates and verifies a unique backup and private manifest, performs same-directory replacement, and verifies the result. A failure after rename causes one verified restore attempt.

## Start and accept

Start the exact merged release with explicit private paths and loopback host:

```bash
npm start -- \
  --data-file <LIVE_RUNTIME_FILE> \
  --source-files-root <PRIVATE_SOURCE_ROOT> \
  --log-file <PRIVATE_RELEASE_LOG> \
  --port <PORT>
```

Verify PID, command, working directory, host, and port. Run read-only post-cutover checks for the approved private bootstrap structure, every target navigation surface, deterministic output availability, safe headers, rate/method controls, Organization isolation, Source-file containment, no legacy route, no external action, test/build/static-scan/audit gates, runtime mode/checksum, and backup checksum.

Do not create records merely to smoke mutation workflows. Those were validated against staged and temporary files.

Accept only if every required check passes. Retain the backup unchanged for at least 30 days after release acceptance, retain the rollback checkout during acceptance, and write the private success record outside Git.

On any required failure, follow `docs/release/PHASE_5_ROLLBACK_RUNBOOK.md` once and stop.
