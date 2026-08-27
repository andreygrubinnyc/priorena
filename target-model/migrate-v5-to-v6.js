'use strict';

const { isDeepStrictEqual } = require('node:util');

const {
  ROOT_COLLECTIONS,
  TARGET_SCHEMA_VERSION,
  TargetValidationError,
  validateTargetData
} = require('./schema');

const SOURCE_SCHEMA_VERSION = 5;
const SOURCE_ROOT_COLLECTIONS = Object.freeze(
  ROOT_COLLECTIONS.filter(collection => !['decisions', 'risks'].includes(collection))
);
const SOURCE_ROOT_FIELDS = new Set([
  'schemaVersion',
  ...SOURCE_ROOT_COLLECTIONS,
  'userPreferences',
  'globalTechnicalSettings'
]);

class TargetMigrationError extends TargetValidationError {
  constructor(message, path = '') {
    super(message, path);
    this.name = 'TargetMigrationError';
    this.code = 'INVALID_TARGET_MIGRATION_SOURCE';
  }
}

function migrationFail(path, message) {
  throw new TargetMigrationError(message, path);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateSourceRoot(document) {
  if (!isPlainObject(document)) migrationFail('root', 'must be an object');
  if (document.schemaVersion !== SOURCE_SCHEMA_VERSION) {
    migrationFail('schemaVersion', `must equal ${SOURCE_SCHEMA_VERSION} for this one-way migration`);
  }
  for (const key of Object.keys(document)) {
    if (!SOURCE_ROOT_FIELDS.has(key)) migrationFail('root', `contains unsupported field ${JSON.stringify(key)}`);
  }
  for (const field of SOURCE_ROOT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(document, field)) migrationFail(field, 'is required');
  }
  for (const collection of SOURCE_ROOT_COLLECTIONS) {
    if (!Array.isArray(document[collection])) migrationFail(collection, 'must be an array');
  }
  return document;
}

function legacyProjection(document) {
  const projected = { schemaVersion: SOURCE_SCHEMA_VERSION };
  for (const collection of SOURCE_ROOT_COLLECTIONS) projected[collection] = structuredClone(document[collection]);
  projected.userPreferences = structuredClone(document.userPreferences);
  projected.globalTechnicalSettings = structuredClone(document.globalTechnicalSettings);
  return projected;
}

function migrateTargetDataV5ToV6(sourceDocument) {
  validateSourceRoot(sourceDocument);
  const sourceSnapshot = legacyProjection(sourceDocument);
  const candidate = { schemaVersion: TARGET_SCHEMA_VERSION };
  for (const collection of ROOT_COLLECTIONS) {
    candidate[collection] = ['decisions', 'risks'].includes(collection)
      ? []
      : structuredClone(sourceDocument[collection]);
  }
  candidate.userPreferences = structuredClone(sourceDocument.userPreferences);
  candidate.globalTechnicalSettings = structuredClone(sourceDocument.globalTechnicalSettings);

  validateTargetData(candidate);
  if (!isDeepStrictEqual(legacyProjection(candidate), sourceSnapshot)) {
    migrationFail('root', 'migration changed an existing schema-v5 value');
  }
  return candidate;
}

module.exports = {
  SOURCE_ROOT_COLLECTIONS,
  SOURCE_SCHEMA_VERSION,
  TargetMigrationError,
  legacyProjection,
  migrateTargetDataV5ToV6,
  validateSourceRoot
};
