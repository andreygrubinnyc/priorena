'use strict';

const TARGET_V4_TEMPLATE = '{\n  "version": "target-v4",\n  "records": []\n}\n';
const MAX_IMPORT_BYTES = 512 * 1024;
const IMPORT_FORMATS = Object.freeze(['target-json', 'target-csv', 'structured-text']);
const IMPORT_RECORD_FIELDS = new Set([
  'externalKey', 'itemType', 'summary', 'description', 'jiraProjectKey', 'jiraEpicKey', 'noEpic',
  'requestedInitiativeId', 'initiativeName', 'canonicalStatus', 'evidenceExcerpt', 'category'
]);
const IMPORT_FIELD_LIMITS = Object.freeze({
  externalKey: 100, itemType: 200, summary: 1000, description: 4000,
  jiraProjectKey: 100, jiraEpicKey: 100, noEpic: 5, requestedInitiativeId: 160,
  initiativeName: 200, canonicalStatus: 200, evidenceExcerpt: 4000, category: 100
});
const IMPORT_VALIDATION_MESSAGES = Object.freeze({
  'cell-too-long': 'A feed cell exceeds 4,000 characters.',
  'content-too-large': 'Feed content must be 512 KiB or smaller.',
  'csv-column-count': 'CSV row has a different number of columns than the header.',
  'duplicate-csv-header': 'CSV header names must be unique.',
  'empty-structured-text': 'Structured text must contain at least one non-empty line.',
  'invalid-feed-shape': 'Feed structure or fields do not match the target-v4 contract.',
  'invalid-input': 'Choose a supported format and provide non-empty feed content.',
  'invalid-json': 'JSON feed is not valid JSON.',
  'invalid-records': 'JSON records must be an array.',
  'invalid-source': 'Complete the Source title, type, date, and provenance with supported values.',
  'jira-key-pair-required': 'jiraProjectKey and jiraEpicKey must be supplied together.',
  'malformed-csv': 'CSV contains invalid quote placement.',
  'missing-record-content': 'Record needs a summary, externalKey, or evidenceExcerpt.',
  'no-epic-conflict': 'noEpic cannot be combined with Jira Epic keys or a requested Initiative ID.',
  'too-many-records': 'Feed contains more than 100 records.',
  'unsupported-csv-header': 'CSV contains an unsupported header.',
  'unsupported-version': 'Feed version must be exactly target-v4.'
});

function buildExtractionPrompt() {
  return [
    '# Priorena target-v4 screenshot extraction instructions',
    '',
    'The screenshots remain in this separate ChatGPT conversation. Priorena does not receive screenshots, and you cannot see or apply anything inside Priorena.',
    '',
    'Extract only facts that are clearly visible in the supplied screenshots. Do not invent, guess, complete, embellish, infer from outside knowledge, or use facts from another source. Omit an unreadable field value instead of guessing it. A partial valid feed is better than an invented row.',
    '',
    'Accuracy rules:',
    '- Preserve exact visible Jira keys, statuses, dates, names, and readable excerpts.',
    '- Distinguish current information from historical information. A question, suggestion, intention, or possibility is not a decision or a current fact.',
    '- Never use proximity, similar titles, tabs, neighboring rows, or page order as proof that records are associated.',
    '- Set itemType only when that type is explicitly visible for the same Jira item.',
    '- Set jiraProjectKey and jiraEpicKey only when both values are explicitly visible for the same Jira item.',
    '- Set noEpic to true only when the same item explicitly shows no Epic, None, No Epic, Unassigned, or a clearly visible empty Epic field.',
    '- Use evidenceExcerpt only for a readable exact excerpt that supports the same record.',
    '- Do not output requestedInitiativeId or invent any Priorena Initiative, Workstream, Jira Epic mapping, Work Item, Finding, or Evidence stable ID.',
    '- A Jira item type named Feature must never become a Workstream suggestion.',
    '',
    'Output rules:',
    '- Output exactly one raw JSON object and nothing else.',
    '- Do not wrap the JSON in a Markdown fence and do not add prose before or after it.',
    '- The object must have exactly version set to "target-v4" and records set to an array.',
    '- Each record may contain only supported fields. Do not add comments or unsupported fields.',
    '- When more than 100 records are necessary, create numbered JSON files with no more than 100 records in each file.',
    '- The user will review, map, and explicitly approve records inside Priorena before applying anything.',
    '',
    'Supported record fields:',
    '- externalKey: exact visible Jira item key.',
    '- itemType: Story, Task, Bug, Other, or Unknown, only when explicitly visible for that same item.',
    '- summary: exact or faithful visible summary for the same item.',
    '- description: clearly visible supporting description.',
    '- jiraProjectKey and jiraEpicKey: paired exact keys for the same visible Jira Epic relationship.',
    '- noEpic: true only under the explicit no-Epic rule above.',
    '- initiativeName: source wording only; Priorena will not match it automatically.',
    '- canonicalStatus: exact visible status, which Priorena will treat as a suggestion requiring later review.',
    '- evidenceExcerpt: a readable exact excerpt supporting this record.',
    '- category: a short factual category such as progress, risk, dependency, decision, or note.',
    '',
    'Required shape:',
    '{',
    '  "version": "target-v4",',
    '  "records": []',
    '}',
    '',
    'Organization and Workspace context, Initiative and Workstream choices, Jira Epic mapping, Work Item creation, Finding review, and Evidence acceptance all remain explicit local Priorena decisions.'
  ].join('\n');
}

function createImportFeedState(date = new Date().toISOString().slice(0, 10)) {
  return {
    inputMethod: 'upload',
    filename: null,
    format: 'target-json',
    content: '',
    sourceTitle: '',
    sourceDate: date,
    provenance: 'Prepared outside Priorena and reviewed locally',
    capabilities: null,
    capabilitiesRevision: null,
    validationPreview: null,
    rowDrafts: new Map(),
    rowFilter: 'all',
    includeSource: false,
    finalPreview: null,
    acknowledgedPreviewHash: null,
    outcome: null,
    applying: false,
    fileReadToken: 0
  };
}

function importValidationMessage(error) {
  if (error?.code !== 'IMPORT_VALIDATION_FAILED') return error?.message || 'Import validation failed.';
  const validation = error.validation;
  if (!validation || typeof validation !== 'object') return 'Import feed validation failed.';
  const recordIndex = Number.isInteger(validation.recordIndex) && validation.recordIndex >= 0 && validation.recordIndex < 100
    ? validation.recordIndex
    : null;
  const scope = recordIndex === null ? '' : `Record ${recordIndex + 1}: `;
  if (validation.reason === 'field-too-long') {
    const limit = IMPORT_FIELD_LIMITS[validation.field];
    return limit
      ? `${scope.slice(0, -2)}, ${validation.field}: use ${limit.toLocaleString('en-US')} characters or fewer.`
      : `${scope}a field exceeds its character limit.`;
  }
  if (validation.reason === 'invalid-field') {
    const field = IMPORT_RECORD_FIELDS.has(validation.field) ? validation.field : null;
    return field === null
      ? `${scope}enter a supported field value in the required format.`
      : `${scope.slice(0, -2)}, ${field}: enter a supported value in the required format.`;
  }
  const message = IMPORT_VALIDATION_MESSAGES[validation.reason];
  return message ? `${scope}${message}` : 'Import feed validation failed.';
}

function formatForFilename(filename) {
  if (typeof filename !== 'string') throw new TypeError('A feed filename is required');
  const lowered = filename.toLocaleLowerCase('en-US');
  if (lowered.endsWith('.json')) return 'target-json';
  if (lowered.endsWith('.csv')) return 'target-csv';
  throw new TypeError('Choose a .json or .csv text feed.');
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

function sourceDescriptor(format, values) {
  if (!IMPORT_FORMATS.includes(format)) throw new TypeError('Choose an explicit import format.');
  const type = format === 'target-json' ? 'normalized-json' : (format === 'target-csv' ? 'normalized-csv' : 'external-evidence-feed');
  const sourceKind = format === 'structured-text' ? 'external-evidence-metadata' : 'normalized-feed';
  return {
    title: String(values.title || '').trim(),
    type,
    sourceKind,
    date: String(values.date || ''),
    provenance: String(values.provenance || '').trim()
  };
}

function emptyReviewDecision(recordIndex) {
  return {
    recordIndex,
    includeRecord: false,
    createWorkItem: false,
    approvedItemType: null,
    approvedSummary: null,
    approvedDescription: null,
    initiativeId: null,
    workstreamId: null,
    jiraEpicMappingId: null,
    includeFinding: false
  };
}

function createReviewDrafts(preview) {
  return new Map(preview.reviewRows.map(row => [row.recordIndex, {
    includeRecord: false,
    createWorkItem: false,
    approvedItemType: null,
    approvedSummary: row.sourceSummary || '',
    approvedDescription: row.sourceDescription || '',
    initiativeId: row.match?.initiativeId || '',
    workstreamId: row.match?.workstreamId || '',
    jiraEpicMappingId: row.match?.jiraEpicMappingId || '',
    includeFinding: false
  }]));
}

function selectedConflictCounts(preview, drafts) {
  const externalKeys = new Map();
  const workItemIds = new Map();
  preview.reviewRows.forEach(row => {
    const draft = drafts.get(row.recordIndex);
    if (!draft?.includeRecord) return;
    if (row.externalKey) externalKeys.set(row.externalKey, (externalKeys.get(row.externalKey) || 0) + 1);
    if (row.match?.workItemId) workItemIds.set(row.match.workItemId, (workItemIds.get(row.match.workItemId) || 0) + 1);
  });
  return { externalKeys, workItemIds };
}

function readinessForRow(row, draft, conflicts) {
  if (!draft?.includeRecord) return { recordIndex: row.recordIndex, state: 'excluded', messages: [], focusTarget: null };
  if (!row.supportedForApply) {
    const message = row.reviewState === 'unsupported-item-type'
      ? 'This external hierarchy type cannot create or update a Work Item.'
      : (row.duplicateReasons.includes('multiple-local-exact-matches')
          ? 'Multiple local exact matches block this record.'
          : 'This record is blocked by the existing import rules.');
    return { recordIndex: row.recordIndex, state: 'blocked', messages: [message], focusTarget: 'row' };
  }

  const messages = [];
  let focusTarget = null;
  if (row.externalKey && conflicts.externalKeys.get(row.externalKey) > 1) {
    messages.push(`Exclude all but one selected record with external key ${row.externalKey}.`);
    focusTarget ||= 'include';
  }
  if (row.match?.workItemId && conflicts.workItemIds.get(row.match.workItemId) > 1) {
    messages.push('Exclude all but one selected record resolving to this exact local Work Item.');
    focusTarget ||= 'include';
  }
  if (row.match === null && !draft.createWorkItem && !(draft.includeFinding && row.findingAvailable)) {
    messages.push('Choose an action: create a Work Item, create a pending Finding when available, or exclude this record.');
    focusTarget ||= 'create';
  }
  if (row.match === null && draft.createWorkItem) {
    if (!draft.approvedItemType) {
      messages.push('Select a Work Item type.');
      focusTarget ||= 'item-type';
    }
    if (!draft.approvedSummary?.trim()) {
      messages.push('Enter an approved summary.');
      focusTarget ||= 'summary';
    }
    if (draft.approvedDescription === null || draft.approvedDescription === undefined) {
      messages.push('Review the approved description.');
      focusTarget ||= 'description';
    }
  }
  return {
    recordIndex: row.recordIndex,
    state: messages.length > 0 ? 'needs-action' : 'ready',
    messages,
    focusTarget
  };
}

function reviewReadiness(preview, drafts) {
  const conflicts = selectedConflictCounts(preview, drafts);
  const rows = preview.reviewRows.map(row => readinessForRow(row, drafts.get(row.recordIndex), conflicts));
  const selectedRows = rows.filter(row => row.state !== 'excluded');
  return {
    valid: preview.reviewRows.filter(row => row.supportedForApply).length,
    selected: selectedRows.length,
    ready: selectedRows.filter(row => row.state === 'ready').length,
    needsAction: selectedRows.filter(row => row.state === 'needs-action').length,
    blocked: selectedRows.filter(row => row.state === 'blocked').length,
    rows,
    firstIncomplete: selectedRows.find(row => row.state === 'needs-action' || row.state === 'blocked') || null
  };
}

function canRunFinalPreview(readiness, includeSource) {
  return Boolean(includeSource && readiness.needsAction === 0 && readiness.blocked === 0);
}

function decisionForRow(row, draft) {
  if (!draft?.includeRecord) return emptyReviewDecision(row.recordIndex);
  const createWorkItem = row.match === null && Boolean(draft.createWorkItem);
  const hasWorkItem = row.match !== null || createWorkItem;
  return {
    recordIndex: row.recordIndex,
    includeRecord: true,
    createWorkItem,
    approvedItemType: createWorkItem ? draft.approvedItemType : null,
    approvedSummary: createWorkItem ? draft.approvedSummary : null,
    approvedDescription: createWorkItem ? draft.approvedDescription : null,
    initiativeId: hasWorkItem ? (draft.initiativeId || null) : null,
    workstreamId: hasWorkItem ? (draft.workstreamId || null) : null,
    jiraEpicMappingId: hasWorkItem ? (draft.jiraEpicMappingId || null) : null,
    includeFinding: Boolean(draft.includeFinding && row.findingAvailable)
  };
}

function summarizeFinalPreview(preview) {
  const count = type => preview.proposals.filter(proposal => proposal.type === type).length;
  const selectedRows = preview.reviewDecisions.filter(decision => decision.includeRecord).length;
  const blockedRows = preview.reviewRows.filter(row => !row.supportedForApply).length;
  const evidenceReassociations = preview.proposals
    .filter(proposal => proposal.type === 'work-item-assign')
    .reduce((total, proposal) => total + (proposal.payload?.evidenceChanges?.length || 0), 0);
  return {
    sources: count('source-create'),
    newWorkItems: count('work-item-create'),
    relationshipChanges: count('work-item-assign'),
    pendingFindings: count('finding-create'),
    deferredCurrentStateChanges: count('proposed-current-state-change'),
    evidenceReassociations,
    selectedRows,
    excludedRows: preview.reviewRows.length - selectedRows,
    blockedRows
  };
}

function formatLiveApplyLabel(summary) {
  const categories = [
    [summary.sources, 'Source', 'Sources'],
    [summary.newWorkItems, 'Work Item', 'Work Items'],
    [summary.relationshipChanges, 'Relationship Change', 'Relationship Changes'],
    [summary.pendingFindings, 'Pending Finding', 'Pending Findings'],
    [summary.evidenceReassociations, 'Evidence Reassociation', 'Evidence Reassociations']
  ].filter(([count]) => count > 0).map(([count, singular, plural]) => `${count} ${count === 1 ? singular : plural}`);
  const description = categories.length < 2
    ? categories[0]
    : (categories.length === 2
        ? `${categories[0]} and ${categories[1]}`
        : `${categories.slice(0, -1).join(', ')}, and ${categories.at(-1)}`);
  return `Apply ${description || 'Reviewed Changes'} to live Priorena`;
}

const targetImportFeedApi = {
  IMPORT_FORMATS,
  MAX_IMPORT_BYTES,
  TARGET_V4_TEMPLATE,
  buildExtractionPrompt,
  canRunFinalPreview,
  createImportFeedState,
  createReviewDrafts,
  decisionForRow,
  emptyReviewDecision,
  formatLiveApplyLabel,
  formatForFilename,
  importValidationMessage,
  reviewReadiness,
  sourceDescriptor,
  summarizeFinalPreview,
  utf8ByteLength
};

if (typeof module !== 'undefined' && module.exports) module.exports = targetImportFeedApi;
if (typeof window !== 'undefined') window.PriorenaTargetImportFeed = Object.freeze(targetImportFeedApi);
