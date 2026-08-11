'use strict';

const path = require('node:path');

const { buildImportPreview, MAX_IMPORT_BYTES, normalizeImportInput } = require('./import-parser');
const { invalidRequest, previewConflict } = require('./errors');
const { createTargetResolvers } = require('./resolvers');
const { createNoneFollowUp } = require('./work-services');
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
  requireIsoTimestamp,
  requireObject,
  requireStableId,
  requireText,
  stateHash,
  writeWorkflow
} = require('./workflow-utils');

const MAX_FINDING_PAGE_SIZE = 100;
const MAX_FINDING_REVIEW_SELECTION = 100;
const SOURCE_TYPES = Object.freeze([
  'meeting-note',
  'sprint-planning',
  'backlog-refinement',
  'dsu',
  'generic',
  'normalized-json',
  'normalized-csv',
  'external-evidence-feed'
]);
const SOURCE_KINDS = Object.freeze(['structured-note', 'normalized-feed', 'external-evidence-metadata']);
const PROPOSED_CHANGE_FIELDS = Object.freeze([
  'canonicalStatus',
  'sourceStatus',
  'assignee',
  'sprint',
  'currentStateConfidence',
  'currentStateProvenance',
  'lastCapturedCommentAt'
]);

function requireExplicitTargetDataFile(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new TypeError('Target capture services require an explicit version-2 data-file path');
  return path.resolve(filePath);
}

function uniqueStableIds(value, options = {}) {
  const ids = requireArray(value, options).map(requireStableId);
  if (new Set(ids).size !== ids.length) throw invalidRequest();
  return ids;
}

function requestBase(body, keys, required) {
  exactKeys(body, ['expectedRevision', 'actor', ...keys], ['expectedRevision', 'actor', ...required]);
  return { expectedRevision: body.expectedRevision, actor: requireActor(body.actor) };
}

function contextFor(document, organizationId, workspaceId) {
  const resolvers = createTargetResolvers(document);
  const workspace = resolvers.resolveWorkspace(organizationId, workspaceId);
  return { resolvers, context: { organizationId: workspace.organizationId, workspaceId: workspace.id } };
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

function sourceInput(value) {
  exactKeys(value, ['title', 'type', 'sourceKind', 'date', 'provenance', 'content'], ['title', 'type', 'sourceKind', 'date', 'provenance', 'content']);
  const content = requireText(value.content, { allowEmpty: true, max: MAX_IMPORT_BYTES });
  if (Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) throw invalidRequest();
  return {
    title: requireText(value.title, { max: 500 }),
    type: requireEnum(value.type, SOURCE_TYPES),
    sourceKind: requireEnum(value.sourceKind, SOURCE_KINDS),
    date: requireDate(value.date),
    provenance: requireText(value.provenance, { max: 4_000 }),
    content
  };
}

function findingInput(value, content, resolvers, context) {
  exactKeys(value, [
    'exactExcerpt', 'extractionMethod', 'extractionVersion', 'category', 'proposedWorkItemId',
    'proposedScopeId', 'currentness'
  ], ['exactExcerpt', 'category']);
  const exactExcerpt = requireText(value.exactExcerpt, { max: 50_000 });
  if (!content.includes(exactExcerpt)) throw invalidRequest();
  const proposedWorkItemId = value.proposedWorkItemId === undefined ? null : nullableStableId(value.proposedWorkItemId);
  const proposedScopeId = value.proposedScopeId === undefined ? null : nullableStableId(value.proposedScopeId);
  let workItem = null;
  if (proposedWorkItemId !== null) workItem = resolvers.resolveWorkspaceChild('workItems', context.organizationId, context.workspaceId, proposedWorkItemId);
  if (proposedScopeId !== null) resolvers.resolveWorkspaceChild('scopes', context.organizationId, context.workspaceId, proposedScopeId);
  if (workItem && proposedScopeId !== null && workItem.scopeId !== proposedScopeId) throw invalidRequest();
  return {
    exactExcerpt,
    extractionMethod: value.extractionMethod === undefined ? 'deterministic-local-capture' : requireText(value.extractionMethod, { max: 200 }),
    extractionVersion: value.extractionVersion === undefined ? 'phase-3-v1' : requireText(value.extractionVersion, { max: 200 }),
    category: requireText(value.category, { max: 100 }),
    proposedWorkItemId,
    proposedScopeId,
    currentness: value.currentness === undefined ? 'unknown' : requireEnum(value.currentness, ['current', 'historical', 'superseded', 'contradicted', 'unknown']),
    supersededBy: null
  };
}

function evidenceAssociations(document, workItemId, nextScopeId) {
  return document.evidence
    .filter(item => item.workItemId === workItemId && item.scopeId !== nextScopeId)
    .map(item => ({ evidenceId: item.id, beforeScopeId: item.scopeId, afterScopeId: nextScopeId }));
}

function reassignWorkItemAndEvidence(document, runtime, resolvers, context, workItem, scopeId, actor, timestamp, action) {
  if (scopeId !== null) resolvers.resolveWorkspaceChild('scopes', context.organizationId, context.workspaceId, scopeId);
  const before = workItem.scopeId;
  workItem.scopeId = scopeId;
  workItem.updatedAt = timestamp;
  audit(document, runtime, context, 'workItem', workItem.id, action, actor, timestamp, before, scopeId);
  const evidenceChanges = evidenceAssociations(document, workItem.id, scopeId);
  evidenceChanges.forEach(change => {
    const evidence = resolvers.resolveWorkspaceChild('evidence', context.organizationId, context.workspaceId, change.evidenceId);
    evidence.scopeId = scopeId;
    audit(document, runtime, context, 'evidence', evidence.id, 'evidence-scope-reassociated', actor, timestamp, change.beforeScopeId, scopeId);
  });
  return evidenceChanges;
}

function exactMappingExists(document, context, candidate, ownId = null) {
  return document.jiraEpicMappings.some(mapping => mapping.id !== ownId && mapping.organizationId === context.organizationId &&
    mapping.workspaceId === context.workspaceId && mapping.mappingStatus !== 'inactive' &&
    mapping.jiraProjectKey.toUpperCase() === candidate.jiraProjectKey.toUpperCase() &&
    mapping.jiraEpicKey.toUpperCase() === candidate.jiraEpicKey.toUpperCase());
}

function applyImportProposals(document, runtime, context, resolvers, inputValue, preview, approvedIds, actor) {
  const input = normalizeImportInput(inputValue);
  const byId = new Map(preview.proposals.map(proposal => [proposal.id, proposal]));
  approvedIds.forEach(id => {
    const proposal = byId.get(id);
    if (!proposal || proposal.dependencies.some(dependency => !approvedIds.includes(dependency))) throw invalidRequest();
  });
  const approved = preview.proposals.filter(proposal => approvedIds.includes(proposal.id));
  const timestamp = runtime.timestamp();
  const created = { sources: [], scopes: [], jiraEpicMappings: [], workItems: [], findings: [], assignments: [], deferredCurrentStateChanges: [] };
  const createdIdsByProposal = new Map();

  approved.filter(proposal => proposal.type === 'source-create').forEach(proposal => {
    const record = {
      id: runtime.id('source'),
      ...context,
      ...input.source,
      content: input.content,
      metadata: { capture: { format: input.format, contentHash: proposal.payload.contentHash } },
      processingState: 'processed',
      createdAt: timestamp
    };
    document.sources.push(record);
    createdIdsByProposal.set(proposal.id, record.id);
    created.sources.push(clone(record));
    audit(document, runtime, context, 'source', record.id, 'source-imported', actor, timestamp, null, record);
  });

  approved.filter(proposal => proposal.type === 'scope-create').forEach(proposal => {
    const name = requireText(proposal.payload.name, { max: 200 });
    if (['unassigned', 'miscellaneous / no epic', 'miscellaneous/no epic', 'no epic'].includes(name.trim().toLowerCase())) throw invalidRequest();
    const record = {
      id: runtime.id('scope'), ...context, name, description: '', owner: null, archived: false,
      primaryMilestoneId: null, createdAt: timestamp, updatedAt: timestamp
    };
    document.scopes.push(record);
    createdIdsByProposal.set(proposal.id, record.id);
    created.scopes.push(clone(record));
    audit(document, runtime, context, 'scope', record.id, 'scope-created-from-approved-import-proposal', actor, timestamp, null, record);
  });

  approved.filter(proposal => proposal.type === 'jira-mapping-create').forEach(proposal => {
    const scopeId = proposal.payload.scopeId || createdIdsByProposal.get(proposal.payload.scopeProposalId);
    if (!scopeId) throw invalidRequest();
    resolvers.indexes.scopes.set(scopeId, document.scopes.find(scope => scope.id === scopeId) || resolvers.indexes.scopes.get(scopeId));
    const scope = resolvers.resolveWorkspaceChild('scopes', context.organizationId, context.workspaceId, scopeId);
    const record = {
      id: runtime.id('jiraEpicMapping'), ...context, scopeId: scope.id,
      jiraProjectKey: proposal.payload.jiraProjectKey,
      jiraEpicKey: proposal.payload.jiraEpicKey,
      jiraEpicName: proposal.payload.jiraEpicName,
      mappingStatus: 'pending',
      provenance: 'Explicitly approved target import proposal.',
      verifiedAt: null
    };
    if (exactMappingExists(document, context, record)) throw invalidRequest();
    document.jiraEpicMappings.push(record);
    created.jiraEpicMappings.push(clone(record));
    audit(document, runtime, context, 'jiraEpicMapping', record.id, 'jira-epic-mapping-created-from-approved-import-proposal', actor, timestamp, null, record);
  });

  approved.filter(proposal => proposal.type === 'work-item-create').forEach(proposal => {
    const payload = proposal.payload;
    const record = {
      id: runtime.id('workItem'), ...context, scopeId: null, jiraId: null, jiraKey: payload.jiraKey,
      itemType: payload.itemType, summary: payload.summary, description: payload.description,
      canonicalStatus: payload.canonicalStatus, currentStateProvenance: 'approved-target-import-proposal',
      currentStateConfidence: 'confirmed', lastCapturedCommentAt: null, sourceStatus: null, assignee: null,
      sprint: null, labels: [], dependencies: [], notes: '', archived: false, followUp: createNoneFollowUp(),
      createdAt: timestamp, updatedAt: timestamp
    };
    document.workItems.push(record);
    resolvers.indexes.workItems.set(record.id, record);
    createdIdsByProposal.set(proposal.id, record.id);
    created.workItems.push(clone(record));
    audit(document, runtime, context, 'workItem', record.id, 'work-item-created-from-approved-import-proposal', actor, timestamp, null, record);
  });

  approved.filter(proposal => proposal.type === 'work-item-assign').forEach(proposal => {
    const workItemId = proposal.payload.workItemId || createdIdsByProposal.get(proposal.payload.workItemProposalId);
    if (!workItemId) throw invalidRequest();
    const item = resolvers.resolveWorkspaceChild('workItems', context.organizationId, context.workspaceId, workItemId);
    const evidenceChanges = reassignWorkItemAndEvidence(
      document, runtime, resolvers, context, item, proposal.payload.scopeId, actor, timestamp,
      'work-item-scope-assigned-from-approved-import-proposal'
    );
    created.assignments.push({ workItemId: item.id, scopeId: item.scopeId, evidenceChanges });
  });

  approved.filter(proposal => proposal.type === 'finding-create').forEach(proposal => {
    const sourceId = createdIdsByProposal.get(proposal.payload.sourceProposalId);
    if (!sourceId) throw invalidRequest();
    const proposedWorkItemId = proposal.payload.proposedWorkItemId || createdIdsByProposal.get(proposal.payload.proposedWorkItemProposalId) || null;
    const record = {
      id: runtime.id('finding'), ...context, sourceId,
      exactExcerpt: proposal.payload.exactExcerpt,
      extractionMethod: 'deterministic-target-import', extractionVersion: 'phase-3-v1',
      category: proposal.payload.category, reviewStatus: 'pending',
      proposedWorkItemId, proposedScopeId: proposal.payload.proposedScopeId,
      currentness: 'unknown', supersededBy: null
    };
    document.findings.push(record);
    createdIdsByProposal.set(proposal.id, record.id);
    created.findings.push(clone(record));
    audit(document, runtime, context, 'finding', record.id, 'finding-created-from-approved-import-proposal', actor, timestamp, null, record);
  });

  approved.filter(proposal => proposal.type === 'proposed-current-state-change').forEach(proposal => {
    created.deferredCurrentStateChanges.push({
      ...clone(proposal.payload),
      findingId: createdIdsByProposal.get(proposal.payload.findingProposalId) || null,
      outcome: 'requires-accepted-evidence-and-separate-proposed-change-review'
    });
  });
  return created;
}

function pagination(query = {}) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 50 : Number(query.pageSize);
  const status = query.status === undefined ? null : requireEnum(query.status, ['pending', 'accepted', 'rejected']);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_FINDING_PAGE_SIZE) throw invalidRequest();
  return { page, pageSize, status };
}

function reviewFinding(document, runtime, resolvers, context, selection, actor, timestamp) {
  exactKeys(selection, ['findingId', 'decision', 'scopeId', 'workItemId'], ['findingId', 'decision']);
  const finding = resolvers.resolveWorkspaceChild('findings', context.organizationId, context.workspaceId, selection.findingId);
  if (finding.reviewStatus !== 'pending') throw previewConflict();
  const decision = requireEnum(selection.decision, ['accept', 'reject']);
  const before = clone(finding);
  if (decision === 'reject') {
    finding.reviewStatus = 'rejected';
    audit(document, runtime, context, 'finding', finding.id, 'finding-rejected', actor, timestamp, before, finding);
    return { finding: clone(finding), evidence: null };
  }

  const workItemId = selection.workItemId === undefined ? finding.proposedWorkItemId : nullableStableId(selection.workItemId);
  const scopeId = selection.scopeId === undefined ? finding.proposedScopeId : nullableStableId(selection.scopeId);
  let workItem = null;
  if (workItemId !== null) workItem = resolvers.resolveWorkspaceChild('workItems', context.organizationId, context.workspaceId, workItemId);
  if (scopeId !== null) resolvers.resolveWorkspaceChild('scopes', context.organizationId, context.workspaceId, scopeId);
  if (workItem && scopeId !== null && workItem.scopeId !== scopeId) throw invalidRequest();
  if (workItem && workItem.scopeId === null && scopeId !== null) throw invalidRequest();
  if (document.evidence.some(item => item.findingId === finding.id && item.currentness !== 'superseded')) throw previewConflict();
  const source = resolvers.resolveWorkspaceChild('sources', context.organizationId, context.workspaceId, finding.sourceId);
  finding.reviewStatus = 'accepted';
  const evidence = {
    id: runtime.id('evidence'), ...context, sourceId: source.id, findingId: finding.id, scopeId, workItemId,
    exactExcerpt: finding.exactExcerpt, sourceDate: source.date, acceptedAt: timestamp, acceptedBy: actor,
    currentness: finding.currentness, supersededBy: null
  };
  document.evidence.push(evidence);
  resolvers.indexes.evidence.set(evidence.id, evidence);
  audit(document, runtime, context, 'finding', finding.id, 'finding-accepted', actor, timestamp, before, finding);
  audit(document, runtime, context, 'evidence', evidence.id, 'evidence-created-from-accepted-finding', actor, timestamp, null, evidence);
  return { finding: clone(finding), evidence: clone(evidence) };
}

function proposedValue(field, value) {
  if (['canonicalStatus', 'currentStateProvenance'].includes(field)) return requireText(value, { max: field === 'canonicalStatus' ? 200 : 500 });
  if (field === 'currentStateConfidence') return requireEnum(value, ['confirmed', 'inferred', 'unknown']);
  if (field === 'lastCapturedCommentAt') return requireIsoTimestamp(value, true);
  return nullableText(value, { max: field === 'assignee' || field === 'sprint' ? 300 : 200 });
}

function buildProposedChangePreview(document, organizationId, workspaceId, value, revision) {
  exactKeys(value, ['findingId', 'evidenceIds', 'workItemId', 'field', 'proposedValue'], ['findingId', 'evidenceIds', 'workItemId', 'field', 'proposedValue']);
  const { resolvers, context } = contextFor(document, organizationId, workspaceId);
  const finding = resolvers.resolveWorkspaceChild('findings', organizationId, workspaceId, value.findingId);
  if (finding.reviewStatus !== 'accepted') throw invalidRequest();
  const workItem = resolvers.resolveWorkspaceChild('workItems', organizationId, workspaceId, value.workItemId);
  const evidenceIds = uniqueStableIds(value.evidenceIds, { min: 1, max: 100 });
  let supportsFinding = false;
  evidenceIds.forEach(evidenceId => {
    const evidence = resolvers.resolveWorkspaceChild('evidence', organizationId, workspaceId, evidenceId);
    if (evidence.findingId === finding.id) supportsFinding = true;
    if (evidence.workItemId !== null && evidence.workItemId !== workItem.id) throw invalidRequest();
    if (evidence.scopeId !== null && evidence.scopeId !== workItem.scopeId) throw invalidRequest();
  });
  if (!supportsFinding) throw invalidRequest();
  const field = requireEnum(value.field, PROPOSED_CHANGE_FIELDS);
  const nextValue = proposedValue(field, value.proposedValue);
  if (stateHash(workItem[field]) === stateHash(nextValue)) throw invalidRequest();
  const core = {
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    findingId: finding.id,
    evidenceIds,
    workItemId: workItem.id,
    field,
    beforeValue: clone(workItem[field]),
    proposedValue: clone(nextValue)
  };
  const revisionBoundPreview = { ...core, expectedRevision: revision };
  return { ...revisionBoundPreview, previewHash: stateHash(revisionBoundPreview) };
}

function createCaptureServices(options = {}) {
  const targetDataFile = requireExplicitTargetDataFile(options.targetDataFile);
  const runtime = createWorkflowRuntime(options);

  return Object.freeze({
    captureSource(organizationId, workspaceId, body) {
      const request = requestBase(body, ['source', 'findings'], ['source']);
      const input = sourceInput(body.source);
      const findings = body.findings === undefined ? [] : requireArray(body.findings, { max: 100 });
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const normalizedFindings = findings.map(value => findingInput(value, input.content, resolvers, context));
        const timestamp = runtime.timestamp();
        const source = {
          id: runtime.id('source'), ...context, ...input,
          metadata: { capture: { method: 'explicit-local-input' } }, processingState: 'processed', createdAt: timestamp
        };
        document.sources.push(source);
        audit(document, runtime, context, 'source', source.id, 'source-created', request.actor, timestamp, null, source);
        const createdFindings = normalizedFindings.map(values => {
          const finding = { id: runtime.id('finding'), ...context, sourceId: source.id, ...values, reviewStatus: 'pending' };
          document.findings.push(finding);
          audit(document, runtime, context, 'finding', finding.id, 'finding-created', request.actor, timestamp, null, finding);
          return clone(finding);
        });
        return { source: clone(source), findings: createdFindings };
      });
    },

    previewImport(organizationId, workspaceId, body) {
      exactKeys(body, ['input'], ['input']);
      return readWorkflow(targetDataFile, (document, revision) => ({ preview: buildImportPreview(document, organizationId, workspaceId, body.input, revision) }));
    },

    applyImport(organizationId, workspaceId, body) {
      const request = requestBase(body, ['input', 'previewHash', 'approvedProposalIds'], ['input', 'previewHash', 'approvedProposalIds']);
      const approvedProposalIds = uniqueStableIds(body.approvedProposalIds, { max: 700 });
      const previewHash = requireText(body.previewHash, { max: 64 });
      return writeWorkflow(targetDataFile, request.expectedRevision, (document, revision) => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const preview = buildImportPreview(document, organizationId, workspaceId, body.input, revision);
        if (preview.previewHash !== previewHash) throw previewConflict();
        const outcome = applyImportProposals(document, runtime, context, resolvers, body.input, preview, approvedProposalIds, request.actor);
        return { outcome, appliedPreviewHash: previewHash };
      });
    },

    listFindings(organizationId, workspaceId, query) {
      const page = pagination(query);
      return readWorkflow(targetDataFile, document => {
        contextFor(document, organizationId, workspaceId);
        const matches = document.findings.filter(finding => finding.organizationId === organizationId && finding.workspaceId === workspaceId &&
          (page.status === null || finding.reviewStatus === page.status));
        const start = (page.page - 1) * page.pageSize;
        return {
          page: page.page,
          pageSize: page.pageSize,
          total: matches.length,
          findings: matches.slice(start, start + page.pageSize).map(clone)
        };
      });
    },

    reviewFinding(organizationId, workspaceId, findingId, body) {
      const request = requestBase(body, ['decision', 'scopeId', 'workItemId'], ['decision']);
      const selection = { findingId, decision: body.decision };
      if (Object.hasOwn(body, 'scopeId')) selection.scopeId = body.scopeId;
      if (Object.hasOwn(body, 'workItemId')) selection.workItemId = body.workItemId;
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        return reviewFinding(document, runtime, resolvers, context, selection, request.actor, runtime.timestamp());
      });
    },

    reviewFindingsBulk(organizationId, workspaceId, body) {
      const request = requestBase(body, ['selections'], ['selections']);
      const selections = requireArray(body.selections, { min: 1, max: MAX_FINDING_REVIEW_SELECTION });
      const ids = selections.map(selection => requireStableId(requireObject(selection).findingId));
      if (new Set(ids).size !== ids.length) throw invalidRequest();
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const timestamp = runtime.timestamp();
        const outcomes = selections.map(selection => reviewFinding(document, runtime, resolvers, context, selection, request.actor, timestamp));
        return { outcomes, count: outcomes.length };
      });
    },

    previewProposedChange(organizationId, workspaceId, body) {
      exactKeys(body, ['change'], ['change']);
      return readWorkflow(targetDataFile, (document, revision) => ({ preview: buildProposedChangePreview(document, organizationId, workspaceId, body.change, revision) }));
    },

    createProposedChange(organizationId, workspaceId, body) {
      const request = requestBase(body, ['change', 'previewHash'], ['change', 'previewHash']);
      const approvedHash = requireText(body.previewHash, { max: 64 });
      return writeWorkflow(targetDataFile, request.expectedRevision, (document, revision) => {
        const { context } = contextFor(document, organizationId, workspaceId);
        const preview = buildProposedChangePreview(document, organizationId, workspaceId, body.change, revision);
        if (preview.previewHash !== approvedHash) throw previewConflict();
        const record = {
          id: runtime.id('proposedChange'), ...context,
          findingId: preview.findingId, evidenceIds: preview.evidenceIds, workItemId: preview.workItemId,
          field: preview.field, beforeValue: preview.beforeValue, proposedValue: preview.proposedValue,
          reviewStatus: 'pending', snapshotHash: preview.previewHash
        };
        document.proposedChanges.push(record);
        const timestamp = runtime.timestamp();
        audit(document, runtime, context, 'proposedChange', record.id, 'proposed-change-created-from-preview', request.actor, timestamp, null, record);
        return { proposedChange: clone(record) };
      });
    },

    reviewProposedChange(organizationId, workspaceId, proposedChangeId, body) {
      const request = requestBase(body, ['decision'], ['decision']);
      const decision = requireEnum(body.decision, ['approve', 'reject']);
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const record = resolvers.resolveWorkspaceChild('proposedChanges', organizationId, workspaceId, proposedChangeId);
        if (record.reviewStatus !== 'pending') throw previewConflict();
        const before = clone(record);
        record.reviewStatus = decision === 'approve' ? 'approved' : 'rejected';
        const timestamp = runtime.timestamp();
        audit(document, runtime, context, 'proposedChange', record.id, `proposed-change-${record.reviewStatus}`, request.actor, timestamp, before, record);
        return { proposedChange: clone(record) };
      });
    },

    applyProposedChange(organizationId, workspaceId, proposedChangeId, body) {
      const request = requestBase(body, ['previewHash'], ['previewHash']);
      const previewHash = requireText(body.previewHash, { max: 64 });
      return writeWorkflow(targetDataFile, request.expectedRevision, document => {
        const { resolvers, context } = contextFor(document, organizationId, workspaceId);
        const record = resolvers.resolveWorkspaceChild('proposedChanges', organizationId, workspaceId, proposedChangeId);
        if (record.reviewStatus !== 'approved' || record.snapshotHash !== previewHash) throw previewConflict();
        const workItem = resolvers.resolveWorkspaceChild('workItems', organizationId, workspaceId, record.workItemId);
        if (stateHash(workItem[record.field]) !== stateHash(record.beforeValue)) throw previewConflict();
        record.evidenceIds.forEach(evidenceId => {
          const evidence = resolvers.resolveWorkspaceChild('evidence', organizationId, workspaceId, evidenceId);
          if (evidence.workItemId !== null && evidence.workItemId !== workItem.id) throw previewConflict();
          if (evidence.scopeId !== null && evidence.scopeId !== workItem.scopeId) throw previewConflict();
        });
        const timestamp = runtime.timestamp();
        const beforeWorkItem = clone(workItem);
        const beforeChange = clone(record);
        workItem[record.field] = clone(record.proposedValue);
        workItem.updatedAt = timestamp;
        record.reviewStatus = 'applied';
        audit(document, runtime, context, 'workItem', workItem.id, 'proposed-change-applied-to-work-item', request.actor, timestamp, beforeWorkItem, workItem);
        audit(document, runtime, context, 'proposedChange', record.id, 'proposed-change-applied', request.actor, timestamp, beforeChange, record);
        return { proposedChange: clone(record), workItem: clone(workItem), evidenceUnchanged: true };
      });
    }
  });
}

module.exports = {
  MAX_FINDING_PAGE_SIZE,
  MAX_FINDING_REVIEW_SELECTION,
  PROPOSED_CHANGE_FIELDS,
  SOURCE_KINDS,
  SOURCE_TYPES,
  applyImportProposals,
  buildProposedChangePreview,
  createCaptureServices,
  evidenceAssociations,
  reassignWorkItemAndEvidence,
  reviewFinding,
  sourceInput
};
