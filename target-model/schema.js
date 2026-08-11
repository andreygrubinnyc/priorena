const crypto = require('node:crypto');

const TARGET_SCHEMA_VERSION = 2;
const UNASSIGNED_SCOPE = Object.freeze({ scopeId: null, label: 'Unassigned' });

const ROOT_COLLECTIONS = Object.freeze([
  'organizations',
  'workspaces',
  'scopes',
  'jiraEpicMappings',
  'workItems',
  'milestones',
  'sources',
  'findings',
  'evidence',
  'proposedChanges',
  'briefings',
  'briefingVersions',
  'auditEvents'
]);

// Priorena is a local small-team product. These limits keep whole-document
// validation predictable while leaving substantial room for every entity type.
const MAX_ROOT_COLLECTION_RECORDS = 1_000;
const MAX_AGGREGATE_ROOT_RECORDS = 5_000;

const ROOT_FIELDS = new Set([
  'schemaVersion',
  ...ROOT_COLLECTIONS,
  'userPreferences',
  'globalTechnicalSettings'
]);

const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ITEM_TYPES = new Set(['Story', 'Feature', 'Task', 'Bug', 'Other', 'Unknown']);
const FOLLOW_UP_STATES = new Set(['none', 'open', 'waiting', 'resolved']);
const MAPPING_STATUSES = new Set(['pending', 'verified', 'inactive']);
const FINDING_REVIEW_STATUSES = new Set(['pending', 'accepted', 'rejected']);
const PROPOSED_CHANGE_REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected', 'applied', 'stale']);
const CURRENTNESS_STATES = new Set(['current', 'historical', 'superseded', 'contradicted', 'unknown']);
const CURRENT_STATE_CONFIDENCE = new Set(['confirmed', 'inferred', 'unknown']);
const BRIEFING_STATUSES = new Set(['draft', 'finalized', 'communicated']);
const BRIEFING_FORMATS = new Set(['teams', 'email', 'confluence']);
const AUDIT_ACTIONS = Object.freeze({
  BRIEFING_VERSION_COMMUNICATED: 'briefing-version-communicated'
});
const FORBIDDEN_SCOPE_NAMES = new Set(['unassigned', 'miscellaneous / no epic', 'miscellaneous/no epic', 'no epic']);
const WORKSPACE_OWNED_AUDIT_ENTITY_TYPES = new Set([
  'workspace',
  'scope',
  'jiraEpicMapping',
  'workItem',
  'milestone',
  'source',
  'finding',
  'evidence',
  'proposedChange'
]);

const ENTITY_PREFIXES = Object.freeze({
  organization: 'org',
  workspace: 'workspace',
  scope: 'scope',
  jiraEpicMapping: 'jira-mapping',
  workItem: 'work-item',
  milestone: 'milestone',
  source: 'source',
  finding: 'finding',
  evidence: 'evidence',
  proposedChange: 'proposed-change',
  briefing: 'briefing',
  briefingVersion: 'briefing-version',
  auditEvent: 'audit-event'
});

class TargetValidationError extends Error {
  constructor(message, path = '') {
    super(path ? `${path}: ${message}` : message);
    this.name = 'TargetValidationError';
    this.code = 'INVALID_TARGET_DATA';
    this.path = path;
  }
}

class TargetResourceLimitError extends TargetValidationError {
  constructor(message, path = '') {
    super(message, path);
    this.name = 'TargetResourceLimitError';
    this.code = 'TARGET_RESOURCE_LIMIT_EXCEEDED';
  }
}

class TargetSchemaVersionError extends TargetValidationError {
  constructor(version) {
    super(`unsupported schemaVersion ${JSON.stringify(version)}; expected ${TARGET_SCHEMA_VERSION}`, 'schemaVersion');
    this.name = 'TargetSchemaVersionError';
    this.code = 'UNSUPPORTED_TARGET_SCHEMA_VERSION';
    this.version = version;
  }
}

function fail(path, message) {
  throw new TargetValidationError(message, path);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) fail(path, 'must be an object');
}

function assertAllowedKeys(value, path, allowed, required = allowed) {
  assertPlainObject(value, path);
  Object.keys(value).forEach(key => {
    if (RESERVED_KEYS.has(key.toLowerCase()) || !allowed.has(key)) fail(path, `contains unsupported field ${JSON.stringify(key)}`);
  });
  required.forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`${path}.${key}`, 'is required');
  });
}

function assertString(value, path, options = {}) {
  const { allowEmpty = false, max = 10_000 } = options;
  if (typeof value !== 'string') fail(path, 'must be text');
  if (!allowEmpty && !value.trim()) fail(path, 'must not be empty');
  if (value.length > max) fail(path, `must be ${max} characters or fewer`);
}

function assertNullableString(value, path, options = {}) {
  if (value === null) return;
  assertString(value, path, options);
}

function assertBoolean(value, path) {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean');
}

function assertId(value, path) {
  assertString(value, path, { max: 160 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) fail(path, 'must be a stable opaque ID');
}

function assertNullableId(value, path) {
  if (value === null) return;
  assertId(value, path);
}

function assertTimestamp(value, path) {
  assertString(value, path, { max: 40 });
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail(path, 'must be an ISO-8601 UTC timestamp');
}

function assertNullableTimestamp(value, path) {
  if (value === null) return;
  assertTimestamp(value, path);
}

function assertDate(value, path) {
  assertString(value, path, { max: 10 });
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    fail(path, 'must be an ISO calendar date');
  }
}

function assertNullableDate(value, path) {
  if (value === null) return;
  assertDate(value, path);
}

function assertEnum(value, path, accepted) {
  if (!accepted.has(value)) fail(path, `must be one of: ${[...accepted].join(', ')}`);
}

function assertArray(value, path) {
  if (!Array.isArray(value)) fail(path, 'must be an array');
}

function validateRootCollectionBounds(document) {
  ROOT_COLLECTIONS.forEach(collection => assertArray(document[collection], collection));

  let aggregateCount = 0;
  ROOT_COLLECTIONS.forEach(collection => {
    const count = document[collection].length;
    if (count > MAX_ROOT_COLLECTION_RECORDS) {
      throw new TargetResourceLimitError(
        `must contain no more than ${MAX_ROOT_COLLECTION_RECORDS} records; received ${count}`,
        collection
      );
    }
    aggregateCount += count;
  });

  if (aggregateCount > MAX_AGGREGATE_ROOT_RECORDS) {
    throw new TargetResourceLimitError(
      `must contain no more than ${MAX_AGGREGATE_ROOT_RECORDS} records across root collections; received ${aggregateCount}`,
      'root'
    );
  }
  return aggregateCount;
}

function assertCanonicalJiraKey(value, path) {
  assertString(value, path, { max: 100 });
  if (value !== value.trim()) fail(path, 'must not contain leading or trailing whitespace');
}

function assertUniqueStrings(value, path, options = {}) {
  const { allowEmpty = true, ids = false, accepted = null } = options;
  assertArray(value, path);
  if (!allowEmpty && value.length === 0) fail(path, 'must contain at least one item');
  const seen = new Set();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (ids) assertId(item, itemPath);
    else assertString(item, itemPath, { max: 1_000 });
    if (accepted) assertEnum(item, itemPath, accepted);
    if (seen.has(item)) fail(itemPath, 'must not be duplicated');
    seen.add(item);
  });
}

function assertJsonValue(value, path, stack = new Set(), depth = 0) {
  if (depth > 30) fail(path, 'exceeds the maximum supported nesting depth');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'must contain only finite JSON numbers');
    return;
  }
  if (typeof value !== 'object') fail(path, 'must contain only JSON-compatible values');
  if (stack.has(value)) fail(path, 'must not contain circular references');
  stack.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, stack, depth + 1));
  } else {
    assertPlainObject(value, path);
    Object.keys(value).forEach(key => {
      if (RESERVED_KEYS.has(key.toLowerCase())) fail(path, `contains unsupported field ${JSON.stringify(key)}`);
      assertJsonValue(value[key], `${path}.${key}`, stack, depth + 1);
    });
  }
  stack.delete(value);
}

function assertJsonObject(value, path) {
  assertPlainObject(value, path);
  assertJsonValue(value, path);
}

function assertObjectKeysAbsent(value, path, forbiddenKeys) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertObjectKeysAbsent(item, `${path}[${index}]`, forbiddenKeys));
    return;
  }
  Object.entries(value).forEach(([key, child]) => {
    if (forbiddenKeys.has(key)) fail(`${path}.${key}`, 'is Workspace-specific and cannot be stored globally');
    assertObjectKeysAbsent(child, `${path}.${key}`, forbiddenKeys);
  });
}

function validateOrganization(record, path) {
  const fields = new Set(['id', 'name', 'description', 'archived', 'createdAt', 'updatedAt']);
  assertAllowedKeys(record, path, fields);
  assertId(record.id, `${path}.id`);
  assertString(record.name, `${path}.name`, { max: 200 });
  assertString(record.description, `${path}.description`, { allowEmpty: true, max: 4_000 });
  assertBoolean(record.archived, `${path}.archived`);
  assertTimestamp(record.createdAt, `${path}.createdAt`);
  assertTimestamp(record.updatedAt, `${path}.updatedAt`);
}

function validateWorkspace(record, path) {
  const fields = new Set([
    'id', 'organizationId', 'name', 'description', 'archived', 'createdAt', 'updatedAt',
    'settings', 'promptOverrides', 'draftingGuidance', 'assigneeDirectory', 'jiraStatusMapping', 'savedViews'
  ]);
  assertAllowedKeys(record, path, fields);
  assertId(record.id, `${path}.id`);
  assertId(record.organizationId, `${path}.organizationId`);
  assertString(record.name, `${path}.name`, { max: 200 });
  assertString(record.description, `${path}.description`, { allowEmpty: true, max: 4_000 });
  assertBoolean(record.archived, `${path}.archived`);
  assertTimestamp(record.createdAt, `${path}.createdAt`);
  assertTimestamp(record.updatedAt, `${path}.updatedAt`);
  assertJsonObject(record.settings, `${path}.settings`);
  assertJsonObject(record.promptOverrides, `${path}.promptOverrides`);
  assertString(record.draftingGuidance, `${path}.draftingGuidance`, { allowEmpty: true, max: 20_000 });
  assertArray(record.assigneeDirectory, `${path}.assigneeDirectory`);
  assertJsonValue(record.assigneeDirectory, `${path}.assigneeDirectory`);
  assertJsonObject(record.jiraStatusMapping, `${path}.jiraStatusMapping`);
  assertArray(record.savedViews, `${path}.savedViews`);
  assertJsonValue(record.savedViews, `${path}.savedViews`);
}

function validateScope(record, path) {
  const fields = new Set([
    'id', 'organizationId', 'workspaceId', 'name', 'description', 'owner', 'archived',
    'primaryMilestoneId', 'createdAt', 'updatedAt'
  ]);
  assertAllowedKeys(record, path, fields);
  assertId(record.id, `${path}.id`);
  assertId(record.organizationId, `${path}.organizationId`);
  assertId(record.workspaceId, `${path}.workspaceId`);
  assertString(record.name, `${path}.name`, { max: 200 });
  if (FORBIDDEN_SCOPE_NAMES.has(record.name.trim().toLocaleLowerCase('en-US'))) {
    fail(`${path}.name`, 'must not create an Unassigned or no-Epic catch-all Scope');
  }
  assertString(record.description, `${path}.description`, { allowEmpty: true, max: 4_000 });
  assertNullableString(record.owner, `${path}.owner`, { max: 300 });
  assertBoolean(record.archived, `${path}.archived`);
  assertNullableId(record.primaryMilestoneId, `${path}.primaryMilestoneId`);
  assertTimestamp(record.createdAt, `${path}.createdAt`);
  assertTimestamp(record.updatedAt, `${path}.updatedAt`);
}

function validateJiraEpicMapping(record, path) {
  const fields = new Set([
    'id', 'organizationId', 'workspaceId', 'scopeId', 'jiraProjectKey', 'jiraEpicKey',
    'jiraEpicName', 'mappingStatus', 'provenance', 'verifiedAt'
  ]);
  assertAllowedKeys(record, path, fields);
  assertId(record.id, `${path}.id`);
  assertId(record.organizationId, `${path}.organizationId`);
  assertId(record.workspaceId, `${path}.workspaceId`);
  assertId(record.scopeId, `${path}.scopeId`);
  assertCanonicalJiraKey(record.jiraProjectKey, `${path}.jiraProjectKey`);
  assertCanonicalJiraKey(record.jiraEpicKey, `${path}.jiraEpicKey`);
  assertString(record.jiraEpicName, `${path}.jiraEpicName`, { max: 500 });
  assertEnum(record.mappingStatus, `${path}.mappingStatus`, MAPPING_STATUSES);
  assertString(record.provenance, `${path}.provenance`, { max: 2_000 });
  assertNullableTimestamp(record.verifiedAt, `${path}.verifiedAt`);
}

function validateFollowUp(value, path) {
  const fields = new Set(['state', 'contact', 'lastContactAt', 'lastCapturedCommentAt', 'nextAction', 'dueAt', 'note']);
  assertAllowedKeys(value, path, fields);
  assertEnum(value.state, `${path}.state`, FOLLOW_UP_STATES);
  assertNullableString(value.contact, `${path}.contact`, { max: 300 });
  assertNullableTimestamp(value.lastContactAt, `${path}.lastContactAt`);
  assertNullableTimestamp(value.lastCapturedCommentAt, `${path}.lastCapturedCommentAt`);
  assertNullableString(value.nextAction, `${path}.nextAction`, { max: 2_000 });
  assertNullableDate(value.dueAt, `${path}.dueAt`);
  assertNullableString(value.note, `${path}.note`, { max: 4_000 });
  if (value.state === 'none') {
    ['contact', 'lastContactAt', 'lastCapturedCommentAt', 'nextAction', 'dueAt', 'note'].forEach(field => {
      if (value[field] !== null) fail(`${path}.${field}`, 'must be null when Follow-Up state is none');
    });
  }
}

function validateWorkItem(record, path) {
  const fields = new Set([
    'id', 'organizationId', 'workspaceId', 'scopeId', 'jiraId', 'jiraKey', 'itemType',
    'summary', 'description', 'canonicalStatus', 'currentStateProvenance', 'currentStateConfidence',
    'lastCapturedCommentAt', 'sourceStatus', 'assignee', 'sprint', 'labels', 'dependencies',
    'notes', 'archived', 'followUp', 'createdAt', 'updatedAt'
  ]);
  assertAllowedKeys(record, path, fields);
  assertId(record.id, `${path}.id`);
  assertId(record.organizationId, `${path}.organizationId`);
  assertId(record.workspaceId, `${path}.workspaceId`);
  assertNullableId(record.scopeId, `${path}.scopeId`);
  assertNullableString(record.jiraId, `${path}.jiraId`, { max: 200 });
  assertNullableString(record.jiraKey, `${path}.jiraKey`, { max: 100 });
  assertEnum(record.itemType, `${path}.itemType`, ITEM_TYPES);
  assertString(record.summary, `${path}.summary`, { max: 1_000 });
  assertString(record.description, `${path}.description`, { allowEmpty: true, max: 20_000 });
  assertString(record.canonicalStatus, `${path}.canonicalStatus`, { max: 200 });
  assertString(record.currentStateProvenance, `${path}.currentStateProvenance`, { max: 500 });
  assertEnum(record.currentStateConfidence, `${path}.currentStateConfidence`, CURRENT_STATE_CONFIDENCE);
  assertNullableTimestamp(record.lastCapturedCommentAt, `${path}.lastCapturedCommentAt`);
  assertNullableString(record.sourceStatus, `${path}.sourceStatus`, { max: 200 });
  assertNullableString(record.assignee, `${path}.assignee`, { max: 300 });
  assertNullableString(record.sprint, `${path}.sprint`, { max: 300 });
  assertUniqueStrings(record.labels, `${path}.labels`);
  assertUniqueStrings(record.dependencies, `${path}.dependencies`, { ids: true });
  assertString(record.notes, `${path}.notes`, { allowEmpty: true, max: 20_000 });
  assertBoolean(record.archived, `${path}.archived`);
  validateFollowUp(record.followUp, `${path}.followUp`);
  assertTimestamp(record.createdAt, `${path}.createdAt`);
  assertTimestamp(record.updatedAt, `${path}.updatedAt`);
}

function validateMilestone(record, path) {
  const fields = new Set([
    'id', 'organizationId', 'workspaceId', 'scopeId', 'title', 'date', 'status', 'notes',
    'linkedWorkItemIds', 'createdAt', 'updatedAt'
  ]);
  assertAllowedKeys(record, path, fields);
  assertId(record.id, `${path}.id`);
  assertId(record.organizationId, `${path}.organizationId`);
  assertId(record.workspaceId, `${path}.workspaceId`);
  assertNullableId(record.scopeId, `${path}.scopeId`);
  assertString(record.title, `${path}.title`, { max: 500 });
  assertDate(record.date, `${path}.date`);
  assertString(record.status, `${path}.status`, { max: 100 });
  assertString(record.notes, `${path}.notes`, { allowEmpty: true, max: 10_000 });
  assertUniqueStrings(record.linkedWorkItemIds, `${path}.linkedWorkItemIds`, { ids: true });
  assertTimestamp(record.createdAt, `${path}.createdAt`);
  assertTimestamp(record.updatedAt, `${path}.updatedAt`);
}

function validateSource(record, path) {
  const fields = new Set([
    'id', 'organizationId', 'workspaceId', 'title', 'type', 'sourceKind', 'date', 'provenance',
    'content', 'metadata', 'processingState', 'createdAt'
  ]);
  assertAllowedKeys(record, path, fields);
  assertId(record.id, `${path}.id`);
  assertId(record.organizationId, `${path}.organizationId`);
  assertId(record.workspaceId, `${path}.workspaceId`);
  assertString(record.title, `${path}.title`, { max: 500 });
  assertString(record.type, `${path}.type`, { max: 100 });
  assertString(record.sourceKind, `${path}.sourceKind`, { max: 100 });
  assertDate(record.date, `${path}.date`);
  assertString(record.provenance, `${path}.provenance`, { max: 4_000 });
  assertNullableString(record.content, `${path}.content`, { allowEmpty: true, max: 2_000_000 });
  assertJsonObject(record.metadata, `${path}.metadata`);
  assertString(record.processingState, `${path}.processingState`, { max: 100 });
  assertTimestamp(record.createdAt, `${path}.createdAt`);
}

function validateFinding(record, path) {
  const fields = new Set([
    'id', 'organizationId', 'workspaceId', 'sourceId', 'exactExcerpt', 'extractionMethod',
    'extractionVersion', 'category', 'reviewStatus', 'proposedWorkItemId', 'proposedScopeId',
    'currentness', 'supersededBy'
  ]);
  assertAllowedKeys(record, path, fields);
  assertId(record.id, `${path}.id`);
  assertId(record.organizationId, `${path}.organizationId`);
  assertId(record.workspaceId, `${path}.workspaceId`);
  assertId(record.sourceId, `${path}.sourceId`);
  assertString(record.exactExcerpt, `${path}.exactExcerpt`, { max: 50_000 });
  assertString(record.extractionMethod, `${path}.extractionMethod`, { max: 200 });
  assertString(record.extractionVersion, `${path}.extractionVersion`, { max: 200 });
  assertString(record.category, `${path}.category`, { max: 100 });
  assertEnum(record.reviewStatus, `${path}.reviewStatus`, FINDING_REVIEW_STATUSES);
  assertNullableId(record.proposedWorkItemId, `${path}.proposedWorkItemId`);
  assertNullableId(record.proposedScopeId, `${path}.proposedScopeId`);
  assertEnum(record.currentness, `${path}.currentness`, CURRENTNESS_STATES);
  assertNullableId(record.supersededBy, `${path}.supersededBy`);
}

function validateEvidence(record, path) {
  const fields = new Set([
    'id', 'organizationId', 'workspaceId', 'sourceId', 'findingId', 'scopeId', 'workItemId',
    'exactExcerpt', 'sourceDate', 'acceptedAt', 'acceptedBy', 'currentness', 'supersededBy'
  ]);
  assertAllowedKeys(record, path, fields);
  assertId(record.id, `${path}.id`);
  assertId(record.organizationId, `${path}.organizationId`);
  assertId(record.workspaceId, `${path}.workspaceId`);
  assertId(record.sourceId, `${path}.sourceId`);
  assertId(record.findingId, `${path}.findingId`);
  assertNullableId(record.scopeId, `${path}.scopeId`);
  assertNullableId(record.workItemId, `${path}.workItemId`);
  assertString(record.exactExcerpt, `${path}.exactExcerpt`, { max: 50_000 });
  assertDate(record.sourceDate, `${path}.sourceDate`);
  assertTimestamp(record.acceptedAt, `${path}.acceptedAt`);
  assertNullableString(record.acceptedBy, `${path}.acceptedBy`, { max: 300 });
  assertEnum(record.currentness, `${path}.currentness`, CURRENTNESS_STATES);
  assertNullableId(record.supersededBy, `${path}.supersededBy`);
}

function validateProposedChange(record, path) {
  const fields = new Set([
    'id', 'organizationId', 'workspaceId', 'findingId', 'evidenceIds', 'workItemId', 'field',
    'beforeValue', 'proposedValue', 'reviewStatus', 'snapshotHash'
  ]);
  assertAllowedKeys(record, path, fields);
  assertId(record.id, `${path}.id`);
  assertId(record.organizationId, `${path}.organizationId`);
  assertId(record.workspaceId, `${path}.workspaceId`);
  assertId(record.findingId, `${path}.findingId`);
  assertUniqueStrings(record.evidenceIds, `${path}.evidenceIds`, { allowEmpty: false, ids: true });
  assertId(record.workItemId, `${path}.workItemId`);
  assertString(record.field, `${path}.field`, { max: 200 });
  assertJsonValue(record.beforeValue, `${path}.beforeValue`);
  assertJsonValue(record.proposedValue, `${path}.proposedValue`);
  assertEnum(record.reviewStatus, `${path}.reviewStatus`, PROPOSED_CHANGE_REVIEW_STATUSES);
  assertString(record.snapshotHash, `${path}.snapshotHash`, { max: 256 });
}

function validateBriefing(record, path) {
  const fields = new Set([
    'id', 'organizationId', 'name', 'workspaceIds', 'scopeIds', 'audienceProfile', 'preferredFormats',
    'defaultSections', 'lastCommunicatedVersionId', 'archived', 'createdAt', 'updatedAt'
  ]);
  assertAllowedKeys(record, path, fields);
  assertId(record.id, `${path}.id`);
  assertId(record.organizationId, `${path}.organizationId`);
  assertString(record.name, `${path}.name`, { max: 300 });
  assertUniqueStrings(record.workspaceIds, `${path}.workspaceIds`, { allowEmpty: false, ids: true });
  assertUniqueStrings(record.scopeIds, `${path}.scopeIds`, { ids: true });
  assertString(record.audienceProfile, `${path}.audienceProfile`, { max: 500 });
  assertUniqueStrings(record.preferredFormats, `${path}.preferredFormats`, { allowEmpty: false, accepted: BRIEFING_FORMATS });
  assertUniqueStrings(record.defaultSections, `${path}.defaultSections`);
  assertNullableId(record.lastCommunicatedVersionId, `${path}.lastCommunicatedVersionId`);
  assertBoolean(record.archived, `${path}.archived`);
  assertTimestamp(record.createdAt, `${path}.createdAt`);
  assertTimestamp(record.updatedAt, `${path}.updatedAt`);
}

function validateBriefingVersion(record, path) {
  const fields = new Set([
    'id', 'organizationId', 'briefingId', 'workspaceIds', 'scopeIds', 'status', 'comparisonVersionId',
    'frozenSnapshot', 'facts', 'outputs', 'createdAt', 'finalizedAt', 'communicatedAt'
  ]);
  assertAllowedKeys(record, path, fields);
  assertId(record.id, `${path}.id`);
  assertId(record.organizationId, `${path}.organizationId`);
  assertId(record.briefingId, `${path}.briefingId`);
  assertUniqueStrings(record.workspaceIds, `${path}.workspaceIds`, { allowEmpty: false, ids: true });
  assertUniqueStrings(record.scopeIds, `${path}.scopeIds`, { ids: true });
  assertEnum(record.status, `${path}.status`, BRIEFING_STATUSES);
  assertNullableId(record.comparisonVersionId, `${path}.comparisonVersionId`);
  assertJsonObject(record.frozenSnapshot, `${path}.frozenSnapshot`);
  assertArray(record.facts, `${path}.facts`);
  assertJsonValue(record.facts, `${path}.facts`);
  assertArray(record.outputs, `${path}.outputs`);
  assertJsonValue(record.outputs, `${path}.outputs`);
  assertTimestamp(record.createdAt, `${path}.createdAt`);
  assertNullableTimestamp(record.finalizedAt, `${path}.finalizedAt`);
  assertNullableTimestamp(record.communicatedAt, `${path}.communicatedAt`);
  if (record.status === 'draft' && (record.finalizedAt !== null || record.communicatedAt !== null)) {
    fail(path, 'draft Briefing Versions cannot have finalized or communicated timestamps');
  }
  if (record.status === 'finalized' && (record.finalizedAt === null || record.communicatedAt !== null)) {
    fail(path, 'finalized Briefing Versions require finalizedAt and cannot have communicatedAt');
  }
  if (record.status === 'communicated' && (record.finalizedAt === null || record.communicatedAt === null)) {
    fail(path, 'communicated Briefing Versions require finalizedAt and communicatedAt');
  }
  if (record.status === 'communicated' && Date.parse(record.communicatedAt) < Date.parse(record.finalizedAt)) {
    fail(`${path}.communicatedAt`, 'must be equal to or later than finalizedAt');
  }
}

function validateAuditEvent(record, path) {
  const entityTypes = new Set(Object.keys(ENTITY_PREFIXES).filter(type => type !== 'auditEvent'));
  const fields = new Set([
    'id', 'organizationId', 'workspaceId', 'entityType', 'entityId', 'action', 'actor', 'timestamp',
    'beforeHash', 'afterHash'
  ]);
  assertAllowedKeys(record, path, fields);
  assertId(record.id, `${path}.id`);
  assertId(record.organizationId, `${path}.organizationId`);
  assertNullableId(record.workspaceId, `${path}.workspaceId`);
  assertEnum(record.entityType, `${path}.entityType`, entityTypes);
  assertId(record.entityId, `${path}.entityId`);
  assertString(record.action, `${path}.action`, { max: 200 });
  assertString(record.actor, `${path}.actor`, { max: 300 });
  assertTimestamp(record.timestamp, `${path}.timestamp`);
  assertNullableString(record.beforeHash, `${path}.beforeHash`, { max: 256 });
  assertNullableString(record.afterHash, `${path}.afterHash`, { max: 256 });
}

function validateUserPreferences(value, path) {
  const fields = new Set(['activeOrganizationId', 'activeWorkspaceIdsByOrganization']);
  assertAllowedKeys(value, path, fields);
  assertNullableId(value.activeOrganizationId, `${path}.activeOrganizationId`);
  assertPlainObject(value.activeWorkspaceIdsByOrganization, `${path}.activeWorkspaceIdsByOrganization`);
  Object.entries(value.activeWorkspaceIdsByOrganization).forEach(([organizationId, workspaceId]) => {
    assertId(organizationId, `${path}.activeWorkspaceIdsByOrganization key`);
    assertNullableId(workspaceId, `${path}.activeWorkspaceIdsByOrganization.${organizationId}`);
  });
}

const VALIDATORS = Object.freeze({
  organizations: validateOrganization,
  workspaces: validateWorkspace,
  scopes: validateScope,
  jiraEpicMappings: validateJiraEpicMapping,
  workItems: validateWorkItem,
  milestones: validateMilestone,
  sources: validateSource,
  findings: validateFinding,
  evidence: validateEvidence,
  proposedChanges: validateProposedChange,
  briefings: validateBriefing,
  briefingVersions: validateBriefingVersion,
  auditEvents: validateAuditEvent
});

function buildIndexes(document) {
  const indexes = Object.create(null);
  const allIds = new Map();
  ROOT_COLLECTIONS.forEach(collection => {
    const index = new Map();
    document[collection].forEach((record, position) => {
      const path = `${collection}[${position}]`;
      if (index.has(record.id)) fail(`${path}.id`, `duplicates another ID in ${collection}`);
      if (allIds.has(record.id)) fail(`${path}.id`, `duplicates an ID in ${allIds.get(record.id)}`);
      index.set(record.id, record);
      allIds.set(record.id, collection);
    });
    indexes[collection] = index;
  });
  return indexes;
}

function requireOrganization(indexes, organizationId, path) {
  const organization = indexes.organizations.get(organizationId);
  if (!organization) fail(path, 'must reference an existing Organization');
  return organization;
}

function requireWorkspace(indexes, organizationId, workspaceId, path) {
  const workspace = indexes.workspaces.get(workspaceId);
  if (!workspace || workspace.organizationId !== organizationId) {
    fail(path, 'must reference a Workspace with matching Organization parents');
  }
  return workspace;
}

function requireScope(indexes, organizationId, workspaceId, scopeId, path) {
  const scope = indexes.scopes.get(scopeId);
  if (!scope || scope.organizationId !== organizationId || scope.workspaceId !== workspaceId) {
    fail(path, 'must reference a Scope with matching Organization and Workspace parents');
  }
  return scope;
}

function requireWorkItem(indexes, organizationId, workspaceId, workItemId, path) {
  const workItem = indexes.workItems.get(workItemId);
  if (!workItem || workItem.organizationId !== organizationId || workItem.workspaceId !== workspaceId) {
    fail(path, 'must reference a Work Item with matching Organization and Workspace parents');
  }
  return workItem;
}

function requireOwnedRecord(index, organizationId, workspaceId, id, path, label) {
  const record = index.get(id);
  if (!record || record.organizationId !== organizationId || record.workspaceId !== workspaceId) {
    fail(path, `must reference ${label} with matching Organization and Workspace parents`);
  }
  return record;
}

function validateParentRelationships(document, indexes) {
  document.workspaces.forEach((workspace, index) => {
    requireOrganization(indexes, workspace.organizationId, `workspaces[${index}].organizationId`);
  });

  document.scopes.forEach((scope, index) => {
    requireWorkspace(indexes, scope.organizationId, scope.workspaceId, `scopes[${index}].workspaceId`);
  });

  const activeJiraMappings = new Set();
  document.jiraEpicMappings.forEach((mapping, index) => {
    const path = `jiraEpicMappings[${index}]`;
    requireWorkspace(indexes, mapping.organizationId, mapping.workspaceId, `${path}.workspaceId`);
    requireScope(indexes, mapping.organizationId, mapping.workspaceId, mapping.scopeId, `${path}.scopeId`);
    if (mapping.mappingStatus !== 'inactive') {
      const uniquenessKey = [mapping.organizationId, mapping.workspaceId, mapping.jiraProjectKey, mapping.jiraEpicKey]
        .map(value => value.trim().toUpperCase())
        .join('\u0000');
      if (activeJiraMappings.has(uniquenessKey)) fail(`${path}.jiraEpicKey`, 'duplicates an active Jira Epic mapping in this Workspace');
      activeJiraMappings.add(uniquenessKey);
    }
  });

  document.workItems.forEach((workItem, index) => {
    const path = `workItems[${index}]`;
    requireWorkspace(indexes, workItem.organizationId, workItem.workspaceId, `${path}.workspaceId`);
    if (workItem.scopeId !== null) {
      requireScope(indexes, workItem.organizationId, workItem.workspaceId, workItem.scopeId, `${path}.scopeId`);
    }
    workItem.dependencies.forEach((dependencyId, dependencyIndex) => {
      if (dependencyId === workItem.id) fail(`${path}.dependencies[${dependencyIndex}]`, 'must not reference the Work Item itself');
      requireWorkItem(indexes, workItem.organizationId, workItem.workspaceId, dependencyId, `${path}.dependencies[${dependencyIndex}]`);
    });
  });

  document.milestones.forEach((milestone, index) => {
    const path = `milestones[${index}]`;
    requireWorkspace(indexes, milestone.organizationId, milestone.workspaceId, `${path}.workspaceId`);
    if (milestone.scopeId !== null) {
      requireScope(indexes, milestone.organizationId, milestone.workspaceId, milestone.scopeId, `${path}.scopeId`);
    }
    milestone.linkedWorkItemIds.forEach((workItemId, workItemIndex) => {
      requireWorkItem(indexes, milestone.organizationId, milestone.workspaceId, workItemId, `${path}.linkedWorkItemIds[${workItemIndex}]`);
    });
  });

  document.scopes.forEach((scope, index) => {
    if (scope.primaryMilestoneId === null) return;
    const milestone = indexes.milestones.get(scope.primaryMilestoneId);
    if (!milestone || milestone.organizationId !== scope.organizationId || milestone.workspaceId !== scope.workspaceId || milestone.scopeId !== scope.id) {
      fail(`scopes[${index}].primaryMilestoneId`, 'must reference a Milestone for this Scope and matching parents');
    }
  });

  document.sources.forEach((source, index) => {
    requireWorkspace(indexes, source.organizationId, source.workspaceId, `sources[${index}].workspaceId`);
  });

  document.findings.forEach((finding, index) => {
    const path = `findings[${index}]`;
    requireWorkspace(indexes, finding.organizationId, finding.workspaceId, `${path}.workspaceId`);
    requireOwnedRecord(indexes.sources, finding.organizationId, finding.workspaceId, finding.sourceId, `${path}.sourceId`, 'a Source');
    if (finding.proposedScopeId !== null) {
      requireScope(indexes, finding.organizationId, finding.workspaceId, finding.proposedScopeId, `${path}.proposedScopeId`);
    }
    if (finding.proposedWorkItemId !== null) {
      requireWorkItem(indexes, finding.organizationId, finding.workspaceId, finding.proposedWorkItemId, `${path}.proposedWorkItemId`);
    }
    if (finding.supersededBy !== null) {
      requireOwnedRecord(indexes.findings, finding.organizationId, finding.workspaceId, finding.supersededBy, `${path}.supersededBy`, 'a Finding');
    }
  });

  document.evidence.forEach((evidence, index) => {
    const path = `evidence[${index}]`;
    requireWorkspace(indexes, evidence.organizationId, evidence.workspaceId, `${path}.workspaceId`);
    const source = requireOwnedRecord(indexes.sources, evidence.organizationId, evidence.workspaceId, evidence.sourceId, `${path}.sourceId`, 'a Source');
    const finding = requireOwnedRecord(indexes.findings, evidence.organizationId, evidence.workspaceId, evidence.findingId, `${path}.findingId`, 'an accepted Finding');
    if (finding.reviewStatus !== 'accepted' || finding.sourceId !== source.id || evidence.exactExcerpt !== finding.exactExcerpt || evidence.sourceDate !== source.date) {
      fail(`${path}.findingId`, 'must preserve accepted Finding and Source provenance exactly');
    }
    if (evidence.scopeId !== null) requireScope(indexes, evidence.organizationId, evidence.workspaceId, evidence.scopeId, `${path}.scopeId`);
    let linkedWorkItem = null;
    if (evidence.workItemId !== null) {
      linkedWorkItem = requireWorkItem(indexes, evidence.organizationId, evidence.workspaceId, evidence.workItemId, `${path}.workItemId`);
    }
    if (linkedWorkItem && evidence.scopeId !== null && evidence.scopeId !== linkedWorkItem.scopeId) {
      fail(`${path}.scopeId`, 'must match the Scope of the referenced Work Item');
    }
    if (evidence.supersededBy !== null) {
      requireOwnedRecord(indexes.evidence, evidence.organizationId, evidence.workspaceId, evidence.supersededBy, `${path}.supersededBy`, 'Evidence');
    }
  });

  document.proposedChanges.forEach((change, index) => {
    const path = `proposedChanges[${index}]`;
    requireWorkspace(indexes, change.organizationId, change.workspaceId, `${path}.workspaceId`);
    const finding = requireOwnedRecord(indexes.findings, change.organizationId, change.workspaceId, change.findingId, `${path}.findingId`, 'a Finding');
    const targetWorkItem = requireWorkItem(indexes, change.organizationId, change.workspaceId, change.workItemId, `${path}.workItemId`);
    let findingIsSupported = false;
    change.evidenceIds.forEach((evidenceId, evidenceIndex) => {
      const evidence = requireOwnedRecord(indexes.evidence, change.organizationId, change.workspaceId, evidenceId, `${path}.evidenceIds[${evidenceIndex}]`, 'Evidence');
      if (evidence.findingId === finding.id) findingIsSupported = true;
      if (evidence.workItemId !== null && evidence.workItemId !== targetWorkItem.id) {
        fail(`${path}.evidenceIds[${evidenceIndex}]`, 'must not reference Evidence associated with a different Work Item');
      }
      if (evidence.scopeId !== null && evidence.scopeId !== targetWorkItem.scopeId) {
        fail(`${path}.evidenceIds[${evidenceIndex}]`, 'must reference Evidence compatible with the target Work Item Scope');
      }
    });
    if (!findingIsSupported) fail(`${path}.evidenceIds`, 'must include Evidence accepted from the Proposed Change Finding');
  });

  document.briefings.forEach((briefing, index) => {
    const path = `briefings[${index}]`;
    requireOrganization(indexes, briefing.organizationId, `${path}.organizationId`);
    const selectedWorkspaces = new Set(briefing.workspaceIds);
    briefing.workspaceIds.forEach((workspaceId, workspaceIndex) => {
      requireWorkspace(indexes, briefing.organizationId, workspaceId, `${path}.workspaceIds[${workspaceIndex}]`);
    });
    briefing.scopeIds.forEach((scopeId, scopeIndex) => {
      const scope = indexes.scopes.get(scopeId);
      if (!scope || scope.organizationId !== briefing.organizationId || !selectedWorkspaces.has(scope.workspaceId)) {
        fail(`${path}.scopeIds[${scopeIndex}]`, 'must reference a Scope in one of the selected Workspaces and matching Organization');
      }
    });
  });

  document.briefingVersions.forEach((version, index) => {
    const path = `briefingVersions[${index}]`;
    const briefing = indexes.briefings.get(version.briefingId);
    if (!briefing || briefing.organizationId !== version.organizationId) {
      fail(`${path}.briefingId`, 'must reference a Briefing with matching Organization parents');
    }
    const selectedWorkspaces = new Set(version.workspaceIds);
    version.workspaceIds.forEach((workspaceId, workspaceIndex) => {
      requireWorkspace(indexes, version.organizationId, workspaceId, `${path}.workspaceIds[${workspaceIndex}]`);
    });
    version.scopeIds.forEach((scopeId, scopeIndex) => {
      const scope = indexes.scopes.get(scopeId);
      if (!scope || scope.organizationId !== version.organizationId || !selectedWorkspaces.has(scope.workspaceId)) {
        fail(`${path}.scopeIds[${scopeIndex}]`, 'must reference a Scope in one of the version Workspaces and matching Organization');
      }
    });
    if (version.comparisonVersionId !== null) {
      const comparison = indexes.briefingVersions.get(version.comparisonVersionId);
      if (!comparison || comparison.organizationId !== version.organizationId || comparison.briefingId !== version.briefingId || comparison.id === version.id) {
        fail(`${path}.comparisonVersionId`, 'must reference another Version of the same Briefing and Organization');
      }
    }
  });

  document.briefings.forEach((briefing, index) => {
    if (briefing.lastCommunicatedVersionId === null) return;
    const version = indexes.briefingVersions.get(briefing.lastCommunicatedVersionId);
    if (!version || version.briefingId !== briefing.id || version.organizationId !== briefing.organizationId || version.status !== 'communicated') {
      fail(`briefings[${index}].lastCommunicatedVersionId`, 'must reference a communicated Version of this Briefing');
    }
  });

  const auditIndexes = {
    organization: indexes.organizations,
    workspace: indexes.workspaces,
    scope: indexes.scopes,
    jiraEpicMapping: indexes.jiraEpicMappings,
    workItem: indexes.workItems,
    milestone: indexes.milestones,
    source: indexes.sources,
    finding: indexes.findings,
    evidence: indexes.evidence,
    proposedChange: indexes.proposedChanges,
    briefing: indexes.briefings,
    briefingVersion: indexes.briefingVersions
  };
  document.auditEvents.forEach((event, index) => {
    const path = `auditEvents[${index}]`;
    requireOrganization(indexes, event.organizationId, `${path}.organizationId`);
    if (event.workspaceId !== null) {
      requireWorkspace(indexes, event.organizationId, event.workspaceId, `${path}.workspaceId`);
    }
    const entity = auditIndexes[event.entityType].get(event.entityId);
    if (!entity || (event.entityType !== 'organization' && entity.organizationId !== event.organizationId) ||
      (event.entityType === 'organization' && entity.id !== event.organizationId)) {
      fail(`${path}.entityId`, 'must reference an entity with matching Organization parents');
    }
    if (WORKSPACE_OWNED_AUDIT_ENTITY_TYPES.has(event.entityType)) {
      const expectedWorkspaceId = event.entityType === 'workspace' ? entity.id : entity.workspaceId;
      if (event.workspaceId === null) fail(`${path}.workspaceId`, 'is required for a Workspace-owned target entity');
      if (event.workspaceId !== expectedWorkspaceId) fail(`${path}.workspaceId`, 'must match the target entity Workspace');
    }
    if (event.workspaceId !== null) {
      if (event.entityType === 'workspace' && entity.id !== event.workspaceId) {
        fail(`${path}.entityId`, 'must reference an entity with matching Workspace parents');
      }
      if (entity.workspaceId && entity.workspaceId !== event.workspaceId) {
        fail(`${path}.entityId`, 'must reference an entity with matching Workspace parents');
      }
      if (Array.isArray(entity.workspaceIds) && !entity.workspaceIds.includes(event.workspaceId)) {
        fail(`${path}.entityId`, 'must reference an entity applicable to the Audit Event Workspace');
      }
    }
  });

  const preferences = document.userPreferences;
  if (preferences.activeOrganizationId !== null) {
    requireOrganization(indexes, preferences.activeOrganizationId, 'userPreferences.activeOrganizationId');
  }
  Object.entries(preferences.activeWorkspaceIdsByOrganization).forEach(([organizationId, workspaceId]) => {
    requireOrganization(indexes, organizationId, `userPreferences.activeWorkspaceIdsByOrganization.${organizationId}`);
    if (workspaceId !== null) {
      requireWorkspace(indexes, organizationId, workspaceId, `userPreferences.activeWorkspaceIdsByOrganization.${organizationId}`);
    }
  });
}

function validateTargetData(document) {
  assertPlainObject(document, 'root');
  if (!Object.prototype.hasOwnProperty.call(document, 'schemaVersion')) fail('schemaVersion', 'is required');
  if (document.schemaVersion !== TARGET_SCHEMA_VERSION) throw new TargetSchemaVersionError(document.schemaVersion);
  assertAllowedKeys(document, 'root', ROOT_FIELDS);
  validateRootCollectionBounds(document);

  ROOT_COLLECTIONS.forEach(collection => {
    document[collection].forEach((record, index) => VALIDATORS[collection](record, `${collection}[${index}]`));
  });
  validateUserPreferences(document.userPreferences, 'userPreferences');
  assertJsonObject(document.globalTechnicalSettings, 'globalTechnicalSettings');
  assertObjectKeysAbsent(document.globalTechnicalSettings, 'globalTechnicalSettings', new Set(['promptOverrides', 'draftingGuidance']));

  const indexes = buildIndexes(document);
  validateParentRelationships(document, indexes);
  return document;
}

function createStableId(entityType, options = {}) {
  const prefix = ENTITY_PREFIXES[entityType];
  if (!prefix) throw new TypeError(`Unsupported target entity type: ${entityType}`);
  const uuid = options.uuid || crypto.randomUUID();
  if (typeof uuid !== 'string' || !/^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/.test(uuid)) {
    throw new TypeError('Stable ID generation requires a UUID');
  }
  return `${prefix}-${uuid.toLowerCase()}`;
}

module.exports = {
  AUDIT_ACTIONS,
  BRIEFING_FORMATS,
  BRIEFING_STATUSES,
  CURRENTNESS_STATES,
  CURRENT_STATE_CONFIDENCE,
  ENTITY_PREFIXES,
  FINDING_REVIEW_STATUSES,
  FOLLOW_UP_STATES,
  ITEM_TYPES,
  MAX_AGGREGATE_ROOT_RECORDS,
  MAX_ROOT_COLLECTION_RECORDS,
  MAPPING_STATUSES,
  PROPOSED_CHANGE_REVIEW_STATUSES,
  ROOT_COLLECTIONS,
  TARGET_SCHEMA_VERSION,
  TargetSchemaVersionError,
  TargetResourceLimitError,
  TargetValidationError,
  UNASSIGNED_SCOPE,
  createStableId,
  validateRootCollectionBounds,
  validateTargetData
};
