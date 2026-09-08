'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { PUBLIC_ERRORS } = require('../target-server/errors');
const {
  ALPHA,
  BETA,
  createTargetApiHarness,
  jsonRequest,
  persisted,
  requestApp,
  workspaceBase
} = require('../test-support/target-api-harness');

const ACTOR = 'fictional-local-management-review';

function advancingClock(start = '2026-09-01T10:00:00.000Z') {
  let current = Date.parse(start);
  return () => {
    const value = new Date(current);
    current += 60_000;
    return value;
  };
}

function revisionOf(response) {
  return response.headers['x-priorena-target-revision'];
}

function notFoundBody() {
  return { error: { code: 'NOT_FOUND', message: PUBLIC_ERRORS.NOT_FOUND.message } };
}

async function createDecision(app, revision, decision = {}) {
  return jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/decisions`, {
    expectedRevision: revision,
    actor: ACTOR,
    decision: {
      title: 'Fictional bounded delivery decision',
      initiativeId: 'initiative-alpha-multiple-mappings',
      workItemId: 'work-item-alpha-assigned',
      evidenceIds: ['evidence-alpha-accepted'],
      supersedesDecisionId: null,
      ...decision
    }
  });
}

async function decide(app, revision, decisionId, values = {}) {
  const decision = {
    outcome: 'Use the fictional bounded delivery sequence.',
    rationale: 'Accepted fictional Evidence supports the bounded sequence.',
    decidedBy: 'fictional-decision-owner',
    ...values
  };
  const preview = await jsonRequest(
    app,
    'POST',
    `${workspaceBase(ALPHA)}/decisions/${decisionId}/decide/preview`,
    decision
  );
  assert.equal(preview.status, 200);
  const applied = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/decisions/${decisionId}/decide/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    decision,
    previewHash: preview.json().preview.previewHash
  });
  return { applied, preview };
}

test('Decision workflow is parent-scoped, revision-bound, audited, and terminal after Decided', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, () => {}, { now: advancingClock() });
  const initial = await persisted(targetDataFile);
  let response = await createDecision(app, initial.revision);
  assert.equal(response.status, 200);
  const decision = response.json().decision;
  assert.match(decision.id, /^decision-/);
  assert.equal(decision.status, 'draft');
  assert.equal(decision.outcome, null);
  assert.equal(decision.rationale, null);
  assert.equal(decision.decidedAt, null);
  assert.equal(decision.decidedBy, null);
  let revision = revisionOf(response);
  const createdRevision = revision;

  response = await requestApp(app, {
    url: `${workspaceBase(ALPHA)}/decisions?status=draft&page=1&pageSize=1`
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().total, 1);
  assert.equal(response.json().decisions[0].id, decision.id);

  response = await requestApp(app, { url: `${workspaceBase(ALPHA)}/decisions/${decision.id}` });
  assert.equal(response.status, 200);
  assert.equal(response.json().decision.title, decision.title);

  response = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/decisions/${decision.id}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { title: 'Fictional reviewed delivery decision' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().decision.title, 'Fictional reviewed delivery decision');
  revision = revisionOf(response);

  const staleEdit = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/decisions/${decision.id}`, {
    expectedRevision: createdRevision,
    actor: ACTOR,
    changes: { title: 'Must not apply from a stale revision' }
  });
  assert.equal(staleEdit.status, 409);

  const finalValues = {
    outcome: 'Use the reviewed fictional delivery sequence.',
    rationale: 'The selected accepted fictional Evidence supports this explicit choice.',
    decidedBy: 'fictional-decision-owner'
  };
  const beforePreview = await persisted(targetDataFile);
  const preview = await jsonRequest(
    app,
    'POST',
    `${workspaceBase(ALPHA)}/decisions/${decision.id}/decide/preview`,
    finalValues
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.json().preview.expectedRevision, revision);
  assert.equal((await persisted(targetDataFile)).revision, beforePreview.revision);

  const badHash = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/decisions/${decision.id}/decide/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    decision: finalValues,
    previewHash: '0'.repeat(64)
  });
  assert.equal(badHash.status, 409);
  assert.equal((await persisted(targetDataFile)).revision, revision);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/decisions/${decision.id}/decide/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    decision: finalValues,
    previewHash: preview.json().preview.previewHash
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().decision.status, 'decided');
  assert.equal(response.json().decision.outcome, finalValues.outcome);
  assert.equal(response.json().decision.decidedAt, response.json().decision.updatedAt);
  revision = revisionOf(response);

  const terminalEdit = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/decisions/${decision.id}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { title: 'Must remain immutable' }
  });
  assert.equal(terminalEdit.status, 409);
  const terminalPreview = await jsonRequest(
    app,
    'POST',
    `${workspaceBase(ALPHA)}/decisions/${decision.id}/decide/preview`,
    finalValues
  );
  assert.equal(terminalPreview.status, 409);

  const stored = await persisted(targetDataFile);
  assert.deepEqual(
    stored.document.auditEvents.slice(-3).map(event => event.action),
    ['decision-created', 'decision-updated', 'decision-decided']
  );
  assert.equal(stored.document.decisions[0].title, 'Fictional reviewed delivery decision');
});

test('Decision supersession is explicit, chronological, and unique', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, () => {}, { now: advancingClock() });
  let revision = (await persisted(targetDataFile)).revision;
  let response = await createDecision(app, revision, { title: 'Fictional original decision' });
  assert.equal(response.status, 200);
  const originalId = response.json().decision.id;
  revision = revisionOf(response);

  const finalized = await decide(app, revision, originalId, {
    outcome: 'Use the original fictional path.',
    rationale: 'The original accepted fictional Evidence supports this path.'
  });
  assert.equal(finalized.applied.status, 200);
  revision = revisionOf(finalized.applied);

  response = await createDecision(app, revision, {
    title: 'Fictional successor decision',
    supersedesDecisionId: originalId
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().decision.supersedesDecisionId, originalId);
  revision = revisionOf(response);

  const beforeDuplicate = await persisted(targetDataFile);
  const duplicate = await createDecision(app, revision, {
    title: 'Fictional duplicate successor',
    supersedesDecisionId: originalId
  });
  assert.equal(duplicate.status, 400);
  assert.equal((await persisted(targetDataFile)).revision, beforeDuplicate.revision);

  const draftTarget = await createDecision(app, revision, { title: 'Fictional draft target' });
  assert.equal(draftTarget.status, 200);
  const draftTargetId = draftTarget.json().decision.id;
  revision = revisionOf(draftTarget);
  const invalidDraftSupersession = await createDecision(app, revision, {
    title: 'Fictional invalid draft successor',
    supersedesDecisionId: draftTargetId
  });
  assert.equal(invalidDraftSupersession.status, 400);
});

test('Risk workflow supports bounded open-state editing and explicit immutable closure', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, () => {}, { now: advancingClock() });
  let revision = (await persisted(targetDataFile)).revision;
  let response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/risks`, {
    expectedRevision: revision,
    actor: ACTOR,
    risk: {
      title: 'Fictional review capacity risk',
      description: 'A fictional review queue might exceed the bounded capacity.',
      responsePlan: null,
      owner: null,
      reviewOn: '2026-09-15',
      initiativeId: 'initiative-alpha-multiple-mappings',
      workItemId: 'work-item-alpha-assigned',
      evidenceIds: ['evidence-alpha-accepted']
    }
  });
  assert.equal(response.status, 200);
  const riskId = response.json().risk.id;
  assert.match(riskId, /^risk-/);
  assert.equal(response.json().risk.status, 'open');
  revision = revisionOf(response);

  response = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/risks/${riskId}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: {
      responsePlan: 'Review the fictional queue within the stated bounded window.',
      owner: 'fictional-risk-owner',
      reviewOn: null
    }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().risk.owner, 'fictional-risk-owner');
  assert.equal(response.json().risk.reviewOn, null);
  revision = revisionOf(response);

  const list = await requestApp(app, { url: `${workspaceBase(ALPHA)}/risks?status=open&pageSize=1` });
  assert.equal(list.status, 200);
  assert.equal(list.json().total, 1);
  assert.equal(list.json().risks[0].id, riskId);

  const closure = {
    closureNote: 'The fictional review capacity was explicitly confirmed.',
    closedBy: 'fictional-risk-owner'
  };
  const beforePreview = await persisted(targetDataFile);
  const preview = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/risks/${riskId}/close/preview`, closure);
  assert.equal(preview.status, 200);
  assert.equal((await persisted(targetDataFile)).revision, beforePreview.revision);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/risks/${riskId}/close/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    closure,
    previewHash: preview.json().preview.previewHash
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().risk.status, 'closed');
  assert.equal(response.json().risk.closedAt, response.json().risk.updatedAt);
  revision = revisionOf(response);

  const terminalEdit = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/risks/${riskId}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { owner: 'Must remain immutable' }
  });
  assert.equal(terminalEdit.status, 409);

  const stored = await persisted(targetDataFile);
  assert.deepEqual(
    stored.document.auditEvents.slice(-3).map(event => event.action),
    ['risk-created', 'risk-updated', 'risk-closed']
  );
});

test('Decision and Risk writes keep foreign, unknown, and incompatible references indistinguishable', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, () => {}, { now: advancingClock() });
  const initial = await persisted(targetDataFile);
  const foreignEvidence = await createDecision(app, initial.revision, {
    evidenceIds: ['evidence-beta-accepted']
  });
  const unknownEvidence = await createDecision(app, initial.revision, {
    evidenceIds: ['evidence-unknown']
  });
  assert.equal(foreignEvidence.status, 404);
  assert.deepEqual(foreignEvidence.json(), notFoundBody());
  assert.deepEqual(unknownEvidence.json(), foreignEvidence.json());

  const incompatibleEvidence = await createDecision(app, initial.revision, {
    initiativeId: null,
    workItemId: 'work-item-alpha-unassigned',
    evidenceIds: ['evidence-alpha-accepted']
  });
  assert.equal(incompatibleEvidence.status, 404);

  const incompatibleParents = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/risks`, {
    expectedRevision: initial.revision,
    actor: ACTOR,
    risk: {
      title: 'Fictional mismatched parent risk',
      description: 'This synthetic request must fail closed.',
      initiativeId: 'initiative-alpha-zero-mapping',
      workItemId: 'work-item-alpha-assigned'
    }
  });
  assert.equal(incompatibleParents.status, 404);
  assert.equal((await persisted(targetDataFile)).revision, initial.revision);

  const created = await createDecision(app, initial.revision);
  assert.equal(created.status, 200);
  const decisionId = created.json().decision.id;
  const foreignRead = await requestApp(app, { url: `${workspaceBase(BETA)}/decisions/${decisionId}` });
  const unknownRead = await requestApp(app, { url: `${workspaceBase(BETA)}/decisions/decision-unknown` });
  assert.equal(foreignRead.status, 404);
  assert.deepEqual(foreignRead.json(), unknownRead.json());
});

test('Decision and Risk routes reject unbounded, unknown, or premature management input', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, () => {}, { now: advancingClock() });
  const revision = (await persisted(targetDataFile)).revision;

  const unknownDecisionField = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/decisions`, {
    expectedRevision: revision,
    actor: ACTOR,
    decision: { title: 'Fictional decision', score: 99 }
  });
  assert.equal(unknownDecisionField.status, 400);

  const prematureDecision = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/decisions`, {
    expectedRevision: revision,
    actor: ACTOR,
    decision: { title: 'Fictional decision', outcome: 'Not allowed during Draft.' }
  });
  assert.equal(prematureDecision.status, 400);

  const unknownRiskField = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/risks`, {
    expectedRevision: revision,
    actor: ACTOR,
    risk: { title: 'Fictional risk', description: 'Synthetic.', severity: 'high' }
  });
  assert.equal(unknownRiskField.status, 400);

  const badDecisionPage = await requestApp(app, { url: `${workspaceBase(ALPHA)}/decisions?pageSize=101` });
  const badRiskStatus = await requestApp(app, { url: `${workspaceBase(ALPHA)}/risks?status=accepted` });
  assert.equal(badDecisionPage.status, 400);
  assert.equal(badRiskStatus.status, 400);
  assert.equal((await persisted(targetDataFile)).revision, revision);
});
