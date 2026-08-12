# Priorena

Priorena is a single-user, local-only delivery-intelligence application. Its released hierarchy is:

```text
Organization → PM Workspace → Scope → Work Item
```

The target release uses strict version-2 persistence, stable parent IDs, Organization isolation, human-reviewed Evidence and Proposed Changes, and canonical Briefings with deterministic Teams-, Email-, and Confluence-style output. It does not write to Jira, send messages, finalize Briefings, or communicate automatically.

## Supported boundary

Priorena binds only to `127.0.0.1`. It has no authentication and must not be exposed through a LAN address, tunnel, reverse proxy, hosted service, or shared account. Runtime data, Source files, private bootstrap input, logs, backups, and release records stay outside version control.

## Install and verify

```bash
npm install
npm test
npm run build
npm run release:legacy-scan
```

The committed clean seed and all test fixtures are fictional and in English.

## Start the target application

Startup is explicit-path and fail-closed:

```bash
npm start -- \
  --data-file <VERSION_2_DATA_FILE> \
  --source-files-root <PRIVATE_SOURCE_ROOT> \
  --log-file <PRIVATE_LOG_FILE> \
  --port 3100
```

The data file must be a regular non-symlink file with mode `0600`. The Source root must be a private regular directory. The operational log must be outside the repository. Malformed, unsupported, or non-version-2 data is rejected without normalization or overwrite.

Open `http://127.0.0.1:3100/`. The release root redirects to the target UI.

## Release operations

Phase 5 commands are explicit and documented in:

- `docs/release/PHASE_5_CUTOVER_RUNBOOK.md`
- `docs/release/PHASE_5_ROLLBACK_RUNBOOK.md`
- `docs/release/PHASE_5_LEGACY_RETIREMENT_COVERAGE.md`

Backup, restore, cutover, and rollback rehearsals use fictional temporary copies. A live cutover requires checksum, process, port, path, release-commit, and exact acknowledgement interlocks. The tooling never selects a live path implicitly and never deletes a verified backup.

## Security and privacy

Read `SECURITY.md`, `PRIVACY.md`, and `AGENTS.md` before changing code. The repository gates scan staged and committed source, verify JavaScript syntax, run the complete test suite and production build, and audit dependencies. Security testing applies only to the exact reviewed revision and supported local deployment boundary.
