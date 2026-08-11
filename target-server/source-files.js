'use strict';

const fs = require('node:fs/promises');
const fsConstants = require('node:fs').constants;
const path = require('node:path');

const { notFound } = require('./errors');

const MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;
const MEDIA_TYPES_BY_EXTENSION = Object.freeze({
  '.csv': 'text/csv; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
});

function requireExplicitRoot(rootPath) {
  if (typeof rootPath !== 'string' || rootPath.trim() === '') throw new TypeError('Target Source-file access requires an explicit safe root');
  return path.resolve(rootPath);
}

function isContained(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function safeDownloadName(value) {
  const basename = path.basename(String(value || 'source-file').replaceAll('\\', '/'));
  const safe = basename.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/[\r\n"]/g, '_').slice(0, 160);
  return safe || 'source-file';
}

function sameFileSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function assertPathStillIdentifiesOpenFile({
  rootPath,
  candidatePath,
  expectedRealRoot,
  expectedRealCandidate,
  openedStats
}) {
  let currentRealRoot;
  let currentRealCandidate;
  let currentStats;
  try {
    [currentRealRoot, currentRealCandidate] = await Promise.all([
      fs.realpath(rootPath),
      fs.realpath(candidatePath)
    ]);
    currentStats = await fs.stat(currentRealCandidate);
  } catch (_) {
    throw notFound();
  }
  if (currentRealRoot !== expectedRealRoot
    || currentRealCandidate !== expectedRealCandidate
    || !isContained(currentRealRoot, currentRealCandidate)
    || !sameFileSnapshot(currentStats, openedStats)) {
    throw notFound();
  }
}

function fileMetadata(source) {
  const metadata = source.metadata?.file;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw notFound();
  const allowed = new Set(['relativePath', 'displayName', 'mediaType', 'byteLength']);
  if (Object.keys(metadata).some(key => !allowed.has(key))) throw notFound();
  if (typeof metadata.relativePath !== 'string' || metadata.relativePath.length === 0 || metadata.relativePath.length > 500) throw notFound();
  if (path.isAbsolute(metadata.relativePath) || metadata.relativePath.includes('\0')) throw notFound();
  if (typeof metadata.displayName !== 'string' || metadata.displayName.length === 0 || metadata.displayName.length > 300) throw notFound();
  if (typeof metadata.mediaType !== 'string' || metadata.mediaType.length === 0 || metadata.mediaType.length > 200) throw notFound();
  if (!Number.isSafeInteger(metadata.byteLength) || metadata.byteLength < 0 || metadata.byteLength > MAX_SOURCE_FILE_BYTES) throw notFound();
  return metadata;
}

async function readSourceFile(source, sourceFilesRoot) {
  const rootPath = requireExplicitRoot(sourceFilesRoot);
  const metadata = fileMetadata(source);
  const candidatePath = path.resolve(rootPath, metadata.relativePath);
  if (!isContained(rootPath, candidatePath)) throw notFound();

  const extension = path.extname(metadata.displayName).toLowerCase();
  const storedExtension = path.extname(metadata.relativePath).toLowerCase();
  const mediaType = MEDIA_TYPES_BY_EXTENSION[extension];
  if (!mediaType || storedExtension !== extension || metadata.mediaType.toLowerCase() !== mediaType.split(';')[0]) throw notFound();

  let realRoot;
  let realCandidate;
  let initialStats;
  try {
    [realRoot, realCandidate] = await Promise.all([fs.realpath(rootPath), fs.realpath(candidatePath)]);
    initialStats = await fs.stat(realCandidate);
  } catch (_) {
    throw notFound();
  }
  if (!isContained(realRoot, realCandidate) || !initialStats.isFile()) throw notFound();

  let handle;
  try {
    handle = await fs.open(realCandidate, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const stats = await handle.stat();
    if (!stats.isFile()
      || !sameFileSnapshot(initialStats, stats)
      || stats.size > MAX_SOURCE_FILE_BYTES
      || stats.size !== metadata.byteLength) {
      throw notFound();
    }
    const verification = { rootPath, candidatePath, expectedRealRoot: realRoot, expectedRealCandidate: realCandidate, openedStats: stats };
    await assertPathStillIdentifiesOpenFile(verification);
    const bytes = await handle.readFile();
    const finalStats = await handle.stat();
    if (bytes.length !== stats.size || !sameFileSnapshot(stats, finalStats)) throw notFound();
    await assertPathStillIdentifiesOpenFile({ ...verification, openedStats: finalStats });
    return {
      bytes,
      byteLength: bytes.length,
      displayName: safeDownloadName(metadata.displayName),
      mediaType
    };
  } catch (error) {
    if (error && error.code === 'NOT_FOUND') throw error;
    throw notFound();
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

module.exports = {
  MAX_SOURCE_FILE_BYTES,
  MEDIA_TYPES_BY_EXTENSION,
  fileMetadata,
  isContained,
  readSourceFile,
  requireExplicitRoot,
  safeDownloadName,
  sameFileSnapshot
};
