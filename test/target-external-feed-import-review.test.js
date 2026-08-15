'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const test = require('node:test');

const {
  ALPHA,
  BETA,
  createTargetApiHarness,
  jsonRequest,
  persisted,
  requestApp,
  workspaceBase
} = require('../test-support/target-api-harness');

const ACTOR = 'local-external-feed-review-test';

function source(format = 'target-json', changes = {}) {
  return {
    title: 'Fictional External Feed',
    type: format === 'target-json' ? 'normalized-json' : (format === 'target-csv' ? 'normalized-csv' : 'external-evidence-feed'),
    sourceKind: format === 'structured-text' ? 'external-evidence-metadata' : 'normalized-feed',
    date: '2026-08-14',
    provenance: 'Synthetic external-feed review test.',
    ...changes
  };
}

function input(records, format = 'target-json', sourceChanges = {}) {
  return {
    format,
    content: format === 'target-json' ? JSON.stringify({ version: 'target-v4', records }) : records,
    source: source(format, sourceChanges)
  };
}

function decision(recordIndex, changes = {}) {
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
    includeFinding: false,
    ...changes
  };
}

async function finalPreview(app, context, importInput, reviewDecisions, includeSource = true) {
  return jsonRequest(app, 'POST', `${workspaceBase(context)}/imports/preview`, {
    input: importInput,
    includeSource,
    reviewDecisions
  });
}

test('strict target-v4 JSON, CSV, structured-text, field, byte, row, and cell bounds fail without writes', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const before = await fs.readFile(targetDataFile);
  const invalidInputs = [
    { ...input([]), content: '{' },
    { ...input([]), content: JSON.stringify({ version: 'target-v3', records: [] }) },
    { ...input([]), content: JSON.stringify({ version: 'target-v4', records: [], extra: true }) },
    input([{ externalKey: 'fictional-1', itemType: 'Task', summary: 'Invalid lowercase key' }]),
    input([{ externalKey: 'FICTA-1', itemType: 'Task', summary: 'Unpaired project', jiraProjectKey: 'FICTA' }]),
    input([{ externalKey: 'FICTA-2', itemType: 'Task', summary: 'Conflicting no Epic', noEpic: true, jiraProjectKey: 'FICTA', jiraEpicKey: 'FICTA-100' }]),
    input([{ externalKey: 'FICTA-3', itemType: 'Task', summary: 'Unknown field', unknown: 'blocked' }]),
    input([{ externalKey: 'FICTA-4', itemType: 'Task', summary: 'Long cell', description: 'x'.repeat(4_001) }]),
    input(Array.from({ length: 101 }, (_, index) => ({ externalKey: `FICTA-${index + 1000}`, itemType: 'Task', summary: `Fictional ${index}` }))),
    { format: 'structured-text', content: 'é'.repeat(300_000), source: source('structured-text') },
    { format: 'target-csv', content: 'externalKey,externalKey\nFICTA-1,FICTA-1', source: source('target-csv') },
    { format: 'target-csv', content: 'externalKey,unsupported\nFICTA-1,x', source: source('target-csv') },
    { format: 'target-csv', content: 'externalKey,itemType,summary\nFICTA-1,Task', source: source('target-csv') },
    { format: 'target-csv', content: 'externalKey,summary\n"FICTA-1,broken', source: source('target-csv') },
    { format: 'target-csv', content: 'externalKey,summary\nFICTA-1,foo"bar', source: source('target-csv') },
    { format: 'target-csv', content: 'externalKey,summary\r\nFICTA-1,"foo"bar', source: source('target-csv') },
    { format: 'structured-text', content: Array.from({ length: 101 }, (_, index) => `Fictional line ${index}`).join('\n'), source: source('structured-text') }
  ];
  for (const importInput of invalidInputs) {
    const response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/preview`, { input: importInput });
    assert.equal(response.status, 400, importInput.content.slice(0, 80));
    assert.deepEqual(await fs.readFile(targetDataFile), before);
  }

  const actionable = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/preview`, {
    input: { ...input([]), content: JSON.stringify({ version: 'target-v3', records: [] }) }
  });
  assert.equal(actionable.json().error.code, 'IMPORT_VALIDATION_FAILED');
  assert.deepEqual(actionable.json().error.validation, { reason: 'unsupported-version' });
  const boundedField = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/preview`, {
    input: input([{ externalKey: 'FICTA-4', itemType: 'Task', summary: 'Long cell', description: 'x'.repeat(4_001) }])
  });
  assert.deepEqual(boundedField.json().error.validation, {
    reason: 'field-too-long', recordIndex: 0, field: 'description'
  });

  const emptyJson = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/preview`, { input: input([]) });
  assert.equal(emptyJson.status, 200, emptyJson.body);
  assert.equal(emptyJson.json().preview.reviewRows.length, 0);
  const emptyCsv = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/preview`, {
    input: { format: 'target-csv', content: 'externalKey,itemType,summary', source: source('target-csv') }
  });
  assert.equal(emptyCsv.status, 200, emptyCsv.body);
  const hundred = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/preview`, {
    input: input(Array.from({ length: 100 }, (_, index) => ({ externalKey: `FICTA-${index + 2000}`, itemType: 'Task', summary: `Fictional ${index}` })))
  });
  assert.equal(hundred.status, 200, hundred.body);
  assert.equal(hundred.json().preview.reviewRows.length, 100);
  assert.deepEqual(await fs.readFile(targetDataFile), before);
});

test('review-decision fields, indexes, human creation values, and parent relationships are strict and write-free', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const before = await fs.readFile(targetDataFile);
  const importInput = input([{ externalKey: 'FICTA-700', itemType: 'Task', summary: 'Fictional candidate' }]);
  const validCreate = decision(0, {
    includeRecord: true,
    createWorkItem: true,
    approvedItemType: 'Task',
    approvedSummary: 'Human-approved fictional candidate',
    approvedDescription: ''
  });
  const cases = [
    [{ ...validCreate, unknown: true }],
    [decision(1)],
    [{ ...validCreate, approvedItemType: 'Feature' }],
    [{ ...validCreate, approvedSummary: 'x'.repeat(1_001) }],
    [{ ...validCreate, approvedDescription: 'x'.repeat(4_001) }],
    [{ ...validCreate, initiativeId: 'initiative-alpha-zero-mapping', workstreamId: 'workstream-alpha-mapped' }]
  ];
  for (const reviewDecisions of cases) {
    const response = await finalPreview(app, ALPHA, importInput, reviewDecisions);
    assert.equal(response.status, 400, response.body);
    assert.deepEqual(await fs.readFile(targetDataFile), before);
  }

  const duplicateInput = input([
    { externalKey: 'FICTA-701', itemType: 'Task', summary: 'Fictional A' },
    { externalKey: 'FICTA-702', itemType: 'Task', summary: 'Fictional B' }
  ]);
  const duplicateIndexes = await finalPreview(app, ALPHA, duplicateInput, [decision(0), decision(0)]);
  assert.equal(duplicateIndexes.status, 400);

  const foreign = await finalPreview(app, ALPHA, importInput, [{ ...validCreate, initiativeId: 'initiative-beta-private' }]);
  assert.equal(foreign.status, 404);
  assert.doesNotMatch(foreign.body, /beta|private|initiative-beta/i);

  const requestedForeign = input([{
    externalKey: 'FICTA-703', itemType: 'Task', summary: 'Foreign request', requestedInitiativeId: 'initiative-beta-private'
  }]);
  const requestedResponse = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/preview`, { input: requestedForeign });
  assert.equal(requestedResponse.status, 404);
  assert.doesNotMatch(requestedResponse.body, /beta|private|initiative-beta/i);
  assert.deepEqual(await fs.readFile(targetDataFile), before);
});

test('content, source metadata, decisions, Workspace, and revision all bind the final preview and apply selection', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const importInput = input([{ externalKey: 'FICTA-710', itemType: 'Task', summary: 'Fictional candidate' }]);
  const create = decision(0, {
    includeRecord: true,
    createWorkItem: true,
    approvedItemType: 'Task',
    approvedSummary: 'Approved A',
    approvedDescription: ''
  });
  const response = await finalPreview(app, ALPHA, importInput, [create]);
  assert.equal(response.status, 200, response.body);
  const preview = response.json().preview;
  const before = await persisted(targetDataFile);

  const changedDecision = { ...create, approvedSummary: 'Approved B' };
  let applied = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/apply`, {
    expectedRevision: before.revision,
    actor: ACTOR,
    input: importInput,
    includeSource: true,
    reviewDecisions: [changedDecision],
    previewHash: preview.previewHash,
    approvedProposalIds: preview.approvableProposalIds
  });
  assert.equal(applied.status, 409);
  assert.equal((await persisted(targetDataFile)).revision, before.revision);

  const changedSource = { ...importInput, source: { ...importInput.source, title: 'Changed fictional title' } };
  applied = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/apply`, {
    expectedRevision: before.revision,
    actor: ACTOR,
    input: changedSource,
    includeSource: true,
    reviewDecisions: [create],
    previewHash: preview.previewHash,
    approvedProposalIds: preview.approvableProposalIds
  });
  assert.equal(applied.status, 409);

  const betaPreview = await finalPreview(app, BETA, importInput, [create]);
  assert.equal(betaPreview.status, 200, betaPreview.body);
  applied = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/apply`, {
    expectedRevision: before.revision,
    actor: ACTOR,
    input: importInput,
    includeSource: true,
    reviewDecisions: [create],
    previewHash: betaPreview.json().preview.previewHash,
    approvedProposalIds: preview.approvableProposalIds
  });
  assert.equal(applied.status, 409);

  applied = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/apply`, {
    expectedRevision: before.revision,
    actor: ACTOR,
    input: importInput,
    includeSource: true,
    reviewDecisions: [create],
    previewHash: preview.previewHash,
    approvedProposalIds: preview.approvableProposalIds.slice(0, -1)
  });
  assert.equal(applied.status, 400);
  assert.equal((await persisted(targetDataFile)).revision, before.revision);

  const intervening = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/sources`, {
    expectedRevision: before.revision,
    actor: ACTOR,
    source: {
      title: 'Fictional intervening source', type: 'generic', sourceKind: 'structured-note',
      date: '2026-08-14', provenance: 'Stale-preview test.', content: 'Fictional intervening content.'
    },
    findings: []
  });
  assert.equal(intervening.status, 200, intervening.body);
  const afterIntervening = await persisted(targetDataFile);
  applied = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/apply`, {
    expectedRevision: before.revision,
    actor: ACTOR,
    input: importInput,
    includeSource: true,
    reviewDecisions: [create],
    previewHash: preview.previewHash,
    approvedProposalIds: preview.approvableProposalIds
  });
  assert.equal(applied.status, 409);
  const afterRejectedApply = await persisted(targetDataFile);
  assert.equal(afterRejectedApply.revision, afterIntervening.revision);
  assert.equal(afterRejectedApply.document.workItems.some(item => item.jiraKey === 'FICTA-710'), false);
});

test('matching never uses titles, missing keys never match, and multiple exact local matches are blocked', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, ({ document }) => {
    document.workItems[0].summary = 'Identical fictional title';
    document.workItems[0].jiraKey = 'FICTA-720';
    document.workItems[1].jiraKey = 'FICTA-720';
  });
  const before = await fs.readFile(targetDataFile);
  const fuzzy = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/preview`, {
    input: input([{ externalKey: 'FICTA-721', itemType: 'Task', summary: 'Identical fictional title' }])
  });
  assert.equal(fuzzy.status, 200, fuzzy.body);
  assert.equal(fuzzy.json().preview.reviewRows[0].match, null);
  assert.equal(fuzzy.json().preview.reviewRows[0].reviewState, 'new-record');

  const missing = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/preview`, {
    input: input([{ itemType: 'Task', summary: 'Identical fictional title' }])
  });
  assert.equal(missing.status, 200, missing.body);
  assert.equal(missing.json().preview.reviewRows[0].match, null);
  assert.equal(missing.json().preview.reviewRows[0].externalKey, null);

  const localConflict = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/preview`, {
    input: input([{ externalKey: 'FICTA-720', itemType: 'Task', summary: 'Exact conflict' }])
  });
  assert.equal(localConflict.status, 200, localConflict.body);
  assert.equal(localConflict.json().preview.reviewRows[0].supportedForApply, false);
  assert.deepEqual(localConflict.json().preview.reviewRows[0].duplicateReasons, ['multiple-local-exact-matches']);
  const rejected = await finalPreview(app, ALPHA, input([{ externalKey: 'FICTA-720', itemType: 'Task', summary: 'Exact conflict' }]), [
    decision(0, { includeRecord: true })
  ]);
  assert.equal(rejected.status, 400);
  assert.deepEqual(await fs.readFile(targetDataFile), before);
});

test('distinct feed identities resolving to one exact local Work Item cannot be included together', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, ({ document }) => {
    const item = document.workItems.find(candidate => candidate.id === 'work-item-alpha-assigned');
    item.jiraKey = 'FICTA-740';
    item.jiraId = 'FICTA-ID740';
  });
  const stored = await persisted(targetDataFile);
  const item = stored.document.workItems.find(candidate => candidate.id === 'work-item-alpha-assigned');
  const importInput = input([
    { externalKey: 'FICTA-740', itemType: 'Task', summary: 'Fictional exact key row' },
    { externalKey: 'FICTA-ID740', itemType: 'Task', summary: 'Fictional exact ID row' }
  ]);
  const initial = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/preview`, { input: importInput });
  assert.equal(initial.status, 200, initial.body);
  assert.deepEqual(initial.json().preview.reviewRows.map(row => row.duplicateReasons), [
    ['multiple-feed-rows-for-local-work-item'], ['multiple-feed-rows-for-local-work-item']
  ]);
  const includeExisting = index => decision(index, {
    includeRecord: true,
    initiativeId: item.initiativeId,
    workstreamId: item.workstreamId,
    jiraEpicMappingId: item.jiraEpicMappingId
  });
  const conflict = await finalPreview(app, ALPHA, importInput, [includeExisting(0), includeExisting(1)]);
  assert.equal(conflict.status, 400);
  const safe = await finalPreview(app, ALPHA, importInput, [includeExisting(0), decision(1)]);
  assert.equal(safe.status, 200, safe.body);
  assert.deepEqual(safe.json().preview.proposals.map(proposal => proposal.type), ['source-create']);
  assert.equal((await persisted(targetDataFile)).revision, stored.revision);
});

test('approved imports create only local Source, human-approved Work Items, pending Findings, and deferred state outcomes', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, ({ document }) => {
    const item = document.workItems.find(candidate => candidate.id === 'work-item-alpha-assigned');
    item.jiraKey = 'FICTA-730';
  });
  const before = await persisted(targetDataFile);
  const existing = before.document.workItems.find(item => item.id === 'work-item-alpha-assigned');
  const importInput = input([{
    externalKey: 'FICTA-730',
    itemType: 'Bug',
    summary: 'Feed suggestion must not overwrite current summary',
    canonicalStatus: 'Fictional changed status',
    evidenceExcerpt: 'Fictional exact status-supporting excerpt.',
    category: 'status'
  }]);
  const review = decision(0, {
    includeRecord: true,
    initiativeId: existing.initiativeId,
    workstreamId: existing.workstreamId,
    jiraEpicMappingId: existing.jiraEpicMappingId,
    includeFinding: true
  });
  const response = await finalPreview(app, ALPHA, importInput, [review]);
  assert.equal(response.status, 200, response.body);
  const preview = response.json().preview;
  assert.deepEqual(preview.proposals.map(item => item.type), ['source-create', 'finding-create', 'proposed-current-state-change']);
  assert.equal(preview.approvableProposalIds.length, 2);
  assert.equal(preview.deferredProposalIds.length, 1);

  const applied = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/apply`, {
    expectedRevision: before.revision,
    actor: ACTOR,
    input: importInput,
    includeSource: true,
    reviewDecisions: [review],
    previewHash: preview.previewHash,
    approvedProposalIds: preview.approvableProposalIds
  });
  assert.equal(applied.status, 200, applied.body);
  assert.equal(applied.json().outcome.sources.length, 1);
  assert.equal(applied.json().outcome.workItems.length, 0);
  assert.equal(applied.json().outcome.findings.length, 1);
  assert.equal(applied.json().outcome.findings[0].reviewStatus, 'pending');
  assert.equal(applied.json().outcome.deferredCurrentStateChanges.length, 1);
  const stored = await persisted(targetDataFile);
  const unchanged = stored.document.workItems.find(item => item.id === existing.id);
  assert.equal(unchanged.summary, existing.summary);
  assert.equal(unchanged.canonicalStatus, existing.canonicalStatus);
  assert.equal(stored.document.evidence.length, before.document.evidence.length);
  assert.equal(stored.document.proposedChanges.length, before.document.proposedChanges.length);
  assert.equal(stored.document.findings.at(-1).reviewStatus, 'pending');
  const serialized = JSON.stringify(stored.document);
  assert.doesNotMatch(serialized, /reviewDecisions|approvedProposalIds|approvedItemType/);
  assert.ok(stored.document.auditEvents.some(event => event.action === 'source-imported'));
  assert.ok(stored.document.auditEvents.some(event => event.action === 'finding-created-from-approved-import-proposal'));
  const repeated = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/apply`, {
    expectedRevision: before.revision,
    actor: ACTOR,
    input: importInput,
    includeSource: true,
    reviewDecisions: [review],
    previewHash: preview.previewHash,
    approvedProposalIds: preview.approvableProposalIds
  });
  assert.equal(repeated.status, 409);
  assert.equal((await persisted(targetDataFile)).revision, stored.revision);
});

test('Initiative assignment preview discloses every Evidence reassociation and apply matches it', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, ({ document }) => {
    document.workItems.find(item => item.id === 'work-item-alpha-assigned').jiraKey = 'FICTA-731';
  });
  const before = await persisted(targetDataFile);
  const importInput = input([{ externalKey: 'FICTA-731', itemType: 'Task', summary: 'Fictional existing item' }]);
  const review = decision(0, {
    includeRecord: true,
    initiativeId: 'initiative-alpha-zero-mapping'
  });
  const response = await finalPreview(app, ALPHA, importInput, [review]);
  assert.equal(response.status, 200, response.body);
  const preview = response.json().preview;
  const assignment = preview.proposals.find(proposal => proposal.type === 'work-item-assign');
  assert.deepEqual(assignment.payload.evidenceChanges, [{
    evidenceId: 'evidence-alpha-accepted',
    beforeInitiativeId: 'initiative-alpha-multiple-mappings',
    afterInitiativeId: 'initiative-alpha-zero-mapping'
  }]);

  const applied = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/apply`, {
    expectedRevision: before.revision,
    actor: ACTOR,
    input: importInput,
    includeSource: true,
    reviewDecisions: [review],
    previewHash: preview.previewHash,
    approvedProposalIds: preview.approvableProposalIds
  });
  assert.equal(applied.status, 200, applied.body);
  assert.deepEqual(applied.json().outcome.assignments[0].evidenceChanges, assignment.payload.evidenceChanges);
  const stored = await persisted(targetDataFile);
  assert.equal(stored.document.evidence.find(item => item.id === 'evidence-alpha-accepted').initiativeId,
    'initiative-alpha-zero-mapping');
});

test('evidence-only review creates a Source and pending Finding without a Work Item or accepted Evidence', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const before = await persisted(targetDataFile);
  const importInput = input([{
    evidenceExcerpt: 'Fictional exact evidence-only excerpt.',
    category: 'note'
  }]);
  const review = decision(0, { includeRecord: true, includeFinding: true });
  const response = await finalPreview(app, ALPHA, importInput, [review]);
  assert.equal(response.status, 200, response.body);
  const preview = response.json().preview;
  assert.deepEqual(preview.proposals.map(proposal => proposal.type), ['source-create', 'finding-create']);
  const applied = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/apply`, {
    expectedRevision: before.revision,
    actor: ACTOR,
    input: importInput,
    includeSource: true,
    reviewDecisions: [review],
    previewHash: preview.previewHash,
    approvedProposalIds: preview.approvableProposalIds
  });
  assert.equal(applied.status, 200, applied.body);
  assert.equal(applied.json().outcome.workItems.length, 0);
  assert.equal(applied.json().outcome.findings[0].proposedWorkItemId, null);
  assert.equal(applied.json().outcome.findings[0].reviewStatus, 'pending');
  const stored = await persisted(targetDataFile);
  assert.equal(stored.document.workItems.length, before.document.workItems.length);
  assert.equal(stored.document.evidence.length, before.document.evidence.length);
});

test('a validation failure during the atomic import write preserves every original byte', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, () => {}, {
    idFactory: () => 'work-item-alpha-assigned'
  });
  const before = await fs.readFile(targetDataFile);
  const current = await persisted(targetDataFile);
  const importInput = input([]);
  const response = await finalPreview(app, ALPHA, importInput, []);
  assert.equal(response.status, 200, response.body);
  const preview = response.json().preview;
  const applied = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/imports/apply`, {
    expectedRevision: current.revision,
    actor: ACTOR,
    input: importInput,
    includeSource: true,
    reviewDecisions: [],
    previewHash: preview.previewHash,
    approvedProposalIds: preview.approvableProposalIds
  });
  assert.equal(applied.status, 400);
  assert.deepEqual(await fs.readFile(targetDataFile), before);
});

test('Import Feed capabilities reject foreign and unknown parents with identical non-revealing responses', async t => {
  const { app } = await createTargetApiHarness(t);
  const foreign = await requestApp(app, {
    url: `/api/v2/organizations/${BETA.organizationId}/workspaces/${ALPHA.workspaceId}/imports/capabilities`
  });
  const unknown = await requestApp(app, {
    url: `/api/v2/organizations/${BETA.organizationId}/workspaces/workspace-unknown/imports/capabilities`
  });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.json(), unknown.json());
  assert.doesNotMatch(foreign.body, /alpha|sentinel|private/i);
});
