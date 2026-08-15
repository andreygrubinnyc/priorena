'use strict';

const { ITEM_TYPES } = require('../target-model/schema');
const { importValidation, invalidRequest } = require('./errors');
const { createTargetResolvers } = require('./resolvers');
const {
  exactKeys,
  nullableStableId,
  nullableText,
  requireArray,
  requireBoolean,
  requireDate,
  requireEnum,
  requireStableId,
  requireText,
  stateHash
} = require('./workflow-utils');

const IMPORT_FORMATS = Object.freeze(['target-json', 'target-csv', 'structured-text']);
const MAX_IMPORT_BYTES = 512 * 1024;
const MAX_IMPORT_RECORDS = 100;
const MAX_IMPORT_CELL_CHARACTERS = 4_000;
const RECORD_FIELDS = Object.freeze([
  'externalKey',
  'itemType',
  'summary',
  'description',
  'jiraProjectKey',
  'jiraEpicKey',
  'noEpic',
  'requestedInitiativeId',
  'initiativeName',
  'canonicalStatus',
  'evidenceExcerpt',
  'category'
]);
const SUPPORTED_SOURCE_TYPES = Object.freeze([
  'meeting-note', 'sprint-planning', 'backlog-refinement', 'dsu', 'generic',
  'normalized-json', 'normalized-csv', 'external-evidence-feed'
]);
const SUPPORTED_SOURCE_KINDS = Object.freeze(['structured-note', 'normalized-feed', 'external-evidence-metadata']);

function proposalId(type, index, payload) {
  return `proposal-${stateHash({ type, index, payload }).slice(0, 32)}`;
}

function requireCanonicalJiraKey(value) {
  const key = requireText(value, { max: 100 });
  if (key !== key.trim() || key !== key.toUpperCase() || !/^[A-Z][A-Z0-9_]*(?:-[A-Z0-9_]+)?$/.test(key)) throw invalidRequest();
  return key;
}

function parseCsvRows(content) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let quotedCellClosed = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        quotedCellClosed = true;
      } else {
        cell += character;
      }
    } else if (quotedCellClosed) {
      if (character === ',') {
        row.push(cell);
        cell = '';
        quotedCellClosed = false;
      } else if (character === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        quotedCellClosed = false;
      } else if (!(character === '\r' && content[index + 1] === '\n')) {
        throw importValidation('malformed-csv');
      }
    } else if (character === '"') {
      if (cell.length > 0) throw importValidation('malformed-csv');
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
    if (cell.length > MAX_IMPORT_CELL_CHARACTERS) throw importValidation('cell-too-long');
  }
  if (quoted) throw importValidation('malformed-csv');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  if (rows.length === 0) throw importValidation('invalid-feed-shape');
  const headers = rows.shift();
  if (headers.length === 0 || headers.some(header => !header)) throw importValidation('invalid-feed-shape');
  if (new Set(headers).size !== headers.length) throw importValidation('duplicate-csv-header');
  if (headers.some(header => !RECORD_FIELDS.includes(header))) throw importValidation('unsupported-csv-header');
  if (rows.length > MAX_IMPORT_RECORDS) throw importValidation('too-many-records');
  return rows.filter(values => values.some(Boolean)).map((values, recordIndex) => {
    if (values.length !== headers.length) throw importValidation('csv-column-count', { recordIndex });
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]).filter(([, value]) => value !== ''));
  });
}

function rawRecords(format, content) {
  if (format === 'structured-text') {
    const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) throw importValidation('empty-structured-text');
    if (lines.length > MAX_IMPORT_RECORDS) throw importValidation('too-many-records');
    return lines.map(line => ({ evidenceExcerpt: line, category: 'note' }));
  }
  if (format === 'target-csv') return parseCsvRows(content);
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    throw importValidation('invalid-json');
  }
  try {
    exactKeys(parsed, ['version', 'records'], ['version', 'records']);
  } catch (error) {
    if (error?.code === 'INVALID_REQUEST') throw importValidation('invalid-feed-shape');
    throw error;
  }
  if (parsed.version !== 'target-v4') throw importValidation('unsupported-version');
  if (!Array.isArray(parsed.records)) throw importValidation('invalid-records');
  if (parsed.records.length > MAX_IMPORT_RECORDS) throw importValidation('too-many-records');
  return parsed.records;
}

function importField(recordIndex, field, callback) {
  try {
    return callback();
  } catch (error) {
    if (error?.code === 'INVALID_REQUEST') throw importValidation('invalid-field', { recordIndex, field });
    throw error;
  }
}

function normalizeImportRecord(value, recordIndex) {
  try {
    exactKeys(value, RECORD_FIELDS);
  } catch (error) {
    if (error?.code === 'INVALID_REQUEST') throw importValidation('invalid-feed-shape', { recordIndex });
    throw error;
  }
  const fieldLimits = {
    externalKey: 100,
    itemType: 200,
    summary: 1_000,
    description: MAX_IMPORT_CELL_CHARACTERS,
    jiraProjectKey: 100,
    jiraEpicKey: 100,
    noEpic: 5,
    requestedInitiativeId: 160,
    initiativeName: 200,
    canonicalStatus: 200,
    evidenceExcerpt: MAX_IMPORT_CELL_CHARACTERS,
    category: 100
  };
  for (const [field, max] of Object.entries(fieldLimits)) {
    if (typeof value[field] === 'string' && value[field].length > max) {
      throw importValidation('field-too-long', { recordIndex, field });
    }
  }
  const externalItemType = ['Feature', 'Workstream'].includes(value.itemType) ? value.itemType : null;
  const record = {
    externalKey: value.externalKey === undefined || value.externalKey === null ? null : importField(recordIndex, 'externalKey', () => requireCanonicalJiraKey(value.externalKey)),
    itemType: value.itemType === undefined ? 'Unknown' : (externalItemType === null ? importField(recordIndex, 'itemType', () => requireEnum(value.itemType, [...ITEM_TYPES])) : null),
    externalItemType,
    summary: value.summary === undefined ? null : importField(recordIndex, 'summary', () => nullableText(value.summary, { max: 1_000 })),
    description: value.description === undefined ? '' : importField(recordIndex, 'description', () => requireText(value.description, { allowEmpty: true, max: MAX_IMPORT_CELL_CHARACTERS })),
    jiraProjectKey: value.jiraProjectKey === undefined ? null : importField(recordIndex, 'jiraProjectKey', () => requireCanonicalJiraKey(value.jiraProjectKey)),
    jiraEpicKey: value.jiraEpicKey === undefined ? null : importField(recordIndex, 'jiraEpicKey', () => requireCanonicalJiraKey(value.jiraEpicKey)),
    noEpic: value.noEpic === undefined ? null : importField(recordIndex, 'noEpic', () => typeof value.noEpic === 'string' ? requireEnum(value.noEpic.toLowerCase(), ['true', 'false']) === 'true' : requireBoolean(value.noEpic)),
    requestedInitiativeId: value.requestedInitiativeId === undefined ? null : importField(recordIndex, 'requestedInitiativeId', () => nullableStableId(value.requestedInitiativeId)),
    initiativeName: value.initiativeName === undefined ? null : importField(recordIndex, 'initiativeName', () => nullableText(value.initiativeName, { max: 200 })),
    canonicalStatus: value.canonicalStatus === undefined ? null : importField(recordIndex, 'canonicalStatus', () => nullableText(value.canonicalStatus, { max: 200 })),
    evidenceExcerpt: value.evidenceExcerpt === undefined ? null : importField(recordIndex, 'evidenceExcerpt', () => nullableText(value.evidenceExcerpt, { max: MAX_IMPORT_CELL_CHARACTERS })),
    category: value.category === undefined ? 'general' : importField(recordIndex, 'category', () => requireText(value.category, { max: 100 }))
  };
  if ((record.jiraProjectKey === null) !== (record.jiraEpicKey === null)) throw importValidation('jira-key-pair-required', { recordIndex });
  if (record.noEpic === true && (record.jiraProjectKey !== null || record.jiraEpicKey !== null || record.requestedInitiativeId !== null)) {
    throw importValidation('no-epic-conflict', { recordIndex });
  }
  if (record.summary === null && record.externalKey === null && record.evidenceExcerpt === null) {
    throw importValidation('missing-record-content', { recordIndex });
  }
  return record;
}

function normalizeSourceDescriptor(value) {
  try {
    exactKeys(value, ['title', 'type', 'sourceKind', 'date', 'provenance'], ['title', 'type', 'sourceKind', 'date', 'provenance']);
    return {
      title: requireText(value.title, { max: 500 }),
      type: requireEnum(value.type, SUPPORTED_SOURCE_TYPES),
      sourceKind: requireEnum(value.sourceKind, SUPPORTED_SOURCE_KINDS),
      date: requireDate(value.date),
      provenance: requireText(value.provenance, { max: 4_000 })
    };
  } catch (error) {
    if (error?.code === 'INVALID_REQUEST') throw importValidation('invalid-source');
    throw error;
  }
}

function normalizeImportInput(value) {
  try {
    exactKeys(value, ['format', 'content', 'source'], ['format', 'content', 'source']);
  } catch (error) {
    if (error?.code === 'INVALID_REQUEST') throw importValidation('invalid-input');
    throw error;
  }
  let format;
  try {
    format = requireEnum(value.format, IMPORT_FORMATS);
  } catch (error) {
    if (error?.code === 'INVALID_REQUEST') throw importValidation('invalid-input');
    throw error;
  }
  if (typeof value.content !== 'string' || !value.content.trim()) throw importValidation('invalid-input');
  if (value.content.length > MAX_IMPORT_BYTES || Buffer.byteLength(value.content, 'utf8') > MAX_IMPORT_BYTES) {
    throw importValidation('content-too-large');
  }
  const content = value.content;
  return {
    format,
    content,
    source: normalizeSourceDescriptor(value.source),
    records: rawRecords(format, content).map(normalizeImportRecord)
  };
}

function exactWorkItemForRecord(document, organizationId, workspaceId, record) {
  return exactWorkItemsForRecord(document, organizationId, workspaceId, record)[0] || null;
}

function exactWorkItemsForRecord(document, organizationId, workspaceId, record) {
  if (record.externalKey === null) return [];
  return document.workItems.filter(item => item.organizationId === organizationId && item.workspaceId === workspaceId &&
    [item.jiraKey, item.jiraId].some(value => value !== null && value === record.externalKey));
}

function exactMappingForRecord(document, organizationId, workspaceId, record) {
  if (record.noEpic === true || record.jiraEpicKey === null) return null;
  return document.jiraEpicMappings.find(item => item.organizationId === organizationId && item.workspaceId === workspaceId &&
    item.mappingStatus !== 'inactive' && item.jiraProjectKey === record.jiraProjectKey && item.jiraEpicKey === record.jiraEpicKey) || null;
}

function evidenceChangesForAssignment(document, workItemId, nextInitiativeId) {
  if (workItemId === null) return [];
  return document.evidence
    .filter(item => item.workItemId === workItemId && item.initiativeId !== nextInitiativeId)
    .map(item => ({
      evidenceId: item.id,
      beforeInitiativeId: item.initiativeId,
      afterInitiativeId: nextInitiativeId
    }));
}

function importCapabilities(document, organizationId, workspaceId) {
  const resolvers = createTargetResolvers(document);
  const workspace = resolvers.resolveWorkspace(organizationId, workspaceId);
  return {
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    contractVersion: 'target-v4',
    formats: [...IMPORT_FORMATS],
    recordFields: [...RECORD_FIELDS],
    sourceTypes: [...SUPPORTED_SOURCE_TYPES],
    sourceKinds: [...SUPPORTED_SOURCE_KINDS],
    limits: {
      maxBytes: MAX_IMPORT_BYTES,
      maxRecords: MAX_IMPORT_RECORDS,
      maxCellCharacters: MAX_IMPORT_CELL_CHARACTERS
    },
    itemTypes: [...ITEM_TYPES],
    initiatives: document.initiatives
      .filter(item => item.organizationId === workspace.organizationId && item.workspaceId === workspace.id && item.archived === false)
      .map(item => ({ id: item.id, name: item.name })),
    workstreams: document.workstreams
      .filter(item => item.organizationId === workspace.organizationId && item.workspaceId === workspace.id)
      .map(item => ({ id: item.id, initiativeId: item.initiativeId, name: item.name, status: item.status })),
    jiraEpicMappings: document.jiraEpicMappings
      .filter(item => item.organizationId === workspace.organizationId && item.workspaceId === workspace.id)
      .map(item => ({
        id: item.id,
        initiativeId: item.initiativeId,
        jiraProjectKey: item.jiraProjectKey,
        jiraEpicKey: item.jiraEpicKey,
        jiraEpicName: item.jiraEpicName,
        mappingStatus: item.mappingStatus
      }))
  };
}

function duplicateExternalKeys(records) {
  const counts = new Map();
  records.forEach(record => {
    if (record.externalKey !== null) counts.set(record.externalKey, (counts.get(record.externalKey) || 0) + 1);
  });
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}

function reviewRowsFor(document, workspace, input) {
  const duplicates = duplicateExternalKeys(input.records);
  const resolvers = createTargetResolvers(document);
  const rows = input.records.map((record, recordIndex) => {
    if (record.requestedInitiativeId !== null) {
      const requested = resolvers.resolveWorkspaceChild(
        'initiatives', workspace.organizationId, workspace.id, record.requestedInitiativeId
      );
      if (requested.archived) throw invalidRequest();
    }
    const exactWorkItems = exactWorkItemsForRecord(document, workspace.organizationId, workspace.id, record);
    const existing = exactWorkItems.length === 1 ? exactWorkItems[0] : null;
    const exactMapping = exactMappingForRecord(document, workspace.organizationId, workspace.id, record);
    const duplicateReasons = [];
    if (record.externalKey !== null && duplicates.has(record.externalKey)) duplicateReasons.push('duplicate-external-key-in-feed');
    if (exactWorkItems.length > 1) duplicateReasons.push('multiple-local-exact-matches');
    const unsupported = record.externalItemType !== null;
    return {
      recordIndex,
      externalKey: record.externalKey,
      sourceItemType: record.externalItemType || record.itemType,
      sourceSummary: record.summary,
      sourceDescription: record.description,
      sourceCanonicalStatus: record.canonicalStatus,
      sourceJiraProjectKey: record.jiraProjectKey,
      sourceJiraEpicKey: record.jiraEpicKey,
      evidenceExcerpt: record.evidenceExcerpt,
      category: record.category,
      match: existing === null ? null : {
        workItemId: existing.id,
        itemType: existing.itemType,
        summary: existing.summary,
        description: existing.description,
        canonicalStatus: existing.canonicalStatus,
        initiativeId: existing.initiativeId,
        workstreamId: existing.workstreamId,
        jiraEpicMappingId: existing.jiraEpicMappingId,
        updatedAt: existing.updatedAt
      },
      suggestedExactMapping: exactMapping === null ? null : {
        jiraEpicMappingId: exactMapping.id,
        initiativeId: exactMapping.initiativeId
      },
      requestedInitiativeId: record.requestedInitiativeId,
      sourceInitiativeName: record.initiativeName,
      noEpic: record.noEpic,
      jiraMappingReviewState: record.noEpic === true
        ? 'explicit-no-epic'
        : (record.jiraEpicKey === null ? 'not-provided' : (exactMapping === null ? 'unresolved' : 'exact-local-suggestion')),
      duplicateReasons,
      reviewState: unsupported
        ? 'unsupported-item-type'
        : (duplicateReasons.length > 0 ? 'duplicate-review' : (existing === null ? 'new-record' : 'existing-record')),
      supportedForApply: !unsupported && exactWorkItems.length <= 1,
      requiresHumanCreationDecision: existing === null && !unsupported,
      findingAvailable: record.evidenceExcerpt !== null,
      proposedCurrentStateChange: existing !== null && record.canonicalStatus !== null && existing.canonicalStatus !== record.canonicalStatus
        ? { beforeValue: existing.canonicalStatus, proposedValue: record.canonicalStatus, disposition: 'deferred' }
        : null
    };
  });
  const matchCounts = new Map();
  rows.forEach(row => {
    if (row.match) matchCounts.set(row.match.workItemId, (matchCounts.get(row.match.workItemId) || 0) + 1);
  });
  return rows.map(row => {
    if (!row.match || matchCounts.get(row.match.workItemId) < 2) return row;
    const duplicateReasons = [...row.duplicateReasons, 'multiple-feed-rows-for-local-work-item'];
    return { ...row, duplicateReasons, reviewState: 'duplicate-review' };
  });
}

const REVIEW_DECISION_FIELDS = Object.freeze([
  'recordIndex',
  'includeRecord',
  'createWorkItem',
  'approvedItemType',
  'approvedSummary',
  'approvedDescription',
  'initiativeId',
  'workstreamId',
  'jiraEpicMappingId',
  'includeFinding'
]);

function normalizeReviewDecision(value) {
  exactKeys(value, REVIEW_DECISION_FIELDS, REVIEW_DECISION_FIELDS);
  if (!Number.isInteger(value.recordIndex) || value.recordIndex < 0 || value.recordIndex >= MAX_IMPORT_RECORDS) throw invalidRequest();
  return {
    recordIndex: value.recordIndex,
    includeRecord: requireBoolean(value.includeRecord),
    createWorkItem: requireBoolean(value.createWorkItem),
    approvedItemType: value.approvedItemType === null ? null : requireEnum(value.approvedItemType, [...ITEM_TYPES]),
    approvedSummary: value.approvedSummary === null ? null : requireText(value.approvedSummary, { max: 1_000 }),
    approvedDescription: value.approvedDescription === null ? null : requireText(value.approvedDescription, { allowEmpty: true, max: MAX_IMPORT_CELL_CHARACTERS }),
    initiativeId: nullableStableId(value.initiativeId),
    workstreamId: nullableStableId(value.workstreamId),
    jiraEpicMappingId: nullableStableId(value.jiraEpicMappingId),
    includeFinding: requireBoolean(value.includeFinding)
  };
}

function normalizeReviewRequest(value, recordCount) {
  exactKeys(value, ['includeSource', 'reviewDecisions'], ['includeSource', 'reviewDecisions']);
  const reviewDecisions = requireArray(value.reviewDecisions, { min: recordCount, max: recordCount }).map(normalizeReviewDecision);
  if (new Set(reviewDecisions.map(decision => decision.recordIndex)).size !== recordCount) throw invalidRequest();
  if (reviewDecisions.some(decision => decision.recordIndex >= recordCount)) throw invalidRequest();
  return {
    includeSource: requireBoolean(value.includeSource),
    reviewDecisions: reviewDecisions.sort((left, right) => left.recordIndex - right.recordIndex)
  };
}

function requireReviewTarget(resolvers, context, decision) {
  const initiative = decision.initiativeId === null
    ? null
    : resolvers.resolveWorkspaceChild('initiatives', context.organizationId, context.workspaceId, decision.initiativeId);
  if (initiative?.archived) throw invalidRequest();
  const workstream = decision.workstreamId === null
    ? null
    : resolvers.resolveWorkspaceChild('workstreams', context.organizationId, context.workspaceId, decision.workstreamId);
  const mapping = decision.jiraEpicMappingId === null
    ? null
    : resolvers.resolveWorkspaceChild('jiraEpicMappings', context.organizationId, context.workspaceId, decision.jiraEpicMappingId);
  if ((workstream && workstream.initiativeId !== decision.initiativeId) || (mapping && mapping.initiativeId !== decision.initiativeId)) throw invalidRequest();
}

function excludedDecisionIsEmpty(decision) {
  return decision.createWorkItem === false && decision.approvedItemType === null && decision.approvedSummary === null &&
    decision.approvedDescription === null && decision.initiativeId === null && decision.workstreamId === null &&
    decision.jiraEpicMappingId === null && decision.includeFinding === false;
}

function buildImportPreview(document, organizationId, workspaceId, value, revision, reviewValue = undefined) {
  const resolvers = createTargetResolvers(document);
  const workspace = resolvers.resolveWorkspace(organizationId, workspaceId);
  const input = normalizeImportInput(value);
  const reviewRows = reviewRowsFor(document, workspace, input);
  const context = { organizationId: workspace.organizationId, workspaceId: workspace.id };
  if (reviewValue === undefined) {
    const previewCore = {
      ...context,
      stage: 'review',
      format: input.format,
      source: {
        ...input.source,
        contentBytes: Buffer.byteLength(input.content, 'utf8'),
        contentHash: stateHash(input.content),
        initiallySelected: false
      },
      reviewRows,
      decisionsRequired: reviewRows.length,
      writesPerformed: 0
    };
    return {
      ...previewCore,
      expectedRevision: revision,
      previewHash: stateHash({ previewCore, input: value, revision })
    };
  }

  const review = normalizeReviewRequest(reviewValue, input.records.length);
  const proposals = [];
  const add = (type, index, payload, dependencies = []) => {
    const proposal = { id: proposalId(type, index, payload), type, index, payload, dependencies };
    proposals.push(proposal);
    return proposal;
  };
  const sourceProposal = review.includeSource ? add('source-create', -1, {
    ...input.source,
    format: input.format,
    contentBytes: Buffer.byteLength(input.content, 'utf8'),
    contentHash: stateHash(input.content)
  }) : null;
  const includedKeys = new Set();
  const includedWorkItemIds = new Set();
  review.reviewDecisions.forEach(decision => {
    const index = decision.recordIndex;
    const record = input.records[index];
    const row = reviewRows[index];
    if (!decision.includeRecord) {
      if (!excludedDecisionIsEmpty(decision)) throw invalidRequest();
      return;
    }
    if (!review.includeSource || !row.supportedForApply) throw invalidRequest();
    if (record.externalKey !== null && includedKeys.has(record.externalKey)) throw invalidRequest();
    if (record.externalKey !== null) includedKeys.add(record.externalKey);
    if (row.match && includedWorkItemIds.has(row.match.workItemId)) throw invalidRequest();
    if (row.match) includedWorkItemIds.add(row.match.workItemId);
    if (decision.includeFinding && record.evidenceExcerpt === null) throw invalidRequest();
    requireReviewTarget(resolvers, context, decision);
    const exactWorkItem = exactWorkItemForRecord(document, workspace.organizationId, workspace.id, record);
    if (exactWorkItem && decision.createWorkItem) throw invalidRequest();
    if (!exactWorkItem && !decision.createWorkItem && (
      decision.approvedItemType !== null || decision.approvedSummary !== null || decision.approvedDescription !== null ||
      decision.initiativeId !== null || decision.workstreamId !== null || decision.jiraEpicMappingId !== null
    )) throw invalidRequest();
    if (decision.createWorkItem && (decision.approvedItemType === null || decision.approvedSummary === null || decision.approvedDescription === null)) throw invalidRequest();
    if (!decision.createWorkItem && (decision.approvedItemType !== null || decision.approvedSummary !== null || decision.approvedDescription !== null)) throw invalidRequest();
    let workItemProposal = null;
    if (decision.createWorkItem) {
      workItemProposal = add('work-item-create', index, {
        jiraKey: record.externalKey,
        itemType: decision.approvedItemType,
        summary: decision.approvedSummary,
        description: decision.approvedDescription,
        canonicalStatus: 'Unknown',
        initiativeId: null
      });
    }
    if ((exactWorkItem && (
      exactWorkItem.initiativeId !== decision.initiativeId || exactWorkItem.workstreamId !== decision.workstreamId ||
      exactWorkItem.jiraEpicMappingId !== decision.jiraEpicMappingId
    )) || (workItemProposal && (
      decision.initiativeId !== null || decision.workstreamId !== null || decision.jiraEpicMappingId !== null
    ))) {
      const beforeWorkstreamId = exactWorkItem?.workstreamId || null;
      const afterWorkstreamId = decision.workstreamId;
      const afterJiraEpicMappingId = decision.jiraEpicMappingId;
      add('work-item-assign', index, {
        workItemId: exactWorkItem?.id || null,
        workItemProposalId: workItemProposal?.id || null,
        initiativeId: decision.initiativeId,
        workstreamId: afterWorkstreamId,
        jiraEpicMappingId: afterJiraEpicMappingId,
        evidenceChanges: evidenceChangesForAssignment(document, exactWorkItem?.id || null, decision.initiativeId),
        initiativeChange: {
          effect: decision.initiativeId === (exactWorkItem?.initiativeId || null)
            ? 'retained'
            : (decision.initiativeId === null ? 'cleared' : 'replaced'),
          beforeInitiativeId: exactWorkItem?.initiativeId || null,
          afterInitiativeId: decision.initiativeId
        },
        workstreamChange: {
          effect: afterWorkstreamId === beforeWorkstreamId ? 'retained' : (afterWorkstreamId === null ? 'cleared' : 'replaced'),
          beforeWorkstreamId,
          afterWorkstreamId
        },
        jiraEpicChange: {
          effect: afterJiraEpicMappingId === (exactWorkItem?.jiraEpicMappingId || null)
            ? 'retained'
            : (afterJiraEpicMappingId === null ? 'cleared' : 'replaced'),
          beforeJiraEpicMappingId: exactWorkItem?.jiraEpicMappingId || null,
          afterJiraEpicMappingId
        }
      }, workItemProposal ? [workItemProposal.id] : []);
    }
    if (decision.includeFinding) {
      const finding = add('finding-create', index, {
        sourceProposalId: sourceProposal.id,
        exactExcerpt: record.evidenceExcerpt,
        category: record.category,
        proposedWorkItemId: exactWorkItem?.id || null,
        proposedWorkItemProposalId: workItemProposal?.id || null,
        proposedInitiativeId: decision.initiativeId
      }, [sourceProposal.id, ...(workItemProposal ? [workItemProposal.id] : [])]);
      if (exactWorkItem && record.canonicalStatus !== null && exactWorkItem.canonicalStatus !== record.canonicalStatus) {
        add('proposed-current-state-change', index, {
          findingProposalId: finding.id,
          workItemId: exactWorkItem.id,
          field: 'canonicalStatus',
          beforeValue: exactWorkItem.canonicalStatus,
          proposedValue: record.canonicalStatus,
          requiresAcceptedEvidence: true
        }, [finding.id]);
      }
    }
  });
  if (proposals.length === 0) throw invalidRequest();
  const approvableProposalIds = proposals
    .filter(proposal => proposal.type !== 'proposed-current-state-change')
    .map(proposal => proposal.id);
  const previewCore = {
    ...context,
    stage: 'final-review',
    format: input.format,
    includeSource: review.includeSource,
    reviewDecisions: review.reviewDecisions,
    reviewRows,
    proposals,
    approvableProposalIds,
    deferredProposalIds: proposals.filter(proposal => proposal.type === 'proposed-current-state-change').map(proposal => proposal.id),
    writesPerformed: 0
  };
  return {
    ...previewCore,
    expectedRevision: revision,
    previewHash: stateHash({ previewCore, input: value, review, revision })
  };
}

module.exports = {
  IMPORT_FORMATS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_CELL_CHARACTERS,
  MAX_IMPORT_RECORDS,
  RECORD_FIELDS,
  SUPPORTED_SOURCE_KINDS,
  SUPPORTED_SOURCE_TYPES,
  buildImportPreview,
  importCapabilities,
  normalizeImportInput,
  normalizeImportRecord,
  normalizeReviewRequest,
  parseCsvRows
};
