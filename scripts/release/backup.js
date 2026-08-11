'use strict';

const { createVerifiedBackup } = require('./file-operations');
const { parseFlagPairs } = require('./safety');

async function run(argv = process.argv.slice(2)) {
  const args = parseFlagPairs(argv, new Set(['--source', '--backup-dir', '--expected-source-checksum']));
  const result = await createVerifiedBackup({
    sourcePath: args['--source'],
    backupDirectory: args['--backup-dir'],
    expectedSourceChecksum: args['--expected-source-checksum']
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`Verified backup failed: ${String(error?.code || error?.name || 'BACKUP_ERROR')}\n`);
    process.exitCode = 1;
  });
}

module.exports = { run };
