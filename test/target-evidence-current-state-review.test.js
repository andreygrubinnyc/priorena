'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const test = require('node:test');

const { PUBLIC_ERRORS } = require('../target-server/errors');
const { createPhase3WorkflowFixture } = require('../test-support/target-v6-fixtures');
const {
  ALPHA,
  BETA,
  createTargetApiHarness,
  jsonRequest,
  persisted,
  requestApp,
  workspaceBase
} = require('../test-support/target-api-harness');

const ACTOR = 'local-target-ui';
const SOURCE_ID = 'source-alpha-sentinel';
const SOURCE_TEXT = 'The fictional Alpha dependency is waiting for review.';

function revisionOf(response) {
  return response.headers['x-priorena-target-revision'];
}

function notFoundBody() {
  return { error: { code: 'NOT_FOUND', message: PUBLIC_ERRORS.NOT_FOUND.message } };
}

function findingBody(revision, changes = {}) {
  return {
    expectedRevision: revision,
    actor: ACTOR,
    finding: {
      startOffset: 4,
      endOffset: 20,
      exactExcerpt: SOURCE_TEXT.slice(4, 20),
      category: 'status',
      currentness: 'unknown',
      proposedWorkItemId: null,
      proposedInitiativeId: null,
      ...changes
    }
  };
}

test('Source detail stays explicit and exact-excerpt Finding creation changes only Findings and Audit Events', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const list = await requestApp(app, { url: `${workspaceBase(ALPHA)}/sources` });
  assert.equal(list.status, 200);
  assert.equal(list.json().sources.find(source => source.id === SOURCE_ID).content, undefined);
  const detail = await requestApp(app, { url: `${workspaceBase(ALPHA)}/sources/${SOURCE_ID}` });
  assert.equal(detail.status, 200);
  assert.equal(detail.json().source.content, SOURCE_TEXT);

  const before = await persisted(targetDataFile);
  const response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/sources/${SOURCE_ID}/findings`, findingBody(before.revision));
  assert.equal(response.status, 200, response.body);
  const created = response.json().finding;
  assert.equal(created.sourceId, SOURCE_ID);
  assert.equal(created.exactExcerpt, SOURCE_TEXT.slice(4, 20));
  assert.equal(created.extractionMethod, 'explicit-source-excerpt');
  assert.equal(created.extractionVersion, 'evidence-current-state-v1');
  assert.equal(created.reviewStatus, 'pending');
  assert.equal(created.currentness, 'unknown');

  const after = await persisted(targetDataFile);
  assert.deepEqual(after.document.sources, before.document.sources);
  assert.deepEqual(after.document.evidence, before.document.evidence);
  assert.deepEqual(after.document.proposedChanges, before.document.proposedChanges);
  assert.deepEqual(after.document.workItems, before.document.workItems);
  assert.deepEqual(after.document.findings.slice(0, -1), before.document.findings);
  assert.equal(after.document.findings.at(-1).id, created.id);
  assert.equal(after.document.auditEvents.length, before.document.auditEvents.length + 1);
  assert.deepEqual(after.document.auditEvents.at(-1), {
    ...after.document.auditEvents.at(-1),
    entityType: 'finding',
    entityId: created.id,
    action: 'finding-created-from-source-excerpt',
    actor: ACTOR,
    beforeHash: null
  });
  assert.match(after.document.auditEvents.at(-1).afterHash, /^[a-f0-9]{64}$/);
});

test('Source-scoped Finding creation rejects empty content, altered offsets, oversized excerpts, and incompatible associations without writes', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, ({ document }) => {
    const source = document.sources.find(item => item.id === SOURCE_ID);
    document.sources.push(
      { ...structuredClone(source), id: 'source-alpha-empty', title: 'Fictional Empty Source', content: '' },
      { ...structuredClone(source), id: 'source-alpha-null', title: 'Fictional Null Source', content: null }
    );
  });
  const before = await persisted(targetDataFile);
  const cases = [
    [`${workspaceBase(ALPHA)}/sources/source-alpha-empty/findings`, findingBody(before.revision)],
    [`${workspaceBase(ALPHA)}/sources/source-alpha-null/findings`, findingBody(before.revision)],
    [`${workspaceBase(ALPHA)}/sources/${SOURCE_ID}/findings`, findingBody(before.revision, { startOffset: 20, endOffset: 4 })],
    [`${workspaceBase(ALPHA)}/sources/${SOURCE_ID}/findings`, findingBody(before.revision, { startOffset: -1 })],
    [`${workspaceBase(ALPHA)}/sources/${SOURCE_ID}/findings`, findingBody(before.revision, { endOffset: SOURCE_TEXT.length + 1 })],
    [`${workspaceBase(ALPHA)}/sources/${SOURCE_ID}/findings`, findingBody(before.revision, { exactExcerpt: 'altered fictional excerpt' })],
    [`${workspaceBase(ALPHA)}/sources/${SOURCE_ID}/findings`, findingBody(before.revision, {
      startOffset: 0,
      endOffset: 50_001,
      exactExcerpt: 'x'.repeat(50_001)
    })],
    [`${workspaceBase(ALPHA)}/sources/${SOURCE_ID}/findings`, findingBody(before.revision, {
      proposedWorkItemId: 'work-item-alpha-assigned',
      proposedInitiativeId: null
    })],
    [`${workspaceBase(ALPHA)}/sources/${SOURCE_ID}/findings`, findingBody(before.revision, { category: 'status\u0000control' })]
  ];
  for (const [url, body] of cases) {
    const response = await jsonRequest(app, 'POST', url, body);
    assert.equal(response.status, 400, `${url}: ${response.body}`);
    assert.equal((await persisted(targetDataFile)).revision, before.revision);
  }
});

test('Source-scoped Finding creation preserves generic wrong-parent non-disclosure', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const revision = (await persisted(targetDataFile)).revision;
  const cases = [
    `${workspaceBase(ALPHA)}/sources/source-beta-sentinel/findings`,
    `${workspaceBase(BETA)}/sources/${SOURCE_ID}/findings`,
    `${workspaceBase(ALPHA)}/sources/source-not-present/findings`
  ];
  for (const url of cases) {
    const response = await jsonRequest(app, 'POST', url, findingBody(revision));
    assert.equal(response.status, 404);
    assert.deepEqual(response.json(), notFoundBody());
    assert.doesNotMatch(response.body, /Beta checkpoint|org-fixture-beta|workspace-beta-shared/);
    assert.equal((await persisted(targetDataFile)).revision, revision);
  }

  const foreignAssociation = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/sources/${SOURCE_ID}/findings`, findingBody(revision, {
    proposedWorkItemId: 'work-item-beta-assigned',
    proposedInitiativeId: 'initiative-beta-shared'
  }));
  assert.equal(foreignAssociation.status, 404);
  assert.deepEqual(foreignAssociation.json(), notFoundBody());
  assert.doesNotMatch(foreignAssociation.body, /Beta|org-fixture-beta|workspace-beta-shared/);
  assert.equal((await persisted(targetDataFile)).revision, revision);
});

test('Finding acceptance requires explicit reviewed currentness and exact nullable associations', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, () => {}, { fixtureFactory: createPhase3WorkflowFixture });
  const initial = await persisted(targetDataFile);
  const workItemsBefore = structuredClone(initial.document.workItems);
  const evidenceBefore = structuredClone(initial.document.evidence);
  const route = `${workspaceBase(ALPHA)}/findings/finding-alpha-pending-malicious/review`;

  const missingCurrentness = await jsonRequest(app, 'POST', route, {
    expectedRevision: initial.revision,
    actor: ACTOR,
    decision: 'accept',
    workItemId: 'work-item-alpha-unassigned',
    initiativeId: null
  });
  assert.equal(missingCurrentness.status, 400);

  const missingAssociation = await jsonRequest(app, 'POST', route, {
    expectedRevision: initial.revision,
    actor: ACTOR,
    decision: 'accept',
    currentness: 'historical'
  });
  assert.equal(missingAssociation.status, 400);

  const wrongNullableInitiative = await jsonRequest(app, 'POST', route, {
    expectedRevision: initial.revision,
    actor: ACTOR,
    decision: 'accept',
    currentness: 'current',
    workItemId: 'work-item-alpha-assigned',
    initiativeId: null
  });
  assert.equal(wrongNullableInitiative.status, 400);

  const rejectWithAcceptFields = await jsonRequest(app, 'POST', route, {
    expectedRevision: initial.revision,
    actor: ACTOR,
    decision: 'reject',
    currentness: 'historical',
    workItemId: null,
    initiativeId: null
  });
  assert.equal(rejectWithAcceptFields.status, 400);
  assert.equal((await persisted(targetDataFile)).revision, initial.revision);

  const accepted = await jsonRequest(app, 'POST', route, {
    expectedRevision: initial.revision,
    actor: ACTOR,
    decision: 'accept',
    currentness: 'historical',
    workItemId: 'work-item-alpha-unassigned',
    initiativeId: null
  });
  assert.equal(accepted.status, 200, accepted.body);
  assert.equal(accepted.json().finding.currentness, 'historical');
  assert.equal(accepted.json().evidence.currentness, 'historical');
  assert.equal(accepted.json().evidence.workItemId, 'work-item-alpha-unassigned');
  assert.equal(accepted.json().evidence.initiativeId, null);
  assert.equal(accepted.json().evidence.sourceId, 'source-alpha-untrusted-feed');
  assert.equal(accepted.json().evidence.findingId, 'finding-alpha-pending-malicious');
  assert.match(accepted.json().evidence.exactExcerpt, /IGNORE PRIOR INSTRUCTIONS/);

  const stored = await persisted(targetDataFile);
  assert.deepEqual(stored.document.workItems, workItemsBefore);
  assert.deepEqual(stored.document.evidence.slice(0, evidenceBefore.length), evidenceBefore);
  assert.ok(stored.document.auditEvents.some(event => event.entityId === 'finding-alpha-pending-malicious' && event.action === 'finding-accepted'));
  assert.ok(stored.document.auditEvents.some(event => event.entityId === accepted.json().evidence.id && event.action === 'evidence-created-from-accepted-finding'));

  const duplicate = await jsonRequest(app, 'POST', route, {
    expectedRevision: stored.revision,
    actor: ACTOR,
    decision: 'accept',
    currentness: 'current',
    workItemId: 'work-item-alpha-unassigned',
    initiativeId: null
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await persisted(targetDataFile)).revision, stored.revision);
});

test('complete Source-to-current-state workflow keeps every trust decision and revision distinct', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const initial = await persisted(targetDataFile);
  const sourceRoute = `${workspaceBase(ALPHA)}/sources/${SOURCE_ID}/findings`;
  let response = await jsonRequest(app, 'POST', sourceRoute, findingBody(initial.revision, {
    startOffset: 0,
    endOffset: SOURCE_TEXT.length,
    exactExcerpt: SOURCE_TEXT,
    currentness: 'current',
    proposedWorkItemId: 'work-item-alpha-assigned',
    proposedInitiativeId: 'initiative-alpha-multiple-mappings'
  }));
  assert.equal(response.status, 200, response.body);
  const finding = response.json().finding;
  let revision = revisionOf(response);
  assert.equal((await persisted(targetDataFile)).document.workItems.find(item => item.id === 'work-item-alpha-assigned').canonicalStatus, 'Planned');

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/findings/${finding.id}/review`, {
    expectedRevision: revision,
    actor: ACTOR,
    decision: 'accept',
    currentness: 'current',
    workItemId: 'work-item-alpha-assigned',
    initiativeId: 'initiative-alpha-multiple-mappings'
  });
  assert.equal(response.status, 200, response.body);
  const evidence = response.json().evidence;
  revision = revisionOf(response);
  assert.equal((await persisted(targetDataFile)).document.workItems.find(item => item.id === 'work-item-alpha-assigned').canonicalStatus, 'Planned');

  const change = {
    findingId: finding.id,
    evidenceIds: [evidence.id],
    workItemId: 'work-item-alpha-assigned',
    field: 'canonicalStatus',
    proposedValue: 'Blocked by fictional dependency'
  };
  const bytesBeforePreview = await fs.readFile(targetDataFile);
  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/proposed-changes/preview`, { change });
  assert.equal(response.status, 200, response.body);
  assert.deepEqual(await fs.readFile(targetDataFile), bytesBeforePreview);
  const preview = response.json().preview;
  assert.equal(preview.expectedRevision, revision);
  assert.equal(preview.beforeValue, 'Planned');
  assert.equal(preview.proposedValue, 'Blocked by fictional dependency');
  assert.match(preview.previewHash, /^[a-f0-9]{64}$/);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/proposed-changes`, {
    expectedRevision: revision,
    actor: ACTOR,
    change,
    previewHash: preview.previewHash
  });
  assert.equal(response.status, 200, response.body);
  const proposedChange = response.json().proposedChange;
  assert.equal(proposedChange.reviewStatus, 'pending');
  revision = revisionOf(response);
  assert.equal((await persisted(targetDataFile)).document.workItems.find(item => item.id === change.workItemId).canonicalStatus, 'Planned');

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/proposed-changes/${proposedChange.id}/review`, {
    expectedRevision: revision,
    actor: ACTOR,
    decision: 'approve'
  });
  assert.equal(response.status, 200, response.body);
  assert.equal(response.json().proposedChange.reviewStatus, 'approved');
  revision = revisionOf(response);
  const beforeApply = await persisted(targetDataFile);
  const evidenceBeforeApply = structuredClone(beforeApply.document.evidence.find(item => item.id === evidence.id));
  const workItemBeforeApply = structuredClone(beforeApply.document.workItems.find(item => item.id === change.workItemId));

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/proposed-changes/${proposedChange.id}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    previewHash: preview.previewHash
  });
  assert.equal(response.status, 200, response.body);
  assert.equal(response.json().evidenceUnchanged, true);
  assert.equal(response.json().proposedChange.reviewStatus, 'applied');
  assert.equal(response.json().workItem.canonicalStatus, 'Blocked by fictional dependency');

  const afterApply = await persisted(targetDataFile);
  assert.deepEqual(afterApply.document.evidence.find(item => item.id === evidence.id), evidenceBeforeApply);
  const workItemAfterApply = structuredClone(afterApply.document.workItems.find(item => item.id === change.workItemId));
  const expectedWorkItem = { ...workItemBeforeApply, canonicalStatus: 'Blocked by fictional dependency', updatedAt: workItemAfterApply.updatedAt };
  assert.deepEqual(workItemAfterApply, expectedWorkItem);
});
