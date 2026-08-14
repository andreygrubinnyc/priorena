'use strict';

const { ITEM_TYPES } = require('../target-model/schema');
const { invalidRequest } = require('./errors');
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
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
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
    if (cell.length > MAX_IMPORT_CELL_CHARACTERS) throw invalidRequest();
  }
  if (quoted) throw invalidRequest();
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  if (rows.length === 0) throw invalidRequest();
  const headers = rows.shift();
  if (headers.length === 0 || new Set(headers).size !== headers.length || headers.some(header => !RECORD_FIELDS.includes(header))) throw invalidRequest();
  if (rows.length > MAX_IMPORT_RECORDS) throw invalidRequest();
  return rows.filter(values => values.some(Boolean)).map(values => {
    if (values.length !== headers.length) throw invalidRequest();
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]).filter(([, value]) => value !== ''));
  });
}

function rawRecords(format, content) {
  if (format === 'structured-text') {
    const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length === 0 || lines.length > MAX_IMPORT_RECORDS) throw invalidRequest();
    return lines.map(line => ({ evidenceExcerpt: line, category: 'note' }));
  }
  if (format === 'target-csv') return parseCsvRows(content);
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    throw invalidRequest();
  }
  exactKeys(parsed, ['version', 'records'], ['version', 'records']);
  if (parsed.version !== 'target-v4') throw invalidRequest();
  return requireArray(parsed.records, { min: 1, max: MAX_IMPORT_RECORDS });
}

function normalizeImportRecord(value) {
  exactKeys(value, RECORD_FIELDS);
  const externalItemType = ['Feature', 'Workstream'].includes(value.itemType) ? value.itemType : null;
  const record = {
    externalKey: value.externalKey === undefined || value.externalKey === null ? null : requireCanonicalJiraKey(value.externalKey),
    itemType: value.itemType === undefined ? 'Unknown' : (externalItemType === null ? requireEnum(value.itemType, [...ITEM_TYPES]) : null),
    externalItemType,
    summary: value.summary === undefined ? null : nullableText(value.summary, { max: 1_000 }),
    description: value.description === undefined ? '' : requireText(value.description, { allowEmpty: true, max: MAX_IMPORT_CELL_CHARACTERS }),
    jiraProjectKey: value.jiraProjectKey === undefined ? null : requireCanonicalJiraKey(value.jiraProjectKey),
    jiraEpicKey: value.jiraEpicKey === undefined ? null : requireCanonicalJiraKey(value.jiraEpicKey),
    noEpic: value.noEpic === undefined ? null : (typeof value.noEpic === 'string' ? requireEnum(value.noEpic.toLowerCase(), ['true', 'false']) === 'true' : requireBoolean(value.noEpic)),
    requestedInitiativeId: value.requestedInitiativeId === undefined ? null : nullableStableId(value.requestedInitiativeId),
    initiativeName: value.initiativeName === undefined ? null : nullableText(value.initiativeName, { max: 200 }),
    canonicalStatus: value.canonicalStatus === undefined ? null : nullableText(value.canonicalStatus, { max: 200 }),
    evidenceExcerpt: value.evidenceExcerpt === undefined ? null : nullableText(value.evidenceExcerpt, { max: MAX_IMPORT_CELL_CHARACTERS }),
    category: value.category === undefined ? 'general' : requireText(value.category, { max: 100 })
  };
  if ((record.jiraProjectKey === null) !== (record.jiraEpicKey === null)) throw invalidRequest();
  if (record.noEpic === true && (record.jiraProjectKey !== null || record.jiraEpicKey !== null || record.requestedInitiativeId !== null)) throw invalidRequest();
  if (record.summary === null && record.externalKey === null && record.evidenceExcerpt === null) throw invalidRequest();
  return record;
}

function normalizeSourceDescriptor(value) {
  exactKeys(value, ['title', 'type', 'sourceKind', 'date', 'provenance'], ['title', 'type', 'sourceKind', 'date', 'provenance']);
  return {
    title: requireText(value.title, { max: 500 }),
    type: requireEnum(value.type, SUPPORTED_SOURCE_TYPES),
    sourceKind: requireEnum(value.sourceKind, SUPPORTED_SOURCE_KINDS),
    date: requireDate(value.date),
    provenance: requireText(value.provenance, { max: 4_000 })
  };
}

function normalizeImportInput(value) {
  exactKeys(value, ['format', 'content', 'source'], ['format', 'content', 'source']);
  const format = requireEnum(value.format, IMPORT_FORMATS);
  const content = requireText(value.content, { max: MAX_IMPORT_BYTES });
  if (Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) throw invalidRequest();
  return {
    format,
    content,
    source: normalizeSourceDescriptor(value.source),
    records: rawRecords(format, content).map(normalizeImportRecord)
  };
}

function exactWorkItemForRecord(document, organizationId, workspaceId, record) {
  if (record.externalKey === null) return null;
  return document.workItems.find(item => item.organizationId === organizationId && item.workspaceId === workspaceId &&
    [item.jiraKey, item.jiraId].some(value => value !== null && value === record.externalKey)) || null;
}

function exactMappingForRecord(document, organizationId, workspaceId, record) {
  if (record.noEpic === true || record.jiraEpicKey === null) return null;
  return document.jiraEpicMappings.find(item => item.organizationId === organizationId && item.workspaceId === workspaceId &&
    item.mappingStatus !== 'inactive' && item.jiraProjectKey === record.jiraProjectKey && item.jiraEpicKey === record.jiraEpicKey);
}

function buildImportPreview(document, organizationId, workspaceId, value, revision) {
  const resolvers = createTargetResolvers(document);
  const workspace = resolvers.resolveWorkspace(organizationId, workspaceId);
  const input = normalizeImportInput(value);
  const proposals = [];
  const add = (type, index, payload, dependencies = []) => {
    const proposal = { id: proposalId(type, index, payload), type, index, payload, dependencies };
    proposals.push(proposal);
    return proposal;
  };
  const sourceProposal = add('source-create', -1, {
    ...input.source,
    format: input.format,
    contentBytes: Buffer.byteLength(input.content, 'utf8'),
    contentHash: stateHash(input.content)
  });

  input.records.forEach((record, index) => {
    if (record.externalItemType !== null) {
      add('external-item-type-review', index, {
        externalItemType: record.externalItemType,
        externalKey: record.externalKey,
        summary: record.summary,
        targetEntityType: 'Workstream',
        workstreamInference: 'none',
        requiresExplicitMapping: true
      });
      return;
    }
    const exactWorkItem = exactWorkItemForRecord(document, workspace.organizationId, workspace.id, record);
    const exactMapping = exactMappingForRecord(document, workspace.organizationId, workspace.id, record);
    let exactInitiativeId = exactMapping?.initiativeId || null;
    if (record.requestedInitiativeId !== null) {
      const requestedInitiativeId = resolvers.resolveWorkspaceChild(
        'initiatives',
        workspace.organizationId,
        workspace.id,
        record.requestedInitiativeId
      ).id;
      if (exactMapping && exactMapping.initiativeId !== requestedInitiativeId) throw invalidRequest();
      exactInitiativeId = requestedInitiativeId;
    }

    if (record.initiativeName !== null && exactInitiativeId === null && record.noEpic !== true) {
      add('initiative-reference-review', index, {
        sourceInitiativeName: record.initiativeName,
        initiativeInference: 'none',
        requiresExactInitiativeId: true
      });
    }

    if (record.jiraEpicKey !== null && exactInitiativeId === null) {
      add('jira-mapping-reference-review', index, {
        jiraProjectKey: record.jiraProjectKey,
        jiraEpicKey: record.jiraEpicKey,
        jiraEpicName: record.initiativeName || record.jiraEpicKey,
        jiraEpicMappingInference: 'none',
        requiresSettingsMapping: true
      });
    }

    let workItemProposal = null;
    if (!exactWorkItem && record.summary !== null) {
      workItemProposal = add('work-item-create', index, {
        jiraKey: record.externalKey,
        itemType: record.itemType,
        summary: record.summary,
        description: record.description,
        canonicalStatus: record.canonicalStatus || 'Unknown',
        initiativeId: null
      });
    }

    if (exactInitiativeId !== null && (
      (exactWorkItem && (
        exactWorkItem.initiativeId !== exactInitiativeId ||
        (exactMapping && exactWorkItem.jiraEpicMappingId !== exactMapping.id)
      )) || workItemProposal
    )) {
      const currentWorkstream = exactWorkItem?.workstreamId === null || exactWorkItem?.workstreamId === undefined
        ? null
        : document.workstreams.find(workstream => workstream.id === exactWorkItem.workstreamId);
      const beforeWorkstreamId = exactWorkItem?.workstreamId || null;
      const afterWorkstreamId = currentWorkstream?.initiativeId === exactInitiativeId ? currentWorkstream.id : null;
      const currentMapping = exactWorkItem?.jiraEpicMappingId === null || exactWorkItem?.jiraEpicMappingId === undefined
        ? null
        : document.jiraEpicMappings.find(mapping => mapping.id === exactWorkItem.jiraEpicMappingId);
      const afterJiraEpicMappingId = exactMapping?.id || (currentMapping?.initiativeId === exactInitiativeId ? currentMapping.id : null);
      add('work-item-assign', index, {
        workItemId: exactWorkItem?.id || null,
        workItemProposalId: workItemProposal?.id || null,
        initiativeId: exactInitiativeId,
        jiraEpicMappingId: afterJiraEpicMappingId,
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

    if (record.evidenceExcerpt !== null) {
      const finding = add('finding-create', index, {
        sourceProposalId: sourceProposal.id,
        exactExcerpt: record.evidenceExcerpt,
        category: record.category,
        proposedWorkItemId: exactWorkItem?.id || null,
        proposedWorkItemProposalId: workItemProposal?.id || null,
        proposedInitiativeId: exactInitiativeId
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

  const previewCore = {
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    format: input.format,
    proposals
  };
  return {
    ...previewCore,
    expectedRevision: revision,
    previewHash: stateHash({ previewCore, input: value, revision })
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
  normalizeImportInput,
  normalizeImportRecord,
  parseCsvRows
};
