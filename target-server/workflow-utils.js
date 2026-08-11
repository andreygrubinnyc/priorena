'use strict';

const crypto = require('node:crypto');

const {
  readTargetDataWithRevision,
  TargetStaleRevisionError,
  writeTargetData
} = require('../target-model/persistence');
const { createStableId } = require('../target-model/schema');
const { invalidRequest, revisionConflict } = require('./errors');

const REVISION_PATTERN = /^[a-f0-9]{64}$/;
const ACTOR_PATTERN = /^[^\u0000-\u001f\u007f]{1,300}$/;

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function requireObject(value) {
  if (!plainObject(value)) throw invalidRequest();
  return value;
}

function exactKeys(value, allowed, required = []) {
  requireObject(value);
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some(key => !allowedSet.has(key))) throw invalidRequest();
  if (required.some(key => !Object.hasOwn(value, key))) throw invalidRequest();
  return value;
}

function requireText(value, options = {}) {
  const { allowEmpty = false, max = 2_000 } = options;
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw invalidRequest();
  return value;
}

function nullableText(value, options = {}) {
  if (value === null) return null;
  return requireText(value, options);
}

function requireBoolean(value) {
  if (typeof value !== 'boolean') throw invalidRequest();
  return value;
}

function requireEnum(value, accepted) {
  if (!accepted.includes(value)) throw invalidRequest();
  return value;
}

function requireArray(value, options = {}) {
  const { min = 0, max = 100 } = options;
  if (!Array.isArray(value) || value.length < min || value.length > max) throw invalidRequest();
  return value;
}

function requireStableId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw invalidRequest();
  }
  return value;
}

function nullableStableId(value) {
  if (value === null) return null;
  return requireStableId(value);
}

function requireRevision(value) {
  if (typeof value !== 'string' || !REVISION_PATTERN.test(value)) throw invalidRequest();
  return value;
}

function requireActor(value) {
  const actor = requireText(value, { max: 300 });
  if (!ACTOR_PATTERN.test(actor)) throw invalidRequest();
  return actor;
}

function requireIsoTimestamp(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') throw invalidRequest();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw invalidRequest();
  return value;
}

function requireDate(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalidRequest();
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw invalidRequest();
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stateHash(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function createWorkflowRuntime(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const idFactory = typeof options.idFactory === 'function' ? options.idFactory : entityType => createStableId(entityType);
  return Object.freeze({
    id(entityType) {
      return requireStableId(idFactory(entityType));
    },
    timestamp() {
      const value = now();
      const date = value instanceof Date ? value : new Date(value);
      if (!Number.isFinite(date.getTime())) throw new TypeError('Target workflow clock must return a valid date');
      return date.toISOString();
    }
  });
}

function createAuditEvent(runtime, details) {
  return {
    id: runtime.id('auditEvent'),
    organizationId: details.organizationId,
    workspaceId: details.workspaceId,
    entityType: details.entityType,
    entityId: details.entityId,
    action: requireText(details.action, { max: 200 }),
    actor: requireActor(details.actor),
    timestamp: details.timestamp,
    beforeHash: details.before === undefined || details.before === null ? null : stateHash(details.before),
    afterHash: details.after === undefined || details.after === null ? null : stateHash(details.after)
  };
}

function appendAudit(document, runtime, details) {
  const event = createAuditEvent(runtime, details);
  document.auditEvents.push(event);
  return event;
}

function clone(value) {
  return structuredClone(value);
}

async function readWorkflow(targetDataFile, projector) {
  const { document, revision } = await readTargetDataWithRevision(targetDataFile);
  return { value: await projector(document, revision), revision };
}

async function writeWorkflow(targetDataFile, expectedRevision, mutator) {
  const requiredRevision = requireRevision(expectedRevision);
  const { document, revision } = await readTargetDataWithRevision(targetDataFile);
  if (revision !== requiredRevision) throw revisionConflict();
  const candidate = clone(document);
  const outcome = await mutator(candidate, revision);
  try {
    const persisted = await writeTargetData(targetDataFile, candidate, { expectedRevision: revision });
    return { value: { ...outcome, revision: persisted.revision }, revision: persisted.revision };
  } catch (error) {
    if (error instanceof TargetStaleRevisionError) throw revisionConflict();
    throw error;
  }
}

module.exports = {
  ACTOR_PATTERN,
  REVISION_PATTERN,
  appendAudit,
  clone,
  createAuditEvent,
  createWorkflowRuntime,
  exactKeys,
  nullableStableId,
  nullableText,
  plainObject,
  readWorkflow,
  requireActor,
  requireArray,
  requireBoolean,
  requireDate,
  requireEnum,
  requireIsoTimestamp,
  requireObject,
  requireRevision,
  requireStableId,
  requireText,
  stableJson,
  stateHash,
  writeWorkflow
};
