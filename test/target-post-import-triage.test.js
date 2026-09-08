'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const { PUBLIC_ERRORS } = require('../target-server/errors');
const {
  DEFAULT_TRIAGE_PAGE_SIZE,
  MAX_TRIAGE_PAGE_SIZE,
  TRIAGE_SIGNAL_FILTERS,
  TRIAGE_SORT_FIELDS
} = require('../target-server/triage-projections');
const {
  activeSignalLabels,
  clearTriageFilters,
  createTargetTriageApiClient,
  createTriageQuery,
  triageQueryString,
  updateTriageQuery
} = require('../public/target-triage-state');
const {
  ALPHA,
  BETA,
  createTargetApiHarness,
  jsonRequest,
  persisted,
  requestApp,
  workspaceBase
} = require('../test-support/target-api-harness');
const { createTriageFixture } = require('../test-support/target-triage-fixtures');

const root = path.join(__dirname, '..');

function query(values = {}) {
  return new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)])).toString();
}

function triageUrl(context = ALPHA, values = {}) {
  const suffix = query(values);
  return `${workspaceBase(context)}/work-items/triage${suffix ? `?${suffix}` : ''}`;
}

async function triageHarness(t) {
  return createTargetApiHarness(t, () => {}, { fixtureFactory: createTriageFixture });
}

function revisionOf(response) {
  return response.headers['x-priorena-target-revision'];
}

function notFoundBody() {
  return { error: { code: 'NOT_FOUND', message: PUBLIC_ERRORS.NOT_FOUND.message } };
}

test('bounded triage collection derives workspace summary and deterministic search, sort, filters, and paging', async t => {
  const { app, targetDataFile } = await triageHarness(t);
  const before = await fs.readFile(targetDataFile);

  let response = await requestApp(app, { url: triageUrl() });
  assert.equal(response.status, 200, response.body);
  const initial = response.json();
  assert.equal(DEFAULT_TRIAGE_PAGE_SIZE, 25);
  assert.equal(MAX_TRIAGE_PAGE_SIZE, 100);
  assert.deepEqual(initial.summary, {
    totalWorkItems: 75,
    typeUnresolved: 16,
    statusSuggestionNeedsEvidence: 5,
    initiativeUnassigned: 26,
    sourceTraceAvailable: 23,
    noSourceTrace: 52
  });
  assert.equal(initial.filteredTotal, 75);
  assert.equal(initial.items.length, 25);
  assert.deepEqual(initial.pagination, {
    page: 1,
    pageSize: 25,
    totalPages: 3,
    hasPreviousPage: false,
    hasNextPage: true
  });

  const pageTwo = (await requestApp(app, { url: triageUrl(ALPHA, { page: 2 }) })).json();
  assert.equal(pageTwo.items.length, 25);
  assert.equal(pageTwo.pagination.page, 2);
  assert.notDeepEqual(pageTwo.items.map(item => item.id), initial.items.map(item => item.id));
  const pageThree = (await requestApp(app, { url: triageUrl(ALPHA, { page: 3 }) })).json();
  const outOfRange = (await requestApp(app, { url: triageUrl(ALPHA, { page: 999 }) })).json();
  assert.equal(outOfRange.pagination.page, 3);
  assert.equal(outOfRange.pagination.totalPages, 3);
  assert.equal(outOfRange.pagination.hasPreviousPage, true);
  assert.equal(outOfRange.pagination.hasNextPage, false);
  assert.deepEqual(outOfRange.items, pageThree.items, 'out-of-range paging uses the effective last-page offset');
  const maximum = await requestApp(app, { url: triageUrl(ALPHA, { pageSize: 100 }) });
  assert.equal(maximum.status, 200);
  assert.equal(maximum.json().items.length, 75);
  const overMaximum = await requestApp(app, { url: triageUrl(ALPHA, { pageSize: 101 }) });
  assert.equal(overMaximum.status, 400);
  assert.equal(overMaximum.json().error.code, 'INVALID_QUERY');

  const byKey = (await requestApp(app, { url: triageUrl(ALPHA, { q: 'ficta-1000' }) })).json();
  assert.deepEqual(byKey.items.map(item => item.externalKey), ['FICTA-1000']);
  const bySummary = (await requestApp(app, { url: triageUrl(ALPHA, { q: 'FICTIONAL TRIAGE ITEM 01' }) })).json();
  assert.deepEqual(bySummary.items.map(item => item.externalKey), ['FICTA-1000']);
  assert.deepEqual(
    (await requestApp(app, { url: triageUrl(ALPHA, { q: 'fictional triage item 01' }) })).json().items,
    bySummary.items
  );

  for (const sort of TRIAGE_SORT_FIELDS) {
    const first = await requestApp(app, { url: triageUrl(ALPHA, { sort, direction: 'asc', pageSize: 50 }) });
    const repeated = await requestApp(app, { url: triageUrl(ALPHA, { sort, direction: 'asc', pageSize: 50 }) });
    assert.equal(first.status, 200, `${sort}: ${first.body}`);
    assert.deepEqual(first.json().items.map(item => item.id), repeated.json().items.map(item => item.id), sort);
  }
  const summarySorted = (await requestApp(app, { url: triageUrl(ALPHA, { sort: 'summary', direction: 'asc', pageSize: 50 }) })).json();
  const tieIds = summarySorted.items.filter(item => item.summary === 'Fictional stable sort tie').map(item => item.externalKey);
  assert.deepEqual(tieIds, ['FICTA-1007', 'FICTA-1008']);

  const typeFiltered = (await requestApp(app, { url: triageUrl(ALPHA, { itemType: 'Unknown', pageSize: 50 }) })).json();
  assert.equal(typeFiltered.filteredTotal, 16);
  assert.ok(typeFiltered.items.every(item => item.itemType === 'Unknown'));
  const filteredPageDisappeared = (await requestApp(app, {
    url: triageUrl(ALPHA, { page: 3, itemType: 'Unknown', pageSize: 50 })
  })).json();
  assert.equal(filteredPageDisappeared.pagination.page, 1);
  assert.equal(filteredPageDisappeared.pagination.totalPages, 1);
  assert.deepEqual(filteredPageDisappeared.items, typeFiltered.items, 'filtering clamps a stale page to the remaining last page');
  const statusFiltered = (await requestApp(app, { url: triageUrl(ALPHA, { canonicalStatus: 'Unknown', pageSize: 50 }) })).json();
  assert.ok(statusFiltered.items.every(item => item.canonicalStatus === 'Unknown'));
  const initiativeFiltered = (await requestApp(app, { url: triageUrl(ALPHA, { initiativeId: 'unassigned', pageSize: 50 }) })).json();
  assert.equal(initiativeFiltered.filteredTotal, 26);
  assert.ok(initiativeFiltered.items.every(item => item.initiativeId === null));
  const sourceFiltered = (await requestApp(app, { url: triageUrl(ALPHA, { sourceId: 'source-triage-secondary' }) })).json();
  assert.deepEqual(new Set(sourceFiltered.items.map(item => item.externalKey)), new Set(['FICTA-901', 'FICTA-1000']));
  const workstreamFiltered = (await requestApp(app, { url: triageUrl(ALPHA, { workstreamId: 'workstream-alpha-mapped' }) })).json();
  assert.ok(workstreamFiltered.items.every(item => item.workstreamId === 'workstream-alpha-mapped'));
  const jiraFiltered = (await requestApp(app, { url: triageUrl(ALPHA, { jiraEpicMappingId: 'jira-mapping-alpha-one' }) })).json();
  assert.ok(jiraFiltered.items.every(item => item.jiraEpicMappingId === 'jira-mapping-alpha-one'));

  const signalKey = {
    'type-unresolved': 'typeUnresolved',
    'status-suggestion-needs-evidence': 'statusSuggestionNeedsEvidence',
    'initiative-unassigned': 'initiativeUnassigned',
    'source-trace-available': 'sourceTraceAvailable',
    'no-source-trace': 'noSourceTrace'
  };
  for (const signal of TRIAGE_SIGNAL_FILTERS) {
    const filtered = (await requestApp(app, { url: triageUrl(ALPHA, { signal, pageSize: 50 }) })).json();
    assert.ok(filtered.items.every(item => item.triageSignals[signalKey[signal]]), signal);
  }
  const combinedUrl = triageUrl(ALPHA, {
    itemType: 'Unknown', canonicalStatus: 'Unknown', initiativeId: 'unassigned', signal: 'source-trace-available', pageSize: 50
  });
  const combined = (await requestApp(app, { url: combinedUrl })).json();
  assert.ok(combined.filteredTotal > 0);
  assert.deepEqual(combined.items, (await requestApp(app, { url: combinedUrl })).json().items);

  const empty = (await requestApp(app, { url: triageUrl(ALPHA, { q: 'fictional-no-result-value' }) })).json();
  assert.equal(empty.filteredTotal, 0);
  assert.equal(empty.items.length, 0);
  assert.deepEqual(empty.summary, initial.summary, 'summary remains workspace-wide');
  assert.equal(empty.summary.totalWorkItems, 75);

  const serialized = JSON.stringify(initial);
  for (const omitted of ['"content"', 'relativePath', 'metadata', '<script>fictionalStatus', 'evidenceExcerptSuggestion']) {
    assert.equal(serialized.includes(omitted), false, omitted);
  }
  for (const badUrl of [
    triageUrl(ALPHA, { sort: 'arbitrary-field' }),
    triageUrl(ALPHA, { signal: 'arbitrary-signal' }),
    triageUrl(ALPHA, { itemType: 'Feature' }),
    `${triageUrl()}?page=1&page=2`,
    `${triageUrl()}?arbitraryFilter=value`
  ]) {
    const invalid = await requestApp(app, { url: badUrl });
    assert.equal(invalid.status, 400, badUrl);
    assert.equal(invalid.json().error.code, 'INVALID_QUERY', badUrl);
  }
  const foreign = await requestApp(app, { url: triageUrl({ organizationId: BETA.organizationId, workspaceId: ALPHA.workspaceId }) });
  const unknown = await requestApp(app, { url: triageUrl({ organizationId: 'org-fixture-unknown', workspaceId: ALPHA.workspaceId }) });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.json(), unknown.json());
  assert.deepEqual(foreign.json(), notFoundBody());
  assert.deepEqual(await fs.readFile(targetDataFile), before, 'all collection reads are write-free');
});

test('detail discloses only exact normalized Source matches and item-scoped Audit Events', async t => {
  const { app, targetDataFile } = await triageHarness(t);
  const before = await fs.readFile(targetDataFile);
  const beforeState = await persisted(targetDataFile);
  const detailUrl = `${workspaceBase(ALPHA)}/work-items/work-item-alpha-unassigned/triage`;
  let response = await requestApp(app, { url: detailUrl });
  assert.equal(response.status, 200, response.body);
  const detail = response.json();
  assert.equal(detail.workItem.canonicalStatus, 'Unknown');
  assert.equal(detail.workItem.currentStateConfidence, 'confirmed');
  assert.equal(detail.triageSignals.statusSuggestionNeedsEvidence, true);
  assert.deepEqual(detail.sourceMatches.map(match => match.source.id), ['source-triage-primary', 'source-triage-secondary']);
  assert.ok(detail.sourceMatches.every(match => match.matchedExternalKey === 'FICTA-901'));
  assert.ok(detail.sourceMatches.every(match => match.trustLabel === 'Source suggestion — not accepted Evidence'));
  assert.deepEqual(detail.auditEvents.map(event => event.action), [
    'work-item-metadata-reviewed',
    'work-item-created-from-approved-import-proposal'
  ]);
  assert.ok(detail.auditEvents.every(event => event.entityId === 'work-item-alpha-unassigned'));
  assert.equal(JSON.stringify(detail).includes('audit-event-alpha-proposal'), false);
  for (const omitted of ['"content"', 'relativePath', '"metadata"', 'evidenceExcerptSuggestion']) {
    assert.equal(JSON.stringify(detail).includes(omitted), false, omitted);
  }

  const singleSource = (await requestApp(app, {
    url: `${workspaceBase(ALPHA)}/work-items/work-item-triage-013/triage`
  })).json();
  assert.equal(singleSource.sourceMatches.length, 1);
  assert.equal(singleSource.sourceMatches[0].matchedExternalKey, 'FICTA-1012');
  assert.deepEqual(singleSource.auditEvents.map(event => event.entityId), ['work-item-triage-013']);

  const multi = (await requestApp(app, { url: `${workspaceBase(ALPHA)}/work-items/work-item-triage-001/triage` })).json();
  assert.deepEqual(multi.sourceMatches.map(match => match.source.id), ['source-triage-primary', 'source-triage-secondary']);
  const titleOnly = (await requestApp(app, { url: `${workspaceBase(ALPHA)}/work-items/work-item-triage-002/triage` })).json();
  assert.equal(titleOnly.workItem.externalKey, 'FICTA-1001');
  assert.equal(titleOnly.sourceMatches.length, 0, 'similar Source title text is not a match');
  const exactNotPartial = (await requestApp(app, { url: `${workspaceBase(ALPHA)}/work-items/work-item-triage-001/triage` })).json();
  assert.equal(exactNotPartial.sourceMatches.some(match => match.source.id === 'source-triage-partial-key'), false);
  const rowOrder = (await requestApp(app, { url: `${workspaceBase(ALPHA)}/work-items/work-item-triage-003/triage` })).json();
  assert.ok(rowOrder.sourceMatches.some(match => match.source.id === 'source-triage-row-order' && match.recordIndex === 0));
  assert.equal(rowOrder.sourceMatches.some(match => match.source.id === 'source-triage-malformed'), false);

  response = await requestApp(app, {
    url: `${workspaceBase(ALPHA)}/work-items/work-item-alpha-unassigned/source-matches/source-triage-primary/1`
  });
  assert.equal(response.status, 200, response.body);
  const sourceDetail = response.json();
  assert.deepEqual(Object.keys(sourceDetail.source).sort(), ['createdAt', 'date', 'id', 'provenance', 'sourceKind', 'title', 'type']);
  assert.equal(sourceDetail.match.matchedExternalKey, 'FICTA-901');
  assert.equal(sourceDetail.match.row.canonicalStatusSuggestion, '<script>fictionalStatus()</script> Awaiting review');
  assert.equal(sourceDetail.match.row.evidenceExcerptSuggestion, '<svg onload=fictional()> Fictional status wording.');
  assert.equal(sourceDetail.match.trustLabel, 'Source suggestion — not accepted Evidence');
  for (const omitted of ['"content"', 'relativePath', '"metadata"']) assert.equal(JSON.stringify(sourceDetail).includes(omitted), false);

  const foreign = await requestApp(app, {
    url: `${workspaceBase(ALPHA)}/work-items/work-item-alpha-unassigned/source-matches/source-beta-sentinel/1`
  });
  const unknown = await requestApp(app, {
    url: `${workspaceBase(ALPHA)}/work-items/work-item-alpha-unassigned/source-matches/source-unknown/1`
  });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.json(), unknown.json());

  const afterState = await persisted(targetDataFile);
  assert.deepEqual(await fs.readFile(targetDataFile), before, 'detail and explicit Source reads are write-free');
  for (const collection of ['workItems', 'sources', 'findings', 'evidence', 'proposedChanges', 'auditEvents']) {
    assert.equal(afterState.document[collection].length, beforeState.document[collection].length, collection);
  }
});

test('explicit type save reuses revision-aware schema-v6 metadata update and preserves unrelated state', async t => {
  const { app, targetDataFile } = await triageHarness(t);
  const detailResponse = await requestApp(app, { url: `${workspaceBase(ALPHA)}/work-items/work-item-alpha-unassigned/triage` });
  const before = await persisted(targetDataFile);
  const beforeItem = structuredClone(before.document.workItems.find(item => item.id === 'work-item-alpha-unassigned'));
  const beforeSources = structuredClone(before.document.sources);
  const beforeFindings = structuredClone(before.document.findings);
  const beforeEvidence = structuredClone(before.document.evidence);
  const beforeChanges = structuredClone(before.document.proposedChanges);

  let response = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/work-items/work-item-alpha-unassigned`, {
    expectedRevision: revisionOf(detailResponse),
    actor: 'fictional-triage-reviewer',
    changes: { itemType: 'Task' }
  });
  assert.equal(response.status, 200, response.body);
  assert.equal(response.json().workItem.itemType, 'Task');
  const after = await persisted(targetDataFile);
  const afterItem = after.document.workItems.find(item => item.id === beforeItem.id);
  const stableBefore = structuredClone(beforeItem);
  const stableAfter = structuredClone(afterItem);
  delete stableBefore.itemType;
  delete stableBefore.updatedAt;
  delete stableAfter.itemType;
  delete stableAfter.updatedAt;
  assert.deepEqual(stableAfter, stableBefore, 'only itemType and established updatedAt metadata change');
  assert.equal(afterItem.canonicalStatus, beforeItem.canonicalStatus);
  assert.deepEqual(
    [afterItem.initiativeId, afterItem.workstreamId, afterItem.jiraEpicMappingId],
    [beforeItem.initiativeId, beforeItem.workstreamId, beforeItem.jiraEpicMappingId]
  );
  assert.deepEqual(after.document.sources, beforeSources);
  assert.deepEqual(after.document.findings, beforeFindings);
  assert.deepEqual(after.document.evidence, beforeEvidence);
  assert.deepEqual(after.document.proposedChanges, beforeChanges);
  assert.equal(after.document.auditEvents.at(-1).action, 'work-item-metadata-updated');
  assert.equal(after.document.auditEvents.at(-1).entityId, beforeItem.id);

  const stale = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/work-items/work-item-alpha-unassigned`, {
    expectedRevision: before.revision,
    actor: 'fictional-triage-reviewer',
    changes: { itemType: 'Bug' }
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.json().error.code, 'REVISION_CONFLICT');
  const foreign = await jsonRequest(app, 'PATCH', `${workspaceBase(BETA)}/work-items/work-item-alpha-unassigned`, {
    expectedRevision: after.revision,
    actor: 'fictional-triage-reviewer',
    changes: { itemType: 'Bug' }
  });
  const unknown = await jsonRequest(app, 'PATCH', `${workspaceBase(BETA)}/work-items/work-item-unknown`, {
    expectedRevision: after.revision,
    actor: 'fictional-triage-reviewer',
    changes: { itemType: 'Bug' }
  });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.json(), unknown.json());

  const auditCount = after.document.auditEvents.length;
  response = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/work-items/work-item-alpha-unassigned`, {
    expectedRevision: after.revision,
    actor: 'fictional-triage-reviewer',
    changes: { itemType: 'Task' }
  });
  assert.equal(response.status, 200, response.body);
  assert.equal((await persisted(targetDataFile)).document.auditEvents.length, auditCount + 1, 'same-value behavior remains the existing metadata-update behavior');
});

test('triage client preserves context locally and performs no write until explicit type save', async () => {
  const requests = [];
  const response = body => ({
    ok: true,
    headers: { get: () => 'a'.repeat(64) },
    async json() { return body; }
  });
  const api = createTargetTriageApiClient({
    request: async (url, options) => {
      requests.push({ url, options });
      if (options.method === 'PATCH') return response({ workItem: { id: 'work-item-fictional', itemType: 'Task' } });
      if (url.includes('/source-matches/')) return response({ source: {}, match: {} });
      if (url.endsWith('/triage')) return response({ workItem: { id: 'work-item-fictional' }, sourceMatches: [], auditEvents: [] });
      return response({ items: [], summary: {}, pagination: {} });
    }
  });
  let current = createTriageQuery();
  current = updateTriageQuery(current, { search: '<script>fictionalQuery()</script>', itemType: 'Unknown' });
  current = updateTriageQuery(current, { sort: 'summary', direction: 'asc', page: 2 }, { resetPage: false });
  assert.equal(current.search, '<script>fictionalQuery()</script>');
  assert.equal(current.page, 2);
  assert.match(triageQueryString(current), /%3Cscript%3EfictionalQuery/);
  const filtered = clearTriageFilters(current);
  assert.equal(filtered.search, '');
  assert.equal(filtered.sort, 'summary');
  assert.equal(filtered.direction, 'asc');
  assert.equal(filtered.page, 1);
  assert.deepEqual(activeSignalLabels({ typeUnresolved: true, noSourceTrace: true }), ['Type unresolved', 'No Source trace']);

  await api.list('org-fictional', 'workspace-fictional', current);
  await api.detail('org-fictional', 'workspace-fictional', 'work-item-fictional');
  await api.sourceMatch('org-fictional', 'workspace-fictional', 'work-item-fictional', 'source-fictional', 0);
  assert.ok(requests.every(request => request.options.method === 'GET'));
  await api.updateItemType('org-fictional', 'workspace-fictional', 'work-item-fictional', {
    expectedRevision: 'a'.repeat(64), actor: 'fictional-reviewer', itemType: 'Task'
  });
  assert.equal(requests.at(-1).options.method, 'PATCH');
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), {
    expectedRevision: 'a'.repeat(64),
    actor: 'fictional-reviewer',
    changes: { itemType: 'Task' }
  });
});

test('Work Items UI uses bounded triage reads, safe text rendering, accessible detail actions, and existing structure routes', async () => {
  const client = await fs.readFile(path.join(root, 'public/target/app.js'), 'utf8');
  const stateSource = await fs.readFile(path.join(root, 'public/target-triage-state.js'), 'utf8');
  const workflowSource = await fs.readFile(path.join(root, 'public/target-workflow-state.js'), 'utf8');
  const projectionSource = await fs.readFile(path.join(root, 'target-server/triage-projections.js'), 'utf8');
  const markup = await fs.readFile(path.join(root, 'public/target/index.html'), 'utf8');
  const css = await fs.readFile(path.join(root, 'public/target/styles.css'), 'utf8');

  assert.match(client, /loadTriageCollection/);
  assert.match(client, /state\.triage\.query = triageModule\.updateTriageQuery\([\s\S]*result\.body\.pagination\.page[\s\S]*resetPage: false/);
  assert.match(client, /ensureWorkflow\(false\)/);
  assert.match(workflowSource, /options\.includeWorkItems !== false/);
  assert.match(stateSource, /\/work-items\/triage\?/);
  assert.match(stateSource, /method: 'PATCH'/);
  assert.match(client, /Save canonical type/);
  assert.match(client, /save\.disabled = type\.value === item\.itemType/);
  assert.match(client, /This is not saved yet/);
  assert.match(client, /Review structure/);
  assert.match(client, /previewBulkWorkItems/);
  assert.match(client, /applyBulkWorkItems/);
  assert.match(client, /View Source match/);
  assert.match(projectionSource, /Source suggestion — not accepted Evidence/);
  assert.match(client, /match\.trustLabel/);
  assert.match(client, /role: 'dialog'/);
  assert.match(client, /aria-modal': 'false'/);
  assert.match(client, /event\.key === 'Escape'/);
  assert.match(client, /data-open-work-item/);
  assert.match(client, /\.focus\(\)/);
  assert.match(client, /Previous Work Item page/);
  assert.match(client, /Next Work Item page/);
  assert.match(client, /textContent/);
  assert.doesNotMatch(client, /\.innerHTML\b|insertAdjacentHTML|outerHTML|document\.write/);
  assert.match(markup, /target-triage-state\.js/);
  assert.match(css, /\.triage-workspace\.detail-open/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.doesNotMatch(`${client}\n${stateSource}`, /createFinding|createEvidence|proposed-changes\/preview|canonicalStatus:\s*type\.value/);
});

test('75-item repeated triage and Source reads remain bounded and preserve the persisted fingerprint and collection counts', async t => {
  const { app, targetDataFile } = await triageHarness(t);
  const beforeBytes = await fs.readFile(targetDataFile);
  const before = await persisted(targetDataFile);
  const readUrls = [
    triageUrl(),
    triageUrl(ALPHA, { page: 2 }),
    triageUrl(ALPHA, { q: 'FICTA-1000' }),
    triageUrl(ALPHA, { signal: 'initiative-unassigned', sort: 'summary', direction: 'asc' }),
    `${workspaceBase(ALPHA)}/work-items/work-item-alpha-unassigned/triage`,
    `${workspaceBase(ALPHA)}/work-items/work-item-alpha-unassigned/source-matches/source-triage-primary/1`
  ];
  for (let iteration = 0; iteration < 3; iteration += 1) {
    for (const url of readUrls) {
      const response = await requestApp(app, { url });
      assert.equal(response.status, 200, `${url}: ${response.body}`);
      if (url.includes('/work-items/triage')) assert.ok(response.json().items.length <= 25);
    }
  }
  const after = await persisted(targetDataFile);
  assert.deepEqual(await fs.readFile(targetDataFile), beforeBytes);
  for (const collection of ['workItems', 'sources', 'findings', 'evidence', 'proposedChanges', 'auditEvents']) {
    assert.equal(after.document[collection].length, before.document[collection].length, collection);
  }
  assert.equal(after.document.schemaVersion, 6);
});
