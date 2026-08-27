'use strict';

const { ITEM_TYPES } = require('../target-model/schema');
const { invalidQuery, notFound, outputTooLarge } = require('./errors');
const { IMPORT_FORMATS, normalizeImportInput, normalizeImportRecord } = require('./import-parser');
const { createTargetResolvers, STABLE_ID_PATTERN } = require('./resolvers');

const DEFAULT_TRIAGE_PAGE_SIZE = 25;
const MAX_TRIAGE_PAGE_SIZE = 100;
const MAX_TRIAGE_SEARCH_CHARACTERS = 200;
const MAX_DEPENDENCY_CONTEXT_ITEMS = 100;
const MAX_DEPENDENCY_CONTEXT_OUTPUT_BYTES = 1024 * 1024;
const DEPENDENCY_CONTEXT_TRUST_LABEL = 'Explicit dependency links — review context, not a risk score, blocker inference, satisfaction assessment, or prioritization';
const DEPENDENCY_REVIEW_CUES = Object.freeze([
  'archived',
  'blocked-status',
  'at-risk-status',
  'unknown-status',
  'state-needs-confirmation'
]);
const TRIAGE_SORT_FIELDS = Object.freeze([
  'jira-key',
  'summary',
  'item-type',
  'canonical-status',
  'initiative',
  'created-at',
  'triage-signals'
]);
const TRIAGE_SIGNAL_FILTERS = Object.freeze([
  'type-unresolved',
  'status-suggestion-needs-evidence',
  'initiative-unassigned',
  'source-trace-available',
  'no-source-trace'
]);
const TRIAGE_QUERY_KEYS = new Set([
  'page',
  'pageSize',
  'q',
  'sort',
  'direction',
  'itemType',
  'canonicalStatus',
  'initiativeId',
  'workstreamId',
  'jiraEpicMappingId',
  'sourceId',
  'signal'
]);

function clone(value) {
  return structuredClone(value);
}

function scalarQueryValue(query, key) {
  const value = query[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw invalidQuery();
  return value;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw invalidQuery();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) throw invalidQuery();
  return number;
}

function boundedQueryText(value, options = {}) {
  if (value === undefined) return options.fallback;
  const normalized = options.trim === false ? value : value.trim();
  if (normalized.length > options.max || /[\u0000-\u001f\u007f]/.test(normalized)) throw invalidQuery();
  return normalized;
}

function stableQueryId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || !STABLE_ID_PATTERN.test(value)) {
    throw invalidQuery();
  }
  return value;
}

function exactNormalizedKey(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return normalizeImportRecord({ externalKey: value }, 0).externalKey;
  } catch (_) {
    return null;
  }
}

function workItemExactKeys(workItem) {
  return [...new Set([workItem.jiraKey, workItem.jiraId].map(exactNormalizedKey).filter(Boolean))];
}

function normalizedSourceRows(source) {
  const format = source.metadata?.capture?.format;
  if (!IMPORT_FORMATS.includes(format) || typeof source.content !== 'string') return [];
  try {
    const input = normalizeImportInput({
      format,
      content: source.content,
      source: {
        title: source.title,
        type: source.type,
        sourceKind: source.sourceKind,
        date: source.date,
        provenance: source.provenance
      }
    });
    return input.records.map((record, recordIndex) => ({ record, recordIndex }));
  } catch (_) {
    return [];
  }
}

function compareText(left, right) {
  const a = String(left ?? '').toLocaleLowerCase('en-US');
  const b = String(right ?? '').toLocaleLowerCase('en-US');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizedStatus(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function dependencyReviewCues(workItem) {
  const cues = [];
  const status = normalizedStatus(workItem.canonicalStatus);
  if (workItem.archived) cues.push('archived');
  if (status === 'blocked') cues.push('blocked-status');
  else if (['at risk', 'at-risk'].includes(status)) cues.push('at-risk-status');
  else if (status === 'unknown') cues.push('unknown-status');
  if (status !== 'unknown' && ['inferred', 'unknown'].includes(workItem.currentStateConfidence)) {
    cues.push('state-needs-confirmation');
  }
  return cues;
}

function compareDependencyItems(left, right) {
  const compare = (a, b) => {
    const normalized = compareText(a, b);
    if (normalized !== 0) return normalized;
    const first = String(a ?? '');
    const second = String(b ?? '');
    if (first < second) return -1;
    if (first > second) return 1;
    return 0;
  };
  return compare(left.jiraKey || left.id, right.jiraKey || right.id) ||
    compare(left.summary, right.summary) ||
    compare(left.id, right.id);
}

function publicDependencyItem(workItem, resolvers, includeReviewCues) {
  const initiative = workItem.initiativeId === null ? null : resolvers.indexes.initiatives.get(workItem.initiativeId);
  const result = {
    id: workItem.id,
    jiraKey: workItem.jiraKey,
    summary: workItem.summary,
    initiative: initiative ? { id: initiative.id, name: initiative.name } : null,
    canonicalStatus: workItem.canonicalStatus,
    currentStateConfidence: workItem.currentStateConfidence,
    archived: workItem.archived
  };
  if (includeReviewCues) result.reviewCues = dependencyReviewCues(workItem);
  return result;
}

function boundedDependencyGroup(workItems, resolvers, includeReviewCues) {
  const ordered = [...workItems].sort(compareDependencyItems);
  const items = ordered.slice(0, MAX_DEPENDENCY_CONTEXT_ITEMS)
    .map(item => publicDependencyItem(item, resolvers, includeReviewCues));
  return {
    items,
    total: ordered.length,
    returned: items.length,
    limit: MAX_DEPENDENCY_CONTEXT_ITEMS,
    truncated: ordered.length > items.length
  };
}

function buildDependencyContext(document, resolvers, organizationId, workspaceId, workItem) {
  const listedWorkItems = workItem.dependencies.map(dependencyId =>
    resolvers.resolveWorkspaceChild('workItems', organizationId, workspaceId, dependencyId));
  const referencingWorkItems = document.workItems.filter(candidate =>
    candidate.organizationId === organizationId &&
    candidate.workspaceId === workspaceId &&
    candidate.id !== workItem.id &&
    candidate.dependencies.includes(workItem.id));
  const listedDependencies = boundedDependencyGroup(listedWorkItems, resolvers, true);
  const referencing = boundedDependencyGroup(referencingWorkItems, resolvers, false);
  const cueCounts = Object.fromEntries(DEPENDENCY_REVIEW_CUES.map(cue => [
    cue,
    listedWorkItems.filter(item => dependencyReviewCues(item).includes(cue)).length
  ]));
  const context = {
    organizationId,
    workspaceId,
    workItemId: workItem.id,
    trustLabel: DEPENDENCY_CONTEXT_TRUST_LABEL,
    listedDependencies,
    referencingWorkItems: referencing,
    cueCounts
  };
  if (Buffer.byteLength(JSON.stringify(context), 'utf8') > MAX_DEPENDENCY_CONTEXT_OUTPUT_BYTES) {
    throw outputTooLarge();
  }
  return context;
}

function buildExactSourceIndex(document, organizationId, workspaceId) {
  const byKey = new Map();
  const sources = document.sources
    .filter(source => source.organizationId === organizationId && source.workspaceId === workspaceId)
    .sort((left, right) => compareText(left.title, right.title) || compareText(left.id, right.id));
  sources.forEach(source => {
    normalizedSourceRows(source).forEach(({ record, recordIndex }) => {
      if (record.externalKey === null) return;
      const matches = byKey.get(record.externalKey) || [];
      matches.push({ source, record, recordIndex });
      byKey.set(record.externalKey, matches);
    });
  });
  byKey.forEach(matches => matches.sort((left, right) =>
    compareText(left.source.title, right.source.title) ||
    compareText(left.source.id, right.source.id) ||
    left.recordIndex - right.recordIndex));
  return { byKey, sources };
}

function exactSourceMatches(sourceIndex, workItem) {
  const matches = workItemExactKeys(workItem).flatMap(key => sourceIndex.byKey.get(key) || []);
  return matches.sort((left, right) =>
    compareText(left.source.title, right.source.title) ||
    compareText(left.source.id, right.source.id) ||
    left.recordIndex - right.recordIndex);
}

function triageSignals(workItem, sourceMatches) {
  return {
    typeUnresolved: workItem.itemType === 'Unknown',
    statusSuggestionNeedsEvidence: workItem.canonicalStatus === 'Unknown' &&
      sourceMatches.some(match => match.record.canonicalStatus !== null),
    initiativeUnassigned: workItem.initiativeId === null,
    sourceTraceAvailable: sourceMatches.length > 0,
    noSourceTrace: sourceMatches.length === 0
  };
}

function signalCount(signals) {
  return Object.values(signals).filter(Boolean).length;
}

function publicStructure(workItem, resolvers) {
  const initiative = workItem.initiativeId === null ? null : resolvers.indexes.initiatives.get(workItem.initiativeId);
  const workstream = workItem.workstreamId === null ? null : resolvers.indexes.workstreams.get(workItem.workstreamId);
  const mapping = workItem.jiraEpicMappingId === null ? null : resolvers.indexes.jiraEpicMappings.get(workItem.jiraEpicMappingId);
  return {
    initiative: initiative ? { id: initiative.id, name: initiative.name } : null,
    workstream: workstream ? { id: workstream.id, initiativeId: workstream.initiativeId, name: workstream.name } : null,
    jiraEpic: mapping ? {
      id: mapping.id,
      initiativeId: mapping.initiativeId,
      jiraProjectKey: mapping.jiraProjectKey,
      jiraEpicKey: mapping.jiraEpicKey,
      jiraEpicName: mapping.jiraEpicName,
      mappingStatus: mapping.mappingStatus
    } : null
  };
}

function triageRow(workItem, resolvers, sourceMatches) {
  const signals = triageSignals(workItem, sourceMatches);
  return {
    id: workItem.id,
    organizationId: workItem.organizationId,
    workspaceId: workItem.workspaceId,
    jiraKey: workItem.jiraKey,
    externalKey: workItem.jiraKey || exactNormalizedKey(workItem.jiraId),
    summary: workItem.summary,
    itemType: workItem.itemType,
    canonicalStatus: workItem.canonicalStatus,
    initiativeId: workItem.initiativeId,
    workstreamId: workItem.workstreamId,
    jiraEpicMappingId: workItem.jiraEpicMappingId,
    ...publicStructure(workItem, resolvers),
    triageSignals: signals,
    triageSignalCount: signalCount(signals),
    sourceMatchCount: sourceMatches.length,
    createdAt: workItem.createdAt
  };
}

function sourceMatchMetadata(match) {
  const suggestionFields = [
    ['itemType', match.record.itemType ?? match.record.externalItemType],
    ['summary', match.record.summary],
    ['description', match.record.description],
    ['jiraEpic', match.record.jiraEpicKey],
    ['initiative', match.record.initiativeName],
    ['evidenceExcerpt', match.record.evidenceExcerpt]
  ].filter(([, value]) => value !== null && value !== '').map(([field]) => field);
  return {
    source: {
      id: match.source.id,
      title: match.source.title,
      type: match.source.type,
      sourceKind: match.source.sourceKind,
      date: match.source.date,
      createdAt: match.source.createdAt
    },
    recordIndex: match.recordIndex,
    matchedExternalKey: match.record.externalKey,
    statusSuggestion: match.record.canonicalStatus,
    suggestionFields,
    trustLabel: 'Source suggestion — not accepted Evidence'
  };
}

function publicSourceRow(record) {
  return {
    externalKey: record.externalKey,
    itemTypeSuggestion: record.itemType,
    externalItemTypeSuggestion: record.externalItemType,
    summarySuggestion: record.summary,
    descriptionSuggestion: record.description,
    jiraProjectKeySuggestion: record.jiraProjectKey,
    jiraEpicKeySuggestion: record.jiraEpicKey,
    noEpicSuggestion: record.noEpic,
    initiativeNameSuggestion: record.initiativeName,
    canonicalStatusSuggestion: record.canonicalStatus,
    evidenceExcerptSuggestion: record.evidenceExcerpt,
    category: record.category
  };
}

function normalizedTriageQuery(document, resolvers, organizationId, workspaceId, query = {}, sourceIndex) {
  if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(key => !TRIAGE_QUERY_KEYS.has(key))) {
    throw invalidQuery();
  }
  const page = positiveInteger(scalarQueryValue(query, 'page'), 1);
  const pageSize = positiveInteger(scalarQueryValue(query, 'pageSize'), DEFAULT_TRIAGE_PAGE_SIZE, MAX_TRIAGE_PAGE_SIZE);
  const search = boundedQueryText(scalarQueryValue(query, 'q'), { fallback: '', max: MAX_TRIAGE_SEARCH_CHARACTERS });
  const sort = scalarQueryValue(query, 'sort') || 'triage-signals';
  const direction = scalarQueryValue(query, 'direction') || 'desc';
  if (!TRIAGE_SORT_FIELDS.includes(sort) || !['asc', 'desc'].includes(direction)) throw invalidQuery();

  const itemType = scalarQueryValue(query, 'itemType') || 'all';
  if (itemType !== 'all' && !ITEM_TYPES.has(itemType)) throw invalidQuery();

  const canonicalStatus = boundedQueryText(scalarQueryValue(query, 'canonicalStatus'), { fallback: 'all', max: 200 });
  const allowedStatuses = new Set(document.workItems
    .filter(item => item.organizationId === organizationId && item.workspaceId === workspaceId)
    .map(item => item.canonicalStatus));
  if (canonicalStatus !== 'all' && !allowedStatuses.has(canonicalStatus)) throw invalidQuery();

  const initiativeId = scalarQueryValue(query, 'initiativeId') || 'all';
  if (!['all', 'unassigned'].includes(initiativeId)) {
    resolvers.resolveWorkspaceChild('initiatives', organizationId, workspaceId, stableQueryId(initiativeId));
  }
  const workstreamId = scalarQueryValue(query, 'workstreamId') || 'all';
  if (!['all', 'none'].includes(workstreamId)) {
    resolvers.resolveWorkspaceChild('workstreams', organizationId, workspaceId, stableQueryId(workstreamId));
  }
  const jiraEpicMappingId = scalarQueryValue(query, 'jiraEpicMappingId') || 'all';
  if (!['all', 'none'].includes(jiraEpicMappingId)) {
    resolvers.resolveWorkspaceChild('jiraEpicMappings', organizationId, workspaceId, stableQueryId(jiraEpicMappingId));
  }
  const sourceId = scalarQueryValue(query, 'sourceId') || 'all';
  if (sourceId !== 'all') resolvers.resolveWorkspaceChild('sources', organizationId, workspaceId, stableQueryId(sourceId));
  const signal = scalarQueryValue(query, 'signal') || 'all';
  if (signal !== 'all' && !TRIAGE_SIGNAL_FILTERS.includes(signal)) throw invalidQuery();

  return {
    page,
    pageSize,
    search,
    sort,
    direction,
    itemType,
    canonicalStatus,
    initiativeId,
    workstreamId,
    jiraEpicMappingId,
    sourceId,
    signal,
    allowedStatuses: [...allowedStatuses].sort(compareText),
    sourceOptions: sourceIndex.sources.map(source => ({ id: source.id, title: source.title }))
  };
}

function signalMatches(signals, filter) {
  if (filter === 'all') return true;
  const keyByFilter = {
    'type-unresolved': 'typeUnresolved',
    'status-suggestion-needs-evidence': 'statusSuggestionNeedsEvidence',
    'initiative-unassigned': 'initiativeUnassigned',
    'source-trace-available': 'sourceTraceAvailable',
    'no-source-trace': 'noSourceTrace'
  };
  return signals[keyByFilter[filter]];
}

function filteredRows(rows, sourceMatchesByItem, query) {
  const search = query.search.toLocaleLowerCase('en-US');
  return rows.filter(row => {
    const matches = sourceMatchesByItem.get(row.id);
    const searchMatch = search === '' || [row.jiraKey, row.externalKey, row.summary]
      .some(value => String(value || '').toLocaleLowerCase('en-US').includes(search));
    return searchMatch &&
      (query.itemType === 'all' || row.itemType === query.itemType) &&
      (query.canonicalStatus === 'all' || row.canonicalStatus === query.canonicalStatus) &&
      (query.initiativeId === 'all' || (query.initiativeId === 'unassigned' ? row.initiativeId === null : row.initiativeId === query.initiativeId)) &&
      (query.workstreamId === 'all' || (query.workstreamId === 'none' ? row.workstreamId === null : row.workstreamId === query.workstreamId)) &&
      (query.jiraEpicMappingId === 'all' || (query.jiraEpicMappingId === 'none' ? row.jiraEpicMappingId === null : row.jiraEpicMappingId === query.jiraEpicMappingId)) &&
      (query.sourceId === 'all' || matches.some(match => match.source.id === query.sourceId)) &&
      signalMatches(row.triageSignals, query.signal);
  });
}

function sortValue(row, field) {
  const values = {
    'jira-key': row.externalKey,
    summary: row.summary,
    'item-type': row.itemType,
    'canonical-status': row.canonicalStatus,
    initiative: row.initiative?.name || 'Unassigned',
    'created-at': row.createdAt,
    'triage-signals': row.triageSignalCount
  };
  return values[field];
}

function compareSortValue(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return compareText(left, right);
}

function sortRows(rows, query) {
  const direction = query.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const primary = compareSortValue(sortValue(left, query.sort), sortValue(right, query.sort));
    if (primary !== 0) return primary * direction;
    return compareText(left.externalKey, right.externalKey) || compareText(left.id, right.id);
  });
}

function workspaceTriageSummary(rows) {
  const count = key => rows.filter(row => row.triageSignals[key]).length;
  return {
    totalWorkItems: rows.length,
    typeUnresolved: count('typeUnresolved'),
    statusSuggestionNeedsEvidence: count('statusSuggestionNeedsEvidence'),
    initiativeUnassigned: count('initiativeUnassigned'),
    sourceTraceAvailable: count('sourceTraceAvailable'),
    noSourceTrace: count('noSourceTrace')
  };
}

function buildTriageCollection(document, organizationId, workspaceId, rawQuery = {}) {
  const resolvers = createTargetResolvers(document);
  const workspace = resolvers.resolveWorkspace(organizationId, workspaceId);
  const sourceIndex = buildExactSourceIndex(document, organizationId, workspace.id);
  const query = normalizedTriageQuery(document, resolvers, organizationId, workspace.id, rawQuery, sourceIndex);
  const sourceMatchesByItem = new Map();
  const rows = document.workItems
    .filter(item => item.organizationId === organizationId && item.workspaceId === workspace.id)
    .map(item => {
      const matches = exactSourceMatches(sourceIndex, item);
      sourceMatchesByItem.set(item.id, matches);
      return triageRow(item, resolvers, matches);
    });
  const filtered = sortRows(filteredRows(rows, sourceMatchesByItem, query), query);
  const filteredTotal = filtered.length;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const offset = (page - 1) * query.pageSize;
  return {
    organizationId,
    workspaceId: workspace.id,
    summary: workspaceTriageSummary(rows),
    filteredTotal,
    items: filtered.slice(offset, offset + query.pageSize),
    pagination: {
      page,
      pageSize: query.pageSize,
      totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages
    },
    applied: {
      search: query.search,
      sort: query.sort,
      direction: query.direction,
      filters: {
        itemType: query.itemType,
        canonicalStatus: query.canonicalStatus,
        initiativeId: query.initiativeId,
        workstreamId: query.workstreamId,
        jiraEpicMappingId: query.jiraEpicMappingId,
        sourceId: query.sourceId,
        signal: query.signal
      }
    },
    filterOptions: {
      canonicalStatuses: query.allowedStatuses,
      sources: query.sourceOptions
    }
  };
}

function detailedWorkItem(workItem, resolvers) {
  return {
    id: workItem.id,
    organizationId: workItem.organizationId,
    workspaceId: workItem.workspaceId,
    jiraId: workItem.jiraId,
    jiraKey: workItem.jiraKey,
    externalKey: workItem.jiraKey || exactNormalizedKey(workItem.jiraId),
    summary: workItem.summary,
    description: workItem.description,
    itemType: workItem.itemType,
    canonicalStatus: workItem.canonicalStatus,
    currentStateProvenance: workItem.currentStateProvenance,
    currentStateConfidence: workItem.currentStateConfidence,
    initiativeId: workItem.initiativeId,
    workstreamId: workItem.workstreamId,
    jiraEpicMappingId: workItem.jiraEpicMappingId,
    ...publicStructure(workItem, resolvers),
    assignee: workItem.assignee,
    sprint: workItem.sprint,
    labels: clone(workItem.labels),
    lastCapturedCommentAt: workItem.lastCapturedCommentAt,
    archived: workItem.archived,
    createdAt: workItem.createdAt,
    updatedAt: workItem.updatedAt
  };
}

function itemAuditEvents(document, organizationId, workspaceId, workItemId) {
  return document.auditEvents
    .filter(event => event.organizationId === organizationId && event.workspaceId === workspaceId &&
      event.entityType === 'workItem' && event.entityId === workItemId)
    .sort((left, right) => compareText(right.timestamp, left.timestamp) || compareText(left.id, right.id))
    .map(event => ({
      id: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      actor: event.actor,
      timestamp: event.timestamp,
      beforeHash: event.beforeHash,
      afterHash: event.afterHash
    }));
}

function buildTriageDetail(document, organizationId, workspaceId, workItemId) {
  const resolvers = createTargetResolvers(document);
  const workspace = resolvers.resolveWorkspace(organizationId, workspaceId);
  const workItem = resolvers.resolveWorkspaceChild('workItems', organizationId, workspace.id, workItemId);
  const matches = exactSourceMatches(buildExactSourceIndex(document, organizationId, workspace.id), workItem);
  return {
    organizationId,
    workspaceId: workspace.id,
    workItem: detailedWorkItem(workItem, resolvers),
    dependencyContext: buildDependencyContext(document, resolvers, organizationId, workspace.id, workItem),
    triageSignals: triageSignals(workItem, matches),
    sourceMatches: matches.map(sourceMatchMetadata),
    auditEvents: itemAuditEvents(document, organizationId, workspace.id, workItem.id)
  };
}

function buildSourceMatchDetail(document, organizationId, workspaceId, workItemId, sourceId, rawRecordIndex) {
  const resolvers = createTargetResolvers(document);
  const workspace = resolvers.resolveWorkspace(organizationId, workspaceId);
  const workItem = resolvers.resolveWorkspaceChild('workItems', organizationId, workspace.id, workItemId);
  const source = resolvers.resolveWorkspaceChild('sources', organizationId, workspace.id, sourceId);
  const recordIndex = positiveInteger(String(rawRecordIndex), undefined, 100) - 1;
  if (!Number.isInteger(recordIndex) || recordIndex < 0) throw invalidQuery();
  const match = exactSourceMatches(buildExactSourceIndex(document, organizationId, workspace.id), workItem)
    .find(candidate => candidate.source.id === source.id && candidate.recordIndex === recordIndex);
  if (!match) throw notFound();
  return {
    organizationId,
    workspaceId: workspace.id,
    workItem: {
      id: workItem.id,
      externalKey: workItem.jiraKey || exactNormalizedKey(workItem.jiraId),
      summary: workItem.summary
    },
    source: {
      id: source.id,
      title: source.title,
      type: source.type,
      sourceKind: source.sourceKind,
      date: source.date,
      provenance: source.provenance,
      createdAt: source.createdAt
    },
    match: {
      recordIndex: match.recordIndex,
      matchedExternalKey: match.record.externalKey,
      row: publicSourceRow(match.record),
      trustLabel: 'Source suggestion — not accepted Evidence'
    }
  };
}

module.exports = {
  DEPENDENCY_CONTEXT_TRUST_LABEL,
  DEPENDENCY_REVIEW_CUES,
  DEFAULT_TRIAGE_PAGE_SIZE,
  MAX_DEPENDENCY_CONTEXT_ITEMS,
  MAX_DEPENDENCY_CONTEXT_OUTPUT_BYTES,
  MAX_TRIAGE_PAGE_SIZE,
  MAX_TRIAGE_SEARCH_CHARACTERS,
  TRIAGE_SIGNAL_FILTERS,
  TRIAGE_SORT_FIELDS,
  buildExactSourceIndex,
  buildDependencyContext,
  buildSourceMatchDetail,
  buildTriageCollection,
  buildTriageDetail,
  exactSourceMatches,
  normalizedSourceRows,
  triageSignals,
  workspaceTriageSummary
};
