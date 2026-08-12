'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const { inspectValidatedProcess, stopValidatedProcess } = require('./process-safety');
const { safeReleaseErrorCategory } = require('./release-diagnostics');
const { assertOutsideRepository } = require('./safety');

const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
const LEGACY_DATA_ENV = ['PMDS', 'DATA', 'FILE'].join('_');
const LEGACY_UPLOADS_ENV = ['PMDS', 'UPLOADS', 'DIR'].join('_');
const LEGACY_RECOVERY_ENV = ['PMDS', 'RECOVERY', 'DIR'].join('_');
function codedError(code, message, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function diagnosticStage(code, operation) {
  try {
    return operation();
  } catch (cause) {
    if (safeReleaseErrorCategory(cause) !== 'REHEARSAL_ERROR') throw cause;
    throw codedError(code, 'Rollback rehearsal stage failed', cause);
  }
}

async function diagnosticStageAsync(code, operation) {
  try {
    return await operation();
  } catch (cause) {
    if (safeReleaseErrorCategory(cause) !== 'REHEARSAL_ERROR') throw cause;
    throw codedError(code, 'Rollback rehearsal stage failed', cause);
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    ...options,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    stdio: 'pipe'
  });
}

async function materializeRollbackApplication({ repositoryRoot, revision, destination, runner = run }) {
  const checkoutRoot = assertOutsideRepository(destination, repositoryRoot, 'Rollback rehearsal application');
  await fs.mkdir(checkoutRoot, { recursive: false, mode: 0o700 });
  const archivePath = path.join(path.dirname(checkoutRoot), `${path.basename(checkoutRoot)}.tar`);
  try {
    diagnosticStage('ROLLBACK_REVISION_UNAVAILABLE', () => runner('git', ['cat-file', '-e', `${revision}^{commit}`], { cwd: repositoryRoot }));
    diagnosticStage('ROLLBACK_ARCHIVE_FAILED', () => runner('git', ['archive', '--format=tar', `--output=${archivePath}`, revision], { cwd: repositoryRoot }));
    diagnosticStage('ROLLBACK_EXTRACTION_FAILED', () => runner('tar', ['-xf', archivePath, '-C', checkoutRoot]));
  } finally {
    await fs.unlink(archivePath).catch(() => {});
  }
  const expectedServerObject = diagnosticStage('ROLLBACK_OBJECT_LOOKUP_FAILED', () => runner('git', ['rev-parse', `${revision}:server.js`], { cwd: repositoryRoot }).trim());
  const extractedServerObject = diagnosticStage('ROLLBACK_OBJECT_HASH_FAILED', () => runner('git', ['hash-object', 'server.js'], { cwd: checkoutRoot }).trim());
  if (expectedServerObject !== extractedServerObject) throw codedError('ROLLBACK_OBJECT_MISMATCH', 'Rollback application extraction did not match the authorized revision');
  diagnosticStage('ROLLBACK_DEPENDENCY_INSTALL_FAILED', () => runner('npm', ['ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: checkoutRoot,
    env: { ...process.env, npm_config_update_notifier: 'false' }
  }));
  const canonicalCheckoutRoot = await diagnosticStageAsync('ROLLBACK_CHECKOUT_RESOLUTION_FAILED', () => fs.realpath(checkoutRoot));
  return Object.freeze({ checkoutRoot: canonicalCheckoutRoot, revision, serverObject: expectedServerObject });
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function captureBounded(stream) {
  let bytes = 0;
  let overflow = false;
  const chunks = [];
  stream.on('data', chunk => {
    bytes += chunk.length;
    if (bytes <= MAX_PROCESS_OUTPUT_BYTES) chunks.push(chunk);
    else overflow = true;
  });
  return Object.freeze({
    overflowed: () => overflow,
    text: () => Buffer.concat(chunks).toString('utf8')
  });
}

async function waitForRollbackReady(child, port, output, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  const origin = `http://127.0.0.1:${port}`;
  while (Date.now() < deadline) {
    if (output.spawnError?.()) throw codedError('ROLLBACK_START_FAILED', 'Rollback application could not start');
    if (child.exitCode !== null) throw codedError('ROLLBACK_START_EXITED', 'Rollback application exited before becoming ready');
    if (output.stdout.overflowed() || output.stderr.overflowed()) throw codedError('ROLLBACK_OUTPUT_LIMIT_EXCEEDED', 'Rollback application exceeded the bounded log limit');
    try {
      const response = await fetch(`${origin}/api/projects`);
      if (response.status === 200) return origin;
    } catch (_) {
      // The exact temporary child is still starting; retry only until the bound.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw codedError('ROLLBACK_START_TIMEOUT', 'Rollback application did not become ready within the bounded timeout');
}

async function smokeRollbackApplication({ checkoutRoot, livePath, port = undefined }) {
  const expectedPort = port || await diagnosticStageAsync('ROLLBACK_PORT_RESERVATION_FAILED', reserveLoopbackPort);
  const uploadsRoot = path.join(path.dirname(livePath), 'rollback-uploads');
  const recoveryRoot = path.join(path.dirname(livePath), 'rollback-recovery');
  await Promise.all([
    fs.mkdir(uploadsRoot, { mode: 0o700 }),
    fs.mkdir(recoveryRoot, { mode: 0o700 })
  ]);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: checkoutRoot,
    env: {
      ...process.env,
      PORT: String(expectedPort),
      [LEGACY_DATA_ENV]: livePath,
      [LEGACY_UPLOADS_ENV]: uploadsRoot,
      [LEGACY_RECOVERY_ENV]: recoveryRoot,
      PRIORENA_DEMO_MODE: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let spawnError;
  child.once('error', error => { spawnError = error; });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const output = { stdout: captureBounded(child.stdout), stderr: captureBounded(child.stderr), spawnError: () => spawnError };
  let stopped = false;
  try {
    const origin = await waitForRollbackReady(child, expectedPort, output);
    const processEvidence = diagnosticStage('ROLLBACK_PROCESS_VALIDATION_FAILED', () => inspectValidatedProcess({
      pid: child.pid,
      expectedCwd: checkoutRoot,
      expectedPort,
      expectedCommandFragment: 'server.js'
    }));
    await diagnosticStageAsync('ROLLBACK_ROOT_SMOKE_FAILED', async () => {
      const rootResponse = await fetch(`${origin}/`);
      assert.equal(rootResponse.status, 200);
      assert.match(await rootResponse.text(), /Priorena/);
    });
    await diagnosticStageAsync('ROLLBACK_DATA_SMOKE_FAILED', async () => {
      const projectsResponse = await fetch(`${origin}/api/projects`);
      assert.equal(projectsResponse.status, 200);
      assert.deepEqual(await projectsResponse.json(), {});
    });
    if (output.stdout.overflowed() || output.stderr.overflowed()) throw codedError('ROLLBACK_OUTPUT_LIMIT_EXCEEDED', 'Rollback application exceeded the bounded log limit');
    await diagnosticStageAsync('ROLLBACK_STOP_VALIDATION_FAILED', () => stopValidatedProcess({
      pid: child.pid,
      expectedCwd: checkoutRoot,
      expectedPort,
      expectedCommandFragment: 'server.js'
    }));
    stopped = true;
    const ended = await exit;
    if (ended.signal !== 'SIGTERM' && ended.code !== 0) throw codedError('ROLLBACK_STOP_FAILED', 'Rollback application did not stop cleanly');
    return Object.freeze({ status: 'passed', host: '127.0.0.1', processValidated: processEvidence.commandMatched, legacyRuntimeReadOnly: true });
  } finally {
    if (!stopped && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 2_000))]);
    }
  }
}

module.exports = {
  LEGACY_DATA_ENV,
  MAX_PROCESS_OUTPUT_BYTES,
  captureBounded,
  codedError,
  diagnosticStage,
  diagnosticStageAsync,
  materializeRollbackApplication,
  reserveLoopbackPort,
  smokeRollbackApplication,
  waitForRollbackReady
};
