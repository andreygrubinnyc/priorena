'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { assertOutsideRepository } = require('../scripts/release/safety');

const MAX_LOG_BYTES = 1024 * 1024;
const MAX_FIELD_CHARS = 300;
const ALLOWED_FIELDS = new Set([
  'category',
  'dataFileIdentity',
  'errorCode',
  'host',
  'port',
  'revision',
  'sourceRootIdentity',
  'status'
]);

function pathIdentity(value) {
  return crypto.createHash('sha256').update(path.resolve(value)).digest('hex');
}

function sanitizeFields(fields = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(key) || value === undefined || value === null) continue;
    safe[key] = String(value).replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_FIELD_CHARS);
  }
  return safe;
}

function createOperationalLogger({ logFile, repositoryRoot = process.cwd(), clock = () => new Date().toISOString() }) {
  if (typeof logFile !== 'string' || logFile.trim() === '') throw new TypeError('An explicit private operational log path is required');
  const resolvedLog = assertOutsideRepository(logFile, repositoryRoot, 'Operational logs');
  fs.mkdirSync(path.dirname(resolvedLog), { recursive: true, mode: 0o700 });
  if (fs.existsSync(resolvedLog)) {
    const existing = fs.lstatSync(resolvedLog);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('The operational log must be a regular non-symlink file');
    if ((existing.mode & 0o777) !== 0o600) throw new Error('The operational log must use mode 0600');
    if (existing.size > MAX_LOG_BYTES) throw new Error('The operational log reached its bounded size limit');
  }
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const descriptor = fs.openSync(resolvedLog, fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY | noFollow, 0o600);
  fs.fchmodSync(descriptor, 0o600);
  let size = fs.fstatSync(descriptor).size;

  function write(level, event, fields) {
    const record = {
      timestamp: clock(),
      level,
      event: String(event || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100),
      ...sanitizeFields(fields)
    };
    const line = `${JSON.stringify(record)}\n`;
    const bytes = Buffer.byteLength(line);
    if (size + bytes > MAX_LOG_BYTES) throw new Error('The operational log reached its bounded size limit');
    fs.writeSync(descriptor, line);
    fs.fsyncSync(descriptor);
    size += bytes;
  }

  return Object.freeze({
    info: (event, fields) => write('info', event, fields),
    error: (event, fields) => write('error', event, fields),
    close: () => fs.closeSync(descriptor),
    pathIdentity: pathIdentity(resolvedLog)
  });
}

module.exports = {
  MAX_LOG_BYTES,
  createOperationalLogger,
  pathIdentity,
  sanitizeFields
};
