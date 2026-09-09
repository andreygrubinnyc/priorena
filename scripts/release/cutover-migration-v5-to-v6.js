'use strict';

const {
  atomicReplaceFromFile,
  createVerifiedBackup,
  releaseCommitPattern,
  restoreVerifiedBackup,
  writePrivateJson
} = require('./file-operations');
const { assertNoLiveWriter } = require('./process-safety');
const { assertOutsideRepository, parseFlagPairs } = require('./safety');
const { validateMigrationPair } = require('./validate-migration-v5-to-v6');

const MIGRATION_CUTOVER_ACKNOWLEDGEMENT = 'APPROVE_ONE_SCHEMA_V6_MIGRATION_CUTOVER';
const NO_PROCESS_ACKNOWLEDGEMENT = 'NO_RUNNING_PRIORENA_PROCESS';

async function performMigrationCutover(options) {
  const releaseCommit = releaseCommitPattern(options.releaseCommit);
  const migration = await validateMigrationPair({
    sourcePath: options.livePath,
    candidatePath: options.candidatePath,
    expectedSourceRevision: options.expectedLiveChecksum,
    expectedCandidateRevision: options.expectedCandidateChecksum
  });
  const backup = await createVerifiedBackup({
    sourcePath: options.livePath,
    backupDirectory: options.backupDirectory,
    expectedSourceChecksum: migration.sourceRevision,
    timestamp: options.timestamp,
    repositoryRoot: options.repositoryRoot,
    hooks: options.hooks
  });

  let replacement;
  try {
    replacement = await atomicReplaceFromFile({
      livePath: options.livePath,
      replacementPath: options.candidatePath,
      expectedLiveChecksum: migration.sourceRevision,
      expectedReplacementChecksum: migration.candidateRevision,
      hooks: options.hooks
    });
    const recordPath = `${backup.backupPath}.schema-v6-cutover.json`;
    const record = {
      operation: 'schema-v5-to-v6-cutover',
      status: 'replaced-and-verified',
      timestamp: new Date(options.timestamp || Date.now()).toISOString(),
      releaseCommit,
      livePath: replacement.livePath,
      migrationCandidatePath: options.candidatePath,
      backupPath: backup.backupPath,
      oldChecksum: backup.sha256,
      newChecksum: replacement.checksum,
      byteSize: replacement.byteSize,
      mode: replacement.mode,
      exactMigration: migration.exactMigration
    };
    await writePrivateJson(recordPath, record, options.repositoryRoot);
    return Object.freeze({ ...record, recordPath, backupManifestPath: backup.manifestPath });
  } catch (error) {
    const applied = Boolean(error.replacementApplied || replacement);
    if (applied) {
      try {
        const currentChecksum = replacement?.checksum || migration.candidateRevision;
        error.rollbackResult = await restoreVerifiedBackup({
          livePath: options.livePath,
          backupPath: backup.backupPath,
          expectedLiveChecksum: currentChecksum,
          expectedBackupChecksum: backup.sha256,
          timestamp: options.timestamp,
          repositoryRoot: options.repositoryRoot,
          hooks: options.rollbackHooks
        });
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      error.rollbackAttempted = true;
    }
    throw error;
  }
}

async function run(argv = process.argv.slice(2), repositoryRoot = process.cwd()) {
  const allowed = new Set([
    '--live-runtime',
    '--migration-candidate',
    '--expected-live-checksum',
    '--expected-candidate-checksum',
    '--backup-dir',
    '--release-commit',
    '--expected-stopped-pid',
    '--expected-port',
    '--acknowledgement',
    '--no-running-process-ack'
  ]);
  const required = new Set([...allowed].filter(flag => flag !== '--no-running-process-ack'));
  const args = parseFlagPairs(argv, allowed, required);
  if (args['--acknowledgement'] !== MIGRATION_CUTOVER_ACKNOWLEDGEMENT) {
    throw new Error('The exact schema-v6 migration-cutover acknowledgement is required');
  }
  if (args['--expected-stopped-pid'] === 'none'
    && args['--no-running-process-ack'] !== NO_PROCESS_ACKNOWLEDGEMENT) {
    throw new Error('The exact no-running-process acknowledgement is required when no prior PID exists');
  }

  const livePath = assertOutsideRepository(args['--live-runtime'], repositoryRoot, 'Private schema-v5 live runtime');
  const candidatePath = assertOutsideRepository(
    args['--migration-candidate'],
    repositoryRoot,
    'Private schema-v6 migration candidate'
  );
  const backupDirectory = assertOutsideRepository(args['--backup-dir'], repositoryRoot, 'Private backup directory');
  assertNoLiveWriter({
    expectedStoppedPid: args['--expected-stopped-pid'],
    expectedPort: args['--expected-port'],
    livePath
  });
  const result = await performMigrationCutover({
    livePath,
    candidatePath,
    expectedLiveChecksum: args['--expected-live-checksum'],
    expectedCandidateChecksum: args['--expected-candidate-checksum'],
    backupDirectory,
    releaseCommit: args['--release-commit'],
    repositoryRoot
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`Schema-v6 migration cutover failed: ${String(error?.code || error?.name || 'MIGRATION_CUTOVER_ERROR')}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  MIGRATION_CUTOVER_ACKNOWLEDGEMENT,
  NO_PROCESS_ACKNOWLEDGEMENT,
  performMigrationCutover,
  run
};
