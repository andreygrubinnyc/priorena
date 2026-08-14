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

test('Initiative lifecycle and optional Jira mappings are parent-scoped, independent, and audited', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  let revision = (await persisted(targetDataFile)).revision;
  let response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/initiatives`, {
    expectedRevision: revision,
    actor: ACTOR,
    initiative: { name: 'Fictional Release Readiness', description: 'Repository-safe Phase 3 test Initiative.', owner: null }
  });
  assert.equal(response.status, 200);
  const initiativeId = response.json().initiative.id;
  assert.match(initiativeId, /^initiative-/);
  revision = revisionOf(response);

  const renamePreview = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/initiatives/${initiativeId}/rename/preview`, {
    name: 'Fictional Release Coordination'
  });
  assert.equal(renamePreview.status, 200);
  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/initiatives/${initiativeId}/rename/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    name: 'Fictional Release Coordination',
    previewHash: renamePreview.json().preview.previewHash
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().initiative.id, initiativeId);
  revision = revisionOf(response);

  response = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/initiatives/${initiativeId}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { owner: 'Fictional owner' }
  });
  assert.equal(response.status, 200);
  revision = revisionOf(response);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/initiatives/${initiativeId}/archive`, {
    expectedRevision: revision,
    actor: ACTOR,
    archived: true
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().initiative.archived, true);
  revision = revisionOf(response);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/initiatives/${initiativeId}/archive`, {
    expectedRevision: revision,
    actor: ACTOR,
    archived: false
  });
  assert.equal(response.status, 200);
  revision = revisionOf(response);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/initiatives/${initiativeId}/jira-epic-mappings`, {
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

  const mappingRead = await requestApp(app, { url: `${workspaceBase(ALPHA)}/initiatives/${initiativeId}/jira-epic-mappings/${mappingId}` });
  assert.equal(mappingRead.status, 200);
  assert.equal(mappingRead.json().jiraEpicMapping.id, mappingId);
  const wrongInitiativeRead = await requestApp(app, { url: `${workspaceBase(ALPHA)}/initiatives/initiative-alpha-zero-mapping/jira-epic-mappings/${mappingId}` });
  assert.equal(wrongInitiativeRead.status, 404);

  response = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/initiatives/${initiativeId}/jira-epic-mappings/${mappingId}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { jiraEpicName: 'Fictional Renamed External Epic' }
  });
  assert.equal(response.status, 200);
  revision = revisionOf(response);

  response = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/initiatives/${initiativeId}/jira-epic-mappings/${mappingId}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { mappingStatus: 'inactive', verifiedAt: null }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().jiraEpicMapping.mappingStatus, 'inactive');
  const staleRevision = revision;
  revision = revisionOf(response);

  const stale = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/initiatives/${initiativeId}/jira-epic-mappings/${mappingId}`, {
    expectedRevision: staleRevision,
    actor: ACTOR,
    changes: { mappingStatus: 'verified' }
  });
  assert.equal(stale.status, 409);

  response = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/initiatives/${initiativeId}/jira-epic-mappings/${mappingId}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { mappingStatus: 'verified', verifiedAt: '2026-08-11T13:00:00.000Z' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().jiraEpicMapping.mappingStatus, 'verified');
  const stored = await persisted(targetDataFile);
  assert.equal(stored.document.initiatives.find(initiative => initiative.id === initiativeId).name, 'Fictional Release Coordination');
  assert.deepEqual(
    stored.document.auditEvents.slice(-9).map(event => event.action),
    ['initiative-created', 'initiative-renamed', 'initiative-updated', 'initiative-archived', 'initiative-restored', 'jira-epic-mapping-created', 'jira-epic-mapping-updated', 'jira-epic-mapping-updated', 'jira-epic-mapping-updated']
  );

  const foreign = await jsonRequest(app, 'PATCH', `${workspaceBase(BETA)}/initiatives/${initiativeId}`, {
    expectedRevision: stored.revision,
    actor: ACTOR,
    changes: { description: 'Must not apply.' }
  });
  const unknown = await jsonRequest(app, 'PATCH', `${workspaceBase(BETA)}/initiatives/initiative-unknown`, {
    expectedRevision: stored.revision,
    actor: ACTOR,
    changes: { description: 'Must not apply.' }
  });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.json(), notFoundBody());
  assert.deepEqual(foreign.json(), unknown.json());
});

test('Initiative archive and restore preserve stable IDs, children, Briefing references, and parent isolation', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const initiativeId = 'initiative-alpha-multiple-mappings';
  const before = await persisted(targetDataFile);
  const relatedBefore = {
    workstreams: before.document.workstreams.filter(item => item.initiativeId === initiativeId),
    jiraEpicMappings: before.document.jiraEpicMappings.filter(item => item.initiativeId === initiativeId),
    workItems: before.document.workItems.filter(item => item.initiativeId === initiativeId),
    milestones: before.document.milestones.filter(item => item.initiativeId === initiativeId),
    briefings: before.document.briefings.filter(item => item.initiativeIds.includes(initiativeId)),
    briefingVersions: before.document.briefingVersions.filter(item => item.initiativeIds.includes(initiativeId))
  };

  const missingName = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/initiatives`, {
    expectedRevision: before.revision,
    actor: ACTOR,
    initiative: { description: 'A name is required.' }
  });
  assert.equal(missingName.status, 400);
  assert.equal((await persisted(targetDataFile)).revision, before.revision);

  let response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/initiatives/${initiativeId}/archive`, {
    expectedRevision: before.revision,
    actor: ACTOR,
    archived: true
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().initiative.id, initiativeId);
  assert.equal(response.json().initiative.archived, true);
  const archivedRevision = revisionOf(response);

  const archivedList = await requestApp(app, { url: `${workspaceBase(ALPHA)}/initiatives` });
  assert.equal(archivedList.status, 200);
  assert.equal(archivedList.json().initiatives.find(item => item.id === initiativeId).archived, true);
  const archived = await persisted(targetDataFile);
  assert.deepEqual({
    workstreams: archived.document.workstreams.filter(item => item.initiativeId === initiativeId),
    jiraEpicMappings: archived.document.jiraEpicMappings.filter(item => item.initiativeId === initiativeId),
    workItems: archived.document.workItems.filter(item => item.initiativeId === initiativeId),
    milestones: archived.document.milestones.filter(item => item.initiativeId === initiativeId),
    briefings: archived.document.briefings.filter(item => item.initiativeIds.includes(initiativeId)),
    briefingVersions: archived.document.briefingVersions.filter(item => item.initiativeIds.includes(initiativeId))
  }, relatedBefore);

  const staleRestore = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/initiatives/${initiativeId}/archive`, {
    expectedRevision: before.revision,
    actor: ACTOR,
    archived: false
  });
  assert.equal(staleRestore.status, 409);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/initiatives/${initiativeId}/archive`, {
    expectedRevision: archivedRevision,
    actor: ACTOR,
    archived: false
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().initiative.id, initiativeId);
  assert.equal(response.json().initiative.archived, false);
  const restored = await persisted(targetDataFile);
  assert.deepEqual(
    restored.document.auditEvents.slice(-2).map(event => event.action),
    ['initiative-archived', 'initiative-restored']
  );

  const wrongParent = await jsonRequest(app, 'POST', `${workspaceBase(BETA)}/initiatives/${initiativeId}/archive`, {
    expectedRevision: restored.revision,
    actor: ACTOR,
    archived: true
  });
  const unknown = await jsonRequest(app, 'POST', `${workspaceBase(BETA)}/initiatives/initiative-unknown/archive`, {
    expectedRevision: restored.revision,
    actor: ACTOR,
    archived: true
  });
  assert.equal(wrongParent.status, 404);
  assert.deepEqual(wrongParent.json(), unknown.json());

  const physicalDelete = await requestApp(app, { method: 'DELETE', url: `${workspaceBase(ALPHA)}/initiatives/${initiativeId}` });
  assert.equal(physicalDelete.status, 405);
});

test('Jira mapping canonical identity is unique per Workspace and reusable across Organizations', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  let revision = (await persisted(targetDataFile)).revision;
  let response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/initiatives/initiative-alpha-zero-mapping/jira-epic-mappings`, {
    expectedRevision: revision,
    actor: ACTOR,
    mapping: {
      jiraProjectKey: 'FICTA', jiraEpicKey: 'FICTA-401', jiraEpicName: 'Fictional Alpha Mapping',
      mappingStatus: 'verified', provenance: 'Explicit review.', verifiedAt: null
    }
  });
  assert.equal(response.status, 200);
  revision = revisionOf(response);

  const duplicate = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/initiatives/initiative-alpha-multiple-mappings/jira-epic-mappings`, {
    expectedRevision: revision,
    actor: ACTOR,
    mapping: {
      jiraProjectKey: 'FICTA', jiraEpicKey: 'FICTA-401', jiraEpicName: 'Duplicate fictional mapping',
      mappingStatus: 'verified', provenance: 'Must fail.', verifiedAt: null
    }
  });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.json().error.code, 'INVALID_REQUEST');

  const nonCanonical = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/initiatives/initiative-alpha-zero-mapping/jira-epic-mappings`, {
    expectedRevision: revision,
    actor: ACTOR,
    mapping: {
      jiraProjectKey: 'ficta', jiraEpicKey: ' FICTA-402 ', jiraEpicName: 'Invalid fictional mapping',
      mappingStatus: 'pending', provenance: 'Must fail.', verifiedAt: null
    }
  });
  assert.equal(nonCanonical.status, 400);

  response = await jsonRequest(app, 'POST', `${workspaceBase(BETA)}/initiatives/initiative-beta-shared/jira-epic-mappings`, {
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
      initiativeId: null,
      itemType: 'Story',
      summary: 'Fictional unassigned Phase 3 item',
      canonicalStatus: 'Planned',
      currentStateProvenance: 'fictional-manual-entry',
      currentStateConfidence: 'confirmed'
    }
  });
  assert.equal(response.status, 200);
  const workItemId = response.json().workItem.id;
  assert.equal(response.json().workItem.initiativeId, null);
  revision = revisionOf(response);

  response = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/work-items/${workItemId}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { summary: 'Fictional updated Phase 3 item', labels: ['fictional'], notes: 'Safe local note.' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().workItem.organizationId, ALPHA.organizationId);
  assert.equal(response.json().workItem.workspaceId, ALPHA.workspaceId);
  assert.equal(response.json().workItem.initiativeId, null);
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
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-multiple-mappings' }
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.json().preview.before, null);
  assert.equal(preview.json().preview.after, 'initiative-alpha-multiple-mappings');
  assert.deepEqual(await fs.readFile(targetDataFile), initialBytes);
  assert.equal((await persisted(targetDataFile)).revision, initial.revision);

  let unrelated = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/initiatives/initiative-alpha-zero-mapping`, {
    expectedRevision: initial.revision,
    actor: ACTOR,
    changes: { description: 'Fictional unrelated revision advance.' }
  });
  assert.equal(unrelated.status, 200);
  let revision = revisionOf(unrelated);

  let response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/${itemId}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-multiple-mappings' },
    previewHash: preview.json().preview.previewHash
  });
  assert.equal(response.status, 409);
  assert.equal(response.json().error.code, 'PREVIEW_CONFLICT');
  assert.equal((await persisted(targetDataFile)).document.workItems.find(item => item.id === itemId).initiativeId, null);

  preview = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/${itemId}/preview`, {
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-multiple-mappings' }
  });
  assert.equal(preview.status, 200);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/${itemId}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-multiple-mappings' },
    previewHash: `${'0'.repeat(63)}1`
  });
  assert.equal(response.status, 409);
  assert.equal(response.json().error.code, 'PREVIEW_CONFLICT');
  assert.equal((await persisted(targetDataFile)).revision, revision);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/${itemId}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-multiple-mappings' },
    previewHash: preview.json().preview.previewHash
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().workItem.initiativeId, 'initiative-alpha-multiple-mappings');
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

test('bulk Initiative, Unassigned, and Sprint assignment is bounded, atomic, and stale-safe', async t => {
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

  const unrelated = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/initiatives/initiative-alpha-zero-mapping`, {
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
    action: { type: 'assign-initiative', initiativeId: null }
  });
  assert.equal(duplicate.status, 400);

  const mixedParent = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/bulk/preview`, {
    workItemIds: [ids[0], 'work-item-beta-assigned'],
    action: { type: 'assign-initiative', initiativeId: null }
  });
  assert.equal(mixedParent.status, 404);
  assert.deepEqual(mixedParent.json(), notFoundBody());

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/bulk/preview`, {
    workItemIds: ids,
    action: { type: 'assign-initiative', initiativeId: null }
  });
  assert.deepEqual(response.json().preview.rows.find(row => row.workItemId === ids[0]).workstreamChange, {
    effect: 'cleared', beforeWorkstreamId: 'workstream-alpha-mapped', afterWorkstreamId: null
  });
  const stalePreview = response.json().preview;
  const individualPreview = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/${ids[1]}/preview`, {
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-zero-mapping' }
  });
  assert.equal(individualPreview.status, 200);
  const individualApply = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/${ids[1]}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-zero-mapping' },
    previewHash: individualPreview.json().preview.previewHash
  });
  assert.equal(individualApply.status, 200, individualApply.body);
  revision = revisionOf(individualApply);
  const staleApply = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/bulk/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    workItemIds: ids,
    action: { type: 'assign-initiative', initiativeId: null },
    previewHash: stalePreview.previewHash
  });
  assert.equal(staleApply.status, 409);
  assert.equal(staleApply.json().error.code, 'PREVIEW_CONFLICT');
  const stored = await persisted(targetDataFile);
  assert.equal(stored.document.workItems.find(item => item.id === ids[0]).initiativeId, 'initiative-alpha-multiple-mappings');
  assert.equal(stored.document.workItems.find(item => item.id === ids[1]).initiativeId, 'initiative-alpha-zero-mapping');
});

test('Milestones expose applicability and deterministic pressure while enforcing explicit cross-Initiative links', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, ({ document }) => {
    document.workspaces.find(workspace => workspace.id === ALPHA.workspaceId).settings.milestoneDueSoonDays = 5;
  });
  let revision = (await persisted(targetDataFile)).revision;
  let response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/milestones`, {
    expectedRevision: revision,
    actor: ACTOR,
    milestone: {
      initiativeId: null,
      title: 'Fictional Workspace Review',
      date: '2026-08-20',
      status: 'Planned',
      linkedWorkItemIds: ['work-item-alpha-assigned', 'work-item-alpha-unassigned']
    }
  });
  assert.equal(response.status, 200);
  const workspaceMilestoneId = response.json().milestone.id;
  revision = revisionOf(response);

  const implicitCrossInitiative = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/milestones`, {
    expectedRevision: revision,
    actor: ACTOR,
    milestone: {
      initiativeId: 'initiative-alpha-multiple-mappings',
      title: 'Fictional Initiative Review',
      date: '2026-08-21',
      status: 'Planned',
      linkedWorkItemIds: ['work-item-alpha-unassigned']
    }
  });
  assert.equal(implicitCrossInitiative.status, 400);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/milestones`, {
    expectedRevision: revision,
    actor: ACTOR,
    milestone: {
      initiativeId: 'initiative-alpha-multiple-mappings',
      title: 'Fictional Explicit Cross-Initiative Review',
      date: '2026-08-21',
      status: 'Planned',
      linkedWorkItemIds: ['work-item-alpha-unassigned'],
      allowCrossInitiativeLinks: true
    }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().crossInitiativeLinksExplicitlyApproved, true);
  const initiativeMilestoneId = response.json().milestone.id;
  revision = revisionOf(response);

  response = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/milestones/${initiativeMilestoneId}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { status: 'At risk', notes: 'Fictional reviewed Milestone note.', allowCrossInitiativeLinks: true }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().milestone.status, 'At risk');

  const list = await requestApp(app, { url: `${workspaceBase(ALPHA)}/milestones` });
  const workspaceMilestone = list.json().milestones.find(item => item.id === workspaceMilestoneId);
  assert.deepEqual(workspaceMilestone.applicability, { kind: 'workspace', initiativeId: null, label: 'Entire workspace' });
  assert.equal(workspaceMilestone.timing.dueSoonDays, 5);
  assert.match(workspaceMilestone.timing.pressure, /scheduled|due-soon|overdue/);
  assert.deepEqual(milestoneTiming('2026-08-10', { referenceDate: '2026-08-11', dueSoonDays: 14 }), {
    referenceDate: '2026-08-11', dueSoonDays: 14, dueInDays: -1, pressure: 'overdue'
  });

  const foreign = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/milestones`, {
    expectedRevision: revisionOf(response),
    actor: ACTOR,
    milestone: {
      initiativeId: 'initiative-beta-shared', title: 'Must fail', date: '2026-08-22', status: 'Planned', linkedWorkItemIds: []
    }
  });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.json(), notFoundBody());
});
