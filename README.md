# Priorena

Priorena is a single-user, local-only delivery-intelligence application. Its v1 hierarchy is:

```text
Organization → PM Workspace → Initiative → optional Workstream → Work Item
```

The v1 source release candidate uses strict `schemaVersion: 6` persistence, stable parent IDs, Organization isolation, human-reviewed Evidence and Proposed Changes, canonical Briefings with deterministic Teams-, Email-, and Confluence-style output, and separate Workspace-owned Decisions and Risks. It never writes to Jira, sends messages, or communicates externally. Briefing finalization and Decision or Risk terminal transitions require explicit user action.

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
  --data-file <SCHEMA_V6_DATA_FILE> \
  --source-files-root <PRIVATE_SOURCE_ROOT> \
  --log-file <PRIVATE_LOG_FILE> \
  --port 3100
```

The data file must be a regular non-symlink file with mode `0600`. The Source root must be a private regular directory. The operational log must be outside the repository. Malformed, unsupported, or non-schema-v6 data is rejected without normalization or overwrite. Schema v5 is accepted only by the separate one-way offline migration tool; it is never read or upgraded by the runtime.

Open `http://127.0.0.1:3100/`. The release root redirects to the target UI.

## Release operations

The current source-freeze status and schema-v6 release procedure are documented in:

- `docs/release/V1_ACCEPTANCE_STATUS.md`
- `docs/release/SCHEMA_V6_CONTROLLED_MIGRATION_AND_RELEASE.md`
- `docs/release/STARTUP_REBOOT_RESILIENCE.md`

The older Phase 2–5, schema-v4, and schema-v5 documents are historical implementation records, not current schema-v6 operating instructions. Backup, restore, migration-cutover, and rollback rehearsals use fictional temporary copies. A live migration requires checksum, process, port, path, release-commit, exact-candidate, and acknowledgement interlocks. The tooling never selects a live path implicitly and never deletes a verified backup.

## Security and privacy

Read `SECURITY.md`, `PRIVACY.md`, and `AGENTS.md` before changing code. The repository gates scan staged and committed source, verify JavaScript syntax, run the complete test suite and production build, and audit dependencies. Security testing applies only to the exact reviewed revision and supported local deployment boundary.
