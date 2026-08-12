'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createCleanSeed } = require('../target-model/clean-seed');
const { serializeTargetData } = require('../target-model/persistence');
const {
  atomicReplaceFromFile,
  checksumFile,
  createVerifiedBackup,
  performCutover,
  restoreVerifiedBackup,
  writePrivateJson
} = require('../scripts/release/file-operations');
const { MAX_PROCESS_COMMAND_BYTES, assertNoLiveWriter, inspectValidatedProcess } = require('../scripts/release/process-safety');
const { waitForRollbackReady } = require('../scripts/release/rollback-application');
const { executeCutoverLifecycle, safeRehearsalErrorCategory } = require('../scripts/release/rehearse');

const FIXED_TIME = new Date('2026-08-11T12:00:00.000Z');
const RELEASE_COMMIT = 'a'.repeat(40);

async function harness(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'priorena-release-tools-'));
  const livePath = path.join(root, 'live.json');
  const replacementPath = path.join(root, 'staged.json');
  const backupDirectory = path.join(root, 'backup-output');
  const repositoryRoot = path.join(root, 'repository');
  await Promise.all([
    fs.mkdir(backupDirectory, { mode: 0o700 }),
    fs.mkdir(repositoryRoot, { mode: 0o700 })
  ]);
  await fs.writeFile(livePath, Buffer.from('{"fictional":"legacy"}\n'), { mode: 0o600 });
  await fs.writeFile(replacementPath, serializeTargetData(createCleanSeed()), { mode: 0o600 });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return {
    backupDirectory,
    livePath,
    replacementPath,
    repositoryRoot,
    root,
    liveChecksum: await checksumFile(livePath),
    replacementChecksum: await checksumFile(replacementPath)
  };
}

test('repository exclusion resolves symlinked ancestors before backup or manifest writes', async t => {
  const context = await harness(t);
  const repositoryBackup = path.join(context.repositoryRoot, 'escaped-backups');
  const outsideLookingAlias = path.join(context.root, 'outside-looking-alias');
  await fs.mkdir(repositoryBackup, { mode: 0o700 });
  await fs.symlink(context.repositoryRoot, outsideLookingAlias, 'dir');

  await assert.rejects(createVerifiedBackup({
    sourcePath: context.livePath,
    backupDirectory: path.join(outsideLookingAlias, 'escaped-backups'),
    expectedSourceChecksum: context.liveChecksum,
    timestamp: FIXED_TIME,
    repositoryRoot: context.repositoryRoot
  }), /outside the repository/);
  await assert.rejects(writePrivateJson(
    path.join(outsideLookingAlias, 'escaped-manifest.json'),
    { fictional: true },
    context.repositoryRoot
  ), /outside the repository/);
  assert.deepEqual(await fs.readdir(repositoryBackup), []);
  await assert.rejects(fs.stat(path.join(context.repositoryRoot, 'escaped-manifest.json')), { code: 'ENOENT' });
});

test('timestamped backup is byte-for-byte verified, private, and never overwritten', async t => {
  const context = await harness(t);
  const before = await fs.readFile(context.livePath);
  const result = await createVerifiedBackup({
    sourcePath: context.livePath,
    backupDirectory: context.backupDirectory,
    expectedSourceChecksum: context.liveChecksum,
    timestamp: FIXED_TIME,
    repositoryRoot: context.repositoryRoot
  });
  assert.deepEqual(await fs.readFile(context.livePath), before);
  assert.deepEqual(await fs.readFile(result.backupPath), before);
  assert.equal((await fs.stat(result.backupPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(result.manifestPath)).mode & 0o777, 0o600);
  await assert.rejects(createVerifiedBackup({
    sourcePath: context.livePath,
    backupDirectory: context.backupDirectory,
    expectedSourceChecksum: context.liveChecksum,
    timestamp: FIXED_TIME,
    repositoryRoot: context.repositoryRoot
  }), /already exists/);
  assert.equal(await checksumFile(result.backupPath), context.liveChecksum);
});

test('backup failures preserve the source and do not create a verified destination', async t => {
  for (const failure of ['space', 'copy', 'sync']) {
    await t.test(failure, async () => {
      const context = await harness(t);
      const before = await fs.readFile(context.livePath);
      const hooks = failure === 'space'
        ? { availableBytes: async () => 0n }
        : failure === 'copy'
          ? { copyFile: async () => { throw new Error('simulated copy failure'); } }
          : { syncFile: async () => { throw new Error('simulated sync failure'); } };
      await assert.rejects(createVerifiedBackup({
        sourcePath: context.livePath,
        backupDirectory: context.backupDirectory,
        expectedSourceChecksum: context.liveChecksum,
        timestamp: FIXED_TIME,
        repositoryRoot: context.repositoryRoot,
        hooks
      }));
      assert.deepEqual(await fs.readFile(context.livePath), before);
      assert.equal((await fs.readdir(context.backupDirectory)).some(name => name.endsWith('.backup')), false);
    });
  }
});

test('wrong checksum and failed rename leave live bytes unchanged', async t => {
  const context = await harness(t);
  const before = await fs.readFile(context.livePath);
  await assert.rejects(createVerifiedBackup({
    sourcePath: context.livePath,
    backupDirectory: context.backupDirectory,
    expectedSourceChecksum: '0'.repeat(64),
    timestamp: FIXED_TIME,
    repositoryRoot: context.repositoryRoot
  }), /checksum/);
  await assert.rejects(atomicReplaceFromFile({
    livePath: context.livePath,
    replacementPath: context.replacementPath,
    expectedLiveChecksum: context.liveChecksum,
    expectedReplacementChecksum: context.replacementChecksum,
    hooks: { rename: async () => { throw new Error('simulated rename failure'); } }
  }), /rename failure/);
  assert.deepEqual(await fs.readFile(context.livePath), before);
});

test('restore verifies backup checksum and preserves the backup', async t => {
  const context = await harness(t);
  const backup = await createVerifiedBackup({
    sourcePath: context.livePath,
    backupDirectory: context.backupDirectory,
    expectedSourceChecksum: context.liveChecksum,
    timestamp: FIXED_TIME,
    repositoryRoot: context.repositoryRoot
  });
  await atomicReplaceFromFile({
    livePath: context.livePath,
    replacementPath: context.replacementPath,
    expectedLiveChecksum: context.liveChecksum,
    expectedReplacementChecksum: context.replacementChecksum
  });
  await assert.rejects(restoreVerifiedBackup({
    livePath: context.livePath,
    backupPath: backup.backupPath,
    expectedLiveChecksum: context.replacementChecksum,
    expectedBackupChecksum: '0'.repeat(64),
    timestamp: FIXED_TIME,
    repositoryRoot: context.repositoryRoot
  }), /checksum/);
  const restored = await restoreVerifiedBackup({
    livePath: context.livePath,
    backupPath: backup.backupPath,
    expectedLiveChecksum: context.replacementChecksum,
    expectedBackupChecksum: context.liveChecksum,
    timestamp: FIXED_TIME,
    repositoryRoot: context.repositoryRoot
  });
  assert.equal(restored.sha256, context.liveChecksum);
  assert.equal(await checksumFile(context.livePath), context.liveChecksum);
  assert.equal(await checksumFile(backup.backupPath), context.liveChecksum);
});

test('restore rejects a corrupt or wrongly permissioned backup', async t => {
  const context = await harness(t);
  const backup = await createVerifiedBackup({
    sourcePath: context.livePath,
    backupDirectory: context.backupDirectory,
    expectedSourceChecksum: context.liveChecksum,
    timestamp: FIXED_TIME,
    repositoryRoot: context.repositoryRoot
  });
  await fs.chmod(backup.backupPath, 0o644);
  await assert.rejects(restoreVerifiedBackup({
    livePath: context.livePath,
    backupPath: backup.backupPath,
    expectedLiveChecksum: context.liveChecksum,
    expectedBackupChecksum: context.liveChecksum,
    timestamp: FIXED_TIME,
    repositoryRoot: context.repositoryRoot
  }), /0600/);
  await fs.chmod(backup.backupPath, 0o600);
  await fs.writeFile(backup.backupPath, Buffer.from('corrupt'), { mode: 0o600 });
  await assert.rejects(restoreVerifiedBackup({
    livePath: context.livePath,
    backupPath: backup.backupPath,
    expectedLiveChecksum: context.liveChecksum,
    expectedBackupChecksum: context.liveChecksum,
    timestamp: FIXED_TIME,
    repositoryRoot: context.repositoryRoot
  }), /checksum/);
  assert.equal(await checksumFile(context.livePath), context.liveChecksum);
});

test('malformed staged data never creates a backup or replaces live bytes', async t => {
  const context = await harness(t);
  const before = await fs.readFile(context.livePath);
  await fs.writeFile(context.replacementPath, Buffer.from('{"version":99}\n'), { mode: 0o600 });
  const malformedChecksum = await checksumFile(context.replacementPath);
  await assert.rejects(performCutover({
    livePath: context.livePath,
    stagedSeedPath: context.replacementPath,
    expectedLiveChecksum: context.liveChecksum,
    expectedSeedChecksum: malformedChecksum,
    backupDirectory: context.backupDirectory,
    releaseCommit: RELEASE_COMMIT,
    timestamp: FIXED_TIME,
    repositoryRoot: context.repositoryRoot
  }));
  assert.deepEqual(await fs.readFile(context.livePath), before);
  assert.deepEqual(await fs.readdir(context.backupDirectory), []);
});

test('post-rename verification failure performs exactly one verified rollback', async t => {
  const context = await harness(t);
  let failedSyncs = 0;
  let error;
  try {
    await performCutover({
      livePath: context.livePath,
      stagedSeedPath: context.replacementPath,
      expectedLiveChecksum: context.liveChecksum,
      expectedSeedChecksum: context.replacementChecksum,
      backupDirectory: context.backupDirectory,
      releaseCommit: RELEASE_COMMIT,
      timestamp: FIXED_TIME,
      repositoryRoot: context.repositoryRoot,
      hooks: {
        syncDirectory: async () => {
          failedSyncs += 1;
          throw new Error('simulated parent sync failure');
        }
      }
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  assert.equal(error.rollbackAttempted, true);
  assert.equal(error.rollbackError, undefined);
  assert.equal(failedSyncs, 1);
  assert.equal(await checksumFile(context.livePath), context.liveChecksum);
  const backups = (await fs.readdir(context.backupDirectory)).filter(name => name.endsWith('.backup'));
  assert.equal(backups.length, 1);
  assert.equal(await checksumFile(path.join(context.backupDirectory, backups[0])), context.liveChecksum);
});

test('cutover lifecycle fails before replacement and rolls back start or smoke failures exactly once', async t => {
  await t.test('pre-replacement startup failure', async () => {
    let replacements = 0;
    let restores = 0;
    await assert.rejects(executeCutoverLifecycle({
      smokeStaged: async () => { throw new Error('simulated staged startup failure'); },
      replace: async () => { replacements += 1; },
      startTarget: async () => ({}),
      smokeTarget: async () => ({}),
      stopTarget: async () => {},
      restore: async () => { restores += 1; },
      smokeRollback: async () => ({})
    }), /staged startup failure/);
    assert.equal(replacements, 0);
    assert.equal(restores, 0);
  });

  for (const failure of ['start', 'smoke']) {
    await t.test(`post-replacement ${failure} failure`, async () => {
      const calls = { replacements: 0, restores: 0, rollbackSmokes: 0, stops: 0 };
      const result = await executeCutoverLifecycle({
        smokeStaged: async () => ({ status: 'passed' }),
        replace: async () => { calls.replacements += 1; return { backupPath: '/fictional/backup' }; },
        startTarget: async () => {
          if (failure === 'start') throw new Error('simulated target start failure');
          return { exactTemporaryProcess: true };
        },
        smokeTarget: async () => {
          if (failure === 'smoke') throw new Error('simulated target smoke failure');
          return { status: 'passed' };
        },
        stopTarget: async () => { calls.stops += 1; },
        restore: async () => { calls.restores += 1; return { status: 'verified' }; },
        smokeRollback: async () => { calls.rollbackSmokes += 1; return { status: 'passed' }; }
      });
      assert.equal(result.status, 'rolled-back-and-verified');
      assert.equal(result.cutoverAttempts, 1);
      assert.equal(result.rollbackAttempts, 1);
      assert.equal(result.secondAutomaticCutoverAttempts, 0);
      assert.deepEqual(calls, {
        replacements: 1,
        restores: 1,
        rollbackSmokes: 1,
        stops: failure === 'smoke' ? 1 : 0
      });
    });
  }
});

test('process guards require an exited PID, unused file, and unused expected port', () => {
  const freeRunner = () => ({ status: 1, stdout: '', stderr: '' });
  const result = assertNoLiveWriter({
    expectedStoppedPid: 'none',
    expectedPort: 3100,
    livePath: '/tmp/fictional-live.json',
    runner: freeRunner
  });
  assert.equal(result.verifiedStopped, true);
  let calls = 0;
  assert.throws(() => assertNoLiveWriter({
    expectedStoppedPid: 'none',
    expectedPort: 3100,
    livePath: '/tmp/fictional-live.json',
    runner: () => {
      calls += 1;
      return calls === 1 ? { status: 1, stdout: '' } : { status: 0, stdout: '999\n' };
    }
  }), /port.*still in use/i);
});

test('process identity inspection requires command, working directory, PID, and port evidence', () => {
  const runner = (name, args) => {
    if (name === 'ps') return { status: 0, stdout: 'node target-server/start.js\nnode\n' };
    if (args.includes('cwd')) return { status: 0, stdout: 'p321\nfcwd\nn/tmp/fictional-release\n' };
    return { status: 0, stdout: 'p321\nf10\nn127.0.0.1:3100\n' };
  };
  const evidence = inspectValidatedProcess({
    pid: 321,
    expectedCwd: '/tmp/fictional-release',
    expectedPort: 3100,
    expectedCommandFragment: 'target-server/start.js',
    platform: 'darwin',
    runner
  });
  assert.equal(evidence.pid, 321);
  assert.throws(() => inspectValidatedProcess({
    pid: 321,
    expectedCwd: '/tmp/other-release',
    expectedPort: 3100,
    expectedCommandFragment: 'target-server/start.js',
    platform: 'darwin',
    runner
  }), /working directory/);

  const linuxRunner = (name, args) => {
    assert.notEqual(name, 'ps');
    if (args.includes('cwd')) return { status: 0, stdout: 'p321\nfcwd\nn/tmp/fictional-release\n' };
    return { status: 0, stdout: 'p321\nf10\nn127.0.0.1:3100\n' };
  };
  let procPath;
  let maximumRequestedBytes = 0;
  let closed = false;
  const commandBytes = Buffer.from('/usr/bin/node\0target-server/start.js\0');
  const linuxEvidence = inspectValidatedProcess({
    pid: 321,
    expectedCwd: '/tmp/fictional-release',
    expectedPort: 3100,
    expectedCommandFragment: 'target-server/start.js',
    platform: 'linux',
    processCommandIo: {
      openSync: file => { procPath = file; return 7; },
      readSync: (descriptor, buffer, offset, length) => {
        assert.equal(descriptor, 7);
        maximumRequestedBytes = Math.max(maximumRequestedBytes, length);
        if (offset >= commandBytes.length) return 0;
        return commandBytes.copy(buffer, offset, offset, Math.min(commandBytes.length, offset + length));
      },
      closeSync: descriptor => { assert.equal(descriptor, 7); closed = true; }
    },
    runner: linuxRunner
  });
  assert.equal(procPath, '/proc/321/cmdline');
  assert.equal(maximumRequestedBytes, MAX_PROCESS_COMMAND_BYTES + 1);
  assert.equal(closed, true);
  assert.equal(linuxEvidence.commandMatched, true);
  let mismatchRead = false;
  assert.throws(() => inspectValidatedProcess({
    pid: 321,
    expectedCwd: '/tmp/fictional-release',
    expectedPort: 3100,
    expectedCommandFragment: 'different-server.js',
    platform: 'linux',
    processCommandIo: {
      openSync: () => 7,
      readSync: (descriptor, buffer, offset, length) => {
        if (mismatchRead) return 0;
        mismatchRead = true;
        return commandBytes.copy(buffer, offset, 0, Math.min(commandBytes.length, length));
      },
      closeSync: () => {}
    },
    runner: linuxRunner
  }), error => error.code === 'PROCESS_COMMAND_MISMATCH');
  let oversizedRequestedBytes = 0;
  let oversizedClosed = false;
  assert.throws(() => inspectValidatedProcess({
    pid: 321,
    expectedCwd: '/tmp/fictional-release',
    expectedPort: 3100,
    expectedCommandFragment: 'target-server/start.js',
    platform: 'linux',
    processCommandIo: {
      openSync: () => 7,
      readSync: (descriptor, buffer, offset, length) => {
        oversizedRequestedBytes += length;
        buffer.fill(97, offset, offset + length);
        return length;
      },
      closeSync: () => { oversizedClosed = true; }
    },
    runner: linuxRunner
  }), error => error.code === 'PROCESS_COMMAND_STATE_UNVERIFIED');
  assert.equal(oversizedRequestedBytes, MAX_PROCESS_COMMAND_BYTES + 1);
  assert.equal(oversizedClosed, true);
  assert.throws(() => inspectValidatedProcess({
    pid: 321,
    expectedCwd: '/tmp/fictional-release',
    expectedPort: 3100,
    expectedCommandFragment: 'target-server/start.js',
    platform: 'linux',
    processCommandIo: {
      openSync: () => { throw new Error('/private/proc-error'); },
      readSync: () => 0,
      closeSync: () => {}
    },
    runner: linuxRunner
  }), error => error.code === 'PROCESS_COMMAND_STATE_UNVERIFIED');
});

test('rollback diagnostics expose only bounded stage categories without paths or child output', async () => {
  const processOptions = {
    pid: 321,
    expectedCwd: '/tmp/fictional-release',
    expectedPort: 3100,
    expectedCommandFragment: 'server.js',
    platform: 'darwin'
  };
  assert.throws(() => inspectValidatedProcess({
    ...processOptions,
    runner: () => ({ status: 1, stdout: '', stderr: '/private/runner-output' })
  }), error => error.code === 'PROCESS_COMMAND_MISMATCH');
  assert.throws(() => inspectValidatedProcess({
    ...processOptions,
    runner: (name, args) => name === 'ps'
      ? { status: 0, stdout: 'node server.js' }
      : args.includes('cwd')
        ? { status: 1, stdout: 'n/private/cwd' }
        : { status: 0, stdout: 'p321\nn127.0.0.1:3100' }
  }), error => error.code === 'PROCESS_CWD_MISMATCH');
  assert.throws(() => inspectValidatedProcess({
    ...processOptions,
    runner: (name, args) => name === 'ps'
      ? { status: 0, stdout: 'node server.js' }
      : args.includes('cwd')
        ? { status: 0, stdout: 'p321\nn/tmp/fictional-release' }
        : { status: 1, stdout: 'n/private/socket' }
  }), error => error.code === 'PROCESS_LOOPBACK_PORT_MISMATCH');

  const output = {
    stdout: { overflowed: () => false },
    stderr: { overflowed: () => false },
    spawnError: () => undefined
  };
  await assert.rejects(waitForRollbackReady({ exitCode: 1 }, 3100, output, 1), error => error.code === 'ROLLBACK_START_EXITED');
  assert.equal(safeRehearsalErrorCategory(Object.assign(new Error('/private/path'), { code: 'PROCESS_CWD_MISMATCH' })), 'PROCESS_CWD_MISMATCH');
  assert.equal(safeRehearsalErrorCategory(Object.assign(new Error('/private/path'), { code: 'ROLLBACK_PRIVATE_RUNTIME_CHECKSUM_ABC123' })), 'REHEARSAL_ERROR');
  assert.equal(safeRehearsalErrorCategory(Object.assign(new Error('/private/path'), { code: 'ENOENT' })), 'REHEARSAL_ERROR');

  const lifecycle = await executeCutoverLifecycle({
    smokeStaged: async () => ({ status: 'passed' }),
    replace: async () => ({ backupPath: '/fictional/backup' }),
    startTarget: async () => { throw Object.assign(new Error('/private/path'), { code: 'ROLLBACK_PRIVATE_RUNTIME_CHECKSUM_ABC123' }); },
    smokeTarget: async () => ({ status: 'passed' }),
    stopTarget: async () => {},
    restore: async () => ({ status: 'verified' }),
    smokeRollback: async () => ({ status: 'passed' })
  });
  assert.equal(lifecycle.failureCategory, 'REHEARSAL_ERROR');
});
