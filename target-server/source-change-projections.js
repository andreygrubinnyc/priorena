'use strict';

const { invalidQuery, outputTooLarge } = require('./errors');
const { IMPORT_FORMATS, normalizeImportInput } = require('./import-parser');
const { createTargetResolvers } = require('./resolvers');

const MAX_CHANGE_VALUE_CHARACTERS = 300;
const MAX_SOURCE_CHANGE_OUTPUT_BYTES = 1024 * 1024;
const SOURCE_CHANGE_FIELDS = Object.freeze([
  'itemType',
  'externalItemType',
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
const SOURCE_CHANGE_STATES = Object.freeze(['added', 'removed', 'changed', 'unchanged']);

function compareText(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function publicSource(source) {
  return {
    id: source.id,
    organizationId: source.organizationId,
    workspaceId: source.workspaceId,
    title: source.title,
    type: source.type,
    sourceKind: source.sourceKind,
    date: source.date,
    createdAt: source.createdAt
  };
}

function normalizedRows(source) {
  const format = source.metadata?.capture?.format;
  if (source.sourceKind !== 'normalized-feed' || !IMPORT_FORMATS.includes(format) || typeof source.content !== 'string') {
    return { ready: false, reason: 'source-not-normalized-feed', affectedRecords: 0, records: [] };
  }
  let records;
  try {
    records = normalizeImportInput({
      format,
      content: source.content,
      source: {
        title: source.title,
        type: source.type,
        sourceKind: source.sourceKind,
        date: source.date,
        provenance: source.provenance
      }
    }).records;
  } catch (_) {
    return { ready: false, reason: 'source-invalid', affectedRecords: 0, records: [] };
  }
  const missingExternalKeys = records.filter(record => record.externalKey === null).length;
  if (missingExternalKeys > 0) {
    return { ready: false, reason: 'missing-external-key', affectedRecords: missingExternalKeys, records: [] };
  }
  const counts = new Map();
  records.forEach(record => counts.set(record.externalKey, (counts.get(record.externalKey) || 0) + 1));
  const duplicateRecords = [...counts.values()].filter(count => count > 1).reduce((total, count) => total + count, 0);
  if (duplicateRecords > 0) {
    return { ready: false, reason: 'duplicate-external-key', affectedRecords: duplicateRecords, records: [] };
  }
  return { ready: true, reason: null, affectedRecords: 0, records };
}

function comparableValue(record, field) {
  const value = record[field];
  return value === undefined ? null : value;
}

function publicValue(value) {
  if (typeof value !== 'string') return { value, truncated: false, originalCharacterCount: null };
  return {
    value: value.slice(0, MAX_CHANGE_VALUE_CHARACTERS),
    truncated: value.length > MAX_CHANGE_VALUE_CHARACTERS,
    originalCharacterCount: value.length
  };
}

function publicRecordSummary(record) {
  if (!record) return null;
  return {
    itemType: publicValue(record.itemType ?? record.externalItemType),
    summary: publicValue(record.summary),
    canonicalStatus: publicValue(record.canonicalStatus)
  };
}

function fieldChanges(baseline, current) {
  return SOURCE_CHANGE_FIELDS.filter(field => comparableValue(baseline, field) !== comparableValue(current, field)).map(field => ({
    field,
    baseline: publicValue(comparableValue(baseline, field)),
    current: publicValue(comparableValue(current, field))
  }));
}

function changeRows(baselineRecords, currentRecords) {
  const baseline = new Map(baselineRecords.map(record => [record.externalKey, record]));
  const current = new Map(currentRecords.map(record => [record.externalKey, record]));
  return [...new Set([...baseline.keys(), ...current.keys()])].sort(compareText).map(externalKey => {
    const before = baseline.get(externalKey) || null;
    const after = current.get(externalKey) || null;
    let status;
    let changes = [];
    if (before === null) status = 'added';
    else if (after === null) status = 'removed';
    else {
      changes = fieldChanges(before, after);
      status = changes.length > 0 ? 'changed' : 'unchanged';
    }
    return {
      externalKey,
      status,
      baseline: publicRecordSummary(before),
      current: publicRecordSummary(after),
      fieldChanges: changes
    };
  });
}

function emptyCounts() {
  return { added: 0, removed: 0, changed: 0, unchanged: 0 };
}

function buildSourceChangeReview(document, organizationId, workspaceId, query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query) ||
    Object.keys(query).some(key => !['baselineSourceId', 'currentSourceId'].includes(key)) ||
    typeof query.baselineSourceId !== 'string' || typeof query.currentSourceId !== 'string' ||
    query.baselineSourceId === query.currentSourceId) {
    throw invalidQuery();
  }
  const resolvers = createTargetResolvers(document);
  const workspace = resolvers.resolveWorkspace(organizationId, workspaceId);
  const baselineSource = resolvers.resolveWorkspaceChild('sources', organizationId, workspace.id, query.baselineSourceId);
  const currentSource = resolvers.resolveWorkspaceChild('sources', organizationId, workspace.id, query.currentSourceId);
  const baseline = normalizedRows(baselineSource);
  const current = normalizedRows(currentSource);
  const reasons = [
    baseline.ready ? null : { sourceRole: 'baseline', reason: baseline.reason, affectedRecords: baseline.affectedRecords },
    current.ready ? null : { sourceRole: 'current', reason: current.reason, affectedRecords: current.affectedRecords }
  ].filter(Boolean);
  const changes = reasons.length ? [] : changeRows(baseline.records, current.records);
  const counts = changes.reduce((result, change) => {
    result[change.status] += 1;
    return result;
  }, emptyCounts());
  const result = {
    organizationId,
    workspaceId: workspace.id,
    baselineSource: publicSource(baselineSource),
    currentSource: publicSource(currentSource),
    comparisonBasis: {
      identity: 'exact-external-key',
      baselinePersisted: false,
      trustLabel: 'Source comparison — not accepted Evidence or current state'
    },
    readiness: { ready: reasons.length === 0, reasons },
    counts,
    changes
  };
  if (!SOURCE_CHANGE_STATES.every(status => Number.isInteger(result.counts[status])) ||
    Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_SOURCE_CHANGE_OUTPUT_BYTES) {
    throw outputTooLarge();
  }
  return result;
}

module.exports = {
  MAX_CHANGE_VALUE_CHARACTERS,
  MAX_SOURCE_CHANGE_OUTPUT_BYTES,
  SOURCE_CHANGE_FIELDS,
  SOURCE_CHANGE_STATES,
  buildSourceChangeReview,
  changeRows,
  normalizedRows,
  publicValue
};
