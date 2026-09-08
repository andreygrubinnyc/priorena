'use strict';

const MANAGEMENT_PAGE_SIZE = 25;
const MANAGEMENT_MAX_PAGE_SIZE = 100;
const DECISION_STATUSES = Object.freeze(['draft', 'decided']);
const RISK_STATUSES = Object.freeze(['open', 'closed']);
const DECISION_KEYS = Object.freeze([
  'id', 'organizationId', 'workspaceId', 'initiativeId', 'workItemId', 'title', 'outcome',
  'rationale', 'evidenceIds', 'status', 'supersedesDecisionId', 'createdAt', 'updatedAt',
  'decidedAt', 'decidedBy'
]);
const RISK_KEYS = Object.freeze([
  'id', 'organizationId', 'workspaceId', 'initiativeId', 'workItemId', 'title', 'description',
  'responsePlan', 'owner', 'reviewOn', 'evidenceIds', 'status', 'createdAt', 'updatedAt',
  'closedAt', 'closedBy', 'closureNote'
]);

function managementStableId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new TypeError('Decision and Risk management requires stable opaque IDs');
  }
  return value;
}

function encodedId(value) {
  return encodeURIComponent(managementStableId(value));
}

function validRevision(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function responseRevision(response) {
  if (!response?.headers) return null;
  if (typeof response.headers.get === 'function') return response.headers.get('x-priorena-target-revision');
  return response.headers['x-priorena-target-revision'] || null;
}

async function responseJson(response) {
  if (response && typeof response.json === 'function') {
    const body = await response.json();
    if (response.ok === false) {
      const error = new Error(body?.error?.message || 'Decision and Risk management request failed');
      error.code = body?.error?.code || 'REQUEST_FAILED';
      throw error;
    }
    return { body, revision: responseRevision(response) };
  }
  return { body: response, revision: response?.revision || null };
}

function boundedPage(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) {
    throw new TypeError('Decision and Risk management pagination is invalid');
  }
  return candidate;
}

function managementQuery(value = {}, statuses) {
  const page = boundedPage(value.page, 1);
  const pageSize = boundedPage(value.pageSize, MANAGEMENT_PAGE_SIZE, MANAGEMENT_MAX_PAGE_SIZE);
  const status = value.status === undefined ? 'all' : value.status;
  if (status !== 'all' && !statuses.includes(status)) throw new TypeError('Decision and Risk management status is invalid');
  return { page, pageSize, status };
}

function queryString(query) {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.status !== 'all') params.set('status', query.status);
  return params.toString();
}

function createTargetDecisionRiskApiClient(options = {}) {
  if (typeof options.request !== 'function') throw new TypeError('Decision and Risk API client requires an injected request function');
  const request = options.request;
  const base = (organizationId, workspaceId) =>
    `/api/v2/organizations/${encodedId(organizationId)}/workspaces/${encodedId(workspaceId)}`;
  const read = url => request(url, { method: 'GET' }).then(responseJson);
  const write = (url, value, method = 'POST') => request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value)
  }).then(responseJson);

  return Object.freeze({
    listDecisions(organizationId, workspaceId, query = {}) {
      return read(`${base(organizationId, workspaceId)}/decisions?${queryString(managementQuery(query, DECISION_STATUSES))}`);
    },
    getDecision(organizationId, workspaceId, decisionId) {
      return read(`${base(organizationId, workspaceId)}/decisions/${encodedId(decisionId)}`);
    },
    createDecision(organizationId, workspaceId, value) {
      return write(`${base(organizationId, workspaceId)}/decisions`, value);
    },
    updateDecision(organizationId, workspaceId, decisionId, value) {
      return write(`${base(organizationId, workspaceId)}/decisions/${encodedId(decisionId)}`, value, 'PATCH');
    },
    previewDecision(organizationId, workspaceId, decisionId, value) {
      return write(`${base(organizationId, workspaceId)}/decisions/${encodedId(decisionId)}/decide/preview`, value);
    },
    decide(organizationId, workspaceId, decisionId, value) {
      return write(`${base(organizationId, workspaceId)}/decisions/${encodedId(decisionId)}/decide/apply`, value);
    },
    listRisks(organizationId, workspaceId, query = {}) {
      return read(`${base(organizationId, workspaceId)}/risks?${queryString(managementQuery(query, RISK_STATUSES))}`);
    },
    getRisk(organizationId, workspaceId, riskId) {
      return read(`${base(organizationId, workspaceId)}/risks/${encodedId(riskId)}`);
    },
    createRisk(organizationId, workspaceId, value) {
      return write(`${base(organizationId, workspaceId)}/risks`, value);
    },
    updateRisk(organizationId, workspaceId, riskId, value) {
      return write(`${base(organizationId, workspaceId)}/risks/${encodedId(riskId)}`, value, 'PATCH');
    },
    previewRiskClosure(organizationId, workspaceId, riskId, value) {
      return write(`${base(organizationId, workspaceId)}/risks/${encodedId(riskId)}/close/preview`, value);
    },
    closeRisk(organizationId, workspaceId, riskId, value) {
      return write(`${base(organizationId, workspaceId)}/risks/${encodedId(riskId)}/close/apply`, value);
    }
  });
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid`);
  const allowed = new Set(keys);
  if (Object.keys(value).length !== allowed.size || Object.keys(value).some(key => !allowed.has(key))) {
    throw new Error(`${label} has an unexpected shape`);
  }
}

function requiredString(value, maximum, label) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) throw new Error(`${label} is invalid`);
}

function nullableString(value, maximum, label) {
  if (value !== null) requiredString(value, maximum, label);
}

function nullableId(value, label) {
  if (value !== null) managementStableId(value);
  return value;
}

function validTimestamp(value) {
  if (typeof value !== 'string' || value.length > 40) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function validateRecordBase(record, organizationId, workspaceId, keys, label) {
  exactKeys(record, keys, label);
  managementStableId(record.id);
  if (record.organizationId !== organizationId || record.workspaceId !== workspaceId) {
    throw new Error(`${label} crossed its validated parent context`);
  }
  nullableId(record.initiativeId, `${label} Initiative`);
  nullableId(record.workItemId, `${label} Work Item`);
  requiredString(record.title, 500, `${label} title`);
  if (!Array.isArray(record.evidenceIds) || record.evidenceIds.length > 100 ||
      new Set(record.evidenceIds).size !== record.evidenceIds.length) throw new Error(`${label} Evidence selection is invalid`);
  record.evidenceIds.forEach(managementStableId);
  for (const timestamp of [record.createdAt, record.updatedAt]) {
    if (!validTimestamp(timestamp)) throw new Error(`${label} timestamp is invalid`);
  }
  if (Date.parse(record.updatedAt) < Date.parse(record.createdAt)) throw new Error(`${label} timestamps are inconsistent`);
}

function validateDecisionRecord(record, organizationId, workspaceId) {
  validateRecordBase(record, organizationId, workspaceId, DECISION_KEYS, 'Decision');
  if (!DECISION_STATUSES.includes(record.status)) throw new Error('Decision status is invalid');
  nullableId(record.supersedesDecisionId, 'Decision supersession');
  nullableString(record.outcome, 10_000, 'Decision outcome');
  nullableString(record.rationale, 10_000, 'Decision rationale');
  nullableString(record.decidedBy, 300, 'Decision owner');
  if (record.status === 'draft') {
    if ([record.outcome, record.rationale, record.decidedAt, record.decidedBy].some(value => value !== null)) {
      throw new Error('Draft Decision contains terminal values');
    }
  } else {
    requiredString(record.outcome, 10_000, 'Decision outcome');
    requiredString(record.rationale, 10_000, 'Decision rationale');
    requiredString(record.decidedBy, 300, 'Decision owner');
    if (record.decidedAt !== record.updatedAt || !validTimestamp(record.decidedAt)) {
      throw new Error('Decided Decision metadata is invalid');
    }
  }
  return record;
}

function validateRiskRecord(record, organizationId, workspaceId) {
  validateRecordBase(record, organizationId, workspaceId, RISK_KEYS, 'Risk');
  if (!RISK_STATUSES.includes(record.status)) throw new Error('Risk status is invalid');
  requiredString(record.description, 10_000, 'Risk description');
  nullableString(record.responsePlan, 10_000, 'Risk response plan');
  nullableString(record.owner, 300, 'Risk owner');
  if (record.reviewOn !== null && !validDate(record.reviewOn)) {
    throw new Error('Risk review date is invalid');
  }
  nullableString(record.closedBy, 300, 'Risk closure owner');
  nullableString(record.closureNote, 4_000, 'Risk closure note');
  if (record.status === 'open') {
    if ([record.closedAt, record.closedBy, record.closureNote].some(value => value !== null)) {
      throw new Error('Open Risk contains closure values');
    }
  } else {
    requiredString(record.closedBy, 300, 'Risk closure owner');
    requiredString(record.closureNote, 4_000, 'Risk closure note');
    if (record.closedAt !== record.updatedAt || !validTimestamp(record.closedAt)) {
      throw new Error('Closed Risk metadata is invalid');
    }
  }
  return record;
}

function validateManagementList(result, kind, organizationId, workspaceId) {
  const definition = kind === 'decision'
    ? { collection: 'decisions', validate: validateDecisionRecord }
    : (kind === 'risk' ? { collection: 'risks', validate: validateRiskRecord } : null);
  if (!definition || !result || !validRevision(result.revision)) throw new Error('Decision and Risk list response is invalid');
  const body = result.body;
  exactKeys(body, ['organizationId', 'workspaceId', 'page', 'pageSize', 'total', definition.collection], 'Decision and Risk list');
  if (body.organizationId !== organizationId || body.workspaceId !== workspaceId) {
    throw new Error('Decision and Risk list crossed its validated parent context');
  }
  if (!Number.isSafeInteger(body.page) || body.page < 1 || !Number.isSafeInteger(body.pageSize) ||
      body.pageSize < 1 || body.pageSize > MANAGEMENT_MAX_PAGE_SIZE || !Number.isSafeInteger(body.total) || body.total < 0) {
    throw new Error('Decision and Risk list pagination is invalid');
  }
  const records = body[definition.collection];
  if (!Array.isArray(records) || records.length > body.pageSize || records.length > body.total) {
    throw new Error('Decision and Risk list records are invalid');
  }
  records.forEach(record => definition.validate(record, organizationId, workspaceId));
  return body;
}

function validateMutationRecord(result, kind, organizationId, workspaceId) {
  if (!result || !validRevision(result.revision)) throw new Error('Decision and Risk mutation response is invalid');
  const key = kind === 'decision' ? 'decision' : (kind === 'risk' ? 'risk' : null);
  if (!key || !result.body || typeof result.body !== 'object' || Array.isArray(result.body) || !result.body[key]) {
    throw new Error('Decision and Risk mutation response is incomplete');
  }
  const bodyKeys = Object.keys(result.body);
  const ordinary = bodyKeys.length === 1 && bodyKeys[0] === key;
  const terminal = bodyKeys.length === 2 && bodyKeys.includes(key) && bodyKeys.includes('appliedPreviewHash') &&
    validRevision(result.body.appliedPreviewHash);
  if (!ordinary && !terminal) throw new Error('Decision and Risk mutation response has an unexpected shape');
  return kind === 'decision'
    ? validateDecisionRecord(result.body.decision, organizationId, workspaceId)
    : validateRiskRecord(result.body.risk, organizationId, workspaceId);
}

function validateTransitionPreview(result, kind, context, entityId, values, expectedRevision) {
  if (!['decision', 'risk'].includes(kind)) throw new Error('Decision and Risk transition kind is invalid');
  managementStableId(entityId);
  const decision = kind === 'decision';
  const valueKeys = decision ? ['outcome', 'rationale', 'decidedBy'] : ['closureNote', 'closedBy'];
  const keys = [
    'organizationId', 'workspaceId', 'entityType', 'entityId', 'action', 'currentRecordHash',
    ...valueKeys, 'expectedRevision', 'previewHash'
  ];
  const preview = result?.body?.preview;
  exactKeys(preview, keys, 'Decision and Risk transition preview');
  if (!validRevision(result.revision) || result.revision !== expectedRevision ||
      preview.expectedRevision !== expectedRevision || preview.organizationId !== context.organizationId ||
      preview.workspaceId !== context.workspaceId || preview.entityType !== kind || preview.entityId !== entityId ||
      preview.action !== (decision ? 'decide' : 'close') || !validRevision(preview.currentRecordHash) ||
      !validRevision(preview.previewHash) || valueKeys.some(key => preview[key] !== values[key])) {
    throw new Error('Decision and Risk transition preview does not match the reviewed state');
  }
  return preview;
}

function compatibleEvidence(evidence, selection, workItems) {
  if (!evidence || !selection || !Array.isArray(workItems)) return false;
  const workItem = selection.workItemId === null
    ? null
    : workItems.find(item => item.id === selection.workItemId);
  if (selection.workItemId !== null && !workItem) return false;
  if (selection.initiativeId !== null && workItem && workItem.initiativeId !== selection.initiativeId) return false;
  if (workItem && evidence.workItemId !== null && evidence.workItemId !== workItem.id) return false;
  const effectiveInitiativeId = selection.initiativeId ?? workItem?.initiativeId ?? null;
  const constrained = selection.initiativeId !== null || workItem !== null;
  if (constrained && evidence.initiativeId !== null && evidence.initiativeId !== effectiveInitiativeId) return false;
  if (constrained && evidence.workItemId !== null) {
    const evidenceWorkItem = workItems.find(item => item.id === evidence.workItemId);
    if (!evidenceWorkItem || evidenceWorkItem.initiativeId !== effectiveInitiativeId) return false;
  }
  return true;
}

function managementPage(status = 'all') {
  return { page: 1, pageSize: MANAGEMENT_PAGE_SIZE, status, total: 0, records: [], revision: null };
}

function createDecisionRiskState() {
  return {
    decisions: managementPage(),
    risks: managementPage(),
    decisionReferences: { records: [], total: 0, revision: null },
    requestId: 0
  };
}

const targetDecisionRiskApi = {
  DECISION_STATUSES,
  MANAGEMENT_MAX_PAGE_SIZE,
  MANAGEMENT_PAGE_SIZE,
  RISK_STATUSES,
  compatibleEvidence,
  createDecisionRiskState,
  createTargetDecisionRiskApiClient,
  managementQuery,
  managementStableId,
  validateDecisionRecord,
  validateManagementList,
  validateMutationRecord,
  validateRiskRecord,
  validateTransitionPreview
};

if (typeof module !== 'undefined' && module.exports) module.exports = targetDecisionRiskApi;
if (typeof window !== 'undefined') window.PriorenaTargetDecisionRisk = Object.freeze(targetDecisionRiskApi);
