'use strict';

const TRIAGE_ITEM_TYPES = Object.freeze(['Story', 'Task', 'Bug', 'Other', 'Unknown']);
const TRIAGE_SORT_FIELDS = Object.freeze([
  'jira-key', 'summary', 'item-type', 'canonical-status', 'initiative', 'created-at', 'triage-signals'
]);
const TRIAGE_SIGNALS = Object.freeze([
  'type-unresolved', 'status-suggestion-needs-evidence', 'initiative-unassigned', 'source-trace-available', 'no-source-trace'
]);
const TRIAGE_SIGNAL_LABELS = Object.freeze({
  typeUnresolved: 'Type unresolved',
  statusSuggestionNeedsEvidence: 'Status suggestion needs evidence',
  initiativeUnassigned: 'Initiative unassigned',
  sourceTraceAvailable: 'Source trace available',
  noSourceTrace: 'No Source trace'
});
const TRIAGE_QUERY_FIELDS = new Set([
  'search', 'sort', 'direction', 'page', 'pageSize', 'itemType', 'canonicalStatus', 'initiativeId',
  'workstreamId', 'jiraEpicMappingId', 'sourceId', 'signal'
]);

function triageStableId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new TypeError('Triage requires a stable opaque ID');
  }
  return value;
}

function triageEncodedId(value) {
  return encodeURIComponent(triageStableId(value));
}

function createTriageQuery() {
  return {
    search: '',
    sort: 'triage-signals',
    direction: 'desc',
    page: 1,
    pageSize: 25,
    itemType: 'all',
    canonicalStatus: 'all',
    initiativeId: 'all',
    workstreamId: 'all',
    jiraEpicMappingId: 'all',
    sourceId: 'all',
    signal: 'all'
  };
}

function validateTriageQuery(query) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw new TypeError('Triage query is invalid');
  if (Object.keys(query).some(key => !TRIAGE_QUERY_FIELDS.has(key))) throw new TypeError('Triage query is invalid');
  if (typeof query.search !== 'string' || query.search.length > 200 || /[\u0000-\u001f\u007f]/.test(query.search)) throw new TypeError('Triage search is invalid');
  if (!TRIAGE_SORT_FIELDS.includes(query.sort) || !['asc', 'desc'].includes(query.direction)) throw new TypeError('Triage sort is invalid');
  if (!Number.isInteger(query.page) || query.page < 1 || ![25, 50].includes(query.pageSize)) throw new TypeError('Triage paging is invalid');
  if (query.itemType !== 'all' && !TRIAGE_ITEM_TYPES.includes(query.itemType)) throw new TypeError('Triage type filter is invalid');
  if (typeof query.canonicalStatus !== 'string' || query.canonicalStatus.length === 0 || query.canonicalStatus.length > 200) throw new TypeError('Triage status filter is invalid');
  for (const [field, special] of [
    ['initiativeId', ['all', 'unassigned']],
    ['workstreamId', ['all', 'none']],
    ['jiraEpicMappingId', ['all', 'none']],
    ['sourceId', ['all']]
  ]) {
    if (!special.includes(query[field])) triageStableId(query[field]);
  }
  if (query.signal !== 'all' && !TRIAGE_SIGNALS.includes(query.signal)) throw new TypeError('Triage signal filter is invalid');
  return query;
}

function updateTriageQuery(current, changes, options = {}) {
  validateTriageQuery(current);
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).some(key => !TRIAGE_QUERY_FIELDS.has(key))) {
    throw new TypeError('Triage query changes are invalid');
  }
  const next = { ...current, ...changes };
  if (options.resetPage !== false && !Object.hasOwn(changes, 'page')) next.page = 1;
  return validateTriageQuery(next);
}

function clearTriageFilters(current) {
  validateTriageQuery(current);
  const defaults = createTriageQuery();
  return validateTriageQuery({
    ...defaults,
    sort: current.sort,
    direction: current.direction,
    pageSize: current.pageSize
  });
}

function triageQueryString(query) {
  validateTriageQuery(query);
  const parameters = [
    ['page', query.page],
    ['pageSize', query.pageSize],
    ['q', query.search],
    ['sort', query.sort],
    ['direction', query.direction],
    ['itemType', query.itemType],
    ['canonicalStatus', query.canonicalStatus],
    ['initiativeId', query.initiativeId],
    ['workstreamId', query.workstreamId],
    ['jiraEpicMappingId', query.jiraEpicMappingId],
    ['sourceId', query.sourceId],
    ['signal', query.signal]
  ];
  return parameters.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
}

function createTriageState() {
  return {
    query: createTriageQuery(),
    collection: null,
    detail: null,
    sourceDetail: null,
    revision: null,
    loading: false,
    requestId: 0,
    detailRequestId: 0,
    returnFocusWorkItemId: null
  };
}

function activeSignalLabels(signals) {
  if (!signals || typeof signals !== 'object' || Array.isArray(signals)) throw new TypeError('Triage signals are invalid');
  return Object.entries(TRIAGE_SIGNAL_LABELS).filter(([key]) => signals[key] === true).map(([, label]) => label);
}

async function triageResponseJson(response) {
  const body = response && typeof response.json === 'function' ? await response.json() : response;
  if (response?.ok === false) {
    const error = new Error(body?.error?.message || 'Triage request failed');
    error.code = body?.error?.code || 'REQUEST_FAILED';
    throw error;
  }
  const revision = typeof response?.headers?.get === 'function'
    ? response.headers.get('x-priorena-target-revision')
    : (response?.headers?.['x-priorena-target-revision'] || response?.revision || null);
  return { body, revision };
}

function createTargetTriageApiClient(options = {}) {
  if (typeof options.request !== 'function') throw new TypeError('Triage API client requires an injected request function');
  const request = options.request;
  const base = (organizationId, workspaceId) =>
    `/api/v2/organizations/${triageEncodedId(organizationId)}/workspaces/${triageEncodedId(workspaceId)}`;
  const read = async url => triageResponseJson(await request(url, { method: 'GET' }));
  const write = async (url, value) => triageResponseJson(await request(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value)
  }));
  return Object.freeze({
    list(organizationId, workspaceId, query) {
      return read(`${base(organizationId, workspaceId)}/work-items/triage?${triageQueryString(query)}`);
    },
    detail(organizationId, workspaceId, workItemId) {
      return read(`${base(organizationId, workspaceId)}/work-items/${triageEncodedId(workItemId)}/triage`);
    },
    sourceMatch(organizationId, workspaceId, workItemId, sourceId, recordIndex) {
      if (!Number.isInteger(recordIndex) || recordIndex < 0 || recordIndex >= 100) throw new TypeError('Source match record index is invalid');
      return read(`${base(organizationId, workspaceId)}/work-items/${triageEncodedId(workItemId)}/source-matches/${triageEncodedId(sourceId)}/${recordIndex + 1}`);
    },
    updateItemType(organizationId, workspaceId, workItemId, value) {
      if (!value || typeof value !== 'object' || !TRIAGE_ITEM_TYPES.includes(value.itemType)) throw new TypeError('Canonical Work Item type is invalid');
      return write(`${base(organizationId, workspaceId)}/work-items/${triageEncodedId(workItemId)}`, {
        expectedRevision: value.expectedRevision,
        actor: value.actor,
        changes: { itemType: value.itemType }
      });
    }
  });
}

const targetTriageApi = {
  TRIAGE_ITEM_TYPES,
  TRIAGE_SIGNALS,
  TRIAGE_SIGNAL_LABELS,
  TRIAGE_SORT_FIELDS,
  activeSignalLabels,
  clearTriageFilters,
  createTargetTriageApiClient,
  createTriageQuery,
  createTriageState,
  triageQueryString,
  triageStableId,
  updateTriageQuery,
  validateTriageQuery
};

if (typeof module !== 'undefined' && module.exports) module.exports = targetTriageApi;
if (typeof window !== 'undefined') window.PriorenaTargetTriage = Object.freeze(targetTriageApi);
