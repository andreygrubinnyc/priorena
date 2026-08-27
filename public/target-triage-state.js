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
const MAX_DEPENDENCY_CONTEXT_ITEMS = 100;
const DEPENDENCY_CONTEXT_TRUST_LABEL = 'Explicit dependency links — review context, not a risk score, blocker inference, satisfaction assessment, or prioritization';
const DEPENDENCY_REVIEW_CUES = Object.freeze([
  'archived',
  'blocked-status',
  'at-risk-status',
  'unknown-status',
  'state-needs-confirmation'
]);
const REVISION_PATTERN = /^[a-f0-9]{64}$/;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys, message) {
  if (!isPlainObject(value)) throw new TypeError(message);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new TypeError(message);
  return value;
}

function boundedProjectionText(value, maximum, message, options = {}) {
  if (typeof value !== 'string' || value.length > maximum || (!options.allowEmpty && !value.trim())) {
    throw new TypeError(message);
  }
  return value;
}

function normalizedDependencyStatus(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function dependencyReviewCuesForItem(item) {
  const cues = [];
  const status = normalizedDependencyStatus(item.canonicalStatus);
  if (item.archived) cues.push('archived');
  if (status === 'blocked') cues.push('blocked-status');
  else if (['at risk', 'at-risk'].includes(status)) cues.push('at-risk-status');
  else if (status === 'unknown') cues.push('unknown-status');
  if (status !== 'unknown' && ['inferred', 'unknown'].includes(item.currentStateConfidence)) {
    cues.push('state-needs-confirmation');
  }
  return cues;
}

function compareDependencyProjectionItems(left, right) {
  const compare = (a, b) => {
    const first = String(a ?? '').toLocaleLowerCase('en-US');
    const second = String(b ?? '').toLocaleLowerCase('en-US');
    if (first < second) return -1;
    if (first > second) return 1;
    const exactFirst = String(a ?? '');
    const exactSecond = String(b ?? '');
    if (exactFirst < exactSecond) return -1;
    if (exactFirst > exactSecond) return 1;
    return 0;
  };
  return compare(left.jiraKey || left.id, right.jiraKey || right.id) ||
    compare(left.summary, right.summary) ||
    compare(left.id, right.id);
}

function validateDependencyProjectionItem(value, selectedWorkItemId, withReviewCues) {
  const keys = ['id', 'jiraKey', 'summary', 'initiative', 'canonicalStatus', 'currentStateConfidence', 'archived'];
  if (withReviewCues) keys.push('reviewCues');
  const item = exactObject(value, keys, 'Dependency context contains an invalid Work Item projection');
  triageStableId(item.id);
  if (item.id === selectedWorkItemId) throw new TypeError('Dependency context cannot contain a self-reference');
  if (item.jiraKey !== null) boundedProjectionText(item.jiraKey, 100, 'Dependency context contains an invalid Jira key');
  boundedProjectionText(item.summary, 1_000, 'Dependency context contains an invalid summary');
  boundedProjectionText(item.canonicalStatus, 200, 'Dependency context contains an invalid canonical status');
  if (!['confirmed', 'inferred', 'unknown'].includes(item.currentStateConfidence)) {
    throw new TypeError('Dependency context contains invalid confidence metadata');
  }
  if (typeof item.archived !== 'boolean') throw new TypeError('Dependency context contains an invalid archive state');
  if (item.initiative !== null) {
    exactObject(item.initiative, ['id', 'name'], 'Dependency context contains an invalid Initiative');
    triageStableId(item.initiative.id);
    boundedProjectionText(item.initiative.name, 200, 'Dependency context contains an invalid Initiative name');
  }
  if (withReviewCues) {
    if (!Array.isArray(item.reviewCues) || item.reviewCues.some(cue => !DEPENDENCY_REVIEW_CUES.includes(cue)) ||
      new Set(item.reviewCues).size !== item.reviewCues.length ||
      JSON.stringify(item.reviewCues) !== JSON.stringify(dependencyReviewCuesForItem(item))) {
      throw new TypeError('Dependency context contains invalid review cues');
    }
  }
  return item;
}

function validateDependencyGroup(value, selectedWorkItemId, withReviewCues) {
  const group = exactObject(value, ['items', 'total', 'returned', 'limit', 'truncated'], 'Dependency context contains invalid bounds');
  if (!Array.isArray(group.items) || group.limit !== MAX_DEPENDENCY_CONTEXT_ITEMS ||
    !Number.isInteger(group.total) || group.total < 0 ||
    !Number.isInteger(group.returned) || group.returned !== group.items.length ||
    group.returned < 0 || group.returned > group.limit || group.returned > group.total ||
    typeof group.truncated !== 'boolean' || group.truncated !== (group.total > group.returned)) {
    throw new TypeError('Dependency context contains invalid bounds');
  }
  group.items.forEach(item => validateDependencyProjectionItem(item, selectedWorkItemId, withReviewCues));
  if (new Set(group.items.map(item => item.id)).size !== group.items.length) {
    throw new TypeError('Dependency context contains duplicate Work Items');
  }
  const ordered = [...group.items].sort(compareDependencyProjectionItems);
  if (ordered.some((item, index) => item.id !== group.items[index].id)) {
    throw new TypeError('Dependency context is not deterministically ordered');
  }
  return group;
}

function validateDependencyContext(result, organizationId, workspaceId, workItemId) {
  triageStableId(organizationId);
  triageStableId(workspaceId);
  triageStableId(workItemId);
  if (!result || !REVISION_PATTERN.test(result.revision || '')) throw new TypeError('Dependency context revision is invalid');
  if (!isPlainObject(result.body) || result.body.organizationId !== organizationId || result.body.workspaceId !== workspaceId ||
    !isPlainObject(result.body.workItem) || result.body.workItem.id !== workItemId ||
    result.body.workItem.organizationId !== organizationId || result.body.workItem.workspaceId !== workspaceId) {
    throw new TypeError('Dependency context does not match the validated parent context');
  }
  const context = exactObject(result.body?.dependencyContext, [
    'organizationId', 'workspaceId', 'workItemId', 'trustLabel', 'listedDependencies',
    'referencingWorkItems', 'cueCounts'
  ], 'Dependency context is invalid');
  if (context.organizationId !== organizationId || context.workspaceId !== workspaceId || context.workItemId !== workItemId) {
    throw new TypeError('Dependency context does not match the validated parent context');
  }
  if (context.trustLabel !== DEPENDENCY_CONTEXT_TRUST_LABEL) throw new TypeError('Dependency context trust boundary is invalid');
  const listed = validateDependencyGroup(context.listedDependencies, workItemId, true);
  validateDependencyGroup(context.referencingWorkItems, workItemId, false);
  exactObject(context.cueCounts, DEPENDENCY_REVIEW_CUES, 'Dependency context contains invalid cue counts');
  const returnedCueCounts = Object.fromEntries(DEPENDENCY_REVIEW_CUES.map(cue => [
    cue,
    listed.items.filter(item => item.reviewCues.includes(cue)).length
  ]));
  DEPENDENCY_REVIEW_CUES.forEach(cue => {
    const count = context.cueCounts[cue];
    if (!Number.isInteger(count) || count < returnedCueCounts[cue] || count > listed.total ||
      (!listed.truncated && count !== returnedCueCounts[cue])) {
      throw new TypeError('Dependency context contains invalid cue counts');
    }
  });
  return context;
}

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
  DEPENDENCY_CONTEXT_TRUST_LABEL,
  DEPENDENCY_REVIEW_CUES,
  MAX_DEPENDENCY_CONTEXT_ITEMS,
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
  validateDependencyContext,
  validateTriageQuery
};

if (typeof module !== 'undefined' && module.exports) module.exports = targetTriageApi;
if (typeof window !== 'undefined') window.PriorenaTargetTriage = Object.freeze(targetTriageApi);
