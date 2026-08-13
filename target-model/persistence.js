const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const {
  AUDIT_ACTIONS,
  TargetResourceLimitError,
  TargetValidationError,
  validateTargetData
} = require('./schema');

const SIMULATED_FAILURE_STAGE = 'after-temporary-write';
// Four MiB permits the product's bounded Source content plus small-team domain
// records while preventing unbounded whole-file reads, parses, and writes.
const MAX_TARGET_READ_BYTES = 4 * 1024 * 1024;
const MAX_TARGET_WRITE_BYTES = 4 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const targetWriteQueues = new Map();
const EXPECT_TARGET_ABSENT = Symbol('EXPECT_TARGET_ABSENT');
const FINALIZED_BRIEFING_VERSION_FIELDS = Object.freeze([
  'id',
  'organizationId',
  'briefingId',
  'workspaceIds',
  'scopeIds',
  'comparisonVersionId',
  'frozenSnapshot',
  'facts',
  'outputs',
  'createdAt',
  'finalizedAt'
]);

class TargetPersistenceError extends Error {
  constructor(message, code, options = {}) {
    super(message, options);
    this.name = 'TargetPersistenceError';
    this.code = code;
  }
}

class TargetTransitionValidationError extends TargetValidationError {
  constructor(message, path = '') {
    super(message, path);
    this.name = 'TargetTransitionValidationError';
    this.code = 'INVALID_TARGET_TRANSITION';
  }
}

class TargetRevisionRequiredError extends TargetPersistenceError {
  constructor() {
    super(
      'Every target write requires an expected persisted revision or the explicit expect-absent sentinel',
      'TARGET_EXPECTED_REVISION_REQUIRED'
    );
    this.name = 'TargetRevisionRequiredError';
  }
}

class TargetStaleRevisionError extends TargetPersistenceError {
  constructor() {
    super(
      'The target data revision no longer matches the caller expectation; re-read, rebuild, and retry explicitly',
      'TARGET_STALE_REVISION'
    );
    this.name = 'TargetStaleRevisionError';
  }
}

function transitionFail(path, message) {
  throw new TargetTransitionValidationError(message, path);
}

function resourceFail(path, message) {
  throw new TargetResourceLimitError(message, path);
}

function recordsById(records) {
  return new Map(records.map(record => [record.id, record]));
}

function validateInitialTargetState(document) {
  const communicatedVersion = document.briefingVersions.find(version => version.status === 'communicated');
  if (communicatedVersion) {
    transitionFail(
      `briefingVersions.${communicatedVersion.id}.status`,
      'a Communicated Briefing Version must transition from an existing Finalized Version'
    );
  }
}

function validateTargetTransition(existingDocument, candidateDocument) {
  validateTargetData(existingDocument);
  validateTargetData(candidateDocument);

  const candidateWorkspaces = recordsById(candidateDocument.workspaces);
  existingDocument.workspaces.forEach(existingWorkspace => {
    const candidateWorkspace = candidateWorkspaces.get(existingWorkspace.id);
    if (!candidateWorkspace) {
      transitionFail(
        `workspaces.${existingWorkspace.id}`,
        'an existing Workspace cannot be removed from the target store'
      );
    }
    if (candidateWorkspace.organizationId !== existingWorkspace.organizationId) {
      transitionFail(
        `workspaces.${existingWorkspace.id}.organizationId`,
        'an existing Workspace cannot move to another Organization'
      );
    }
  });

  for (const [collection, label, parentFields] of [
    ['scopes', 'Scope', ['organizationId', 'workspaceId']],
    ['features', 'Feature', ['organizationId', 'workspaceId', 'scopeId']]
  ]) {
    const candidates = recordsById(candidateDocument[collection]);
    existingDocument[collection].forEach(existingRecord => {
      const candidateRecord = candidates.get(existingRecord.id);
      if (!candidateRecord) transitionFail(`${collection}.${existingRecord.id}`, `an existing ${label} cannot be removed from the target store`);
      for (const parentField of parentFields) {
        if (candidateRecord[parentField] !== existingRecord[parentField]) {
          transitionFail(`${collection}.${existingRecord.id}.${parentField}`, `an existing ${label} cannot move to another parent`);
        }
      }
    });
  }

  if (candidateDocument.auditEvents.length < existingDocument.auditEvents.length) {
    transitionFail('auditEvents', 'existing Audit Events cannot be deleted');
  }
  existingDocument.auditEvents.forEach((existingEvent, index) => {
    if (!isDeepStrictEqual(existingEvent, candidateDocument.auditEvents[index])) {
      transitionFail(`auditEvents[${index}]`, 'existing Audit Events are append-only, ordered, and immutable');
    }
  });
  const appendedAuditEvents = candidateDocument.auditEvents.slice(existingDocument.auditEvents.length);

  const existingVersions = recordsById(existingDocument.briefingVersions);
  const candidateVersions = recordsById(candidateDocument.briefingVersions);
  const communicationTransitions = [];
  existingDocument.briefingVersions.forEach(existingVersion => {
    const candidateVersion = candidateVersions.get(existingVersion.id);
    if (existingVersion.status === 'draft') {
      if (candidateVersion && candidateVersion.status === 'communicated') {
        transitionFail(`briefingVersions.${existingVersion.id}.status`, 'a Draft Briefing Version cannot skip directly to Communicated');
      }
      return;
    }
    if (!candidateVersion) {
      transitionFail(`briefingVersions.${existingVersion.id}`, `${existingVersion.status} Briefing Versions cannot be deleted`);
    }
    if (existingVersion.status === 'communicated') {
      if (!isDeepStrictEqual(existingVersion, candidateVersion)) {
        transitionFail(`briefingVersions.${existingVersion.id}`, 'Communicated Briefing Versions are immutable');
      }
      return;
    }
    if (!['finalized', 'communicated'].includes(candidateVersion.status)) {
      transitionFail(`briefingVersions.${existingVersion.id}.status`, 'a Finalized Briefing Version may only remain Finalized or become Communicated');
    }
    FINALIZED_BRIEFING_VERSION_FIELDS.forEach(field => {
      if (!isDeepStrictEqual(existingVersion[field], candidateVersion[field])) {
        transitionFail(`briefingVersions.${existingVersion.id}.${field}`, 'finalized Briefing content is immutable');
      }
    });
    if (candidateVersion.status === 'communicated') {
      communicationTransitions.push({ existingVersion, candidateVersion });
    }
  });

  candidateDocument.briefingVersions.forEach(candidateVersion => {
    if (!existingVersions.has(candidateVersion.id) && candidateVersion.status === 'communicated') {
      transitionFail(
        `briefingVersions.${candidateVersion.id}.status`,
        'a Communicated Briefing Version must transition from an existing Finalized Version'
      );
    }
  });

  const communicationByBriefing = new Map();
  communicationTransitions.forEach(transition => {
    const { candidateVersion } = transition;
    if (communicationByBriefing.has(candidateVersion.briefingId)) {
      transitionFail(
        `briefings.${candidateVersion.briefingId}.lastCommunicatedVersionId`,
        'only one Briefing Version may become Communicated for a Briefing in one persisted transition'
      );
    }
    communicationByBriefing.set(candidateVersion.briefingId, transition);
  });

  const candidateBriefings = recordsById(candidateDocument.briefings);
  existingDocument.briefings.forEach(existingBriefing => {
    const candidateBriefing = candidateBriefings.get(existingBriefing.id);
    const communication = communicationByBriefing.get(existingBriefing.id);
    if (communication) {
      const { candidateVersion } = communication;
      if (!candidateBriefing || candidateBriefing.organizationId !== candidateVersion.organizationId) {
        transitionFail(
          `briefings.${existingBriefing.id}`,
          'a communicated Briefing Version requires its matching parent Briefing'
        );
      }
      if (candidateBriefing.lastCommunicatedVersionId !== candidateVersion.id) {
        transitionFail(
          `briefings.${existingBriefing.id}.lastCommunicatedVersionId`,
          'must advance to the Briefing Version becoming Communicated in this transition'
        );
      }
      return;
    }

    const candidateBaseline = candidateBriefing ? candidateBriefing.lastCommunicatedVersionId : null;
    if (candidateBaseline !== existingBriefing.lastCommunicatedVersionId) {
      transitionFail(
        `briefings.${existingBriefing.id}.lastCommunicatedVersionId`,
        'may change only when that Briefing gains a newly Communicated Version in the same transition'
      );
    }
  });

  communicationTransitions.forEach(({ candidateVersion }) => {
    const matchingEvents = appendedAuditEvents.filter(event =>
      event.organizationId === candidateVersion.organizationId &&
      event.entityType === 'briefingVersion' &&
      event.entityId === candidateVersion.id &&
      event.action === AUDIT_ACTIONS.BRIEFING_VERSION_COMMUNICATED &&
      event.timestamp === candidateVersion.communicatedAt
    );
    if (matchingEvents.length !== 1) {
      transitionFail(
        `briefingVersions.${candidateVersion.id}.communicatedAt`,
        'communication requires exactly one newly appended matching Briefing Version Audit Event'
      );
    }
  });

  appendedAuditEvents
    .filter(event => event.action === AUDIT_ACTIONS.BRIEFING_VERSION_COMMUNICATED)
    .forEach(event => {
      const matchingTransitions = communicationTransitions.filter(({ candidateVersion }) =>
        event.organizationId === candidateVersion.organizationId &&
        event.entityType === 'briefingVersion' &&
        event.entityId === candidateVersion.id &&
        event.timestamp === candidateVersion.communicatedAt
      );
      if (matchingTransitions.length !== 1) {
        transitionFail(
          `auditEvents.${event.id}`,
          'a newly appended Briefing Version communication Audit Event requires exactly one matching Finalized to Communicated transition'
        );
      }
    });

  return candidateDocument;
}

function requireExplicitPath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new TypeError('An explicit target data-file path is required');
  }
  if (filePath.includes('\0')) throw new TypeError('The target data-file path is invalid');
  return path.resolve(filePath);
}

function parseTargetData(text, filePath = 'target data') {
  if (typeof text !== 'string') throw new TypeError('Target data text must be a string');
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > MAX_TARGET_READ_BYTES) {
    resourceFail(filePath, `target data exceeds the ${MAX_TARGET_READ_BYTES}-byte read limit; received ${byteLength} bytes`);
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new TargetPersistenceError(`${filePath} is not valid JSON; the file was left unchanged`, 'INVALID_TARGET_JSON', { cause: error });
  }
  validateTargetData(document);
  return document;
}

function serializeTargetData(document) {
  validateTargetData(document);
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  if (byteLength > MAX_TARGET_WRITE_BYTES) {
    resourceFail('root', `serialized target data exceeds the ${MAX_TARGET_WRITE_BYTES}-byte write limit; received ${byteLength} bytes`);
  }
  return serialized;
}

function revisionForBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function readBoundedTargetBytes(filePath, options = {}) {
  const { allowMissing = false, operation = 'read' } = options;
  let handle = null;
  try {
    handle = await fs.open(filePath, 'r');
    const stats = await handle.stat();
    if (stats.size > MAX_TARGET_READ_BYTES) {
      resourceFail(filePath, `target file exceeds the ${MAX_TARGET_READ_BYTES}-byte read limit; received ${stats.size} bytes`);
    }

    const chunks = [];
    let byteLength = 0;
    while (byteLength <= MAX_TARGET_READ_BYTES) {
      const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, MAX_TARGET_READ_BYTES + 1 - byteLength));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      byteLength += bytesRead;
      if (byteLength > MAX_TARGET_READ_BYTES) {
        resourceFail(filePath, `target file exceeds the ${MAX_TARGET_READ_BYTES}-byte read limit`);
      }
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, byteLength);
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return null;
    if (error instanceof TargetResourceLimitError) throw error;
    const message = operation === 'inspect'
      ? `Unable to inspect the existing target data file: ${error.message}`
      : `Unable to read the target data file: ${error.message}`;
    throw new TargetPersistenceError(message, 'TARGET_READ_FAILED', { cause: error });
  } finally {
    if (handle) await handle.close();
  }
}

async function readTargetDataWithRevision(filePath) {
  const resolvedPath = requireExplicitPath(filePath);
  const bytes = await readBoundedTargetBytes(resolvedPath);
  return {
    document: parseTargetData(bytes.toString('utf8'), resolvedPath),
    revision: revisionForBytes(bytes)
  };
}

async function readTargetData(filePath) {
  return (await readTargetDataWithRevision(filePath)).document;
}

async function withTargetWriteQueue(resolvedPath, operation) {
  const precedingWrite = targetWriteQueues.get(resolvedPath) || Promise.resolve();
  let release;
  const currentWrite = new Promise(resolve => {
    release = resolve;
  });
  targetWriteQueues.set(resolvedPath, currentWrite);

  await precedingWrite;
  try {
    return await operation();
  } finally {
    release();
    if (targetWriteQueues.get(resolvedPath) === currentWrite) targetWriteQueues.delete(resolvedPath);
  }
}

async function writeTargetData(filePath, document, options = {}) {
  const resolvedPath = requireExplicitPath(filePath);
  const optionKeys = Object.keys(options);
  if (optionKeys.some(key => !['expectedRevision', 'simulateFailureAt'].includes(key))) {
    throw new TypeError(
      `Unsupported target persistence option: ${optionKeys.find(key => !['expectedRevision', 'simulateFailureAt'].includes(key))}`
    );
  }
  if (options.simulateFailureAt !== undefined && options.simulateFailureAt !== SIMULATED_FAILURE_STAGE) {
    throw new TypeError(`Unsupported simulated failure stage: ${options.simulateFailureAt}`);
  }

  return withTargetWriteQueue(resolvedPath, async () => {
    const latestBytes = await readBoundedTargetBytes(resolvedPath, { allowMissing: true, operation: 'inspect' });
    if (!Object.hasOwn(options, 'expectedRevision') || options.expectedRevision == null) {
      throw new TargetRevisionRequiredError();
    }

    if (latestBytes === null) {
      if (options.expectedRevision !== EXPECT_TARGET_ABSENT) throw new TargetStaleRevisionError();
      validateTargetData(document);
      validateInitialTargetState(document);
    } else {
      const actualRevision = revisionForBytes(latestBytes);
      if (options.expectedRevision === EXPECT_TARGET_ABSENT || options.expectedRevision !== actualRevision) {
        throw new TargetStaleRevisionError();
      }
      const existingDocument = parseTargetData(latestBytes.toString('utf8'), resolvedPath);
      validateTargetTransition(existingDocument, document);
    }
    const serialized = serializeTargetData(document);
    const serializedBytes = Buffer.from(serialized, 'utf8');

    const directory = path.dirname(resolvedPath);
    const basename = path.basename(resolvedPath);
    const temporaryPath = path.join(directory, `.${basename}.${process.pid}.${crypto.randomUUID()}.tmp`);
    let handle = null;

    try {
      handle = await fs.open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(serializedBytes);
      await handle.sync();
      await handle.close();
      handle = null;

      if (options.simulateFailureAt === SIMULATED_FAILURE_STAGE) {
        throw new TargetPersistenceError('Simulated target write failure after temporary-file sync', 'SIMULATED_TARGET_WRITE_FAILURE');
      }

      await fs.rename(temporaryPath, resolvedPath);
      return {
        filePath: resolvedPath,
        byteLength: serializedBytes.length,
        revision: revisionForBytes(serializedBytes)
      };
    } catch (error) {
      if (handle) {
        try {
          await handle.close();
        } catch (_) {
          // The original error remains authoritative.
        }
      }
      try {
        await fs.unlink(temporaryPath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          throw new TargetPersistenceError(
            `Target write failed and temporary-file cleanup also failed: ${cleanupError.message}`,
            'TARGET_TEMP_CLEANUP_FAILED',
            { cause: error }
          );
        }
      }
      if (error instanceof TargetPersistenceError) throw error;
      throw new TargetPersistenceError(`Unable to atomically write the target data file: ${error.message}`, 'TARGET_WRITE_FAILED', { cause: error });
    }
  });
}

module.exports = {
  EXPECT_TARGET_ABSENT,
  FINALIZED_BRIEFING_VERSION_FIELDS,
  MAX_TARGET_READ_BYTES,
  MAX_TARGET_WRITE_BYTES,
  SIMULATED_FAILURE_STAGE,
  TargetPersistenceError,
  TargetRevisionRequiredError,
  TargetStaleRevisionError,
  TargetTransitionValidationError,
  parseTargetData,
  readTargetData,
  readTargetDataWithRevision,
  serializeTargetData,
  validateTargetTransition,
  writeTargetData
};
