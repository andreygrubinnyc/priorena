'use strict';

const { restoreVerifiedBackup } = require('./file-operations');
const { assertNoLiveWriter } = require('./process-safety');
const { parseFlagPairs } = require('./safety');

const RESTORE_ACKNOWLEDGEMENT = 'RESTORE_VERIFIED_BACKUP';
const NO_PROCESS_ACKNOWLEDGEMENT = 'NO_RUNNING_PRIORENA_PROCESS';

async function run(argv = process.argv.slice(2)) {
  const allowed = new Set([
    '--live-runtime', '--backup', '--expected-live-checksum', '--expected-backup-checksum',
    '--expected-stopped-pid', '--expected-port', '--acknowledgement', '--no-running-process-ack'
  ]);
  const required = new Set([...allowed].filter(flag => flag !== '--no-running-process-ack'));
  const args = parseFlagPairs(argv, allowed, required);
  if (args['--acknowledgement'] !== RESTORE_ACKNOWLEDGEMENT) throw new Error('The exact verified-restore acknowledgement is required');
  if (args['--expected-stopped-pid'] === 'none' && args['--no-running-process-ack'] !== NO_PROCESS_ACKNOWLEDGEMENT) {
    throw new Error('The exact no-running-process acknowledgement is required when no prior PID exists');
  }
  assertNoLiveWriter({
    expectedStoppedPid: args['--expected-stopped-pid'],
    expectedPort: args['--expected-port'],
    livePath: args['--live-runtime']
  });
  const result = await restoreVerifiedBackup({
    livePath: args['--live-runtime'],
    backupPath: args['--backup'],
    expectedLiveChecksum: args['--expected-live-checksum'],
    expectedBackupChecksum: args['--expected-backup-checksum']
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`Verified restore failed: ${String(error?.code || error?.name || 'RESTORE_ERROR')}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  NO_PROCESS_ACKNOWLEDGEMENT,
  RESTORE_ACKNOWLEDGEMENT,
  run
};
