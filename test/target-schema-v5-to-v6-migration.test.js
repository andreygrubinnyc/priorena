'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createCleanSeed } = require('../target-model/clean-seed');
const {
  SOURCE_ROOT_COLLECTIONS,
  TargetMigrationError,
  legacyProjection,
  migrateTargetDataV5ToV6
} = require('../target-model/migrate-v5-to-v6');
const { readTargetData, serializeTargetData, validateTargetTransition } = require('../target-model/persistence');
const { ROOT_COLLECTIONS, TARGET_SCHEMA_VERSION, TargetValidationError, validateTargetData } = require('../target-model/schema');
const {
  SchemaMigrationFileError,
  migrateFile,
  revisionForBytes,
  run: runFileMigration,
  writeExclusiveCandidate
} = require('../scripts/release/migrate-schema-v5-to-v6');
const {
  performMigrationCutover
} = require('../scripts/release/cutover-migration-v5-to-v6');
const {
  run: runMigrationValidation,
  validateMigrationPair
} = require('../scripts/release/validate-migration-v5-to-v6');
const { createMultiOrganizationFixture } = require('../test-support/target-v6-fixtures');

function schemaV5Document(document = createMultiOrganizationFixture()) {
  const source = { schemaVersion: 5 };
  for (const collection of SOURCE_ROOT_COLLECTIONS) source[collection] = structuredClone(document[collection]);
  source.userPreferences = structuredClone(document.userPreferences);
  source.globalTechnicalSettings = structuredClone(document.globalTechnicalSettings);
  return source;
}

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'priorena-schema-v6-migration-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writePrivateFile(filePath, bytes) {
  await fs.writeFile(filePath, bytes, { mode: 0o600 });
}

test('pure v5-to-v6 migration adds only empty Decision and Risk collections', () => {
  const source = schemaV5Document();
  const before = structuredClone(source);
  const migrated = migrateTargetDataV5ToV6(source);

  assert.equal(migrated.schemaVersion, TARGET_SCHEMA_VERSION);
  assert.deepEqual(migrated.decisions, []);
  assert.deepEqual(migrated.risks, []);
  assert.deepEqual(legacyProjection(migrated), before);
  assert.deepEqual(source, before);
  assert.deepEqual(Object.keys(migrated), [
    'schemaVersion',
    ...ROOT_COLLECTIONS,
    'userPreferences',
    'globalTechnicalSettings'
  ]);
  assert.equal(validateTargetData(migrated), migrated);
});

test('migration rejects wrong versions, missing fields, new collections, and invalid legacy records', () => {
  const current = schemaV5Document();
  current.schemaVersion = 6;
  assert.throws(() => migrateTargetDataV5ToV6(current), error => (
    error instanceof TargetMigrationError && error.code === 'INVALID_TARGET_MIGRATION_SOURCE'
  ));

  const missing = schemaV5Document();
  delete missing.auditEvents;
  assert.throws(() => migrateTargetDataV5ToV6(missing), /auditEvents.*required/);

  const futureField = schemaV5Document();
  futureField.decisions = [];
  assert.throws(() => migrateTargetDataV5ToV6(futureField), /unsupported field "decisions"/);

  const invalidLegacyRecord = schemaV5Document();
  invalidLegacyRecord.workItems[0].workspaceId = 'workspace-beta-shared';
  assert.throws(() => migrateTargetDataV5ToV6(invalidLegacyRecord), TargetValidationError);
});

test('file migration writes one verified 0600 candidate and preserves source bytes exactly', async t => {
  const directory = await temporaryDirectory(t);
  const sourcePath = path.join(directory, 'source-v5.json');
  const destinationPath = path.join(directory, 'candidate-v6.json');
  const sourceBytes = Buffer.from(`${JSON.stringify(schemaV5Document(), null, 2)}\n`, 'utf8');
  await writePrivateFile(sourcePath, sourceBytes);

  const result = await migrateFile(sourcePath, destinationPath);
  assert.equal(result.fromSchemaVersion, 5);
  assert.equal(result.toSchemaVersion, 6);
  assert.equal(result.existingCollectionsPreserved, true);
  assert.deepEqual(result.addedCollections, { decisions: 0, risks: 0 });
  assert.deepEqual(await fs.readFile(sourcePath), sourceBytes);

  const destinationStats = await fs.lstat(destinationPath);
  assert.equal(destinationStats.isFile(), true);
  assert.equal(destinationStats.isSymbolicLink(), false);
  assert.equal(destinationStats.mode & 0o777, 0o600);
  const migrated = await readTargetData(destinationPath);
  assert.deepEqual(legacyProjection(migrated), schemaV5Document());
  assert.deepEqual(migrated.decisions, []);
  assert.deepEqual(migrated.risks, []);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['candidate-v6.json', 'source-v5.json']);
});

test('file migration refuses in-place operation and never overwrites a destination', async t => {
  const directory = await temporaryDirectory(t);
  const sourcePath = path.join(directory, 'source-v5.json');
  const destinationPath = path.join(directory, 'candidate-v6.json');
  const sourceBytes = Buffer.from(`${JSON.stringify(schemaV5Document())}\n`, 'utf8');
  const destinationBytes = Buffer.from('existing fictional candidate\n', 'utf8');
  await writePrivateFile(sourcePath, sourceBytes);
  await writePrivateFile(destinationPath, destinationBytes);

  await assert.rejects(migrateFile(sourcePath, sourcePath), error => (
    error instanceof SchemaMigrationFileError && error.code === 'MIGRATION_IN_PLACE_FORBIDDEN'
  ));
  await assert.rejects(migrateFile(sourcePath, destinationPath), error => (
    error instanceof SchemaMigrationFileError && error.code === 'MIGRATION_DESTINATION_EXISTS'
  ));
  assert.deepEqual(await fs.readFile(sourcePath), sourceBytes);
  assert.deepEqual(await fs.readFile(destinationPath), destinationBytes);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['candidate-v6.json', 'source-v5.json']);
});

test('file migration rejects invalid, permissive, and symlinked sources without a candidate', async t => {
  const directory = await temporaryDirectory(t);
  const destinationPath = path.join(directory, 'candidate-v6.json');

  const invalidPath = path.join(directory, 'invalid-v5.json');
  await writePrivateFile(invalidPath, Buffer.from('{ invalid'));
  await assert.rejects(migrateFile(invalidPath, destinationPath), error => error.code === 'INVALID_MIGRATION_SOURCE_JSON');

  const permissivePath = path.join(directory, 'permissive-v5.json');
  await writePrivateFile(permissivePath, Buffer.from(JSON.stringify(schemaV5Document())));
  await fs.chmod(permissivePath, 0o644);
  await assert.rejects(migrateFile(permissivePath, destinationPath), error => error.code === 'INVALID_MIGRATION_SOURCE_MODE');

  const privatePath = path.join(directory, 'private-v5.json');
  const symlinkPath = path.join(directory, 'linked-v5.json');
  await writePrivateFile(privatePath, Buffer.from(JSON.stringify(schemaV5Document())));
  await fs.symlink(privatePath, symlinkPath);
  await assert.rejects(migrateFile(symlinkPath, destinationPath), error => error.code === 'INVALID_MIGRATION_SOURCE_FILE');

  await assert.rejects(fs.lstat(destinationPath), error => error.code === 'ENOENT');
  assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.tmp')), false);
});

test('candidate cleanup removes only the exact file created by the migration writer', async t => {
  const directory = await temporaryDirectory(t);
  const destinationPath = path.join(directory, 'candidate-v6.json');
  const candidateFile = await writeExclusiveCandidate(destinationPath, Buffer.from('candidate\n'));
  await fs.unlink(destinationPath);
  const replacementBytes = Buffer.from('replacement owned by another operation\n');
  await writePrivateFile(destinationPath, replacementBytes);

  await assert.rejects(candidateFile.remove(), error => (
    error instanceof SchemaMigrationFileError && error.code === 'MIGRATION_CANDIDATE_CLEANUP_REFUSED'
  ));
  assert.deepEqual(await fs.readFile(destinationPath), replacementBytes);
});

test('migration output is a normal strict-v6 state for subsequent transitions', () => {
  const migrated = migrateTargetDataV5ToV6(schemaV5Document(createCleanSeed()));
  const candidate = structuredClone(migrated);
  candidate.globalTechnicalSettings = { fictionalSetting: true };
  assert.equal(validateTargetTransition(migrated, candidate), candidate);
});

test('migration-pair validation accepts only the exact preserved v5-to-v6 candidate', async t => {
  const directory = await temporaryDirectory(t);
  const sourcePath = path.join(directory, 'source-v5.json');
  const candidatePath = path.join(directory, 'candidate-v6.json');
  const wrongCandidatePath = path.join(directory, 'wrong-candidate-v6.json');
  const sourceBytes = Buffer.from(`${JSON.stringify(schemaV5Document(), null, 2)}\n`, 'utf8');
  await writePrivateFile(sourcePath, sourceBytes);
  const migrated = await migrateFile(sourcePath, candidatePath);

  const validated = await validateMigrationPair({
    sourcePath,
    candidatePath,
    expectedSourceRevision: migrated.sourceRevision,
    expectedCandidateRevision: migrated.candidateRevision
  });
  assert.equal(validated.exactMigration, true);
  assert.equal(validated.existingCollectionsPreserved, true);
  assert.deepEqual(validated.addedCollections, { decisions: 0, risks: 0 });

  const wrongCandidateBytes = Buffer.from(serializeTargetData(createCleanSeed()), 'utf8');
  await writePrivateFile(wrongCandidatePath, wrongCandidateBytes);
  await assert.rejects(validateMigrationPair({
    sourcePath,
    candidatePath: wrongCandidatePath,
    expectedSourceRevision: migrated.sourceRevision,
    expectedCandidateRevision: revisionForBytes(wrongCandidateBytes)
  }), error => error.code === 'MIGRATION_CANDIDATE_NOT_EXACT');
  assert.deepEqual(await fs.readFile(sourcePath), sourceBytes);
});

test('migration cutover backs up schema v5 and atomically installs its exact schema-v6 candidate', async t => {
  const directory = await temporaryDirectory(t);
  const sourcePath = path.join(directory, 'live-v5.json');
  const candidatePath = path.join(directory, 'candidate-v6.json');
  const backupDirectory = path.join(directory, 'backups');
  const repositoryRoot = path.join(directory, 'repository');
  await Promise.all([
    fs.mkdir(backupDirectory, { mode: 0o700 }),
    fs.mkdir(repositoryRoot, { mode: 0o700 })
  ]);
  const sourceBytes = Buffer.from(`${JSON.stringify(schemaV5Document(), null, 2)}\n`, 'utf8');
  await writePrivateFile(sourcePath, sourceBytes);
  const migrated = await migrateFile(sourcePath, candidatePath);

  const result = await performMigrationCutover({
    livePath: sourcePath,
    candidatePath,
    expectedLiveChecksum: migrated.sourceRevision,
    expectedCandidateChecksum: migrated.candidateRevision,
    backupDirectory,
    releaseCommit: 'a'.repeat(40),
    timestamp: new Date('2026-09-09T12:00:00.000Z'),
    repositoryRoot
  });

  assert.equal(result.operation, 'schema-v5-to-v6-cutover');
  assert.equal(result.status, 'replaced-and-verified');
  assert.equal(result.exactMigration, true);
  assert.equal(revisionForBytes(await fs.readFile(sourcePath)), migrated.candidateRevision);
  assert.deepEqual(await fs.readFile(result.backupPath), sourceBytes);
  assert.equal((await fs.stat(result.backupPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(result.recordPath)).mode & 0o777, 0o600);
});

test('migration cutover performs one verified rollback after a post-replacement failure', async t => {
  const directory = await temporaryDirectory(t);
  const sourcePath = path.join(directory, 'live-v5.json');
  const candidatePath = path.join(directory, 'candidate-v6.json');
  const backupDirectory = path.join(directory, 'backups');
  const repositoryRoot = path.join(directory, 'repository');
  await Promise.all([
    fs.mkdir(backupDirectory, { mode: 0o700 }),
    fs.mkdir(repositoryRoot, { mode: 0o700 })
  ]);
  const sourceBytes = Buffer.from(`${JSON.stringify(schemaV5Document(), null, 2)}\n`, 'utf8');
  await writePrivateFile(sourcePath, sourceBytes);
  const migrated = await migrateFile(sourcePath, candidatePath);
  let error;

  try {
    await performMigrationCutover({
      livePath: sourcePath,
      candidatePath,
      expectedLiveChecksum: migrated.sourceRevision,
      expectedCandidateChecksum: migrated.candidateRevision,
      backupDirectory,
      releaseCommit: 'a'.repeat(40),
      timestamp: new Date('2026-09-09T12:00:00.000Z'),
      repositoryRoot,
      hooks: {
        syncDirectory: async () => {
          throw new Error('simulated post-replacement sync failure');
        }
      }
    });
  } catch (caught) {
    error = caught;
  }

  assert.ok(error);
  assert.equal(error.rollbackAttempted, true);
  assert.equal(error.rollbackError, undefined);
  assert.deepEqual(await fs.readFile(sourcePath), sourceBytes);
  const backups = (await fs.readdir(backupDirectory)).filter(name => name.endsWith('.backup'));
  assert.equal(backups.length, 1);
  assert.deepEqual(await fs.readFile(path.join(backupDirectory, backups[0])), sourceBytes);
});

test('CLI requires explicit outside-repository source and destination paths', async () => {
  await assert.rejects(runFileMigration([], process.cwd()), /Missing required release command flag/);
  await assert.rejects(
    runFileMigration(['--source', 'package.json', '--destination', 'candidate-v6.json'], process.cwd()),
    /must remain outside the repository/
  );
  await assert.rejects(runMigrationValidation([], process.cwd()), /Missing required release command flag/);
});
