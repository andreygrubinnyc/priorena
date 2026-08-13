'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const test = require('node:test');

const { PUBLIC_ERRORS } = require('../target-server/errors');
const { milestoneTiming } = require('../target-server/projections');
const {
  ALPHA,
  BETA,
  createTargetApiHarness,
  jsonRequest,
  persisted,
  requestApp,
  workspaceBase
} = require('../test-support/target-api-harness');

const ACTOR = 'local-phase-3-review-session';

function notFoundBody() {
  return { error: { code: 'NOT_FOUND', message: PUBLIC_ERRORS.NOT_FOUND.message } };
}

function revisionOf(response) {
  return response.headers['x-priorena-target-revision'];
}

test('Scope lifecycle and optional Jira mappings are parent-scoped, independent, and audited', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  let revision = (await persisted(targetDataFile)).revision;
  let response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/scopes`, {
    expectedRevision: revision,
    actor: ACTOR,
    scope: { name: 'Fictional Release Readiness', description: 'Repository-safe Phase 3 test Scope.', owner: null }
  });
  assert.equal(response.status, 200);
  const scopeId = response.json().scope.id;
  assert.match(scopeId, /^scope-/);
  revision = revisionOf(response);

  const renamePreview = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/scopes/${scopeId}/rename/preview`, {
    name: 'Fictional Release Coordination'
  });
  assert.equal(renamePreview.status, 200);
  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/scopes/${scopeId}/rename/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    name: 'Fictional Release Coordination',
    previewHash: renamePreview.json().preview.previewHash
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().scope.id, scopeId);
  revision = revisionOf(response);

  response = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/scopes/${scopeId}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { owner: 'Fictional owner' }
  });
  assert.equal(response.status, 200);
  revision = revisionOf(response);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/scopes/${scopeId}/archive`, {
    expectedRevision: revision,
    actor: ACTOR,
    archived: true
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().scope.archived, true);
  revision = revisionOf(response);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/scopes/${scopeId}/archive`, {
    expectedRevision: revision,
    actor: ACTOR,
    archived: false
  });
  assert.equal(response.status, 200);
  revision = revisionOf(response);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/scopes/${scopeId}/jira-epic-mappings`, {
    expectedRevision: revision,
    actor: ACTOR,
    mapping: {
      jiraProjectKey: 'FICTA',
      jiraEpicKey: 'FICTA-303',
      jiraEpicName: 'Fictional Release Epic',
      mappingStatus: 'verified',
      provenance: 'Explicit fictional mapping review.',
      verifiedAt: '2026-08-11T12:00:00.000Z'
    }
  });
  assert.equal(response.status, 200);
  const mappingId = response.json().jiraEpicMapping.id;
  revision = revisionOf(response);

  response = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/scopes/${scopeId}/jira-epic-mappings/${mappingId}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { jiraEpicName: 'Fictional Renamed External Epic' }
  });
  assert.equal(response.status, 200);
  const stored = await persisted(targetDataFile);
  assert.equal(stored.document.scopes.find(scope => scope.id === scopeId).name, 'Fictional Release Coordination');
  assert.deepEqual(
    stored.document.auditEvents.slice(-7).map(event => event.action),
    ['scope-created', 'scope-renamed', 'scope-updated', 'scope-archived', 'scope-restored', 'jira-epic-mapping-created', 'jira-epic-mapping-updated']
  );

  const foreign = await jsonRequest(app, 'PATCH', `${workspaceBase(BETA)}/scopes/${scopeId}`, {
    expectedRevision: stored.revision,
    actor: ACTOR,
    changes: { description: 'Must not apply.' }
  });
  const unknown = await jsonRequest(app, 'PATCH', `${workspaceBase(BETA)}/scopes/scope-unknown`, {
    expectedRevision: stored.revision,
    actor: ACTOR,
    changes: { description: 'Must not apply.' }
  });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.json(), notFoundBody());
  assert.deepEqual(foreign.json(), unknown.json());
});

test('Jira mapping canonical identity is unique per Workspace and reusable across Organizations', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  let revision = (await persisted(targetDataFile)).revision;
  let response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/scopes/scope-alpha-zero-mapping/jira-epic-mappings`, {
    expectedRevision: revision,
    actor: ACTOR,
    mapping: {
      jiraProjectKey: 'FICTA', jiraEpicKey: 'FICTA-401', jiraEpicName: 'Fictional Alpha Mapping',
      mappingStatus: 'verified', provenance: 'Explicit review.', verifiedAt: null
    }
  });
  assert.equal(response.status, 200);
  revision = revisionOf(response);

  const duplicate = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/scopes/scope-alpha-multiple-mappings/jira-epic-mappings`, {
    expectedRevision: revision,
    actor: ACTOR,
    mapping: {
      jiraProjectKey: 'FICTA', jiraEpicKey: 'FICTA-401', jiraEpicName: 'Duplicate fictional mapping',
      mappingStatus: 'verified', provenance: 'Must fail.', verifiedAt: null
    }
  });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.json().error.code, 'INVALID_REQUEST');

  const nonCanonical = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/scopes/scope-alpha-zero-mapping/jira-epic-mappings`, {
    expectedRevision: revision,
    actor: ACTOR,
    mapping: {
      jiraProjectKey: 'ficta', jiraEpicKey: ' FICTA-402 ', jiraEpicName: 'Invalid fictional mapping',
      mappingStatus: 'pending', provenance: 'Must fail.', verifiedAt: null
    }
  });
  assert.equal(nonCanonical.status, 400);

  response = await jsonRequest(app, 'POST', `${workspaceBase(BETA)}/scopes/scope-beta-shared/jira-epic-mappings`, {
    expectedRevision: revision,
    actor: ACTOR,
    mapping: {
      jiraProjectKey: 'FICTA', jiraEpicKey: 'FICTA-401', jiraEpicName: 'Fictional Beta Mapping',
      mappingStatus: 'verified', provenance: 'Separate Organization review.', verifiedAt: null
    }
  });
  assert.equal(response.status, 200);
});

test('Work Item creation and metadata updates preserve parents and Unassigned as null', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  let revision = (await persisted(targetDataFile)).revision;
  let response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items`, {
    expectedRevision: revision,
    actor: ACTOR,
    workItem: {
      scopeId: null,
      itemType: 'Story',
      summary: 'Fictional unassigned Phase 3 item',
      canonicalStatus: 'Planned',
      currentStateProvenance: 'fictional-manual-entry',
      currentStateConfidence: 'confirmed'
    }
  });
  assert.equal(response.status, 200);
  const workItemId = response.json().workItem.id;
  assert.equal(response.json().workItem.scopeId, null);
  revision = revisionOf(response);

  response = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/work-items/${workItemId}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { summary: 'Fictional updated Phase 3 item', labels: ['fictional'], notes: 'Safe local note.' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().workItem.organizationId, ALPHA.organizationId);
  assert.equal(response.json().workItem.workspaceId, ALPHA.workspaceId);
  assert.equal(response.json().workItem.scopeId, null);
  revision = revisionOf(response);

  const attemptedParentMove = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/work-items/${workItemId}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { organizationId: BETA.organizationId }
  });
  assert.equal(attemptedParentMove.status, 400);
  assert.equal((await persisted(targetDataFile)).document.workItems.find(item => item.id === workItemId).organizationId, ALPHA.organizationId);
});

test('consequential Work Item and Follow-Up changes require exact no-write previews', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const initial = await persisted(targetDataFile);
  const initialBytes = await fs.readFile(targetDataFile);
  const itemId = 'work-item-alpha-unassigned';
  let preview = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/${itemId}/preview`, {
    action: { type: 'assign-scope', scopeId: 'scope-alpha-multiple-mappings' }
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.json().preview.before, null);
  assert.equal(preview.json().preview.after, 'scope-alpha-multiple-mappings');
  assert.deepEqual(await fs.readFile(targetDataFile), initialBytes);
  assert.equal((await persisted(targetDataFile)).revision, initial.revision);

  let unrelated = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/scopes/scope-alpha-zero-mapping`, {
    expectedRevision: initial.revision,
    actor: ACTOR,
    changes: { description: 'Fictional unrelated revision advance.' }
  });
  assert.equal(unrelated.status, 200);
  let revision = revisionOf(unrelated);

  let response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/${itemId}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-scope', scopeId: 'scope-alpha-multiple-mappings' },
    previewHash: preview.json().preview.previewHash
  });
  assert.equal(response.status, 409);
  assert.equal(response.json().error.code, 'PREVIEW_CONFLICT');
  assert.equal((await persisted(targetDataFile)).document.workItems.find(item => item.id === itemId).scopeId, null);

  preview = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/${itemId}/preview`, {
    action: { type: 'assign-scope', scopeId: 'scope-alpha-multiple-mappings' }
  });
  assert.equal(preview.status, 200);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/${itemId}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-scope', scopeId: 'scope-alpha-multiple-mappings' },
    previewHash: `${'0'.repeat(63)}1`
  });
  assert.equal(response.status, 409);
  assert.equal(response.json().error.code, 'PREVIEW_CONFLICT');
  assert.equal((await persisted(targetDataFile)).revision, revision);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/${itemId}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-scope', scopeId: 'scope-alpha-multiple-mappings' },
    previewHash: preview.json().preview.previewHash
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().workItem.scopeId, 'scope-alpha-multiple-mappings');
  revision = revisionOf(response);

  const followUpPreview = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/${itemId}/preview`, {
    action: {
      type: 'follow-up',
      followUp: { state: 'open', contact: 'Fictional contact', nextAction: 'Request a fictional update.', lastCapturedCommentAt: null }
    }
  });
  assert.equal(followUpPreview.status, 200);
  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/${itemId}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: {
      type: 'follow-up',
      followUp: { state: 'open', contact: 'Fictional contact', nextAction: 'Request a fictional update.', lastCapturedCommentAt: null }
    },
    previewHash: followUpPreview.json().preview.previewHash
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().workItem.followUp.state, 'open');
  assert.equal(response.json().workItem.followUp.lastCapturedCommentAt, null);
  assert.ok((await persisted(targetDataFile)).document.auditEvents.some(event => event.action === 'work-item-follow-up-applied'));
});

test('bulk Scope, Unassigned, and Sprint assignment is bounded, atomic, and stale-safe', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const ids = ['work-item-alpha-assigned', 'work-item-alpha-unassigned'];
  let before = await persisted(targetDataFile);
  let response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/bulk/preview`, {
    workItemIds: ids,
    action: { type: 'assign-sprint', sprint: 'Fictional Sprint 12' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().preview.rows.length, 2);
  assert.ok(response.json().preview.rows.every(row => row.before === null && row.after === 'Fictional Sprint 12'));
  assert.equal((await persisted(targetDataFile)).revision, before.revision);
  let preview = response.json().preview;

  const unrelated = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/scopes/scope-alpha-zero-mapping`, {
    expectedRevision: before.revision,
    actor: ACTOR,
    changes: { description: 'Fictional unrelated bulk revision advance.' }
  });
  assert.equal(unrelated.status, 200);
  let revision = revisionOf(unrelated);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/bulk/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    workItemIds: ids,
    action: { type: 'assign-sprint', sprint: 'Fictional Sprint 12' },
    previewHash: preview.previewHash
  });
  assert.equal(response.status, 409);
  assert.equal(response.json().error.code, 'PREVIEW_CONFLICT');
  assert.ok((await persisted(targetDataFile)).document.workItems.filter(item => ids.includes(item.id)).every(item => item.sprint === null));

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/bulk/preview`, {
    workItemIds: ids,
    action: { type: 'assign-sprint', sprint: 'Fictional Sprint 12' }
  });
  assert.equal(response.status, 200);
  preview = response.json().preview;
  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/bulk/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    workItemIds: ids,
    action: { type: 'assign-sprint', sprint: 'Fictional Sprint 12' },
    previewHash: preview.previewHash
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().changedCount, 2);
  revision = revisionOf(response);

  const duplicate = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/bulk/preview`, {
    workItemIds: [ids[0], ids[0]],
    action: { type: 'assign-scope', scopeId: null }
  });
  assert.equal(duplicate.status, 400);

  const mixedParent = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/bulk/preview`, {
    workItemIds: [ids[0], 'work-item-beta-assigned'],
    action: { type: 'assign-scope', scopeId: null }
  });
  assert.equal(mixedParent.status, 404);
  assert.deepEqual(mixedParent.json(), notFoundBody());

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/bulk/preview`, {
    workItemIds: ids,
    action: { type: 'assign-scope', scopeId: null }
  });
  assert.deepEqual(response.json().preview.rows.find(row => row.workItemId === ids[0]).featureChange, {
    effect: 'cleared', beforeFeatureId: 'feature-alpha-mapped', afterFeatureId: null
  });
  const stalePreview = response.json().preview;
  const individualPreview = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/${ids[1]}/preview`, {
    action: { type: 'assign-scope', scopeId: 'scope-alpha-zero-mapping' }
  });
  assert.equal(individualPreview.status, 200);
  const individualApply = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/${ids[1]}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-scope', scopeId: 'scope-alpha-zero-mapping' },
    previewHash: individualPreview.json().preview.previewHash
  });
  assert.equal(individualApply.status, 200, individualApply.body);
  revision = revisionOf(individualApply);
  const staleApply = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/bulk/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    workItemIds: ids,
    action: { type: 'assign-scope', scopeId: null },
    previewHash: stalePreview.previewHash
  });
  assert.equal(staleApply.status, 409);
  assert.equal(staleApply.json().error.code, 'PREVIEW_CONFLICT');
  const stored = await persisted(targetDataFile);
  assert.equal(stored.document.workItems.find(item => item.id === ids[0]).scopeId, 'scope-alpha-multiple-mappings');
  assert.equal(stored.document.workItems.find(item => item.id === ids[1]).scopeId, 'scope-alpha-zero-mapping');
});

test('Milestones expose applicability and deterministic pressure while enforcing explicit cross-Scope links', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, ({ document }) => {
    document.workspaces.find(workspace => workspace.id === ALPHA.workspaceId).settings.milestoneDueSoonDays = 5;
  });
  let revision = (await persisted(targetDataFile)).revision;
  let response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/milestones`, {
    expectedRevision: revision,
    actor: ACTOR,
    milestone: {
      scopeId: null,
      title: 'Fictional Workspace Review',
      date: '2026-08-20',
      status: 'Planned',
      linkedWorkItemIds: ['work-item-alpha-assigned', 'work-item-alpha-unassigned']
    }
  });
  assert.equal(response.status, 200);
  const workspaceMilestoneId = response.json().milestone.id;
  revision = revisionOf(response);

  const implicitCrossScope = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/milestones`, {
    expectedRevision: revision,
    actor: ACTOR,
    milestone: {
      scopeId: 'scope-alpha-multiple-mappings',
      title: 'Fictional Scope Review',
      date: '2026-08-21',
      status: 'Planned',
      linkedWorkItemIds: ['work-item-alpha-unassigned']
    }
  });
  assert.equal(implicitCrossScope.status, 400);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/milestones`, {
    expectedRevision: revision,
    actor: ACTOR,
    milestone: {
      scopeId: 'scope-alpha-multiple-mappings',
      title: 'Fictional Explicit Cross-Scope Review',
      date: '2026-08-21',
      status: 'Planned',
      linkedWorkItemIds: ['work-item-alpha-unassigned'],
      allowCrossScopeLinks: true
    }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().crossScopeLinksExplicitlyApproved, true);
  const scopeMilestoneId = response.json().milestone.id;
  revision = revisionOf(response);

  response = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/milestones/${scopeMilestoneId}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { status: 'At risk', notes: 'Fictional reviewed Milestone note.', allowCrossScopeLinks: true }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().milestone.status, 'At risk');

  const list = await requestApp(app, { url: `${workspaceBase(ALPHA)}/milestones` });
  const workspaceMilestone = list.json().milestones.find(item => item.id === workspaceMilestoneId);
  assert.deepEqual(workspaceMilestone.applicability, { kind: 'workspace', scopeId: null, label: 'Entire workspace' });
  assert.equal(workspaceMilestone.timing.dueSoonDays, 5);
  assert.match(workspaceMilestone.timing.pressure, /scheduled|due-soon|overdue/);
  assert.deepEqual(milestoneTiming('2026-08-10', { referenceDate: '2026-08-11', dueSoonDays: 14 }), {
    referenceDate: '2026-08-11', dueSoonDays: 14, dueInDays: -1, pressure: 'overdue'
  });

  const foreign = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/milestones`, {
    expectedRevision: revisionOf(response),
    actor: ACTOR,
    milestone: {
      scopeId: 'scope-beta-shared', title: 'Must fail', date: '2026-08-22', status: 'Planned', linkedWorkItemIds: []
    }
  });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.json(), notFoundBody());
});
