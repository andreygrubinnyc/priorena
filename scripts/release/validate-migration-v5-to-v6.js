'use strict';

const { migrateTargetDataV5ToV6 } = require('../../target-model/migrate-v5-to-v6');
const { readTargetDataWithRevision, serializeTargetData } = require('../../target-model/persistence');
const { checksumPattern } = require('./file-operations');
const {
  SchemaMigrationFileError,
  readPrivateSource,
  revisionForBytes
} = require('./migrate-schema-v5-to-v6');
const { assertOutsideRepository, parseFlagPairs } = require('./safety');

async function validateMigrationPair(options) {
  if (options.sourcePath === options.candidatePath) {
    throw new SchemaMigrationFileError(
      'Migration source and candidate must be different files',
      'MIGRATION_IN_PLACE_FORBIDDEN'
    );
  }

  const expectedSourceRevision = checksumPattern(
    options.expectedSourceRevision,
    'Expected schema-v5 source checksum'
  );
  const expectedCandidateRevision = checksumPattern(
    options.expectedCandidateRevision,
    'Expected schema-v6 candidate checksum'
  );
  const sourceBefore = await readPrivateSource(options.sourcePath);
  if (sourceBefore.revision !== expectedSourceRevision) {
    throw new SchemaMigrationFileError(
      'Schema-v5 source checksum does not match the authorized value',
      'MIGRATION_SOURCE_REVISION_MISMATCH'
    );
  }

  let sourceDocument;
  try {
    sourceDocument = JSON.parse(sourceBefore.bytes.toString('utf8'));
  } catch (error) {
    throw new SchemaMigrationFileError(
      'Migration source is not valid JSON',
      'INVALID_MIGRATION_SOURCE_JSON',
      { cause: error }
    );
  }

  const exactCandidateDocument = migrateTargetDataV5ToV6(sourceDocument);
  const exactCandidateBytes = Buffer.from(serializeTargetData(exactCandidateDocument), 'utf8');
  const exactCandidateRevision = revisionForBytes(exactCandidateBytes);
  const candidateFile = await readPrivateSource(options.candidatePath);
  if (candidateFile.revision !== expectedCandidateRevision) {
    throw new SchemaMigrationFileError(
      'Schema-v6 candidate checksum does not match the authorized value',
      'MIGRATION_CANDIDATE_REVISION_MISMATCH'
    );
  }
  if (candidateFile.revision !== exactCandidateRevision) {
    throw new SchemaMigrationFileError(
      'Schema-v6 candidate is not the exact migration of the schema-v5 source',
      'MIGRATION_CANDIDATE_NOT_EXACT'
    );
  }

  const validatedCandidate = await readTargetDataWithRevision(options.candidatePath);
  if (validatedCandidate.revision !== candidateFile.revision) {
    throw new SchemaMigrationFileError(
      'Schema-v6 candidate changed during validation',
      'MIGRATION_CANDIDATE_CHANGED'
    );
  }
  const sourceAfter = await readPrivateSource(options.sourcePath);
  if (sourceAfter.revision !== sourceBefore.revision) {
    throw new SchemaMigrationFileError(
      'Schema-v5 source changed during migration-pair validation',
      'MIGRATION_SOURCE_CHANGED'
    );
  }

  return Object.freeze({
    fromSchemaVersion: 5,
    toSchemaVersion: validatedCandidate.document.schemaVersion,
    sourceRevision: sourceBefore.revision,
    candidateRevision: candidateFile.revision,
    byteSize: candidateFile.bytes.length,
    addedCollections: Object.freeze({
      decisions: validatedCandidate.document.decisions.length,
      risks: validatedCandidate.document.risks.length
    }),
    existingCollectionsPreserved: true,
    exactMigration: true
  });
}

async function run(argv = process.argv.slice(2), repositoryRoot = process.cwd()) {
  const args = parseFlagPairs(argv, new Set([
    '--source',
    '--candidate',
    '--expected-source-checksum',
    '--expected-candidate-checksum'
  ]));
  const sourcePath = assertOutsideRepository(args['--source'], repositoryRoot, 'Private schema-v5 source');
  const candidatePath = assertOutsideRepository(args['--candidate'], repositoryRoot, 'Private schema-v6 candidate');
  const result = await validateMigrationPair({
    sourcePath,
    candidatePath,
    expectedSourceRevision: args['--expected-source-checksum'],
    expectedCandidateRevision: args['--expected-candidate-checksum']
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`Migration-pair validation failed: ${String(error?.code || error?.name || 'MIGRATION_VALIDATION_ERROR')}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  run,
  validateMigrationPair
};
