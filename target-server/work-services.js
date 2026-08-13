'use strict';

const path = require('node:path');

const { ITEM_TYPES } = require('../target-model/schema');
const { invalidRequest, notFound, previewConflict } = require('./errors');
const { publicWorkItem } = require('./projections');
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
const WORK_ITEM_ACTIONS = Object.freeze(['assign-scope', 'assign-feature', 'assign-sprint', 'follow-up', 'archive']);
const MAPPING_STATUSES = Object.freeze(['pending', 'verified', 'inactive']);
const FOLLOW_UP_STATES = Object.freeze(['none', 'open', 'waiting', 'resolved']);

function requireExplicitTargetDataFile(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new TypeError('Target work services require an explicit schema-v3 data-file path');
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

function featureCreateInput(value) {
  exactKeys(value, ['name', 'description'], ['name']);
  return {
    name: requireText(value.name, { max: 200 }),
    description: optionalText(value.description, '', { allowEmpty: true, max: 4_000 })
  };
}

function buildRenamePreview(target, context, entityType, nextName, revision) {
  const oldName = target.name;
  if (oldName === nextName) throw invalidRequest();
  const value = {
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    entityType,
    entityId: target.id,
    oldName,
    newName: nextName,
    expectedRevision: revision
  };
  return { ...value, previewHash: stateHash(value) };
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
    'scopeId', 'featureId', 'jiraId', 'jiraKey', 'itemType', 'summary', 'description', 'canonicalStatus',
    'currentStateProvenance', 'currentStateConfidence', 'lastCapturedCommentAt', 'sourceStatus',
    'assignee', 'sprint', 'labels', 'dependencies', 'notes'
  ];
  exactKeys(value, allowed, ['scopeId', 'itemType', 'summary', 'canonicalStatus', 'currentStateProvenance', 'currentStateConfidence']);
  return {
    scopeId: nullableStableId(value.scopeId),
    featureId: value.featureId === undefined ? null : nullableStableId(value.featureId),
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
    exactKeys(value, ['type', 'scopeId', 'featureId'], ['type', 'scopeId']);
    const scopeId = nullableStableId(value.scopeId);
    if (scopeId !== null) resolvers.resolveWorkspaceChild('scopes', context.organizationId, context.workspaceId, scopeId);
    let featureId;
    if (Object.hasOwn(value, 'featureId')) featureId = nullableStableId(value.featureId);
    else if (workItem.featureId !== null && resolvers.indexes.features.get(workItem.featureId)?.scopeId === scopeId) featureId = workItem.featureId;
    else featureId = null;
    if (featureId !== null) {
      if (scopeId === null) throw invalidRequest();
      const feature = resolvers.resolveWorkspaceChild('features', context.organizationId, context.workspaceId, featureId);
      if (feature.scopeId !== scopeId) throw notFound();
    }
    const evidenceChanges = document.evidence
      .filter(evidence => evidence.workItemId === workItem.id && evidence.scopeId !== scopeId)
      .map(evidence => ({ evidenceId: evidence.id, beforeScopeId: evidence.scopeId, afterScopeId: scopeId }));
    const featureEffect = featureId === workItem.featureId ? 'retained' : (featureId === null ? 'cleared' : 'replaced');
    return {
      type: value.type,
      field: 'scopeId',
      before: workItem.scopeId,
      after: scopeId,
      featureChange: { effect: featureEffect, beforeFeatureId: workItem.featureId, afterFeatureId: featureId },
      evidenceChanges
    };
  }
  if (value.type === 'assign-feature') {
    exactKeys(value, ['type', 'featureId'], ['type', 'featureId']);
    const featureId = nullableStableId(value.featureId);
    if (featureId !== null) {
      if (workItem.scopeId === null) throw invalidRequest();
      const feature = resolvers.resolveWorkspaceChild('features', context.organizationId, context.workspaceId, featureId);
      if (feature.scopeId !== workItem.scopeId) throw notFound();
    }
    return { type: value.type, field: 'featureId', before: workItem.featureId, after: featureId };
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
  if (stateHash({ value: normalized.before, featureId: normalized.featureChange?.beforeFeatureId }) ===
    stateHash({ value: normalized.after, featureId: normalized.featureChange?.afterFeatureId })) throw invalidRequest();
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
  if (normalized.featureChange) preview.featureChange = clone(normalized.featureChange);
  const revisionBoundPreview = { ...preview, expectedRevision: revision };
  return { ...revisionBoundPreview, previewHash: stateHash(revisionBoundPreview) };
}

function normalizeBulkAction(document, resolvers, context, value) {
  requireObject(value);
  requireEnum(value.type, ['assign-scope', 'assign-sprint']);
  if (value.type === 'assign-scope') {
    exactKeys(value, ['type', 'scopeId', 'featureId'], ['type', 'scopeId']);
    const scopeId = nullableStableId(value.scopeId);
    if (scopeId !== null) resolvers.resolveWorkspaceChild('scopes', context.organizationId, context.workspaceId, scopeId);
    const featureId = Object.hasOwn(value, 'featureId') ? nullableStableId(value.featureId) : undefined;
    if (featureId !== undefined && featureId !== null) {
      if (scopeId === null) throw invalidRequest();
      const feature = resolvers.resolveWorkspaceChild('features', context.organizationId, context.workspaceId, featureId);
      if (feature.scopeId !== scopeId) throw notFound();
    }
    return { type: value.type, field: 'scopeId', after: scopeId, featureId };
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
      const compatibleExisting = item.featureId !== null && resolvers.indexes.features.get(item.featureId)?.scopeId === normalized.after;
      const afterFeatureId = normalized.featureId === undefined ? (compatibleExisting ? item.featureId : null) : normalized.featureId;
      row.featureChange = {
        effect: afterFeatureId === item.featureId ? 'retained' : (afterFeatureId === null ? 'cleared' : 'replaced'),
        beforeFeatureId: item.featureId,
        afterFeatureId
      };
      row.evidenceChanges = document.evidence
        .filter(evidence => evidence.workItemId === item.id && evidence.scopeId !== normalized.after)
        .map(evidence => ({ evidenceId: evidence.id, beforeScopeId: evidence.scopeId, afterScopeId: normalized.after }));
    }
    return row;
  });
  if (rows.every(row => stateHash({ scopeId: row.before, featureId: row.featureChange?.beforeFeatureId }) ===
    stateHash({ scopeId: row.after, featureId: row.featureChange?.afterFeatureId }))) throw invalidRequest();
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

  function renameTarget(document, entityType, ids) {
    const resolvers = createTargetResolvers(document);
    if (entityType === 'organization') {
      const target = resolvers.resolveOrganization(ids.organizationId);
      return { target, context: { organizationId: target.id, workspaceId: null } };
    }
    const workspace = resolvers.resolveWorkspace(ids.organizationId, ids.workspaceId);
    const context = { organizationId: workspace.organizationId, workspaceId: workspace.id };
    if (entityType === 'workspace') return { target: workspace, context };
    const collection = entityType === 'scope' ? 'scopes' : 'features';
    const entityId = entityType === 'scope' ? ids.scopeId : ids.featureId;
    const target = resolvers.resolveWorkspaceChild(collection, ids.organizationId, ids.workspaceId, entityId);
    if (entityType === 'feature' && target.scopeId !== ids.scopeId) throw notFound();
    return { target, context };
  }

  function previewRename(entityType, ids, body) {
    exactKeys(body, ['name'], ['name']);
    const name = requireText(body.name, { max: 200 });
    return readWorkflow(targetDataFile, (document, revision) => {
      const { target, context } = renameTarget(document, entityType, ids);
      return { preview: buildRenamePreview(target, context, entityType, name, revision) };
    });
  }

  function applyRename(entityType, ids, body) {
    const request = baseRequest(body, ['name', 'previewHash'], ['name', 'previewHash']);
    const name = requireText(body.name, { max: 200 });
    const approvedHash = requireText(body.previewHash, { max: 64 });
    return writeWorkflow(targetDataFile, request.expectedRevision, (document, revision) => {
      const { target, context } = renameTarget(document, entityType, ids);
      const preview = buildRenamePreview(target, context, entityType, name, revision);
      if (preview.previewHash !== approvedHash) throw previewConflict();
      const before = clone(target);
      target.name = name;
      if (Object.hasOwn(target, 'updatedAt')) target.updatedAt = runtime.timestamp();
      const timestamp = Object.hasOwn(target, 'updatedAt') ? target.updatedAt : runtime.timestamp();
      appendEntityAudit(document, runtime, context, entityType, target.id, `${entityType}-renamed`, request.actor, timestamp, before, target);
      return { [entityType]: clone(target), appliedPreviewHash: approvedHash };
    });
  }

  return Object.freeze({
    previewOrganizationRename(organizationId, body) {
      return previewRename('organization', { organizationId }, body);
    },

    applyOrganizationRename(organizationId, body) {
      return applyRename('organization', { organizationId }, body);
    },

    previewWorkspaceRename(organizationId, workspaceId, body) {
      return previewRename('workspace', { organizationId, workspaceId }, body);
    },

    applyWorkspaceRename(organizationId, workspaceId, body) {
      return applyRename('workspace', { organizationId, workspaceId }, body);
    },

    previewScopeRename(organizationId, workspaceId, scopeId, body) {
      return previewRename('scope', { organizationId, workspaceId, scopeId }, body);
    },

    applyScopeRename(organizationId, workspaceId, scopeId, body) {
      return applyRename('scope', { organizationId, workspaceId, scopeId }, body);
    },
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
      exactKeys(body.changes, ['description', 'owner']);
      if (Object.keys(body.changes).length === 0) throw invalidRequest();
      return writeWorkflow(targetDataFile, request.expectedRevision, (document) => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const record = resolvers.resolveWorkspaceChild('scopes', organizationId, workspaceId, scopeId);
        const before = clone(record);
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

    listScopeFeatures(organizationId, workspaceId, scopeId) {
      return readWorkflow(targetDataFile, document => {
        const { resolvers } = contextFor(document, organizationId, workspaceId);
        const scope = resolvers.resolveWorkspaceChild('scopes', organizationId, workspaceId, scopeId);
        return { features: document.features.filter(feature => feature.organizationId === organizationId && feature.workspaceId === workspaceId && feature.scopeId === scope.id).map(clone) };
      });
    },

    getScopeFeature(organizationId, workspaceId, scopeId, featureId) {
      return readWorkflow(targetDataFile, document => {
        const { resolvers } = contextFor(document, organizationId, workspaceId);
        const scope = resolvers.resolveWorkspaceChild('scopes', organizationId, workspaceId, scopeId);
        const feature = resolvers.resolveWorkspaceChild('features', organizationId, workspaceId, featureId);
        if (feature.scopeId !== scope.id) throw notFound();
        return { feature: clone(feature) };
      });
    },

    createFeature(organizationId, workspaceId, scopeId, body) {
      const request = baseRequest(body, ['feature'], ['feature']);
      const input = featureCreateInput(body.feature);
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const scope = resolvers.resolveWorkspaceChild('scopes', organizationId, workspaceId, scopeId);
        const record = { id: runtime.id('feature'), ...context, scopeId: scope.id, ...input };
        document.features.push(record);
        const timestamp = runtime.timestamp();
        appendEntityAudit(document, runtime, context, 'feature', record.id, 'feature-created', request.actor, timestamp, null, record);
        return { feature: clone(record) };
      });
    },

    updateFeature(organizationId, workspaceId, scopeId, featureId, body) {
      const request = baseRequest(body, ['changes'], ['changes']);
      exactKeys(body.changes, ['description']);
      if (!Object.hasOwn(body.changes, 'description')) throw invalidRequest();
      const description = requireText(body.changes.description, { allowEmpty: true, max: 4_000 });
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const scope = resolvers.resolveWorkspaceChild('scopes', organizationId, workspaceId, scopeId);
        const record = resolvers.resolveWorkspaceChild('features', organizationId, workspaceId, featureId);
        if (record.scopeId !== scope.id) throw notFound();
        const before = clone(record);
        record.description = description;
        const timestamp = runtime.timestamp();
        appendEntityAudit(document, runtime, context, 'feature', record.id, 'feature-updated', request.actor, timestamp, before, record);
        return { feature: clone(record) };
      });
    },

    previewFeatureRename(organizationId, workspaceId, scopeId, featureId, body) {
      return previewRename('feature', { organizationId, workspaceId, scopeId, featureId }, body);
    },

    applyFeatureRename(organizationId, workspaceId, scopeId, featureId, body) {
      return applyRename('feature', { organizationId, workspaceId, scopeId, featureId }, body);
    },

    listFeatureWorkItems(organizationId, workspaceId, scopeId, featureId) {
      return readWorkflow(targetDataFile, document => {
        const { resolvers } = contextFor(document, organizationId, workspaceId);
        const scope = resolvers.resolveWorkspaceChild('scopes', organizationId, workspaceId, scopeId);
        const feature = resolvers.resolveWorkspaceChild('features', organizationId, workspaceId, featureId);
        if (feature.scopeId !== scope.id) throw notFound();
        return {
          feature: clone(feature),
          workItems: document.workItems
            .filter(item => item.organizationId === organizationId && item.workspaceId === workspaceId && item.featureId === feature.id)
            .map(item => publicWorkItem(item, resolvers.indexes.scopes, resolvers.indexes.features))
        };
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
        if (input.featureId !== null) {
          if (input.scopeId === null) throw invalidRequest();
          const feature = resolvers.resolveWorkspaceChild('features', organizationId, workspaceId, input.featureId);
          if (feature.scopeId !== input.scopeId) throw notFound();
        }
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
        if (normalized.featureChange) item.featureId = normalized.featureChange.afterFeatureId;
        item.updatedAt = runtime.timestamp();
        const auditBefore = normalized.featureChange
          ? { [normalized.field]: normalized.before, featureId: normalized.featureChange.beforeFeatureId }
          : normalized.before;
        const auditAfter = normalized.featureChange
          ? { [normalized.field]: normalized.after, featureId: normalized.featureChange.afterFeatureId }
          : normalized.after;
        appendEntityAudit(document, runtime, context, 'workItem', item.id, `work-item-${normalized.type}-applied`, request.actor, item.updatedAt, auditBefore, auditAfter);
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
          if (stateHash({ value: row.before, featureId: row.featureChange?.beforeFeatureId }) ===
            stateHash({ value: row.after, featureId: row.featureChange?.afterFeatureId })) return;
          item[preview.field] = clone(row.after);
          if (row.featureChange) item.featureId = row.featureChange.afterFeatureId;
          item.updatedAt = timestamp;
          const auditBefore = row.featureChange
            ? { [preview.field]: row.before, featureId: row.featureChange.beforeFeatureId }
            : row.before;
          const auditAfter = row.featureChange
            ? { [preview.field]: row.after, featureId: row.featureChange.afterFeatureId }
            : row.after;
          appendEntityAudit(document, runtime, context, 'workItem', item.id, `bulk-${preview.action}-applied`, request.actor, timestamp, auditBefore, auditAfter);
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
