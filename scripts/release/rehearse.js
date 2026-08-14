'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { createCleanSeed } = require('../../target-model/clean-seed');
const { serializeTargetData } = require('../../target-model/persistence');
const { startTargetServer } = require('../../target-server/start');
const {
  atomicReplaceFromFile,
  checksumFile,
  createVerifiedBackup,
  performCutover,
  restoreVerifiedBackup
} = require('./file-operations');
const { materializeRollbackApplication, smokeRollbackApplication } = require('./rollback-application');
const { safeReleaseErrorCategory } = require('./release-diagnostics');
const { smokeStartedTarget, smokeTarget, stopStartedTarget } = require('./smoke');

const ROLLBACK_REVISION = '363a321648aba0e2d10a812644a298b9abe5e7bb';
const REHEARSAL_TIMESTAMP = new Date('2026-08-11T12:00:00.000Z');
const SCENARIOS = new Set(['all', 'backup', 'restore', 'cutover', 'rollback']);
function safeRehearsalErrorCategory(error) {
  return safeReleaseErrorCategory(error);
}

function parseScenario(argv) {
  if (argv.length === 0) return 'all';
  if (argv.length !== 2 || argv[0] !== '--scenario' || !SCENARIOS.has(argv[1])) throw new Error('Rehearsal scenario must be all, backup, restore, cutover, or rollback');
  return argv[1];
}

async function executeCutoverLifecycle(steps, options = {}) {
  const stagedSmoke = await steps.smokeStaged();
  let cutoverAttempts = 0;
  let rollbackAttempts = 0;
  let startedTarget;
  cutoverAttempts += 1;
  const cutover = await steps.replace();
  try {
    startedTarget = await steps.startTarget();
    const targetSmoke = await steps.smokeTarget(startedTarget);
    if (options.simulatedPostCutoverFailure) throw new Error('Simulated post-cutover acceptance failure');
    await steps.stopTarget(startedTarget, 'success');
    startedTarget = undefined;
    return Object.freeze({
      status: 'cutover-verified',
      stagedSmoke,
      targetSmoke,
      cutover,
      cutoverAttempts,
      rollbackAttempts,
      secondAutomaticCutoverAttempts: 0
    });
  } catch (error) {
    if (startedTarget) {
      await steps.stopTarget(startedTarget, 'failure');
      startedTarget = undefined;
    }
    rollbackAttempts += 1;
    const rollback = await steps.restore(cutover);
    const rollbackSmoke = await steps.smokeRollback(rollback);
    return Object.freeze({
      status: 'rolled-back-and-verified',
      stagedSmoke,
      cutover,
      cutoverAttempts,
      rollbackAttempts,
      secondAutomaticCutoverAttempts: 0,
      failureCategory: safeRehearsalErrorCategory(error),
      rollback,
      rollbackSmoke
    });
  }
}

async function runRehearsal(scenario = 'all', repositoryRoot = path.resolve(__dirname, '..', '..')) {
  if (!SCENARIOS.has(scenario)) throw new Error('Unknown release rehearsal scenario');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'priorena-release-rehearsal-'));
  const livePath = path.join(root, 'fictional-live.json');
  const stagedSeedPath = path.join(root, 'fictional-staged-v5.json');
  const sourceFilesRoot = path.join(root, 'source-files');
  const backupDirectory = path.join(root, 'verified-backups');
  const materializedRollback = await materializeRollbackApplication({
    repositoryRoot,
    revision: ROLLBACK_REVISION,
    destination: path.join(root, 'rollback-application')
  });
  const previousSchemaBytes = execFileSync(process.execPath, ['-e', [
    "const { createCleanSeed } = require('./target-model/clean-seed');",
    "const { serializeTargetData } = require('./target-model/persistence');",
    'process.stdout.write(serializeTargetData(createCleanSeed()));'
  ].join(' ')], {
    cwd: materializedRollback.checkoutRoot,
    maxBuffer: 2 * 1024 * 1024
  });
  await Promise.all([
    fs.mkdir(sourceFilesRoot, { mode: 0o700 }),
    fs.mkdir(backupDirectory, { mode: 0o700 })
  ]);
  await fs.writeFile(livePath, previousSchemaBytes, { mode: 0o600 });
  await fs.writeFile(stagedSeedPath, serializeTargetData(createCleanSeed()), { mode: 0o600 });
  const liveChecksum = await checksumFile(livePath);
  const seedChecksum = await checksumFile(stagedSeedPath);
  const releaseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();

  try {
    if (scenario === 'backup') {
      const backup = await createVerifiedBackup({
        sourcePath: livePath,
        backupDirectory,
        expectedSourceChecksum: liveChecksum,
        timestamp: REHEARSAL_TIMESTAMP,
        repositoryRoot
      });
      assert.equal(await checksumFile(livePath), liveChecksum);
      assert.equal(await checksumFile(backup.backupPath), liveChecksum);
      return { scenario, status: 'passed', sourceUnchanged: true, backupVerified: true, backupRetainedByTooling: true };
    }

    if (scenario === 'restore') {
      const backup = await createVerifiedBackup({
        sourcePath: livePath,
        backupDirectory,
        expectedSourceChecksum: liveChecksum,
        timestamp: REHEARSAL_TIMESTAMP,
        repositoryRoot
      });
      await atomicReplaceFromFile({
        livePath,
        replacementPath: stagedSeedPath,
        expectedLiveChecksum: liveChecksum,
        expectedReplacementChecksum: seedChecksum
      });
      await restoreVerifiedBackup({
        livePath,
        backupPath: backup.backupPath,
        expectedLiveChecksum: seedChecksum,
        expectedBackupChecksum: liveChecksum,
        timestamp: REHEARSAL_TIMESTAMP,
        repositoryRoot
      });
      assert.deepEqual(await fs.readFile(livePath), previousSchemaBytes);
      assert.equal(await checksumFile(backup.backupPath), liveChecksum);
      return { scenario, status: 'passed', semanticAndByteRestore: true, backupRetainedByTooling: true };
    }

    const lifecycle = await executeCutoverLifecycle({
      smokeStaged: () => smokeTarget({
        targetDataFile: stagedSeedPath,
        sourceFilesRoot,
        logFile: path.join(root, 'staged-smoke.log'),
        repositoryRoot
      }),
      replace: () => performCutover({
        livePath,
        stagedSeedPath,
        expectedLiveChecksum: liveChecksum,
        expectedSeedChecksum: seedChecksum,
        backupDirectory,
        releaseCommit,
        timestamp: REHEARSAL_TIMESTAMP,
        repositoryRoot
      }),
      startTarget: () => startTargetServer({
        targetDataFile: livePath,
        sourceFilesRoot,
        logFile: path.join(root, 'post-cutover-smoke.log'),
        port: 0,
        repositoryRoot
      }),
      smokeTarget: smokeStartedTarget,
      stopTarget: stopStartedTarget,
      restore: async cutover => {
        const currentChecksum = await checksumFile(livePath);
        return restoreVerifiedBackup({
          livePath,
          backupPath: cutover.backupPath,
          expectedLiveChecksum: currentChecksum,
          expectedBackupChecksum: liveChecksum,
          timestamp: REHEARSAL_TIMESTAMP,
          repositoryRoot
        });
      },
      smokeRollback: async () => {
        const beforeRollbackSmoke = await checksumFile(livePath);
        const smoke = await smokeRollbackApplication({ checkoutRoot: materializedRollback.checkoutRoot, livePath });
        assert.equal(await checksumFile(livePath), beforeRollbackSmoke);
        return { ...smoke, revision: materializedRollback.revision, serverObjectVerified: true };
      }
    }, { simulatedPostCutoverFailure: scenario !== 'cutover' });

    if (scenario === 'cutover') {
      assert.equal(await checksumFile(livePath), seedChecksum);
      assert.equal(await checksumFile(lifecycle.cutover.backupPath), liveChecksum);
      return {
        scenario,
        status: 'passed',
        stagedSmoke: lifecycle.stagedSmoke.status,
        postCutoverSmoke: lifecycle.targetSmoke.status,
        atomicReplacement: true,
        cutoverAttempts: lifecycle.cutoverAttempts,
        rollbackAttempts: lifecycle.rollbackAttempts,
        backupRetainedByTooling: true
      };
    }

    assert.equal(lifecycle.status, 'rolled-back-and-verified');
    assert.equal(lifecycle.rollbackAttempts, 1);
    assert.deepEqual(await fs.readFile(livePath), previousSchemaBytes);
    assert.equal(await checksumFile(lifecycle.cutover.backupPath), liveChecksum);
    return {
      scenario,
      status: 'passed',
      stagedSmoke: lifecycle.stagedSmoke.status,
      simulatedPostCutoverFailure: true,
      rollbackAttempts: lifecycle.rollbackAttempts,
      secondAutomaticCutoverAttempts: lifecycle.secondAutomaticCutoverAttempts,
      restoredPreviousSchemaBytes: true,
      rollbackRevisionStartedAndSmoked: lifecycle.rollbackSmoke.revision,
      rollbackProcessValidated: lifecycle.rollbackSmoke.processValidated,
      backupRetainedByTooling: true
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function run(argv = process.argv.slice(2)) {
  const result = await runRehearsal(parseScenario(argv));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`Release rehearsal failed: ${safeRehearsalErrorCategory(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  REHEARSAL_TIMESTAMP,
  ROLLBACK_REVISION,
  SCENARIOS,
  executeCutoverLifecycle,
  parseScenario,
  run,
  runRehearsal,
  safeRehearsalErrorCategory
};
