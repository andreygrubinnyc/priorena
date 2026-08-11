'use strict';

const { performCutover } = require('./file-operations');
const { assertNoLiveWriter } = require('./process-safety');
const { parseFlagPairs } = require('./safety');

const CUTOVER_ACKNOWLEDGEMENT = 'APPROVE_ONE_LIVE_CUTOVER';
const NO_PROCESS_ACKNOWLEDGEMENT = 'NO_RUNNING_PRIORENA_PROCESS';

async function run(argv = process.argv.slice(2)) {
  const allowed = new Set([
    '--live-runtime', '--staged-seed', '--expected-live-checksum', '--expected-seed-checksum',
    '--backup-dir', '--release-commit', '--expected-stopped-pid', '--expected-port',
    '--acknowledgement', '--no-running-process-ack'
  ]);
  const required = new Set([...allowed].filter(flag => flag !== '--no-running-process-ack'));
  const args = parseFlagPairs(argv, allowed, required);
  if (args['--acknowledgement'] !== CUTOVER_ACKNOWLEDGEMENT) throw new Error('The exact live-cutover acknowledgement is required');
  if (args['--expected-stopped-pid'] === 'none' && args['--no-running-process-ack'] !== NO_PROCESS_ACKNOWLEDGEMENT) {
    throw new Error('The exact no-running-process acknowledgement is required when no prior PID exists');
  }
  assertNoLiveWriter({
    expectedStoppedPid: args['--expected-stopped-pid'],
    expectedPort: args['--expected-port'],
    livePath: args['--live-runtime']
  });
  const result = await performCutover({
    livePath: args['--live-runtime'],
    stagedSeedPath: args['--staged-seed'],
    expectedLiveChecksum: args['--expected-live-checksum'],
    expectedSeedChecksum: args['--expected-seed-checksum'],
    backupDirectory: args['--backup-dir'],
    releaseCommit: args['--release-commit']
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`Live cutover failed: ${String(error?.code || error?.name || 'CUTOVER_ERROR')}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CUTOVER_ACKNOWLEDGEMENT,
  NO_PROCESS_ACKNOWLEDGEMENT,
  run
};
