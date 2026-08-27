'use strict';

const crypto = require('node:crypto');
const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

const { migrateTargetDataV5ToV6 } = require('../../target-model/migrate-v5-to-v6');
const {
  MAX_TARGET_READ_BYTES,
  readTargetDataWithRevision,
  serializeTargetData
} = require('../../target-model/persistence');
const { assertOutsideRepository, parseFlagPairs } = require('./safety');

class SchemaMigrationFileError extends Error {
  constructor(message, code, options = {}) {
    super(message, options);
    this.name = 'SchemaMigrationFileError';
    this.code = code;
  }
}

function revisionForBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function readPrivateSource(sourcePath) {
  let handle;
  try {
    handle = await fs.open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new SchemaMigrationFileError('Migration source must be a regular non-symlink file', 'INVALID_MIGRATION_SOURCE_FILE');
    }
    if ((stats.mode & 0o777) !== 0o600) {
      throw new SchemaMigrationFileError('Migration source must use mode 0600', 'INVALID_MIGRATION_SOURCE_MODE');
    }
    if (stats.size > MAX_TARGET_READ_BYTES) {
      throw new SchemaMigrationFileError('Migration source exceeds the bounded target-data read limit', 'MIGRATION_SOURCE_TOO_LARGE');
    }
    const bytes = await handle.readFile();
    if (bytes.length > MAX_TARGET_READ_BYTES) {
      throw new SchemaMigrationFileError('Migration source exceeds the bounded target-data read limit', 'MIGRATION_SOURCE_TOO_LARGE');
    }
    return { bytes, revision: revisionForBytes(bytes) };
  } catch (error) {
    if (error instanceof SchemaMigrationFileError) throw error;
    throw new SchemaMigrationFileError('Migration source must be a readable regular non-symlink file', 'INVALID_MIGRATION_SOURCE_FILE', { cause: error });
  } finally {
    if (handle) await handle.close();
  }
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeExclusiveCandidate(destinationPath, bytes) {
  const directory = path.dirname(destinationPath);
  const directoryStats = await fs.lstat(directory);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new SchemaMigrationFileError('Migration destination parent must be a regular directory', 'INVALID_MIGRATION_DESTINATION_DIRECTORY');
  }

  const temporaryPath = path.join(
    directory,
    `.${path.basename(destinationPath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  let handle = null;
  let destinationCreated = false;
  let candidateIdentity = null;
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    const candidateStats = await handle.stat();
    candidateIdentity = { dev: candidateStats.dev, ino: candidateStats.ino };
    await handle.close();
    handle = null;

    await fs.link(temporaryPath, destinationPath);
    destinationCreated = true;
    await fs.unlink(temporaryPath);
    await syncDirectory(directory);
    const remove = async () => {
      if (!destinationCreated) return;
      let currentStats;
      try {
        currentStats = await fs.lstat(destinationPath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          destinationCreated = false;
          return;
        }
        throw error;
      }
      if (currentStats.dev !== candidateIdentity.dev || currentStats.ino !== candidateIdentity.ino) {
        throw new SchemaMigrationFileError(
          'Migration candidate path no longer identifies the created candidate',
          'MIGRATION_CANDIDATE_CLEANUP_REFUSED'
        );
      }
      await fs.unlink(destinationPath);
      await syncDirectory(directory);
      destinationCreated = false;
    };
    return { candidateIdentity, remove };
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch (_) {
        // The original failure remains authoritative.
      }
    }
    try {
      await fs.unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        throw new SchemaMigrationFileError(
          'Migration write failed and temporary-file cleanup also failed',
          'MIGRATION_TEMP_CLEANUP_FAILED',
          { cause: error }
        );
      }
    }
    if (destinationCreated) {
      try {
        const currentStats = await fs.lstat(destinationPath);
        if (currentStats.dev === candidateIdentity.dev && currentStats.ino === candidateIdentity.ino) {
          await fs.unlink(destinationPath);
          await syncDirectory(directory);
        }
      } catch (cleanupError) {
        if (cleanupError.code === 'ENOENT') {
          destinationCreated = false;
        } else {
          throw new SchemaMigrationFileError(
            'Migration write failed and candidate cleanup also failed',
            'MIGRATION_CANDIDATE_CLEANUP_FAILED',
            { cause: error }
          );
        }
      }
    }
    if (error.code === 'EEXIST') {
      throw new SchemaMigrationFileError('Migration destination already exists', 'MIGRATION_DESTINATION_EXISTS');
    }
    if (error instanceof SchemaMigrationFileError) throw error;
    throw new SchemaMigrationFileError('Unable to write the migration candidate', 'MIGRATION_DESTINATION_WRITE_FAILED', { cause: error });
  }
}

async function migrateFile(sourcePath, destinationPath) {
  if (sourcePath === destinationPath) {
    throw new SchemaMigrationFileError('Migration requires different source and destination files', 'MIGRATION_IN_PLACE_FORBIDDEN');
  }
  const source = await readPrivateSource(sourcePath);
  let sourceDocument;
  try {
    sourceDocument = JSON.parse(source.bytes.toString('utf8'));
  } catch (error) {
    throw new SchemaMigrationFileError('Migration source is not valid JSON', 'INVALID_MIGRATION_SOURCE_JSON', { cause: error });
  }

  const candidate = migrateTargetDataV5ToV6(sourceDocument);
  const candidateBytes = Buffer.from(serializeTargetData(candidate), 'utf8');
  const candidateFile = await writeExclusiveCandidate(destinationPath, candidateBytes);
  try {
    const sourceAfter = await readPrivateSource(sourcePath);
    if (sourceAfter.revision !== source.revision) {
      throw new SchemaMigrationFileError('Migration source changed during candidate creation', 'MIGRATION_SOURCE_CHANGED');
    }
    const verified = await readTargetDataWithRevision(destinationPath);
    if (verified.revision !== revisionForBytes(candidateBytes)) {
      throw new SchemaMigrationFileError('Migration candidate revision verification failed', 'MIGRATION_CANDIDATE_VERIFICATION_FAILED');
    }
    const destinationStats = await fs.lstat(destinationPath);
    if (!destinationStats.isFile() || destinationStats.isSymbolicLink() || (destinationStats.mode & 0o777) !== 0o600 ||
      destinationStats.dev !== candidateFile.candidateIdentity.dev || destinationStats.ino !== candidateFile.candidateIdentity.ino) {
      throw new SchemaMigrationFileError('Migration candidate file boundary verification failed', 'MIGRATION_CANDIDATE_FILE_INVALID');
    }
    return {
      fromSchemaVersion: 5,
      toSchemaVersion: verified.document.schemaVersion,
      sourceRevision: source.revision,
      candidateRevision: verified.revision,
      byteSize: destinationStats.size,
      addedCollections: { decisions: 0, risks: 0 },
      existingCollectionsPreserved: true
    };
  } catch (error) {
    await candidateFile.remove();
    throw error;
  }
}

async function run(argv = process.argv.slice(2), repositoryRoot = process.cwd()) {
  const args = parseFlagPairs(argv, new Set(['--source', '--destination']));
  const sourcePath = assertOutsideRepository(args['--source'], repositoryRoot, 'Private schema-v5 source');
  const destinationPath = assertOutsideRepository(args['--destination'], repositoryRoot, 'Private schema-v6 candidate');
  const result = await migrateFile(sourcePath, destinationPath);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`Schema migration candidate failed: ${String(error?.code || error?.name || 'SCHEMA_MIGRATION_ERROR')}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  SchemaMigrationFileError,
  migrateFile,
  readPrivateSource,
  revisionForBytes,
  run,
  writeExclusiveCandidate
};
