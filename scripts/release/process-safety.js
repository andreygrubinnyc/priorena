'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

function codedError(code, message, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function command(commandName, args) {
  const result = spawnSync(commandName, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.error) throw codedError('PROCESS_INSPECTION_COMMAND_UNAVAILABLE', `Required process inspection command is unavailable: ${commandName}`, result.error);
  return result;
}

function requirePid(value) {
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid < 1) throw new TypeError('PID must be a positive integer');
  return pid;
}

function requirePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('Port must be an integer from 1 through 65535');
  return port;
}

function noLsofResult(result, label) {
  const output = String(result.stdout || '').trim();
  if (result.status === 0 && output) throw codedError('PROCESS_RESOURCE_STILL_IN_USE', `${label} is still in use`);
  if (result.status !== 1 || output) throw codedError('PROCESS_RESOURCE_STATE_UNVERIFIED', `${label} could not be verified as unused`);
}

function assertNoLiveWriter({ expectedStoppedPid, expectedPort, livePath, runner = command }) {
  if (expectedStoppedPid !== 'none') {
    const pid = requirePid(expectedStoppedPid);
    try {
      process.kill(pid, 0);
      throw codedError('PROCESS_EXPECTED_PID_STILL_RUNNING', 'The expected Priorena PID is still running');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  const port = requirePort(expectedPort);
  const resolvedLive = path.resolve(livePath);
  noLsofResult(runner('lsof', ['-nP', '-t', '--', resolvedLive]), 'Live runtime file');
  noLsofResult(runner('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']), 'Expected loopback port');
  return Object.freeze({ expectedStoppedPid, expectedPort: port, livePath: resolvedLive, verifiedStopped: true });
}

function inspectValidatedProcess({ pid, expectedCwd, expectedPort, expectedCommandFragment, runner = command }) {
  const validatedPid = requirePid(pid);
  const port = requirePort(expectedPort);
  const expectedDirectory = path.resolve(expectedCwd);
  if (typeof expectedCommandFragment !== 'string' || expectedCommandFragment.length < 3) throw new TypeError('Expected command fragment is required');
  const processResult = runner('ps', ['-ww', '-p', String(validatedPid), '-o', 'args=', '-o', 'comm=']);
  if (processResult.status !== 0 || !String(processResult.stdout).includes(expectedCommandFragment)) throw codedError('PROCESS_COMMAND_MISMATCH', 'PID command does not match the expected Priorena command');
  const cwdResult = runner('lsof', ['-a', '-p', String(validatedPid), '-d', 'cwd', '-Fn']);
  if (cwdResult.status !== 0 || !String(cwdResult.stdout).split(/\r?\n/).includes(`n${expectedDirectory}`)) throw codedError('PROCESS_CWD_MISMATCH', 'PID working directory does not match the expected release checkout');
  const portResult = runner('lsof', ['-nP', '-a', '-p', String(validatedPid), `-iTCP:${port}`, '-sTCP:LISTEN', '-Fn']);
  const portOutput = String(portResult.stdout);
  if (portResult.status !== 0
    || !portOutput.includes(`p${validatedPid}`)
    || !portOutput.split(/\r?\n/).includes(`n127.0.0.1:${port}`)) {
    throw codedError('PROCESS_LOOPBACK_PORT_MISMATCH', 'PID does not own the expected loopback-only listening port');
  }
  return Object.freeze({ pid: validatedPid, cwd: expectedDirectory, port, commandMatched: true });
}

async function stopValidatedProcess(options) {
  const evidence = inspectValidatedProcess(options);
  const runner = options.runner || command;
  process.kill(evidence.pid, 'SIGTERM');
  const timeoutMs = options.timeoutMs === undefined ? 10_000 : Number(options.timeoutMs);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(evidence.pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') {
        noLsofResult(runner('lsof', ['-nP', `-iTCP:${evidence.port}`, '-sTCP:LISTEN', '-t']), 'Expected loopback port');
        return Object.freeze({ ...evidence, stopped: true, portClosed: true, signal: 'SIGTERM' });
      }
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw codedError('PROCESS_STOP_TIMEOUT', 'The validated Priorena PID did not exit after SIGTERM; no broader signal was sent');
}

module.exports = {
  assertNoLiveWriter,
  codedError,
  command,
  inspectValidatedProcess,
  noLsofResult,
  requirePid,
  requirePort,
  stopValidatedProcess
};
