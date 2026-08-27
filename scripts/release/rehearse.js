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
const {
  ACKNOWLEDGEMENTS,
  AGENT_LABEL,
  LAUNCHCTL,
  PLUTIL,
  SUPPORTED_PORT,
  installAgent,
  replaceAgent,
  rollbackAgent
} = require('./startup-resilience');

const ROLLBACK_REVISION = '363a321648aba0e2d10a812644a298b9abe5e7bb';
const REHEARSAL_TIMESTAMP = new Date('2026-08-11T12:00:00.000Z');
const SCENARIOS = new Set(['all', 'backup', 'restore', 'cutover', 'rollback', 'startup']);
function safeRehearsalErrorCategory(error) {
  return safeReleaseErrorCategory(error);
}

function parseScenario(argv) {
  if (argv.length === 0) return 'all';
  if (argv.length !== 2 || argv[0] !== '--scenario' || !SCENARIOS.has(argv[1])) throw new Error('Rehearsal scenario must be all, backup, restore, cutover, rollback, or startup');
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

function createSyntheticStartupRunner(bootstrapFailures, uid, destination) {
  const state = {
    registered: false,
    counts: { bootstrap: 0, bootout: 0, print: 0, plutil: 0 },
    bootstrapFailures: new Set(bootstrapFailures)
  };
  state.runner = (command, args, options = {}) => {
    assert.equal(options.shell, false);
    if (command === PLUTIL) {
      assert.deepEqual(args, ['-lint', '-']);
      assert.ok(Buffer.isBuffer(options.input));
      state.counts.plutil += 1;
      return { status: 0, stdout: '-', stderr: '' };
    }
    assert.equal(command, LAUNCHCTL);
    const operation = args[0];
    state.counts[operation] += 1;
    if (operation === 'print') {
      assert.deepEqual(args, ['print', `gui/${uid}/${AGENT_LABEL}`]);
      return state.registered
        ? { status: 0, stdout: 'synthetic-service-state', stderr: '' }
        : { status: 113, stdout: '', stderr: 'synthetic-service-absent' };
    }
    if (operation === 'bootstrap') {
      assert.deepEqual(args, ['bootstrap', `gui/${uid}`, destination]);
      if (state.bootstrapFailures.has(state.counts.bootstrap)) {
        return { status: 5, stdout: 'synthetic-bootstrap-output', stderr: 'synthetic-bootstrap-error' };
      }
      state.registered = true;
      return { status: 0, stdout: 'synthetic-bootstrap-output', stderr: '' };
    }
    assert.equal(operation, 'bootout');
    assert.deepEqual(args, ['bootout', `gui/${uid}/${AGENT_LABEL}`]);
    state.registered = false;
    return { status: 0, stdout: 'synthetic-bootout-output', stderr: '' };
  };
  return state;
}

async function createStartupRehearsalCase(root, name, bootstrapFailures) {
  const caseRoot = path.join(root, name);
  const repositoryRoot = path.join(caseRoot, 'fictional-release');
  const privateRoot = path.join(caseRoot, 'fictional-private');
  const userHome = path.join(caseRoot, 'fictional-user');
  const sourceFilesRoot = path.join(privateRoot, 'source-files');
  const dataFile = path.join(privateRoot, 'target-v6.json');
  const logFile = path.join(privateRoot, 'logs', 'priorena.log');
  const nodeExecutable = path.join(caseRoot, 'fictional-runtime', 'node');
  const launchAgentsDirectory = path.join(userHome, 'Library', 'LaunchAgents');
  await Promise.all([
    fs.mkdir(path.join(repositoryRoot, 'target-server'), { recursive: true, mode: 0o700 }),
    fs.mkdir(sourceFilesRoot, { recursive: true, mode: 0o700 }),
    fs.mkdir(path.dirname(logFile), { recursive: true, mode: 0o700 }),
    fs.mkdir(path.dirname(nodeExecutable), { recursive: true, mode: 0o700 }),
    fs.mkdir(launchAgentsDirectory, { recursive: true, mode: 0o700 })
  ]);
  await Promise.all([
    fs.writeFile(path.join(repositoryRoot, 'package.json'), '{"name":"priorena","private":true}\n', { mode: 0o600 }),
    fs.writeFile(path.join(repositoryRoot, 'target-server', 'start.js'), "'use strict';\n", { mode: 0o600 }),
    fs.writeFile(dataFile, '{"schemaVersion":6,"fictional":true}\n', { mode: 0o600 }),
    fs.writeFile(nodeExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  ]);
  const destination = path.join(launchAgentsDirectory, `${AGENT_LABEL}.plist`);
  const uid = (await fs.stat(userHome)).uid;
  const launchd = createSyntheticStartupRunner(bootstrapFailures, uid, destination);
  return {
    destination,
    rollback: path.join(launchAgentsDirectory, `${AGENT_LABEL}.plist.previous`),
    launchd,
    dependencies: {
      platform: 'darwin',
      getuid: () => uid,
      runner: launchd.runner,
      sleep: async () => {},
      convergenceAttempts: 3,
      convergenceIntervalMs: 0
    },
    options: {
      repositoryRoot,
      nodeExecutable,
      dataFile,
      sourceFilesRoot,
      logFile,
      userHome,
      port: String(SUPPORTED_PORT)
    }
  };
}

async function rehearseStartupControllerLifecycle() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'priorena-startup-rehearsal-')));
  try {
    const restored = await createStartupRehearsalCase(root, 'restored', [2]);
    await installAgent(
      { ...restored.options, acknowledgement: ACKNOWLEDGEMENTS.install },
      restored.dependencies
    );
    const restoredBaseline = await fs.readFile(restored.destination);
    let activationFailure;
    try {
      await replaceAgent({
        ...restored.options,
        logFile: path.join(path.dirname(restored.options.logFile), 'candidate.log'),
        acknowledgement: ACKNOWLEDGEMENTS.replace
      }, restored.dependencies);
    } catch (error) {
      activationFailure = error;
    }
    assert.equal(activationFailure?.code, 'STARTUP_REPLACEMENT_FAILED');
    assert.equal(activationFailure?.phase, 'candidate-bootstrap');
    assert.equal(activationFailure?.status, 'mutation-failed');
    assert.equal(restored.launchd.registered, true);
    assert.deepEqual(await fs.readFile(restored.destination), restoredBaseline);
    assert.deepEqual(await fs.readFile(restored.rollback), restoredBaseline);
    assert.equal(restored.launchd.counts.bootstrap, 3);
    assert.equal(restored.launchd.counts.bootout, 1);

    const stopped = await createStartupRehearsalCase(root, 'stopped', [2, 3]);
    await installAgent(
      { ...stopped.options, acknowledgement: ACKNOWLEDGEMENTS.install },
      stopped.dependencies
    );
    const stoppedBaseline = await fs.readFile(stopped.destination);
    let restorationFailure;
    try {
      await replaceAgent({
        ...stopped.options,
        logFile: path.join(path.dirname(stopped.options.logFile), 'candidate.log'),
        acknowledgement: ACKNOWLEDGEMENTS.replace
      }, stopped.dependencies);
    } catch (error) {
      restorationFailure = error;
    }
    assert.equal(restorationFailure?.code, 'STARTUP_REPLACEMENT_ROLLBACK_FAILED');
    assert.equal(restorationFailure?.phase, 'restoration-bootstrap');
    assert.equal(restorationFailure?.replacementPhase, 'candidate-bootstrap');
    assert.equal(stopped.launchd.registered, false);
    assert.deepEqual(await fs.readFile(stopped.destination), stoppedBaseline);
    assert.deepEqual(await fs.readFile(stopped.rollback), stoppedBaseline);
    const mutationCountsBeforeStop = {
      bootstrap: stopped.launchd.counts.bootstrap,
      bootout: stopped.launchd.counts.bootout
    };
    let recoveryRequired;
    try {
      await rollbackAgent(
        { ...stopped.options, acknowledgement: ACKNOWLEDGEMENTS.rollback },
        stopped.dependencies
      );
    } catch (error) {
      recoveryRequired = error;
    }
    assert.equal(recoveryRequired?.code, 'STARTUP_REGISTRATION_RECOVERY_REQUIRED');
    assert.equal(recoveryRequired?.phase, 'registration-recovery-required');
    assert.deepEqual({
      bootstrap: stopped.launchd.counts.bootstrap,
      bootout: stopped.launchd.counts.bootout
    }, mutationCountsBeforeStop);

    return Object.freeze({
      status: 'passed',
      syntheticOnly: true,
      baselineRestoration: Object.freeze({
        status: 'restored-and-registered',
        candidateActivationAttempts: 1,
        restorationRegistrationAttempts: 1,
        secondCandidateActivationAttempts: 0
      }),
      stoppedRecovery: Object.freeze({
        status: 'registration-recovery-required',
        candidateActivationAttempts: 1,
        restorationRegistrationAttempts: 1,
        automaticRegistrationRecoveryAttempts: 0,
        secondCandidateActivationAttempts: 0
      })
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function runRehearsal(scenario = 'all', repositoryRoot = path.resolve(__dirname, '..', '..')) {
  if (!SCENARIOS.has(scenario)) throw new Error('Unknown release rehearsal scenario');
  if (scenario === 'startup') {
    return { scenario, status: 'passed', startupController: await rehearseStartupControllerLifecycle() };
  }
  const startupController = scenario === 'all' ? await rehearseStartupControllerLifecycle() : undefined;
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
      backupRetainedByTooling: true,
      ...(startupController ? { startupController } : {})
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
  rehearseStartupControllerLifecycle,
  run,
  runRehearsal,
  safeRehearsalErrorCategory
};
