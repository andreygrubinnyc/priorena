'use strict';

const path = require('node:path');

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
  requireDate,
  requireEnum,
  requireStableId,
  requireText,
  stateHash,
  writeWorkflow
} = require('./workflow-utils');

const MAX_MANAGEMENT_PAGE_SIZE = 100;
const MAX_EVIDENCE_SELECTION = 100;
const DECISION_STATUSES = Object.freeze(['draft', 'decided']);
const RISK_STATUSES = Object.freeze(['open', 'closed']);
const DECISION_FIELDS = Object.freeze([
  'title', 'initiativeId', 'workItemId', 'evidenceIds', 'supersedesDecisionId'
]);
const RISK_FIELDS = Object.freeze([
  'title', 'description', 'responsePlan', 'owner', 'reviewOn',
  'initiativeId', 'workItemId', 'evidenceIds'
]);

function requireExplicitTargetDataFile(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new TypeError('Target Decision and Risk services require an explicit schema-v6 data-file path');
  }
  return path.resolve(filePath);
}

function requestBase(body, keys, required) {
  exactKeys(body, ['expectedRevision', 'actor', ...keys], ['expectedRevision', 'actor', ...required]);
  return {
    expectedRevision: body.expectedRevision,
    actor: requireActor(body.actor)
  };
}

function uniqueStableIds(value) {
  const ids = requireArray(value, { max: MAX_EVIDENCE_SELECTION }).map(requireStableId);
  if (new Set(ids).size !== ids.length) throw invalidRequest();
  return ids;
}

function optionalNullableId(value, key, fallback) {
  return Object.hasOwn(value, key) ? nullableStableId(value[key]) : fallback;
}

function optionalNullableText(value, key, fallback, options) {
  return Object.hasOwn(value, key) ? nullableText(value[key], options) : fallback;
}

function contextFor(document, organizationId, workspaceId) {
  const resolvers = createTargetResolvers(document);
  const workspace = resolvers.resolveWorkspace(organizationId, workspaceId);
  return {
    resolvers,
    context: { organizationId: workspace.organizationId, workspaceId: workspace.id }
  };
}

function audit(document, runtime, context, entityType, entityId, action, actor, timestamp, before, after) {
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

function pagination(query = {}, acceptedStatuses) {
  exactKeys(query, ['page', 'pageSize', 'status']);
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 50 : Number(query.pageSize);
  const status = query.status === undefined ? null : requireEnum(query.status, acceptedStatuses);
  if (!Number.isInteger(page) || page < 1 ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_MANAGEMENT_PAGE_SIZE) {
    throw invalidRequest();
  }
  return { page, pageSize, status };
}

function sortManagedRecords(records) {
  return records.slice().sort((left, right) => {
    const timeOrder = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    return timeOrder || left.id.localeCompare(right.id, 'en-US');
  });
}

function validateScopedReferences(resolvers, context, record) {
  const initiative = record.initiativeId === null
    ? null
    : resolvers.resolveWorkspaceChild('initiatives', context.organizationId, context.workspaceId, record.initiativeId);
  const workItem = record.workItemId === null
    ? null
    : resolvers.resolveWorkspaceChild('workItems', context.organizationId, context.workspaceId, record.workItemId);
  if (initiative && workItem && workItem.initiativeId !== initiative.id) throw notFound();

  const effectiveInitiativeId = initiative?.id ?? workItem?.initiativeId ?? null;
  const initiativeIsConstrained = initiative !== null || workItem !== null;
  record.evidenceIds.forEach(evidenceId => {
    const evidence = resolvers.resolveWorkspaceChild(
      'evidence',
      context.organizationId,
      context.workspaceId,
      evidenceId
    );
    if (workItem && evidence.workItemId !== null && evidence.workItemId !== workItem.id) throw notFound();
    if (initiativeIsConstrained && evidence.initiativeId !== null && evidence.initiativeId !== effectiveInitiativeId) {
      throw notFound();
    }
    if (initiativeIsConstrained && evidence.workItemId !== null) {
      const evidenceWorkItem = resolvers.resolveWorkspaceChild(
        'workItems',
        context.organizationId,
        context.workspaceId,
        evidence.workItemId
      );
      if (evidenceWorkItem.initiativeId !== effectiveInitiativeId) throw notFound();
    }
  });
}

function validateSupersession(document, resolvers, context, decision) {
  if (decision.supersedesDecisionId === null) return;
  if (decision.supersedesDecisionId === decision.id) throw invalidRequest();
  const superseded = resolvers.resolveWorkspaceChild(
    'decisions',
    context.organizationId,
    context.workspaceId,
    decision.supersedesDecisionId
  );
  if (superseded.status !== 'decided') throw invalidRequest();
  if (Date.parse(superseded.decidedAt) >= Date.parse(decision.createdAt)) throw invalidRequest();
  if (document.decisions.some(candidate => (
    candidate.id !== decision.id && candidate.supersedesDecisionId === superseded.id
  ))) throw invalidRequest();
}

function decisionInput(value, existing = null) {
  exactKeys(value, DECISION_FIELDS, existing ? [] : ['title']);
  if (existing && Object.keys(value).length === 0) throw invalidRequest();
  const next = existing ? clone(existing) : {
    initiativeId: null,
    workItemId: null,
    title: '',
    outcome: null,
    rationale: null,
    evidenceIds: [],
    status: 'draft',
    supersedesDecisionId: null,
    decidedAt: null,
    decidedBy: null
  };
  if (Object.hasOwn(value, 'title')) next.title = requireText(value.title, { max: 500 });
  next.initiativeId = optionalNullableId(value, 'initiativeId', next.initiativeId);
  next.workItemId = optionalNullableId(value, 'workItemId', next.workItemId);
  if (Object.hasOwn(value, 'evidenceIds')) next.evidenceIds = uniqueStableIds(value.evidenceIds);
  next.supersedesDecisionId = optionalNullableId(value, 'supersedesDecisionId', next.supersedesDecisionId);
  return next;
}

function riskInput(value, existing = null) {
  exactKeys(value, RISK_FIELDS, existing ? [] : ['title', 'description']);
  if (existing && Object.keys(value).length === 0) throw invalidRequest();
  const next = existing ? clone(existing) : {
    title: '',
    description: '',
    responsePlan: null,
    owner: null,
    reviewOn: null,
    initiativeId: null,
    workItemId: null,
    evidenceIds: [],
    status: 'open',
    closedAt: null,
    closedBy: null,
    closureNote: null
  };
  if (Object.hasOwn(value, 'title')) next.title = requireText(value.title, { max: 500 });
  if (Object.hasOwn(value, 'description')) next.description = requireText(value.description, { max: 10_000 });
  next.responsePlan = optionalNullableText(value, 'responsePlan', next.responsePlan, { max: 10_000 });
  next.owner = optionalNullableText(value, 'owner', next.owner, { max: 300 });
  if (Object.hasOwn(value, 'reviewOn')) next.reviewOn = requireDate(value.reviewOn, true);
  next.initiativeId = optionalNullableId(value, 'initiativeId', next.initiativeId);
  next.workItemId = optionalNullableId(value, 'workItemId', next.workItemId);
  if (Object.hasOwn(value, 'evidenceIds')) next.evidenceIds = uniqueStableIds(value.evidenceIds);
  return next;
}

function decisionFinalization(value) {
  exactKeys(value, ['outcome', 'rationale', 'decidedBy'], ['outcome', 'rationale', 'decidedBy']);
  return {
    outcome: requireText(value.outcome, { max: 10_000 }),
    rationale: requireText(value.rationale, { max: 10_000 }),
    decidedBy: requireActor(value.decidedBy)
  };
}

function riskClosure(value) {
  exactKeys(value, ['closureNote', 'closedBy'], ['closureNote', 'closedBy']);
  return {
    closureNote: requireText(value.closureNote, { max: 4_000 }),
    closedBy: requireActor(value.closedBy)
  };
}

function transitionPreview(context, record, action, values, revision) {
  const core = {
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    entityType: action === 'decide' ? 'decision' : 'risk',
    entityId: record.id,
    action,
    currentRecordHash: stateHash(record),
    ...values,
    expectedRevision: revision
  };
  return { ...core, previewHash: stateHash(core) };
}

function createDecisionRiskServices(options = {}) {
  const targetDataFile = requireExplicitTargetDataFile(options.targetDataFile);
  const runtime = createWorkflowRuntime(options);

  return Object.freeze({
    listDecisions(organizationId, workspaceId, query) {
      const requested = pagination(query, DECISION_STATUSES);
      return readWorkflow(targetDataFile, document => {
        contextFor(document, organizationId, workspaceId);
        const matches = sortManagedRecords(document.decisions.filter(decision => (
          decision.organizationId === organizationId && decision.workspaceId === workspaceId &&
          (requested.status === null || decision.status === requested.status)
        )));
        const start = (requested.page - 1) * requested.pageSize;
        return {
          organizationId,
          workspaceId,
          page: requested.page,
          pageSize: requested.pageSize,
          total: matches.length,
          decisions: matches.slice(start, start + requested.pageSize).map(clone)
        };
      });
    },

    getDecision(organizationId, workspaceId, decisionId) {
      return readWorkflow(targetDataFile, document => {
        const { resolvers } = contextFor(document, organizationId, workspaceId);
        return { decision: clone(resolvers.resolveWorkspaceChild('decisions', organizationId, workspaceId, decisionId)) };
      });
    },

    createDecision(organizationId, workspaceId, body) {
      const request = requestBase(body, ['decision'], ['decision']);
      const input = decisionInput(body.decision);
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const timestamp = runtime.timestamp();
        const record = {
          id: runtime.id('decision'),
          ...context,
          ...input,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        validateScopedReferences(resolvers, context, record);
        validateSupersession(document, resolvers, context, record);
        document.decisions.push(record);
        audit(document, runtime, context, 'decision', record.id, 'decision-created', request.actor, timestamp, null, record);
        return { decision: clone(record) };
      });
    },

    updateDecision(organizationId, workspaceId, decisionId, body) {
      const request = requestBase(body, ['changes'], ['changes']);
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const record = resolvers.resolveWorkspaceChild('decisions', organizationId, workspaceId, decisionId);
        if (record.status !== 'draft') throw previewConflict();
        const before = clone(record);
        const next = decisionInput(body.changes, record);
        validateScopedReferences(resolvers, context, next);
        validateSupersession(document, resolvers, context, next);
        if (stateHash(next) === stateHash(record)) throw invalidRequest();
        DECISION_FIELDS.forEach(field => { record[field] = clone(next[field]); });
        record.updatedAt = runtime.timestamp();
        audit(document, runtime, context, 'decision', record.id, 'decision-updated', request.actor, record.updatedAt, before, record);
        return { decision: clone(record) };
      });
    },

    previewDecision(organizationId, workspaceId, decisionId, body) {
      const values = decisionFinalization(body);
      return readWorkflow(targetDataFile, (document, revision) => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const record = resolvers.resolveWorkspaceChild('decisions', organizationId, workspaceId, decisionId);
        if (record.status !== 'draft') throw previewConflict();
        validateScopedReferences(resolvers, context, record);
        validateSupersession(document, resolvers, context, record);
        return { preview: transitionPreview(context, record, 'decide', values, revision) };
      });
    },

    decide(organizationId, workspaceId, decisionId, body) {
      const request = requestBase(body, ['decision', 'previewHash'], ['decision', 'previewHash']);
      const values = decisionFinalization(body.decision);
      const approvedHash = requireText(body.previewHash, { max: 64 });
      return writeWorkflow(targetDataFile, request.expectedRevision, (document, revision) => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const record = resolvers.resolveWorkspaceChild('decisions', organizationId, workspaceId, decisionId);
        if (record.status !== 'draft') throw previewConflict();
        validateScopedReferences(resolvers, context, record);
        validateSupersession(document, resolvers, context, record);
        const preview = transitionPreview(context, record, 'decide', values, revision);
        if (preview.previewHash !== approvedHash) throw previewConflict();
        const before = clone(record);
        const timestamp = runtime.timestamp();
        Object.assign(record, values, { status: 'decided', decidedAt: timestamp, updatedAt: timestamp });
        audit(document, runtime, context, 'decision', record.id, 'decision-decided', request.actor, timestamp, before, record);
        return { decision: clone(record), appliedPreviewHash: approvedHash };
      });
    },

    listRisks(organizationId, workspaceId, query) {
      const requested = pagination(query, RISK_STATUSES);
      return readWorkflow(targetDataFile, document => {
        contextFor(document, organizationId, workspaceId);
        const matches = sortManagedRecords(document.risks.filter(risk => (
          risk.organizationId === organizationId && risk.workspaceId === workspaceId &&
          (requested.status === null || risk.status === requested.status)
        )));
        const start = (requested.page - 1) * requested.pageSize;
        return {
          organizationId,
          workspaceId,
          page: requested.page,
          pageSize: requested.pageSize,
          total: matches.length,
          risks: matches.slice(start, start + requested.pageSize).map(clone)
        };
      });
    },

    getRisk(organizationId, workspaceId, riskId) {
      return readWorkflow(targetDataFile, document => {
        const { resolvers } = contextFor(document, organizationId, workspaceId);
        return { risk: clone(resolvers.resolveWorkspaceChild('risks', organizationId, workspaceId, riskId)) };
      });
    },

    createRisk(organizationId, workspaceId, body) {
      const request = requestBase(body, ['risk'], ['risk']);
      const input = riskInput(body.risk);
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const timestamp = runtime.timestamp();
        const record = {
          id: runtime.id('risk'),
          ...context,
          ...input,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        validateScopedReferences(resolvers, context, record);
        document.risks.push(record);
        audit(document, runtime, context, 'risk', record.id, 'risk-created', request.actor, timestamp, null, record);
        return { risk: clone(record) };
      });
    },

    updateRisk(organizationId, workspaceId, riskId, body) {
      const request = requestBase(body, ['changes'], ['changes']);
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const record = resolvers.resolveWorkspaceChild('risks', organizationId, workspaceId, riskId);
        if (record.status !== 'open') throw previewConflict();
        const before = clone(record);
        const next = riskInput(body.changes, record);
        validateScopedReferences(resolvers, context, next);
        if (stateHash(next) === stateHash(record)) throw invalidRequest();
        RISK_FIELDS.forEach(field => { record[field] = clone(next[field]); });
        record.updatedAt = runtime.timestamp();
        audit(document, runtime, context, 'risk', record.id, 'risk-updated', request.actor, record.updatedAt, before, record);
        return { risk: clone(record) };
      });
    },

    previewRiskClosure(organizationId, workspaceId, riskId, body) {
      const values = riskClosure(body);
      return readWorkflow(targetDataFile, (document, revision) => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const record = resolvers.resolveWorkspaceChild('risks', organizationId, workspaceId, riskId);
        if (record.status !== 'open') throw previewConflict();
        validateScopedReferences(resolvers, context, record);
        return { preview: transitionPreview(context, record, 'close', values, revision) };
      });
    },

    closeRisk(organizationId, workspaceId, riskId, body) {
      const request = requestBase(body, ['closure', 'previewHash'], ['closure', 'previewHash']);
      const values = riskClosure(body.closure);
      const approvedHash = requireText(body.previewHash, { max: 64 });
      return writeWorkflow(targetDataFile, request.expectedRevision, (document, revision) => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const record = resolvers.resolveWorkspaceChild('risks', organizationId, workspaceId, riskId);
        if (record.status !== 'open') throw previewConflict();
        validateScopedReferences(resolvers, context, record);
        const preview = transitionPreview(context, record, 'close', values, revision);
        if (preview.previewHash !== approvedHash) throw previewConflict();
        const before = clone(record);
        const timestamp = runtime.timestamp();
        Object.assign(record, values, { status: 'closed', closedAt: timestamp, updatedAt: timestamp });
        audit(document, runtime, context, 'risk', record.id, 'risk-closed', request.actor, timestamp, before, record);
        return { risk: clone(record), appliedPreviewHash: approvedHash };
      });
    }
  });
}

module.exports = {
  DECISION_FIELDS,
  MAX_EVIDENCE_SELECTION,
  MAX_MANAGEMENT_PAGE_SIZE,
  RISK_FIELDS,
  createDecisionRiskServices
};
