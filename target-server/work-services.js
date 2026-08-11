'use strict';

const path = require('node:path');

const { ITEM_TYPES } = require('../target-model/schema');
const { invalidRequest, notFound, previewConflict } = require('./errors');
const { createTargetResolvers } = require('./resolvers');
const {
  appendAudit,
  clone,
  createWorkflowRuntime,
  exactKeys,
  nullableStableId,
  nullableText,
  readWorkflow,
  requireActor,
  requireArray,
  requireBoolean,
  requireDate,
  requireEnum,
  requireIsoTimestamp,
  requireObject,
  requireStableId,
  requireText,
  stateHash,
  writeWorkflow
} = require('./workflow-utils');

const MAX_BULK_WORK_ITEMS = 100;
const WORK_ITEM_ACTIONS = Object.freeze(['assign-scope', 'assign-sprint', 'follow-up', 'archive']);
const MAPPING_STATUSES = Object.freeze(['pending', 'verified', 'inactive']);
const FOLLOW_UP_STATES = Object.freeze(['none', 'open', 'waiting', 'resolved']);

function requireExplicitTargetDataFile(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new TypeError('Target work services require an explicit version-2 data-file path');
  return path.resolve(filePath);
}

function createNoneFollowUp() {
  return {
    state: 'none',
    contact: null,
    lastContactAt: null,
    lastCapturedCommentAt: null,
    nextAction: null,
    dueAt: null,
    note: null
  };
}

function uniqueStableIds(value, options = {}) {
  const ids = requireArray(value, options).map(requireStableId);
  if (new Set(ids).size !== ids.length) throw invalidRequest();
  return ids;
}

function optionalText(value, fallback, options) {
  return value === undefined ? fallback : requireText(value, options);
}

function optionalNullableText(value, fallback, options) {
  return value === undefined ? fallback : nullableText(value, options);
}

function requireJiraKey(value) {
  const key = requireText(value, { max: 100 });
  if (key !== key.trim() || key !== key.toUpperCase() || !/^[A-Z][A-Z0-9_]*(?:-[A-Z0-9_]+)?$/.test(key)) throw invalidRequest();
  return key;
}

function baseRequest(body, additionalKeys = [], requiredAdditional = []) {
  exactKeys(body, ['expectedRevision', 'actor', ...additionalKeys], ['expectedRevision', 'actor', ...requiredAdditional]);
  return { expectedRevision: body.expectedRevision, actor: requireActor(body.actor) };
}

function appendEntityAudit(document, runtime, context, entityType, entityId, action, actor, timestamp, before, after) {
  return appendAudit(document, runtime, {
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    entityType,
    entityId,
    action,
    actor,
    timestamp,
    before,
    after
  });
}

function scopeCreateInput(value) {
  exactKeys(value, ['name', 'description', 'owner'], ['name']);
  return {
    name: requireText(value.name, { max: 200 }),
    description: optionalText(value.description, '', { allowEmpty: true, max: 4_000 }),
    owner: optionalNullableText(value.owner, null, { max: 300 })
  };
}

function mappingInput(value, existing = null) {
  const allowed = ['jiraProjectKey', 'jiraEpicKey', 'jiraEpicName', 'mappingStatus', 'provenance', 'verifiedAt'];
  exactKeys(value, allowed, existing ? [] : ['jiraProjectKey', 'jiraEpicKey', 'jiraEpicName', 'mappingStatus', 'provenance']);
  if (existing && Object.keys(value).length === 0) throw invalidRequest();
  const next = existing ? clone(existing) : {};
  if (Object.hasOwn(value, 'jiraProjectKey')) next.jiraProjectKey = requireJiraKey(value.jiraProjectKey);
  if (Object.hasOwn(value, 'jiraEpicKey')) next.jiraEpicKey = requireJiraKey(value.jiraEpicKey);
  if (Object.hasOwn(value, 'jiraEpicName')) next.jiraEpicName = requireText(value.jiraEpicName, { max: 500 });
  if (Object.hasOwn(value, 'mappingStatus')) next.mappingStatus = requireEnum(value.mappingStatus, MAPPING_STATUSES);
  if (Object.hasOwn(value, 'provenance')) next.provenance = requireText(value.provenance, { max: 2_000 });
  if (Object.hasOwn(value, 'verifiedAt')) next.verifiedAt = requireIsoTimestamp(value.verifiedAt, true);
  else if (!existing) next.verifiedAt = null;
  return next;
}

function canonicalJiraIdentity(mapping) {
  return `${mapping.jiraProjectKey.trim().toUpperCase()}\u0000${mapping.jiraEpicKey.trim().toUpperCase()}`;
}

function rejectDuplicateActiveMapping(document, mapping, ownId = null) {
  if (mapping.mappingStatus === 'inactive') return;
  const identity = canonicalJiraIdentity(mapping);
  if (document.jiraEpicMappings.some(candidate => candidate.id !== ownId && candidate.organizationId === mapping.organizationId &&
    candidate.workspaceId === mapping.workspaceId && candidate.mappingStatus !== 'inactive' && canonicalJiraIdentity(candidate) === identity)) {
    throw invalidRequest();
  }
}

function workItemCreateInput(value) {
  const allowed = [
    'scopeId', 'jiraId', 'jiraKey', 'itemType', 'summary', 'description', 'canonicalStatus',
    'currentStateProvenance', 'currentStateConfidence', 'lastCapturedCommentAt', 'sourceStatus',
    'assignee', 'sprint', 'labels', 'dependencies', 'notes'
  ];
  exactKeys(value, allowed, ['scopeId', 'itemType', 'summary', 'canonicalStatus', 'currentStateProvenance', 'currentStateConfidence']);
  return {
    scopeId: nullableStableId(value.scopeId),
    jiraId: optionalNullableText(value.jiraId, null, { max: 200 }),
    jiraKey: value.jiraKey === undefined || value.jiraKey === null ? null : requireJiraKey(value.jiraKey),
    itemType: requireEnum(value.itemType, [...ITEM_TYPES]),
    summary: requireText(value.summary, { max: 1_000 }),
    description: optionalText(value.description, '', { allowEmpty: true, max: 20_000 }),
    canonicalStatus: requireText(value.canonicalStatus, { max: 200 }),
    currentStateProvenance: requireText(value.currentStateProvenance, { max: 500 }),
    currentStateConfidence: requireEnum(value.currentStateConfidence, ['confirmed', 'inferred', 'unknown']),
    lastCapturedCommentAt: value.lastCapturedCommentAt === undefined ? null : requireIsoTimestamp(value.lastCapturedCommentAt, true),
    sourceStatus: optionalNullableText(value.sourceStatus, null, { max: 200 }),
    assignee: optionalNullableText(value.assignee, null, { max: 300 }),
    sprint: optionalNullableText(value.sprint, null, { max: 300 }),
    labels: value.labels === undefined ? [] : requireArray(value.labels, { max: 100 }).map(item => requireText(item, { max: 1_000 })),
    dependencies: value.dependencies === undefined ? [] : uniqueStableIds(value.dependencies, { max: 100 }),
    notes: optionalText(value.notes, '', { allowEmpty: true, max: 20_000 })
  };
}

function workItemMetadataChanges(value) {
  const allowed = ['jiraId', 'jiraKey', 'itemType', 'summary', 'description', 'assignee', 'labels', 'dependencies', 'notes'];
  exactKeys(value, allowed);
  if (Object.keys(value).length === 0) throw invalidRequest();
  const next = {};
  if (Object.hasOwn(value, 'jiraId')) next.jiraId = nullableText(value.jiraId, { max: 200 });
  if (Object.hasOwn(value, 'jiraKey')) next.jiraKey = value.jiraKey === null ? null : requireJiraKey(value.jiraKey);
  if (Object.hasOwn(value, 'itemType')) next.itemType = requireEnum(value.itemType, [...ITEM_TYPES]);
  if (Object.hasOwn(value, 'summary')) next.summary = requireText(value.summary, { max: 1_000 });
  if (Object.hasOwn(value, 'description')) next.description = requireText(value.description, { allowEmpty: true, max: 20_000 });
  if (Object.hasOwn(value, 'assignee')) next.assignee = nullableText(value.assignee, { max: 300 });
  if (Object.hasOwn(value, 'labels')) next.labels = requireArray(value.labels, { max: 100 }).map(item => requireText(item, { max: 1_000 }));
  if (Object.hasOwn(value, 'dependencies')) next.dependencies = uniqueStableIds(value.dependencies, { max: 100 });
  if (Object.hasOwn(value, 'notes')) next.notes = requireText(value.notes, { allowEmpty: true, max: 20_000 });
  return next;
}

function normalizeFollowUp(value) {
  const allowed = ['state', 'contact', 'lastContactAt', 'lastCapturedCommentAt', 'nextAction', 'dueAt', 'note'];
  exactKeys(value, allowed, ['state']);
  const state = requireEnum(value.state, FOLLOW_UP_STATES);
  if (state === 'none') return createNoneFollowUp();
  return {
    state,
    contact: optionalNullableText(value.contact, null, { max: 300 }),
    lastContactAt: value.lastContactAt === undefined ? null : requireIsoTimestamp(value.lastContactAt, true),
    lastCapturedCommentAt: value.lastCapturedCommentAt === undefined ? null : requireIsoTimestamp(value.lastCapturedCommentAt, true),
    nextAction: optionalNullableText(value.nextAction, null, { max: 2_000 }),
    dueAt: value.dueAt === undefined ? null : requireDate(value.dueAt, true),
    note: optionalNullableText(value.note, null, { max: 4_000 })
  };
}

function rejectDuplicateWorkItemJiraKey(document, context, jiraKey, ownId = null) {
  if (jiraKey === null) return;
  if (document.workItems.some(item => item.id !== ownId && item.organizationId === context.organizationId &&
    item.workspaceId === context.workspaceId && item.jiraKey !== null && item.jiraKey.toUpperCase() === jiraKey.toUpperCase())) {
    throw invalidRequest();
  }
}

function normalizeWorkItemAction(document, resolvers, context, workItem, value) {
  requireObject(value);
  requireEnum(value.type, WORK_ITEM_ACTIONS);
  if (value.type === 'assign-scope') {
    exactKeys(value, ['type', 'scopeId'], ['type', 'scopeId']);
    const scopeId = nullableStableId(value.scopeId);
    if (scopeId !== null) resolvers.resolveWorkspaceChild('scopes', context.organizationId, context.workspaceId, scopeId);
    const evidenceChanges = document.evidence
      .filter(evidence => evidence.workItemId === workItem.id && evidence.scopeId !== scopeId)
      .map(evidence => ({ evidenceId: evidence.id, beforeScopeId: evidence.scopeId, afterScopeId: scopeId }));
    return { type: value.type, field: 'scopeId', before: workItem.scopeId, after: scopeId, evidenceChanges };
  }
  if (value.type === 'assign-sprint') {
    exactKeys(value, ['type', 'sprint'], ['type', 'sprint']);
    return { type: value.type, field: 'sprint', before: workItem.sprint, after: nullableText(value.sprint, { max: 300 }) };
  }
  if (value.type === 'follow-up') {
    exactKeys(value, ['type', 'followUp'], ['type', 'followUp']);
    return { type: value.type, field: 'followUp', before: clone(workItem.followUp), after: normalizeFollowUp(value.followUp) };
  }
  exactKeys(value, ['type', 'archived'], ['type', 'archived']);
  return { type: value.type, field: 'archived', before: workItem.archived, after: requireBoolean(value.archived) };
}

function actionPreview(context, workItemId, normalized, revision) {
  if (stateHash(normalized.before) === stateHash(normalized.after)) throw invalidRequest();
  const preview = {
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    workItemId,
    action: normalized.type,
    field: normalized.field,
    before: clone(normalized.before),
    after: clone(normalized.after)
  };
  if (normalized.evidenceChanges) preview.evidenceChanges = clone(normalized.evidenceChanges);
  const revisionBoundPreview = { ...preview, expectedRevision: revision };
  return { ...revisionBoundPreview, previewHash: stateHash(revisionBoundPreview) };
}

function normalizeBulkAction(document, resolvers, context, value) {
  requireObject(value);
  requireEnum(value.type, ['assign-scope', 'assign-sprint']);
  if (value.type === 'assign-scope') {
    exactKeys(value, ['type', 'scopeId'], ['type', 'scopeId']);
    const scopeId = nullableStableId(value.scopeId);
    if (scopeId !== null) resolvers.resolveWorkspaceChild('scopes', context.organizationId, context.workspaceId, scopeId);
    return { type: value.type, field: 'scopeId', after: scopeId };
  }
  exactKeys(value, ['type', 'sprint'], ['type', 'sprint']);
  return { type: value.type, field: 'sprint', after: nullableText(value.sprint, { max: 300 }) };
}

function buildBulkPreview(document, resolvers, context, workItemIds, rawAction, revision) {
  const normalized = normalizeBulkAction(document, resolvers, context, rawAction);
  const rows = workItemIds.map(workItemId => {
    const item = resolvers.resolveWorkspaceChild('workItems', context.organizationId, context.workspaceId, workItemId);
    const row = { workItemId: item.id, before: clone(item[normalized.field]), after: clone(normalized.after) };
    if (normalized.field === 'scopeId') {
      row.evidenceChanges = document.evidence
        .filter(evidence => evidence.workItemId === item.id && evidence.scopeId !== normalized.after)
        .map(evidence => ({ evidenceId: evidence.id, beforeScopeId: evidence.scopeId, afterScopeId: normalized.after }));
    }
    return row;
  });
  if (rows.every(row => stateHash(row.before) === stateHash(row.after))) throw invalidRequest();
  const preview = {
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    action: normalized.type,
    field: normalized.field,
    rows
  };
  const revisionBoundPreview = { ...preview, expectedRevision: revision };
  return { ...revisionBoundPreview, previewHash: stateHash(revisionBoundPreview) };
}

function milestoneInput(value, existing = null) {
  const allowed = ['scopeId', 'title', 'date', 'status', 'notes', 'linkedWorkItemIds', 'allowCrossScopeLinks'];
  exactKeys(value, allowed, existing ? [] : ['scopeId', 'title', 'date', 'status', 'linkedWorkItemIds']);
  const next = existing ? clone(existing) : {};
  if (Object.hasOwn(value, 'scopeId')) next.scopeId = nullableStableId(value.scopeId);
  if (Object.hasOwn(value, 'title')) next.title = requireText(value.title, { max: 500 });
  if (Object.hasOwn(value, 'date')) next.date = requireDate(value.date);
  if (Object.hasOwn(value, 'status')) next.status = requireText(value.status, { max: 100 });
  if (Object.hasOwn(value, 'notes')) next.notes = requireText(value.notes, { allowEmpty: true, max: 10_000 });
  else if (!existing) next.notes = '';
  if (Object.hasOwn(value, 'linkedWorkItemIds')) next.linkedWorkItemIds = uniqueStableIds(value.linkedWorkItemIds, { max: 100 });
  next.allowCrossScopeLinks = value.allowCrossScopeLinks === undefined ? false : requireBoolean(value.allowCrossScopeLinks);
  return next;
}

function validateMilestoneLinks(resolvers, context, milestone) {
  if (milestone.scopeId !== null) resolvers.resolveWorkspaceChild('scopes', context.organizationId, context.workspaceId, milestone.scopeId);
  milestone.linkedWorkItemIds.forEach(workItemId => {
    const item = resolvers.resolveWorkspaceChild('workItems', context.organizationId, context.workspaceId, workItemId);
    if (milestone.scopeId !== null && item.scopeId !== milestone.scopeId && milestone.allowCrossScopeLinks !== true) throw invalidRequest();
  });
}

function createWorkServices(options = {}) {
  const targetDataFile = requireExplicitTargetDataFile(options.targetDataFile);
  const runtime = createWorkflowRuntime(options);

  function contextFor(document, organizationId, workspaceId) {
    const resolvers = createTargetResolvers(document);
    const workspace = resolvers.resolveWorkspace(organizationId, workspaceId);
    return { resolvers, context: { organizationId: workspace.organizationId, workspaceId: workspace.id } };
  }

  return Object.freeze({
    createScope(organizationId, workspaceId, body) {
      const request = baseRequest(body, ['scope'], ['scope']);
      const input = scopeCreateInput(body.scope);
      return writeWorkflow(targetDataFile, request.expectedRevision, (document) => {
        const { context } = contextFor(document, organizationId, workspaceId);
        const timestamp = runtime.timestamp();
        const record = {
          id: runtime.id('scope'),
          ...context,
          ...input,
          archived: false,
          primaryMilestoneId: null,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        document.scopes.push(record);
        appendEntityAudit(document, runtime, context, 'scope', record.id, 'scope-created', request.actor, timestamp, null, record);
        return { scope: clone(record) };
      });
    },

    updateScope(organizationId, workspaceId, scopeId, body) {
      const request = baseRequest(body, ['changes'], ['changes']);
      exactKeys(body.changes, ['name', 'description', 'owner']);
      if (Object.keys(body.changes).length === 0) throw invalidRequest();
      return writeWorkflow(targetDataFile, request.expectedRevision, (document) => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const record = resolvers.resolveWorkspaceChild('scopes', organizationId, workspaceId, scopeId);
        const before = clone(record);
        if (Object.hasOwn(body.changes, 'name')) record.name = requireText(body.changes.name, { max: 200 });
        if (Object.hasOwn(body.changes, 'description')) record.description = requireText(body.changes.description, { allowEmpty: true, max: 4_000 });
        if (Object.hasOwn(body.changes, 'owner')) record.owner = nullableText(body.changes.owner, { max: 300 });
        record.updatedAt = runtime.timestamp();
        appendEntityAudit(document, runtime, context, 'scope', record.id, 'scope-updated', request.actor, record.updatedAt, before, record);
        return { scope: clone(record) };
      });
    },

    setScopeArchived(organizationId, workspaceId, scopeId, body) {
      const request = baseRequest(body, ['archived'], ['archived']);
      const archived = requireBoolean(body.archived);
      return writeWorkflow(targetDataFile, request.expectedRevision, (document) => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const record = resolvers.resolveWorkspaceChild('scopes', organizationId, workspaceId, scopeId);
        const before = clone(record);
        record.archived = archived;
        record.updatedAt = runtime.timestamp();
        appendEntityAudit(document, runtime, context, 'scope', record.id, archived ? 'scope-archived' : 'scope-restored', request.actor, record.updatedAt, before, record);
        return { scope: clone(record) };
      });
    },

    listScopeMappings(organizationId, workspaceId, scopeId) {
      return readWorkflow(targetDataFile, document => {
        const { resolvers } = contextFor(document, organizationId, workspaceId);
        const scope = resolvers.resolveWorkspaceChild('scopes', organizationId, workspaceId, scopeId);
        return { jiraEpicMappings: document.jiraEpicMappings.filter(mapping => mapping.organizationId === organizationId && mapping.workspaceId === workspaceId && mapping.scopeId === scope.id).map(clone) };
      });
    },

    createJiraMapping(organizationId, workspaceId, scopeId, body) {
      const request = baseRequest(body, ['mapping'], ['mapping']);
      const input = mappingInput(body.mapping);
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const scope = resolvers.resolveWorkspaceChild('scopes', organizationId, workspaceId, scopeId);
        const record = { id: runtime.id('jiraEpicMapping'), ...context, scopeId: scope.id, ...input };
        rejectDuplicateActiveMapping(document, record);
        document.jiraEpicMappings.push(record);
        const timestamp = runtime.timestamp();
        appendEntityAudit(document, runtime, context, 'jiraEpicMapping', record.id, 'jira-epic-mapping-created', request.actor, timestamp, null, record);
        return { jiraEpicMapping: clone(record) };
      });
    },

    updateJiraMapping(organizationId, workspaceId, scopeId, mappingId, body) {
      const request = baseRequest(body, ['changes'], ['changes']);
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const scope = resolvers.resolveWorkspaceChild('scopes', organizationId, workspaceId, scopeId);
        const record = resolvers.resolveWorkspaceChild('jiraEpicMappings', organizationId, workspaceId, mappingId);
        if (record.scopeId !== scope.id) throw notFound();
        const before = clone(record);
        Object.assign(record, mappingInput(body.changes, record));
        rejectDuplicateActiveMapping(document, record, record.id);
        const timestamp = runtime.timestamp();
        appendEntityAudit(document, runtime, context, 'jiraEpicMapping', record.id, 'jira-epic-mapping-updated', request.actor, timestamp, before, record);
        return { jiraEpicMapping: clone(record) };
      });
    },

    createWorkItem(organizationId, workspaceId, body) {
      const request = baseRequest(body, ['workItem'], ['workItem']);
      const input = workItemCreateInput(body.workItem);
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        if (input.scopeId !== null) resolvers.resolveWorkspaceChild('scopes', organizationId, workspaceId, input.scopeId);
        input.dependencies.forEach(id => resolvers.resolveWorkspaceChild('workItems', organizationId, workspaceId, id));
        rejectDuplicateWorkItemJiraKey(document, context, input.jiraKey);
        const timestamp = runtime.timestamp();
        const record = {
          id: runtime.id('workItem'),
          ...context,
          ...input,
          archived: false,
          followUp: createNoneFollowUp(),
          createdAt: timestamp,
          updatedAt: timestamp
        };
        document.workItems.push(record);
        appendEntityAudit(document, runtime, context, 'workItem', record.id, 'work-item-created', request.actor, timestamp, null, record);
        return { workItem: clone(record) };
      });
    },

    updateWorkItem(organizationId, workspaceId, workItemId, body) {
      const request = baseRequest(body, ['changes'], ['changes']);
      const changes = workItemMetadataChanges(body.changes);
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const record = resolvers.resolveWorkspaceChild('workItems', organizationId, workspaceId, workItemId);
        changes.dependencies?.forEach(id => {
          if (id === record.id) throw invalidRequest();
          resolvers.resolveWorkspaceChild('workItems', organizationId, workspaceId, id);
        });
        if (Object.hasOwn(changes, 'jiraKey')) rejectDuplicateWorkItemJiraKey(document, context, changes.jiraKey, record.id);
        const before = clone(record);
        Object.assign(record, changes);
        record.updatedAt = runtime.timestamp();
        appendEntityAudit(document, runtime, context, 'workItem', record.id, 'work-item-metadata-updated', request.actor, record.updatedAt, before, record);
        return { workItem: clone(record) };
      });
    },

    previewWorkItemAction(organizationId, workspaceId, workItemId, body) {
      exactKeys(body, ['action'], ['action']);
      return readWorkflow(targetDataFile, (document, revision) => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const item = resolvers.resolveWorkspaceChild('workItems', organizationId, workspaceId, workItemId);
        return { preview: actionPreview(context, item.id, normalizeWorkItemAction(document, resolvers, context, item, body.action), revision) };
      });
    },

    applyWorkItemAction(organizationId, workspaceId, workItemId, body) {
      const request = baseRequest(body, ['action', 'previewHash'], ['action', 'previewHash']);
      const approvedHash = requireText(body.previewHash, { max: 64 });
      return writeWorkflow(targetDataFile, request.expectedRevision, (document, revision) => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const item = resolvers.resolveWorkspaceChild('workItems', organizationId, workspaceId, workItemId);
        const normalized = normalizeWorkItemAction(document, resolvers, context, item, body.action);
        const preview = actionPreview(context, item.id, normalized, revision);
        if (preview.previewHash !== approvedHash) throw previewConflict();
        item[normalized.field] = clone(normalized.after);
        item.updatedAt = runtime.timestamp();
        appendEntityAudit(document, runtime, context, 'workItem', item.id, `work-item-${normalized.type}-applied`, request.actor, item.updatedAt, normalized.before, normalized.after);
        (normalized.evidenceChanges || []).forEach(change => {
          const evidence = resolvers.resolveWorkspaceChild('evidence', organizationId, workspaceId, change.evidenceId);
          evidence.scopeId = normalized.after;
          appendEntityAudit(document, runtime, context, 'evidence', evidence.id, 'evidence-scope-reassociated', request.actor, item.updatedAt, change.beforeScopeId, normalized.after);
        });
        return { workItem: clone(item), appliedPreviewHash: approvedHash };
      });
    },

    previewBulkWorkItems(organizationId, workspaceId, body) {
      exactKeys(body, ['workItemIds', 'action'], ['workItemIds', 'action']);
      const workItemIds = uniqueStableIds(body.workItemIds, { min: 1, max: MAX_BULK_WORK_ITEMS });
      return readWorkflow(targetDataFile, (document, revision) => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        return { preview: buildBulkPreview(document, resolvers, context, workItemIds, body.action, revision) };
      });
    },

    applyBulkWorkItems(organizationId, workspaceId, body) {
      const request = baseRequest(body, ['workItemIds', 'action', 'previewHash'], ['workItemIds', 'action', 'previewHash']);
      const workItemIds = uniqueStableIds(body.workItemIds, { min: 1, max: MAX_BULK_WORK_ITEMS });
      const approvedHash = requireText(body.previewHash, { max: 64 });
      return writeWorkflow(targetDataFile, request.expectedRevision, (document, revision) => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const preview = buildBulkPreview(document, resolvers, context, workItemIds, body.action, revision);
        if (preview.previewHash !== approvedHash) throw previewConflict();
        const timestamp = runtime.timestamp();
        const changed = [];
        preview.rows.forEach(row => {
          const item = resolvers.resolveWorkspaceChild('workItems', organizationId, workspaceId, row.workItemId);
          if (stateHash(row.before) === stateHash(row.after)) return;
          item[preview.field] = clone(row.after);
          item.updatedAt = timestamp;
          appendEntityAudit(document, runtime, context, 'workItem', item.id, `bulk-${preview.action}-applied`, request.actor, timestamp, row.before, row.after);
          (row.evidenceChanges || []).forEach(change => {
            const evidence = resolvers.resolveWorkspaceChild('evidence', organizationId, workspaceId, change.evidenceId);
            evidence.scopeId = row.after;
            appendEntityAudit(document, runtime, context, 'evidence', evidence.id, 'evidence-scope-reassociated', request.actor, timestamp, change.beforeScopeId, row.after);
          });
          changed.push(clone(item));
        });
        return { workItems: changed, appliedPreviewHash: approvedHash, changedCount: changed.length };
      });
    },

    createMilestone(organizationId, workspaceId, body) {
      const request = baseRequest(body, ['milestone'], ['milestone']);
      const input = milestoneInput(body.milestone);
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        validateMilestoneLinks(resolvers, context, input);
        const timestamp = runtime.timestamp();
        const { allowCrossScopeLinks, ...fields } = input;
        const record = { id: runtime.id('milestone'), ...context, ...fields, createdAt: timestamp, updatedAt: timestamp };
        document.milestones.push(record);
        appendEntityAudit(document, runtime, context, 'milestone', record.id, 'milestone-created', request.actor, timestamp, null, record);
        return { milestone: clone(record), crossScopeLinksExplicitlyApproved: allowCrossScopeLinks };
      });
    },

    updateMilestone(organizationId, workspaceId, milestoneId, body) {
      const request = baseRequest(body, ['changes'], ['changes']);
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const record = resolvers.resolveWorkspaceChild('milestones', organizationId, workspaceId, milestoneId);
        const before = clone(record);
        const input = milestoneInput(body.changes, record);
        validateMilestoneLinks(resolvers, context, input);
        const { allowCrossScopeLinks, ...fields } = input;
        Object.assign(record, fields);
        record.updatedAt = runtime.timestamp();
        appendEntityAudit(document, runtime, context, 'milestone', record.id, 'milestone-updated', request.actor, record.updatedAt, before, record);
        return { milestone: clone(record), crossScopeLinksExplicitlyApproved: allowCrossScopeLinks };
      });
    }
  });
}

module.exports = {
  FOLLOW_UP_STATES,
  MAPPING_STATUSES,
  MAX_BULK_WORK_ITEMS,
  WORK_ITEM_ACTIONS,
  buildBulkPreview,
  createNoneFollowUp,
  createWorkServices,
  normalizeFollowUp,
  requireJiraKey
};
