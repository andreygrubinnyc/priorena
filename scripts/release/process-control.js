'use strict';

const { inspectValidatedProcess, stopValidatedProcess } = require('./process-safety');
const { parseFlagPairs } = require('./safety');

const STOP_ACKNOWLEDGEMENT = 'STOP_VALIDATED_PRIORENA_PROCESS';

async function run(argv = process.argv.slice(2)) {
  const action = argv[0];
  if (!['inspect', 'stop'].includes(action)) throw new Error('Process action must be inspect or stop');
  const allowed = new Set(['--pid', '--expected-cwd', '--expected-command', '--expected-port', '--acknowledgement']);
  const required = new Set(['--pid', '--expected-cwd', '--expected-command', '--expected-port']);
  const args = parseFlagPairs(argv.slice(1), allowed, required);
  const options = {
    pid: args['--pid'],
    expectedCwd: args['--expected-cwd'],
    expectedCommandFragment: args['--expected-command'],
    expectedPort: args['--expected-port']
  };
  const result = action === 'inspect'
    ? inspectValidatedProcess(options)
    : await (async () => {
      if (args['--acknowledgement'] !== STOP_ACKNOWLEDGEMENT) throw new Error('The exact process-stop acknowledgement is required');
      return stopValidatedProcess(options);
    })();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`Process control failed: ${String(error?.code || error?.name || 'PROCESS_ERROR')}\n`);
    process.exitCode = 1;
  });
}

module.exports = { STOP_ACKNOWLEDGEMENT, run };
