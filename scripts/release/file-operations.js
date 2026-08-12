'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsConstants = require('node:fs').constants;
const path = require('node:path');

const { validateSeed } = require('./validate-seed');
const { assertOutsideRepository, requireExplicitPath } = require('./safety');

const MAX_OPERATIONAL_FILE_BYTES = 64 * 1024 * 1024;
const MINIMUM_FREE_SPACE_MARGIN = 1024 * 1024;

function checksumPattern(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError(`${label} must be an exact lowercase SHA-256 checksum`);
  return value;
}

function releaseCommitPattern(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) throw new TypeError('Release commit must be an exact full Git commit hash');
  return value;
}

async function inspectPrivateFile(filePath, label) {
  const resolved = requireExplicitPath(filePath, label);
  const stats = await fs.lstat(resolved);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if ((stats.mode & 0o777) !== 0o600) throw new Error(`${label} must use mode 0600`);
  if (stats.size > MAX_OPERATIONAL_FILE_BYTES) throw new Error(`${label} exceeds the bounded operational file limit`);
  return { path: resolved, stats };
}

async function checksumFile(filePath) {
  const bytes = await fs.readFile(filePath);
  if (bytes.length > MAX_OPERATIONAL_FILE_BYTES) throw new Error('Operational file exceeds the bounded checksum limit');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function syncFile(filePath) {
  const handle = await fs.open(filePath, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directoryPath) {
  const handle = await fs.open(directoryPath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function timestampLabel(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Release timestamp is invalid');
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function availableBytes(directoryPath) {
  const stats = await fs.statfs(directoryPath, { bigint: true });
  return stats.bavail * stats.bsize;
}

async function writePrivateJson(filePath, value, repositoryRoot = process.cwd()) {
  const resolved = assertOutsideRepository(filePath, repositoryRoot, 'Private release manifest');
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const handle = await fs.open(resolved, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW || 0), 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(resolved));
  return resolved;
}

async function createVerifiedBackup(options) {
  const source = await inspectPrivateFile(options.sourcePath, 'Backup source');
  const backupDirectory = assertOutsideRepository(options.backupDirectory, options.repositoryRoot, 'Backup directory');
  const directoryStats = await fs.lstat(backupDirectory);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) throw new Error('Backup directory must be a regular non-symlink directory');
  const expected = checksumPattern(options.expectedSourceChecksum, 'Expected source checksum');
  const beforeChecksum = await checksumFile(source.path);
  if (beforeChecksum !== expected) throw new Error('Backup source checksum does not match the authorized value');
  const getAvailableBytes = options.hooks?.availableBytes || availableBytes;
  const freeBytes = await getAvailableBytes(backupDirectory);
  if (BigInt(freeBytes) < BigInt(source.stats.size + MINIMUM_FREE_SPACE_MARGIN)) throw new Error('Insufficient free space for the verified backup');

  const label = timestampLabel(options.timestamp);
  const backupPath = path.join(backupDirectory, `${path.basename(source.path)}.${label}.backup`);
  const manifestPath = `${backupPath}.manifest.json`;
  if (backupPath === source.path) throw new Error('Backup destination must differ from the live source');
  for (const candidate of [backupPath, manifestPath]) {
    if (await fs.stat(candidate).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))) {
      throw new Error('A backup or manifest already exists at the timestamped destination');
    }
  }

  const temporaryPath = path.join(backupDirectory, `.${path.basename(backupPath)}.partial-${crypto.randomUUID()}`);
  const copyFile = options.hooks?.copyFile || fs.copyFile;
  const sync = options.hooks?.syncFile || syncFile;
  const link = options.hooks?.link || fs.link;
  let linked = false;
  try {
    await copyFile(source.path, temporaryPath, fsConstants.COPYFILE_EXCL);
    await fs.chmod(temporaryPath, 0o600);
    await sync(temporaryPath);
    const temporary = await inspectPrivateFile(temporaryPath, 'Temporary backup');
    const copiedChecksum = await checksumFile(temporary.path);
    const afterChecksum = await checksumFile(source.path);
    const afterStats = await fs.stat(source.path);
    if (temporary.stats.size !== source.stats.size || copiedChecksum !== expected || afterChecksum !== expected || afterStats.size !== source.stats.size) {
      throw new Error('Backup verification failed or the source changed during backup');
    }
    await link(temporaryPath, backupPath);
    linked = true;
    await syncDirectory(backupDirectory);
    await fs.unlink(temporaryPath);
    const final = await inspectPrivateFile(backupPath, 'Verified backup');
    const finalChecksum = await checksumFile(backupPath);
    if (final.stats.size !== source.stats.size || finalChecksum !== expected) throw new Error('Final backup verification failed');
    const manifest = {
      operation: 'backup',
      status: 'verified',
      timestamp: new Date(options.timestamp || Date.now()).toISOString(),
      sourcePath: source.path,
      backupPath,
      byteSize: final.stats.size,
      mode: '0600',
      sha256: finalChecksum
    };
    await writePrivateJson(manifestPath, manifest, options.repositoryRoot);
    return Object.freeze({ ...manifest, manifestPath });
  } catch (error) {
    if (!linked) await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function atomicReplaceFromFile(options) {
  const live = await inspectPrivateFile(options.livePath, 'Live runtime');
  const replacement = await inspectPrivateFile(options.replacementPath, 'Replacement source');
  if (live.path === replacement.path) throw new Error('Replacement source must differ from the live runtime');
  const expectedLive = checksumPattern(options.expectedLiveChecksum, 'Expected live checksum');
  const expectedReplacement = checksumPattern(options.expectedReplacementChecksum, 'Expected replacement checksum');
  if (await checksumFile(live.path) !== expectedLive) throw new Error('Live runtime checksum changed before atomic replacement');
  if (await checksumFile(replacement.path) !== expectedReplacement) throw new Error('Replacement checksum does not match the authorized value');
  const bytes = await fs.readFile(replacement.path);
  const temporaryPath = path.join(path.dirname(live.path), `.${path.basename(live.path)}.replacement-${crypto.randomUUID()}`);
  let renamed = false;
  try {
    const handle = await fs.open(temporaryPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW || 0), 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.chmod(temporaryPath, 0o600);
    if (await checksumFile(temporaryPath) !== expectedReplacement) throw new Error('Same-directory replacement verification failed');
    if (await checksumFile(live.path) !== expectedLive) throw new Error('Live runtime checksum changed immediately before replacement');
    const rename = options.hooks?.rename || fs.rename;
    await rename(temporaryPath, live.path);
    renamed = true;
    const syncParent = options.hooks?.syncDirectory || syncDirectory;
    await syncParent(path.dirname(live.path));
    const final = await inspectPrivateFile(live.path, 'Replaced live runtime');
    if (final.stats.size !== replacement.stats.size || await checksumFile(live.path) !== expectedReplacement) {
      throw new Error('Atomic replacement result did not match the staged source');
    }
    if (await checksumFile(replacement.path) !== expectedReplacement) throw new Error('Replacement source changed during atomic replacement');
    return Object.freeze({
      livePath: live.path,
      previousChecksum: expectedLive,
      checksum: expectedReplacement,
      byteSize: final.stats.size,
      mode: '0600'
    });
  } catch (error) {
    error.replacementApplied = renamed;
    if (!renamed) await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function restoreVerifiedBackup(options) {
  const backup = await inspectPrivateFile(options.backupPath, 'Verified backup');
  const expectedBackup = checksumPattern(options.expectedBackupChecksum, 'Expected backup checksum');
  if (await checksumFile(backup.path) !== expectedBackup) throw new Error('Backup checksum does not match the authorized value');
  const replacement = await atomicReplaceFromFile({
    livePath: options.livePath,
    replacementPath: backup.path,
    expectedLiveChecksum: options.expectedLiveChecksum,
    expectedReplacementChecksum: expectedBackup,
    hooks: options.hooks
  });
  if (await checksumFile(backup.path) !== expectedBackup) throw new Error('Verified backup changed during restore');
  const recordPath = options.recordPath || `${backup.path}.rollback-${timestampLabel(options.timestamp)}.json`;
  const record = {
    operation: 'restore',
    status: 'verified',
    timestamp: new Date(options.timestamp || Date.now()).toISOString(),
    livePath: replacement.livePath,
    backupPath: backup.path,
    byteSize: backup.stats.size,
    mode: '0600',
    sha256: expectedBackup
  };
  await writePrivateJson(recordPath, record, options.repositoryRoot);
  return Object.freeze({ ...record, recordPath });
}

async function performCutover(options) {
  const releaseCommit = releaseCommitPattern(options.releaseCommit);
  const expectedSeedChecksum = checksumPattern(options.expectedSeedChecksum, 'Expected staged-seed checksum');
  const seed = await validateSeed(options.stagedSeedPath);
  if (seed.sha256 !== expectedSeedChecksum) throw new Error('Validated staged-seed checksum does not match the authorized value');
  const backup = await createVerifiedBackup({
    sourcePath: options.livePath,
    backupDirectory: options.backupDirectory,
    expectedSourceChecksum: options.expectedLiveChecksum,
    timestamp: options.timestamp,
    repositoryRoot: options.repositoryRoot,
    hooks: options.hooks
  });
  let replacement;
  try {
    replacement = await atomicReplaceFromFile({
      livePath: options.livePath,
      replacementPath: options.stagedSeedPath,
      expectedLiveChecksum: options.expectedLiveChecksum,
      expectedReplacementChecksum: expectedSeedChecksum,
      hooks: options.hooks
    });
    const recordPath = `${backup.backupPath}.cutover.json`;
    const record = {
      operation: 'cutover',
      status: 'replaced-and-verified',
      timestamp: new Date(options.timestamp || Date.now()).toISOString(),
      releaseCommit,
      livePath: replacement.livePath,
      stagedSeedPath: path.resolve(options.stagedSeedPath),
      backupPath: backup.backupPath,
      oldChecksum: backup.sha256,
      newChecksum: replacement.checksum,
      byteSize: replacement.byteSize,
      mode: replacement.mode
    };
    await writePrivateJson(recordPath, record, options.repositoryRoot);
    return Object.freeze({ ...record, recordPath, backupManifestPath: backup.manifestPath });
  } catch (error) {
    const applied = Boolean(error.replacementApplied || replacement);
    if (applied) {
      try {
        const currentChecksum = await checksumFile(options.livePath);
        error.rollbackResult = await restoreVerifiedBackup({
          livePath: options.livePath,
          backupPath: backup.backupPath,
          expectedLiveChecksum: currentChecksum,
          expectedBackupChecksum: backup.sha256,
          timestamp: options.timestamp,
          repositoryRoot: options.repositoryRoot,
          hooks: options.rollbackHooks
        });
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      error.rollbackAttempted = true;
    }
    throw error;
  }
}

module.exports = {
  MAX_OPERATIONAL_FILE_BYTES,
  MINIMUM_FREE_SPACE_MARGIN,
  atomicReplaceFromFile,
  availableBytes,
  checksumFile,
  checksumPattern,
  createVerifiedBackup,
  inspectPrivateFile,
  performCutover,
  releaseCommitPattern,
  restoreVerifiedBackup,
  syncDirectory,
  syncFile,
  timestampLabel,
  writePrivateJson
};
