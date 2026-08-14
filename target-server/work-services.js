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
const WORK_ITEM_ACTIONS = Object.freeze(['assign-initiative', 'assign-workstream', 'assign-jira-epic', 'assign-sprint', 'follow-up', 'archive']);
const MAPPING_STATUSES = Object.freeze(['pending', 'verified', 'inactive']);
const FOLLOW_UP_STATES = Object.freeze(['none', 'open', 'waiting', 'resolved']);

function requireExplicitTargetDataFile(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new TypeError('Target work services require an explicit schema-v5 data-file path');
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

function initiativeCreateInput(value) {
  exactKeys(value, ['name', 'description', 'owner'], ['name']);
  return {
    name: requireText(value.name, { max: 200 }),
    description: optionalText(value.description, '', { allowEmpty: true, max: 4_000 }),
    owner: optionalNullableText(value.owner, null, { max: 300 })
  };
}

function workstreamCreateInput(value) {
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
    'initiativeId', 'workstreamId', 'jiraEpicMappingId', 'jiraId', 'jiraKey', 'itemType', 'summary', 'description', 'canonicalStatus',
    'currentStateProvenance', 'currentStateConfidence', 'lastCapturedCommentAt', 'sourceStatus',
    'assignee', 'sprint', 'labels', 'dependencies', 'notes'
  ];
  exactKeys(value, allowed, ['initiativeId', 'itemType', 'summary', 'canonicalStatus', 'currentStateProvenance', 'currentStateConfidence']);
  return {
    initiativeId: nullableStableId(value.initiativeId),
    workstreamId: value.workstreamId === undefined ? null : nullableStableId(value.workstreamId),
    jiraEpicMappingId: value.jiraEpicMappingId === undefined ? null : nullableStableId(value.jiraEpicMappingId),
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
  if (value.type === 'assign-initiative') {
    exactKeys(value, ['type', 'initiativeId', 'workstreamId', 'jiraEpicMappingId'], ['type', 'initiativeId']);
    const initiativeId = nullableStableId(value.initiativeId);
    if (initiativeId !== null) resolvers.resolveWorkspaceChild('initiatives', context.organizationId, context.workspaceId, initiativeId);
    let workstreamId;
    if (Object.hasOwn(value, 'workstreamId')) workstreamId = nullableStableId(value.workstreamId);
    else if (workItem.workstreamId !== null && resolvers.indexes.workstreams.get(workItem.workstreamId)?.initiativeId === initiativeId) workstreamId = workItem.workstreamId;
    else workstreamId = null;
    if (workstreamId !== null) {
      if (initiativeId === null) throw invalidRequest();
      const workstream = resolvers.resolveWorkspaceChild('workstreams', context.organizationId, context.workspaceId, workstreamId);
      if (workstream.initiativeId !== initiativeId) throw notFound();
    }
    let jiraEpicMappingId;
    const jiraEpicSelectionExplicit = Object.hasOwn(value, 'jiraEpicMappingId');
    if (jiraEpicSelectionExplicit) jiraEpicMappingId = nullableStableId(value.jiraEpicMappingId);
    else if (workItem.jiraEpicMappingId !== null && resolvers.indexes.jiraEpicMappings.get(workItem.jiraEpicMappingId)?.initiativeId === initiativeId) {
      jiraEpicMappingId = workItem.jiraEpicMappingId;
    } else jiraEpicMappingId = null;
    if (jiraEpicMappingId !== null) {
      if (initiativeId === null) throw invalidRequest();
      const mapping = resolvers.resolveWorkspaceChild('jiraEpicMappings', context.organizationId, context.workspaceId, jiraEpicMappingId);
      if (mapping.initiativeId !== initiativeId) throw notFound();
    }
    const evidenceChanges = document.evidence
      .filter(evidence => evidence.workItemId === workItem.id && evidence.initiativeId !== initiativeId)
      .map(evidence => ({ evidenceId: evidence.id, beforeInitiativeId: evidence.initiativeId, afterInitiativeId: initiativeId }));
    const workstreamEffect = workstreamId === workItem.workstreamId ? 'retained' : (workstreamId === null ? 'cleared' : 'replaced');
    const jiraEpicEffect = jiraEpicMappingId === workItem.jiraEpicMappingId ? 'retained' : (jiraEpicMappingId === null ? 'cleared' : 'replaced');
    return {
      type: value.type,
      field: 'initiativeId',
      before: workItem.initiativeId,
      after: initiativeId,
      workstreamChange: { effect: workstreamEffect, beforeWorkstreamId: workItem.workstreamId, afterWorkstreamId: workstreamId },
      jiraEpicChange: {
        effect: jiraEpicEffect,
        beforeJiraEpicMappingId: workItem.jiraEpicMappingId,
        afterJiraEpicMappingId: jiraEpicMappingId
      },
      evidenceChanges
    };
  }
  if (value.type === 'assign-workstream') {
    exactKeys(value, ['type', 'workstreamId'], ['type', 'workstreamId']);
    const workstreamId = nullableStableId(value.workstreamId);
    if (workstreamId !== null) {
      if (workItem.initiativeId === null) throw invalidRequest();
      const workstream = resolvers.resolveWorkspaceChild('workstreams', context.organizationId, context.workspaceId, workstreamId);
      if (workstream.initiativeId !== workItem.initiativeId) throw notFound();
    }
    return { type: value.type, field: 'workstreamId', before: workItem.workstreamId, after: workstreamId };
  }
  if (value.type === 'assign-jira-epic') {
    exactKeys(value, ['type', 'jiraEpicMappingId'], ['type', 'jiraEpicMappingId']);
    const jiraEpicMappingId = nullableStableId(value.jiraEpicMappingId);
    if (jiraEpicMappingId !== null) {
      if (workItem.initiativeId === null) throw invalidRequest();
      const mapping = resolvers.resolveWorkspaceChild('jiraEpicMappings', context.organizationId, context.workspaceId, jiraEpicMappingId);
      if (mapping.initiativeId !== workItem.initiativeId) throw notFound();
    }
    return { type: value.type, field: 'jiraEpicMappingId', before: workItem.jiraEpicMappingId, after: jiraEpicMappingId };
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
  if (stateHash({
    value: normalized.before,
    workstreamId: normalized.workstreamChange?.beforeWorkstreamId,
    jiraEpicMappingId: normalized.jiraEpicChange?.beforeJiraEpicMappingId
  }) === stateHash({
    value: normalized.after,
    workstreamId: normalized.workstreamChange?.afterWorkstreamId,
    jiraEpicMappingId: normalized.jiraEpicChange?.afterJiraEpicMappingId
  })) throw invalidRequest();
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
  if (normalized.workstreamChange) preview.workstreamChange = clone(normalized.workstreamChange);
  if (normalized.jiraEpicChange) preview.jiraEpicChange = clone(normalized.jiraEpicChange);
  const revisionBoundPreview = { ...preview, expectedRevision: revision };
  return { ...revisionBoundPreview, previewHash: stateHash(revisionBoundPreview) };
}

function normalizeBulkAction(document, resolvers, context, value) {
  requireObject(value);
  requireEnum(value.type, ['assign-initiative', 'assign-sprint']);
  if (value.type === 'assign-initiative') {
    exactKeys(value, ['type', 'initiativeId', 'workstreamId', 'jiraEpicMappingId'], ['type', 'initiativeId']);
    const initiativeId = nullableStableId(value.initiativeId);
    if (initiativeId !== null) resolvers.resolveWorkspaceChild('initiatives', context.organizationId, context.workspaceId, initiativeId);
    const workstreamId = Object.hasOwn(value, 'workstreamId') ? nullableStableId(value.workstreamId) : undefined;
    const jiraEpicMappingId = Object.hasOwn(value, 'jiraEpicMappingId') ? nullableStableId(value.jiraEpicMappingId) : undefined;
    if (workstreamId !== undefined && workstreamId !== null) {
      if (initiativeId === null) throw invalidRequest();
      const workstream = resolvers.resolveWorkspaceChild('workstreams', context.organizationId, context.workspaceId, workstreamId);
      if (workstream.initiativeId !== initiativeId) throw notFound();
    }
    if (jiraEpicMappingId !== undefined && jiraEpicMappingId !== null) {
      if (initiativeId === null) throw invalidRequest();
      const mapping = resolvers.resolveWorkspaceChild('jiraEpicMappings', context.organizationId, context.workspaceId, jiraEpicMappingId);
      if (mapping.initiativeId !== initiativeId) throw notFound();
    }
    return { type: value.type, field: 'initiativeId', after: initiativeId, workstreamId, jiraEpicMappingId };
  }
  exactKeys(value, ['type', 'sprint'], ['type', 'sprint']);
  return { type: value.type, field: 'sprint', after: nullableText(value.sprint, { max: 300 }) };
}

function buildBulkPreview(document, resolvers, context, workItemIds, rawAction, revision) {
  const normalized = normalizeBulkAction(document, resolvers, context, rawAction);
  const rows = workItemIds.map(workItemId => {
    const item = resolvers.resolveWorkspaceChild('workItems', context.organizationId, context.workspaceId, workItemId);
    const row = { workItemId: item.id, before: clone(item[normalized.field]), after: clone(normalized.after) };
    if (normalized.field === 'initiativeId') {
      const compatibleExisting = item.workstreamId !== null && resolvers.indexes.workstreams.get(item.workstreamId)?.initiativeId === normalized.after;
      const afterWorkstreamId = normalized.workstreamId === undefined ? (compatibleExisting ? item.workstreamId : null) : normalized.workstreamId;
      row.workstreamChange = {
        effect: afterWorkstreamId === item.workstreamId ? 'retained' : (afterWorkstreamId === null ? 'cleared' : 'replaced'),
        beforeWorkstreamId: item.workstreamId,
        afterWorkstreamId
      };
      const compatibleMapping = item.jiraEpicMappingId !== null &&
        resolvers.indexes.jiraEpicMappings.get(item.jiraEpicMappingId)?.initiativeId === normalized.after;
      const afterJiraEpicMappingId = normalized.jiraEpicMappingId === undefined
        ? (compatibleMapping ? item.jiraEpicMappingId : null)
        : normalized.jiraEpicMappingId;
      row.jiraEpicChange = {
        effect: afterJiraEpicMappingId === item.jiraEpicMappingId ? 'retained' : (afterJiraEpicMappingId === null ? 'cleared' : 'replaced'),
        beforeJiraEpicMappingId: item.jiraEpicMappingId,
        afterJiraEpicMappingId
      };
      row.evidenceChanges = document.evidence
        .filter(evidence => evidence.workItemId === item.id && evidence.initiativeId !== normalized.after)
        .map(evidence => ({ evidenceId: evidence.id, beforeInitiativeId: evidence.initiativeId, afterInitiativeId: normalized.after }));
    }
    return row;
  });
  if (rows.every(row => stateHash({
    initiativeId: row.before,
    workstreamId: row.workstreamChange?.beforeWorkstreamId,
    jiraEpicMappingId: row.jiraEpicChange?.beforeJiraEpicMappingId
  }) === stateHash({
    initiativeId: row.after,
    workstreamId: row.workstreamChange?.afterWorkstreamId,
    jiraEpicMappingId: row.jiraEpicChange?.afterJiraEpicMappingId
  }))) throw invalidRequest();
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
  const allowed = ['initiativeId', 'title', 'date', 'status', 'notes', 'linkedWorkItemIds', 'allowCrossInitiativeLinks'];
  exactKeys(value, allowed, existing ? [] : ['initiativeId', 'title', 'date', 'status', 'linkedWorkItemIds']);
  const next = existing ? clone(existing) : {};
  if (Object.hasOwn(value, 'initiativeId')) next.initiativeId = nullableStableId(value.initiativeId);
  if (Object.hasOwn(value, 'title')) next.title = requireText(value.title, { max: 500 });
  if (Object.hasOwn(value, 'date')) next.date = requireDate(value.date);
  if (Object.hasOwn(value, 'status')) next.status = requireText(value.status, { max: 100 });
  if (Object.hasOwn(value, 'notes')) next.notes = requireText(value.notes, { allowEmpty: true, max: 10_000 });
  else if (!existing) next.notes = '';
  if (Object.hasOwn(value, 'linkedWorkItemIds')) next.linkedWorkItemIds = uniqueStableIds(value.linkedWorkItemIds, { max: 100 });
  next.allowCrossInitiativeLinks = value.allowCrossInitiativeLinks === undefined ? false : requireBoolean(value.allowCrossInitiativeLinks);
  return next;
}

function validateMilestoneLinks(resolvers, context, milestone) {
  if (milestone.initiativeId !== null) resolvers.resolveWorkspaceChild('initiatives', context.organizationId, context.workspaceId, milestone.initiativeId);
  milestone.linkedWorkItemIds.forEach(workItemId => {
    const item = resolvers.resolveWorkspaceChild('workItems', context.organizationId, context.workspaceId, workItemId);
    if (milestone.initiativeId !== null && item.initiativeId !== milestone.initiativeId && milestone.allowCrossInitiativeLinks !== true) throw invalidRequest();
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
    const collection = entityType === 'initiative' ? 'initiatives' : 'workstreams';
    const entityId = entityType === 'initiative' ? ids.initiativeId : ids.workstreamId;
    const target = resolvers.resolveWorkspaceChild(collection, ids.organizationId, ids.workspaceId, entityId);
    if (entityType === 'workstream' && target.initiativeId !== ids.initiativeId) throw notFound();
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

    previewInitiativeRename(organizationId, workspaceId, initiativeId, body) {
      return previewRename('initiative', { organizationId, workspaceId, initiativeId }, body);
    },

    applyInitiativeRename(organizationId, workspaceId, initiativeId, body) {
      return applyRename('initiative', { organizationId, workspaceId, initiativeId }, body);
    },
    createInitiative(organizationId, workspaceId, body) {
      const request = baseRequest(body, ['initiative'], ['initiative']);
      const input = initiativeCreateInput(body.initiative);
      return writeWorkflow(targetDataFile, request.expectedRevision, (document) => {
        const { context } = contextFor(document, organizationId, workspaceId);
        const timestamp = runtime.timestamp();
        const record = {
          id: runtime.id('initiative'),
          ...context,
          ...input,
          archived: false,
          primaryMilestoneId: null,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        document.initiatives.push(record);
        appendEntityAudit(document, runtime, context, 'initiative', record.id, 'initiative-created', request.actor, timestamp, null, record);
        return { initiative: clone(record) };
      });
    },

    updateInitiative(organizationId, workspaceId, initiativeId, body) {
      const request = baseRequest(body, ['changes'], ['changes']);
      exactKeys(body.changes, ['description', 'owner']);
      if (Object.keys(body.changes).length === 0) throw invalidRequest();
      return writeWorkflow(targetDataFile, request.expectedRevision, (document) => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const record = resolvers.resolveWorkspaceChild('initiatives', organizationId, workspaceId, initiativeId);
        const before = clone(record);
        if (Object.hasOwn(body.changes, 'description')) record.description = requireText(body.changes.description, { allowEmpty: true, max: 4_000 });
        if (Object.hasOwn(body.changes, 'owner')) record.owner = nullableText(body.changes.owner, { max: 300 });
        record.updatedAt = runtime.timestamp();
        appendEntityAudit(document, runtime, context, 'initiative', record.id, 'initiative-updated', request.actor, record.updatedAt, before, record);
        return { initiative: clone(record) };
      });
    },

    setInitiativeArchived(organizationId, workspaceId, initiativeId, body) {
      const request = baseRequest(body, ['archived'], ['archived']);
      const archived = requireBoolean(body.archived);
      return writeWorkflow(targetDataFile, request.expectedRevision, (document) => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const record = resolvers.resolveWorkspaceChild('initiatives', organizationId, workspaceId, initiativeId);
        const before = clone(record);
        record.archived = archived;
        record.updatedAt = runtime.timestamp();
        appendEntityAudit(document, runtime, context, 'initiative', record.id, archived ? 'initiative-archived' : 'initiative-restored', request.actor, record.updatedAt, before, record);
        return { initiative: clone(record) };
      });
    },

    listInitiativeWorkstreams(organizationId, workspaceId, initiativeId) {
      return readWorkflow(targetDataFile, document => {
        const { resolvers } = contextFor(document, organizationId, workspaceId);
        const initiative = resolvers.resolveWorkspaceChild('initiatives', organizationId, workspaceId, initiativeId);
        return { workstreams: document.workstreams.filter(workstream => workstream.organizationId === organizationId && workstream.workspaceId === workspaceId && workstream.initiativeId === initiative.id).map(clone) };
      });
    },

    getInitiativeWorkstream(organizationId, workspaceId, initiativeId, workstreamId) {
      return readWorkflow(targetDataFile, document => {
        const { resolvers } = contextFor(document, organizationId, workspaceId);
        const initiative = resolvers.resolveWorkspaceChild('initiatives', organizationId, workspaceId, initiativeId);
        const workstream = resolvers.resolveWorkspaceChild('workstreams', organizationId, workspaceId, workstreamId);
        if (workstream.initiativeId !== initiative.id) throw notFound();
        return { workstream: clone(workstream) };
      });
    },

    createWorkstream(organizationId, workspaceId, initiativeId, body) {
      const request = baseRequest(body, ['workstream'], ['workstream']);
      const input = workstreamCreateInput(body.workstream);
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const initiative = resolvers.resolveWorkspaceChild('initiatives', organizationId, workspaceId, initiativeId);
        const record = { id: runtime.id('workstream'), ...context, initiativeId: initiative.id, ...input };
        document.workstreams.push(record);
        const timestamp = runtime.timestamp();
        appendEntityAudit(document, runtime, context, 'workstream', record.id, 'workstream-created', request.actor, timestamp, null, record);
        return { workstream: clone(record) };
      });
    },

    updateWorkstream(organizationId, workspaceId, initiativeId, workstreamId, body) {
      const request = baseRequest(body, ['changes'], ['changes']);
      exactKeys(body.changes, ['description']);
      if (!Object.hasOwn(body.changes, 'description')) throw invalidRequest();
      const description = requireText(body.changes.description, { allowEmpty: true, max: 4_000 });
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const initiative = resolvers.resolveWorkspaceChild('initiatives', organizationId, workspaceId, initiativeId);
        const record = resolvers.resolveWorkspaceChild('workstreams', organizationId, workspaceId, workstreamId);
        if (record.initiativeId !== initiative.id) throw notFound();
        const before = clone(record);
        record.description = description;
        const timestamp = runtime.timestamp();
        appendEntityAudit(document, runtime, context, 'workstream', record.id, 'workstream-updated', request.actor, timestamp, before, record);
        return { workstream: clone(record) };
      });
    },

    previewWorkstreamRename(organizationId, workspaceId, initiativeId, workstreamId, body) {
      return previewRename('workstream', { organizationId, workspaceId, initiativeId, workstreamId }, body);
    },

    applyWorkstreamRename(organizationId, workspaceId, initiativeId, workstreamId, body) {
      return applyRename('workstream', { organizationId, workspaceId, initiativeId, workstreamId }, body);
    },

    listWorkstreamWorkItems(organizationId, workspaceId, initiativeId, workstreamId) {
      return readWorkflow(targetDataFile, document => {
        const { resolvers } = contextFor(document, organizationId, workspaceId);
        const initiative = resolvers.resolveWorkspaceChild('initiatives', organizationId, workspaceId, initiativeId);
        const workstream = resolvers.resolveWorkspaceChild('workstreams', organizationId, workspaceId, workstreamId);
        if (workstream.initiativeId !== initiative.id) throw notFound();
        return {
          workstream: clone(workstream),
          workItems: document.workItems
            .filter(item => item.organizationId === organizationId && item.workspaceId === workspaceId && item.workstreamId === workstream.id)
            .map(item => publicWorkItem(
              item,
              resolvers.indexes.initiatives,
              resolvers.indexes.workstreams,
              resolvers.indexes.jiraEpicMappings
            ))
        };
      });
    },

    listInitiativeMappings(organizationId, workspaceId, initiativeId) {
      return readWorkflow(targetDataFile, document => {
        const { resolvers } = contextFor(document, organizationId, workspaceId);
        const initiative = resolvers.resolveWorkspaceChild('initiatives', organizationId, workspaceId, initiativeId);
        return { jiraEpicMappings: document.jiraEpicMappings.filter(mapping => mapping.organizationId === organizationId && mapping.workspaceId === workspaceId && mapping.initiativeId === initiative.id).map(clone) };
      });
    },

    getInitiativeMapping(organizationId, workspaceId, initiativeId, mappingId) {
      return readWorkflow(targetDataFile, document => {
        const { resolvers } = contextFor(document, organizationId, workspaceId);
        const initiative = resolvers.resolveWorkspaceChild('initiatives', organizationId, workspaceId, initiativeId);
        const mapping = resolvers.resolveWorkspaceChild('jiraEpicMappings', organizationId, workspaceId, mappingId);
        if (mapping.initiativeId !== initiative.id) throw notFound();
        return { jiraEpicMapping: clone(mapping) };
      });
    },

    createJiraMapping(organizationId, workspaceId, initiativeId, body) {
      const request = baseRequest(body, ['mapping'], ['mapping']);
      const input = mappingInput(body.mapping);
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const initiative = resolvers.resolveWorkspaceChild('initiatives', organizationId, workspaceId, initiativeId);
        const record = { id: runtime.id('jiraEpicMapping'), ...context, initiativeId: initiative.id, ...input };
        rejectDuplicateActiveMapping(document, record);
        document.jiraEpicMappings.push(record);
        const timestamp = runtime.timestamp();
        appendEntityAudit(document, runtime, context, 'jiraEpicMapping', record.id, 'jira-epic-mapping-created', request.actor, timestamp, null, record);
        return { jiraEpicMapping: clone(record) };
      });
    },

    updateJiraMapping(organizationId, workspaceId, initiativeId, mappingId, body) {
      const request = baseRequest(body, ['changes'], ['changes']);
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const initiative = resolvers.resolveWorkspaceChild('initiatives', organizationId, workspaceId, initiativeId);
        const record = resolvers.resolveWorkspaceChild('jiraEpicMappings', organizationId, workspaceId, mappingId);
        if (record.initiativeId !== initiative.id) throw notFound();
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
        if (input.initiativeId !== null) resolvers.resolveWorkspaceChild('initiatives', organizationId, workspaceId, input.initiativeId);
        if (input.workstreamId !== null) {
          if (input.initiativeId === null) throw invalidRequest();
          const workstream = resolvers.resolveWorkspaceChild('workstreams', organizationId, workspaceId, input.workstreamId);
          if (workstream.initiativeId !== input.initiativeId) throw notFound();
        }
        if (input.jiraEpicMappingId !== null) {
          if (input.initiativeId === null) throw invalidRequest();
          const mapping = resolvers.resolveWorkspaceChild('jiraEpicMappings', organizationId, workspaceId, input.jiraEpicMappingId);
          if (mapping.initiativeId !== input.initiativeId) throw notFound();
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
        return {
          workItem: publicWorkItem(
            record,
            resolvers.indexes.initiatives,
            resolvers.indexes.workstreams,
            resolvers.indexes.jiraEpicMappings
          )
        };
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
        if (normalized.workstreamChange) item.workstreamId = normalized.workstreamChange.afterWorkstreamId;
        if (normalized.jiraEpicChange) item.jiraEpicMappingId = normalized.jiraEpicChange.afterJiraEpicMappingId;
        item.updatedAt = runtime.timestamp();
        const hasRelationshipChanges = normalized.workstreamChange || normalized.jiraEpicChange;
        const auditBefore = hasRelationshipChanges
          ? {
              [normalized.field]: normalized.before,
              workstreamId: normalized.workstreamChange?.beforeWorkstreamId,
              jiraEpicMappingId: normalized.jiraEpicChange?.beforeJiraEpicMappingId
            }
          : normalized.before;
        const auditAfter = hasRelationshipChanges
          ? {
              [normalized.field]: normalized.after,
              workstreamId: normalized.workstreamChange?.afterWorkstreamId,
              jiraEpicMappingId: normalized.jiraEpicChange?.afterJiraEpicMappingId
            }
          : normalized.after;
        appendEntityAudit(document, runtime, context, 'workItem', item.id, `work-item-${normalized.type}-applied`, request.actor, item.updatedAt, auditBefore, auditAfter);
        (normalized.evidenceChanges || []).forEach(change => {
          const evidence = resolvers.resolveWorkspaceChild('evidence', organizationId, workspaceId, change.evidenceId);
          evidence.initiativeId = normalized.after;
          appendEntityAudit(document, runtime, context, 'evidence', evidence.id, 'evidence-initiative-reassociated', request.actor, item.updatedAt, change.beforeInitiativeId, normalized.after);
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
          if (stateHash({
            value: row.before,
            workstreamId: row.workstreamChange?.beforeWorkstreamId,
            jiraEpicMappingId: row.jiraEpicChange?.beforeJiraEpicMappingId
          }) === stateHash({
            value: row.after,
            workstreamId: row.workstreamChange?.afterWorkstreamId,
            jiraEpicMappingId: row.jiraEpicChange?.afterJiraEpicMappingId
          })) return;
          item[preview.field] = clone(row.after);
          if (row.workstreamChange) item.workstreamId = row.workstreamChange.afterWorkstreamId;
          if (row.jiraEpicChange) item.jiraEpicMappingId = row.jiraEpicChange.afterJiraEpicMappingId;
          item.updatedAt = timestamp;
          const hasRelationshipChanges = row.workstreamChange || row.jiraEpicChange;
          const auditBefore = hasRelationshipChanges
            ? {
                [preview.field]: row.before,
                workstreamId: row.workstreamChange?.beforeWorkstreamId,
                jiraEpicMappingId: row.jiraEpicChange?.beforeJiraEpicMappingId
              }
            : row.before;
          const auditAfter = hasRelationshipChanges
            ? {
                [preview.field]: row.after,
                workstreamId: row.workstreamChange?.afterWorkstreamId,
                jiraEpicMappingId: row.jiraEpicChange?.afterJiraEpicMappingId
              }
            : row.after;
          appendEntityAudit(document, runtime, context, 'workItem', item.id, `bulk-${preview.action}-applied`, request.actor, timestamp, auditBefore, auditAfter);
          (row.evidenceChanges || []).forEach(change => {
            const evidence = resolvers.resolveWorkspaceChild('evidence', organizationId, workspaceId, change.evidenceId);
            evidence.initiativeId = row.after;
            appendEntityAudit(document, runtime, context, 'evidence', evidence.id, 'evidence-initiative-reassociated', request.actor, timestamp, change.beforeInitiativeId, row.after);
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
        const { allowCrossInitiativeLinks, ...fields } = input;
        const record = { id: runtime.id('milestone'), ...context, ...fields, createdAt: timestamp, updatedAt: timestamp };
        document.milestones.push(record);
        appendEntityAudit(document, runtime, context, 'milestone', record.id, 'milestone-created', request.actor, timestamp, null, record);
        return { milestone: clone(record), crossInitiativeLinksExplicitlyApproved: allowCrossInitiativeLinks };
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
        const { allowCrossInitiativeLinks, ...fields } = input;
        Object.assign(record, fields);
        record.updatedAt = runtime.timestamp();
        appendEntityAudit(document, runtime, context, 'milestone', record.id, 'milestone-updated', request.actor, record.updatedAt, before, record);
        return { milestone: clone(record), crossInitiativeLinksExplicitlyApproved: allowCrossInitiativeLinks };
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
