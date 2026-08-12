# Phase 5 rollback runbook

Rollback is a one-attempt response to a failed authorized cutover. It restores the complete byte-for-byte pre-cutover runtime. It never migrates, reconciles, or selectively restores records.

## Preconditions

- Stop only the exact target PID after revalidating PID, command, working directory, and port evidence.
- Confirm the verified backup path, SHA-256, byte count, and mode match the private release manifest.
- Confirm the current live checksum is the value observed after the failed replacement/start/smoke step.
- Confirm the rollback application checkout is still the prepared detached copy of `316759d9073a004e8478d027d93df268b3827fdb`.
- Confirm `ps` and `lsof` are available for fail-closed process, file-holder, and loopback-port validation.
- Preserve the staged seed, backup, cutover record, and logs.

Abort and request direction if the backup checksum differs, the target process cannot be safely identified, or an unrelated process owns the expected port.

## Restore

After the exact target process is stopped and the port is closed:

```bash
npm run release:restore -- \
  --live-runtime <LIVE_RUNTIME_FILE> \
  --backup <VERIFIED_BACKUP_FILE> \
  --expected-live-checksum <CURRENT_LIVE_SHA256> \
  --expected-backup-checksum <BACKUP_SHA256> \
  --expected-stopped-pid <STOPPED_PID_OR_none> \
  --expected-port <PORT> \
  --acknowledgement RESTORE_VERIFIED_BACKUP
```

When no target process reached startup, also supply:

```text
--no-running-process-ack NO_RUNNING_PRIORENA_PROCESS
```

The restore command verifies that no process holds the live file or port, checks the backup without modifying it, writes a private same-directory temporary file, synchronizes it, atomically renames it over the live path, synchronizes the parent directory, verifies the restored checksum/size/mode, rechecks the unchanged backup, and writes a private rollback record outside Git.

## Restart the rollback application

Start the exact prepared rollback checkout with its recorded explicit private runtime, upload/Source, recovery, log, host, and port configuration. Do not start it from the Phase 5 checkout. Verify its PID, command, working directory, executable, host, and port.

Run rollback smoke against the restored runtime and confirm the live checksum still equals the original pre-cutover value. Record the triggering failure, target stop result, backup verification, restore result, rollback process evidence, and smoke outcome in the private rollback record.

Do not attempt another automatic cutover. Do not delete or alter the verified backup or staged seed. Preserve the backup for the required retention period and stop for product-owner direction.
