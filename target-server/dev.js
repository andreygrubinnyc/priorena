'use strict';

const path = require('node:path');

const { createTargetApiApp } = require('./app');

const LOOPBACK_HOST = '127.0.0.1';

function parseArguments(argv) {
  const values = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--data-file', '--source-files-root', '--port'].includes(flag) || value === undefined) {
      throw new Error('Usage: node target-server/dev.js --data-file <target-v2.json> --source-files-root <directory> [--port <port>]');
    }
    values[flag] = value;
  }
  if (!values['--data-file'] || !values['--source-files-root']) {
    throw new Error('The target development server requires explicit --data-file and --source-files-root paths');
  }
  const port = values['--port'] === undefined ? 3100 : Number(values['--port']);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('The target development port is invalid');
  return Object.freeze({
    targetDataFile: path.resolve(values['--data-file']),
    sourceFilesRoot: path.resolve(values['--source-files-root']),
    port
  });
}

function startTargetDevelopmentServer(options) {
  const { app } = createTargetApiApp(options);
  const server = app.listen(options.port, LOOPBACK_HOST, () => {
    const address = server.address();
    process.stdout.write(`Priorena target UI ready on ${LOOPBACK_HOST}:${address.port} at /target/\n`);
  });
  return server;
}

if (require.main === module) {
  try {
    startTargetDevelopmentServer(parseArguments(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  LOOPBACK_HOST,
  parseArguments,
  startTargetDevelopmentServer
};
