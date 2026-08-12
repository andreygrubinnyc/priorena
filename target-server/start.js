'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { readTargetDataWithRevision } = require('../target-model/persistence');
const { createTargetApiApp } = require('./app');
const { createOperationalLogger, pathIdentity } = require('./operational-log');

const LOOPBACK_HOST = '127.0.0.1';

function parseArguments(argv) {
  const values = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--data-file', '--source-files-root', '--log-file', '--port'].includes(flag) || value === undefined || flag in values) {
      throw new Error('Usage: node target-server/start.js --data-file <target-v2.json> --source-files-root <directory> --log-file <private-log> [--port <port>]');
    }
    values[flag] = value;
  }
  if (!values['--data-file'] || !values['--source-files-root'] || !values['--log-file']) {
    throw new Error('Target startup requires explicit data-file, Source-root, and private log paths');
  }
  const port = values['--port'] === undefined ? 3100 : Number(values['--port']);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('The target port is invalid');
  return Object.freeze({
    targetDataFile: path.resolve(values['--data-file']),
    sourceFilesRoot: path.resolve(values['--source-files-root']),
    logFile: path.resolve(values['--log-file']),
    port
  });
}

async function requirePrivateRegularFile(filePath) {
  const stats = await fs.lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('The target data file must be a regular non-symlink file');
  if ((stats.mode & 0o777) !== 0o600) throw new Error('The target data file must use mode 0600');
}

async function requirePrivateDirectory(directoryPath) {
  const stats = await fs.lstat(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('The Source root must be a regular non-symlink directory');
  if ((stats.mode & 0o077) !== 0) throw new Error('The Source root must not grant group or world access');
}

async function validateTargetStartup(options) {
  await Promise.all([
    requirePrivateRegularFile(options.targetDataFile),
    requirePrivateDirectory(options.sourceFilesRoot)
  ]);
  const { revision } = await readTargetDataWithRevision(options.targetDataFile);
  return Object.freeze({
    revision,
    dataFileIdentity: pathIdentity(options.targetDataFile),
    sourceRootIdentity: pathIdentity(options.sourceFilesRoot)
  });
}

async function startTargetServer(options) {
  let logger;
  let server;
  try {
    logger = createOperationalLogger({ logFile: options.logFile, repositoryRoot: options.repositoryRoot });
    const validated = await validateTargetStartup(options);
    const { app } = createTargetApiApp({
      targetDataFile: options.targetDataFile,
      sourceFilesRoot: options.sourceFilesRoot,
      logger
    });
    server = app.listen(options.port, LOOPBACK_HOST);
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    logger.info('startup', {
      status: 'success',
      host: LOOPBACK_HOST,
      port: address.port,
      revision: validated.revision,
      dataFileIdentity: validated.dataFileIdentity,
      sourceRootIdentity: validated.sourceRootIdentity
    });
    process.stdout.write(`Priorena target ready on ${LOOPBACK_HOST}:${address.port} at /target/\n`);
    return Object.freeze({ server, logger, ...validated });
  } catch (error) {
    if (server?.listening) await new Promise(resolve => server.close(() => resolve()));
    if (logger) {
      try {
        logger.error('startup', { status: 'failure', category: 'validation-or-listen', errorCode: error?.code || error?.name });
      } catch (_) {
        // Preserve the original startup failure if the bounded log is full.
      }
      try { logger.close(); } catch (_) {}
    }
    throw error;
  }
}

async function run() {
  const started = await startTargetServer(parseArguments(process.argv.slice(2)));
  let stopping = false;
  const stop = signal => {
    if (stopping) return;
    stopping = true;
    try { started.logger.info('shutdown', { status: 'requested', category: signal }); } catch (_) {}
    started.server.close(error => {
      try {
        if (error) started.logger.error('shutdown', { status: 'failure', errorCode: error.code || error.name });
        else started.logger.info('shutdown', { status: 'success' });
      } catch (_) {
        // Shutdown remains exact even when the bounded log cannot accept more bytes.
      }
      try { started.logger.close(); } catch (_) {}
      process.exitCode = error ? 1 : 0;
    });
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`Target startup failed: ${String(error?.code || error?.name || 'STARTUP_ERROR')}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  LOOPBACK_HOST,
  parseArguments,
  requirePrivateDirectory,
  requirePrivateRegularFile,
  startTargetServer,
  validateTargetStartup
};
