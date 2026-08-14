'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { PUBLIC_ERRORS } = require('../target-server/errors');
const { stateHash } = require('../target-server/workflow-utils');
const {
  ALPHA,
  BETA,
  createTargetApiHarness,
  jsonRequest,
  persisted,
  requestApp,
  workspaceBase
} = require('../test-support/target-api-harness');

const ACTOR = 'local-workstream-hierarchy-review';

function revisionOf(response) {
  return response.headers['x-priorena-target-revision'];
}

function notFoundBody() {
  return { error: { code: 'NOT_FOUND', message: PUBLIC_ERRORS.NOT_FOUND.message } };
}

async function rename(app, targetDataFile, route, name) {
  const preview = await jsonRequest(app, 'POST', `${route}/rename/preview`, { name });
  assert.equal(preview.status, 200, preview.body);
  const current = await persisted(targetDataFile);
  const applied = await jsonRequest(app, 'POST', `${route}/rename/apply`, {
    expectedRevision: current.revision,
    actor: ACTOR,
    name,
    previewHash: preview.json().preview.previewHash
  });
  assert.equal(applied.status, 200, applied.body);
  return applied;
}

test('Workstream CRUD routes remain Initiative-scoped, independent from Jira mappings, and non-revealing', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const initiativeRoute = `${workspaceBase(ALPHA)}/initiatives/initiative-alpha-zero-mapping`;
  let response = await requestApp(app, { url: `${initiativeRoute}/workstreams` });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json().workstreams.map(item => item.id), ['workstream-alpha-zero']);
  response = await requestApp(app, { url: initiativeRoute });
  assert.deepEqual(response.json().initiative.workstreams.map(item => item.id), ['workstream-alpha-zero']);

  let revision = (await persisted(targetDataFile)).revision;
  response = await jsonRequest(app, 'POST', `${initiativeRoute}/workstreams`, {
    expectedRevision: revision,
    actor: ACTOR,
    workstream: { name: 'Fictional Workstream One', description: 'A repository-safe Workstream.' }
  });
  assert.equal(response.status, 200, response.body);
  const workstreamId = response.json().workstream.id;
  assert.match(workstreamId, /^workstream-/);
  revision = revisionOf(response);

  response = await jsonRequest(app, 'PATCH', `${initiativeRoute}/workstreams/${workstreamId}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { description: 'A revised repository-safe Workstream description.' }
  });
  assert.equal(response.status, 200);
  const renamed = await rename(app, targetDataFile, `${initiativeRoute}/workstreams/${workstreamId}`, 'Fictional Workstream Renamed');
  assert.equal(renamed.json().workstream.id, workstreamId);

  response = await requestApp(app, { url: `${initiativeRoute}/workstreams/${workstreamId}` });
  assert.equal(response.status, 200);
  assert.equal(response.json().workstream.name, 'Fictional Workstream Renamed');
  response = await requestApp(app, { url: `${initiativeRoute}/workstreams/${workstreamId}/work-items` });
  assert.deepEqual(response.json().workItems, []);

  const stored = await persisted(targetDataFile);
  assert.equal(stored.document.jiraEpicMappings.length, 4);
  assert.deepEqual(
    stored.document.auditEvents.filter(event => event.entityId === workstreamId).map(event => event.action),
    ['workstream-created', 'workstream-updated', 'workstream-renamed']
  );

  const foreign = await requestApp(app, { url: `${workspaceBase(BETA)}/initiatives/initiative-beta-shared/workstreams/${workstreamId}` });
  const unknown = await requestApp(app, { url: `${workspaceBase(BETA)}/initiatives/initiative-beta-shared/workstreams/workstream-unknown` });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.json(), notFoundBody());
  assert.deepEqual(foreign.json(), unknown.json());
});

test('Workstream assignment and clear require revision-bound preview/apply and exact Initiative parents', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const itemId = 'work-item-alpha-unassigned';
  const itemRoute = `${workspaceBase(ALPHA)}/work-items/${itemId}`;
  let revision = (await persisted(targetDataFile)).revision;

  let preview = await jsonRequest(app, 'POST', `${itemRoute}/preview`, {
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-zero-mapping', workstreamId: 'workstream-alpha-zero' }
  });
  assert.equal(preview.status, 200, preview.body);
  assert.deepEqual(preview.json().preview.workstreamChange, {
    effect: 'replaced', beforeWorkstreamId: null, afterWorkstreamId: 'workstream-alpha-zero'
  });
  let response = await jsonRequest(app, 'POST', `${itemRoute}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-zero-mapping', workstreamId: 'workstream-alpha-zero' },
    previewHash: preview.json().preview.previewHash
  });
  assert.equal(response.status, 200, response.body);
  assert.equal(response.json().workItem.initiativeId, 'initiative-alpha-zero-mapping');
  assert.equal(response.json().workItem.workstreamId, 'workstream-alpha-zero');
  revision = revisionOf(response);

  preview = await jsonRequest(app, 'POST', `${itemRoute}/preview`, {
    action: { type: 'assign-workstream', workstreamId: null }
  });
  assert.equal(preview.status, 200);
  response = await jsonRequest(app, 'POST', `${itemRoute}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-workstream', workstreamId: null },
    previewHash: preview.json().preview.previewHash
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().workItem.workstreamId, null);

  const wrongInitiative = await jsonRequest(app, 'POST', `${itemRoute}/preview`, {
    action: { type: 'assign-workstream', workstreamId: 'workstream-alpha-mapped' }
  });
  assert.equal(wrongInitiative.status, 404);
  assert.deepEqual(wrongInitiative.json(), notFoundBody());

  const oldType = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items`, {
    expectedRevision: revisionOf(response),
    actor: ACTOR,
    workItem: {
      initiativeId: null,
      itemType: 'Workstream',
      summary: 'Fictional invalid old-type item',
      canonicalStatus: 'Planned',
      currentStateProvenance: 'fictional-manual-entry',
      currentStateConfidence: 'confirmed'
    }
  });
  assert.equal(oldType.status, 400);
});

test('every Initiative change previews Workstream retention, clearing, or explicit replacement', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const itemRoute = `${workspaceBase(ALPHA)}/work-items/work-item-alpha-assigned`;
  let revision = (await persisted(targetDataFile)).revision;

  let preview = await jsonRequest(app, 'POST', `${itemRoute}/preview`, {
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-multiple-mappings' }
  });
  assert.equal(preview.status, 400, 'an unchanged Initiative and retained Workstream is a no-op');

  preview = await jsonRequest(app, 'POST', `${itemRoute}/preview`, {
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-zero-mapping' }
  });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.json().preview.workstreamChange, {
    effect: 'cleared', beforeWorkstreamId: 'workstream-alpha-mapped', afterWorkstreamId: null
  });
  let response = await jsonRequest(app, 'POST', `${itemRoute}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-zero-mapping' },
    previewHash: preview.json().preview.previewHash
  });
  assert.equal(response.status, 200, response.body);
  assert.equal(response.json().workItem.workstreamId, null);
  revision = revisionOf(response);

  preview = await jsonRequest(app, 'POST', `${itemRoute}/preview`, {
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-multiple-mappings', workstreamId: 'workstream-alpha-mapped' }
  });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.json().preview.workstreamChange, {
    effect: 'replaced', beforeWorkstreamId: null, afterWorkstreamId: 'workstream-alpha-mapped'
  });
  response = await jsonRequest(app, 'POST', `${itemRoute}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-multiple-mappings', workstreamId: 'workstream-alpha-mapped' },
    previewHash: preview.json().preview.previewHash
  });
  assert.equal(response.status, 200);

  const retainedPreview = await jsonRequest(app, 'POST', `${itemRoute}/preview`, {
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-multiple-mappings', workstreamId: 'workstream-alpha-mapped' }
  });
  assert.equal(retainedPreview.status, 400);
  const stored = await persisted(targetDataFile);
  assert.equal(stored.document.evidence.find(item => item.id === 'evidence-alpha-accepted').initiativeId, 'initiative-alpha-multiple-mappings');
});

test('bulk same-Initiative Workstream replacement and clear apply the previewed Workstream change', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, ({ document }) => {
    document.workstreams.push({
      id: 'workstream-alpha-mapped-alternate',
      organizationId: ALPHA.organizationId,
      workspaceId: ALPHA.workspaceId,
      initiativeId: 'initiative-alpha-multiple-mappings',
      name: 'Alternate Fictional Workstream',
      description: 'A second fictional Workstream in the same Initiative.'
    });
  });
  const route = `${workspaceBase(ALPHA)}/work-items/bulk`;
  const workItemIds = ['work-item-alpha-assigned'];
  let revision = (await persisted(targetDataFile)).revision;

  let previewResponse = await jsonRequest(app, 'POST', `${route}/preview`, {
    workItemIds,
    action: {
      type: 'assign-initiative',
      initiativeId: 'initiative-alpha-multiple-mappings',
      workstreamId: 'workstream-alpha-mapped-alternate'
    }
  });
  assert.equal(previewResponse.status, 200, previewResponse.body);
  assert.deepEqual(previewResponse.json().preview.rows[0].workstreamChange, {
    effect: 'replaced',
    beforeWorkstreamId: 'workstream-alpha-mapped',
    afterWorkstreamId: 'workstream-alpha-mapped-alternate'
  });
  let response = await jsonRequest(app, 'POST', `${route}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    workItemIds,
    action: {
      type: 'assign-initiative',
      initiativeId: 'initiative-alpha-multiple-mappings',
      workstreamId: 'workstream-alpha-mapped-alternate'
    },
    previewHash: previewResponse.json().preview.previewHash
  });
  assert.equal(response.status, 200, response.body);
  assert.equal(response.json().changedCount, 1);
  assert.equal(response.json().workItems[0].workstreamId, 'workstream-alpha-mapped-alternate');
  revision = revisionOf(response);

  previewResponse = await jsonRequest(app, 'POST', `${route}/preview`, {
    workItemIds,
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-multiple-mappings', workstreamId: null }
  });
  assert.deepEqual(previewResponse.json().preview.rows[0].workstreamChange, {
    effect: 'cleared',
    beforeWorkstreamId: 'workstream-alpha-mapped-alternate',
    afterWorkstreamId: null
  });
  response = await jsonRequest(app, 'POST', `${route}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    workItemIds,
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-multiple-mappings', workstreamId: null },
    previewHash: previewResponse.json().preview.previewHash
  });
  assert.equal(response.status, 200, response.body);
  assert.equal(response.json().changedCount, 1);
  assert.equal(response.json().workItems[0].workstreamId, null);

  const stored = await persisted(targetDataFile);
  const audits = stored.document.auditEvents.filter(event => event.entityId === workItemIds[0] && event.action === 'bulk-assign-initiative-applied').slice(-2);
  assert.deepEqual(audits.map(event => event.beforeHash), [
    stateHash({ initiativeId: 'initiative-alpha-multiple-mappings', workstreamId: 'workstream-alpha-mapped', jiraEpicMappingId: 'jira-mapping-alpha-one' }),
    stateHash({ initiativeId: 'initiative-alpha-multiple-mappings', workstreamId: 'workstream-alpha-mapped-alternate', jiraEpicMappingId: 'jira-mapping-alpha-one' })
  ]);
  assert.deepEqual(audits.map(event => event.afterHash), [
    stateHash({ initiativeId: 'initiative-alpha-multiple-mappings', workstreamId: 'workstream-alpha-mapped-alternate', jiraEpicMappingId: 'jira-mapping-alpha-one' }),
    stateHash({ initiativeId: 'initiative-alpha-multiple-mappings', workstreamId: null, jiraEpicMappingId: 'jira-mapping-alpha-one' })
  ]);
});

test('controlled renames preserve stable IDs, relationships, and frozen Briefing names', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const briefingRoute = `/api/v2/organizations/${ALPHA.organizationId}/briefings/briefing-alpha`;
  let candidateResponse = await jsonRequest(app, 'POST', `${briefingRoute}/candidates/prepare`, {});
  const oldWorkstreamCandidate = candidateResponse.json().candidates.find(candidate => candidate.workstreamId === 'workstream-alpha-mapped');
  assert.ok(oldWorkstreamCandidate);
  let draftResponse = await jsonRequest(app, 'POST', `${briefingRoute}/versions`, {
    expectedRevision: revisionOf(candidateResponse),
    actor: ACTOR,
    selectedFactIds: [oldWorkstreamCandidate.id],
    manualInputs: []
  });
  assert.equal(draftResponse.status, 200, draftResponse.body);
  const frozenVersionId = draftResponse.json().version.id;
  const finalizePreview = await jsonRequest(app, 'POST', `${briefingRoute}/versions/${frozenVersionId}/finalize/preview`, {});
  const finalized = await jsonRequest(app, 'POST', `${briefingRoute}/versions/${frozenVersionId}/finalize`, {
    expectedRevision: revisionOf(finalizePreview),
    actor: ACTOR,
    draftStateHash: finalizePreview.json().draftStateHash
  });
  assert.equal(finalized.status, 200, finalized.body);
  const originalFrozenSnapshot = structuredClone(finalized.json().version.frozenSnapshot);
  const originalFrozenOutputs = structuredClone(finalized.json().outputs);
  assert.equal(originalFrozenSnapshot.definition.organization.name, 'Fictional Organization Alpha');
  assert.equal(originalFrozenSnapshot.definition.workspaces[0].name, 'Shared Delivery Workspace');
  assert.match(originalFrozenSnapshot.definition.workspaces[0].selection.label, /Mapped Initiative/);
  assert.ok(finalized.json().version.facts.some(fact => fact.workstreamName === 'Duplicate Fictional Workstream'));
  assert.ok(originalFrozenOutputs.every(output => output.text.includes('Workstream: Duplicate Fictional Workstream')));

  const before = await persisted(targetDataFile);
  const originalIds = {
    organization: before.document.organizations[0].id,
    workspace: before.document.workspaces[0].id,
    initiative: before.document.initiatives.find(item => item.id === 'initiative-alpha-multiple-mappings').id,
    workstream: before.document.workstreams.find(item => item.id === 'workstream-alpha-mapped').id
  };

  await rename(app, targetDataFile, `/api/v2/organizations/${ALPHA.organizationId}`, 'Fictional Organization Renamed');
  await rename(app, targetDataFile, `${workspaceBase(ALPHA)}`, 'Fictional Workspace Renamed');
  await rename(app, targetDataFile, `${workspaceBase(ALPHA)}/initiatives/initiative-alpha-multiple-mappings`, 'Fictional Initiative Renamed');
  await rename(app, targetDataFile, `${workspaceBase(ALPHA)}/initiatives/initiative-alpha-multiple-mappings/workstreams/workstream-alpha-mapped`, 'Fictional Workstream Renamed');

  const after = await persisted(targetDataFile);
  assert.deepEqual({
    organization: after.document.organizations[0].id,
    workspace: after.document.workspaces[0].id,
    initiative: after.document.initiatives.find(item => item.id === originalIds.initiative).id,
    workstream: after.document.workstreams.find(item => item.id === originalIds.workstream).id
  }, originalIds);
  assert.equal(after.document.workstreams.find(item => item.id === originalIds.workstream).initiativeId, originalIds.initiative);
  assert.equal(after.document.workItems.find(item => item.id === 'work-item-alpha-assigned').workstreamId, originalIds.workstream);
  const preservedVersion = after.document.briefingVersions.find(version => version.id === frozenVersionId);
  assert.deepEqual(preservedVersion.frozenSnapshot, originalFrozenSnapshot);
  assert.deepEqual(preservedVersion.outputs, originalFrozenOutputs);
  assert.deepEqual(after.document.auditEvents.slice(-4).map(event => event.action), [
    'organization-renamed', 'workspace-renamed', 'initiative-renamed', 'workstream-renamed'
  ]);

  candidateResponse = await jsonRequest(app, 'POST', `${briefingRoute}/candidates/prepare`, {});
  assert.equal(candidateResponse.status, 200);
  assert.equal(candidateResponse.json().definition.organization.name, 'Fictional Organization Renamed');
  assert.equal(candidateResponse.json().definition.workspaces[0].name, 'Fictional Workspace Renamed');
  assert.match(candidateResponse.json().definition.workspaces[0].selection.label, /Fictional Initiative Renamed/);
  const currentWorkstreamCandidate = candidateResponse.json().candidates.find(candidate => candidate.workstreamId === originalIds.workstream);
  assert.equal(currentWorkstreamCandidate.workstreamName, 'Fictional Workstream Renamed');
  assert.match(currentWorkstreamCandidate.text, /Workstream: Fictional Workstream Renamed/);
  draftResponse = await jsonRequest(app, 'POST', `${briefingRoute}/versions`, {
    expectedRevision: revisionOf(candidateResponse),
    actor: ACTOR,
    selectedFactIds: [currentWorkstreamCandidate.id],
    manualInputs: []
  });
  assert.equal(draftResponse.status, 200, draftResponse.body);
  assert.equal(draftResponse.json().version.frozenSnapshot.definition.organization.name, 'Fictional Organization Renamed');
  assert.equal(draftResponse.json().version.frozenSnapshot.definition.workspaces[0].name, 'Fictional Workspace Renamed');
  assert.ok(draftResponse.json().version.facts.some(fact => fact.workstreamName === 'Fictional Workstream Renamed'));

  const organizationRead = await requestApp(app, { url: `/api/v2/organizations/${ALPHA.organizationId}` });
  const workspaceRead = await requestApp(app, { url: workspaceBase(ALPHA) });
  const initiativeRead = await requestApp(app, { url: `${workspaceBase(ALPHA)}/initiatives/${originalIds.initiative}` });
  const workstreamRead = await requestApp(app, { url: `${workspaceBase(ALPHA)}/initiatives/${originalIds.initiative}/workstreams/${originalIds.workstream}` });
  assert.equal(organizationRead.json().organization.name, 'Fictional Organization Renamed');
  assert.equal(workspaceRead.json().workspace.name, 'Fictional Workspace Renamed');
  assert.equal(initiativeRead.json().initiative.name, 'Fictional Initiative Renamed');
  assert.equal(workstreamRead.json().workstream.name, 'Fictional Workstream Renamed');

  const currentExport = await requestApp(app, { url: `/api/v2/organizations/${ALPHA.organizationId}/export` });
  assert.equal(currentExport.json().organizations.find(item => item.id === originalIds.organization).name, 'Fictional Organization Renamed');
  assert.equal(currentExport.json().workspaces.find(item => item.id === originalIds.workspace).name, 'Fictional Workspace Renamed');
  assert.equal(currentExport.json().initiatives.find(item => item.id === originalIds.initiative).name, 'Fictional Initiative Renamed');
  assert.equal(currentExport.json().workstreams.find(item => item.id === originalIds.workstream).name, 'Fictional Workstream Renamed');
});

test('every rename family rejects stale previews without mutation', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const cases = [
    {
      label: 'Organization',
      route: `/api/v2/organizations/${ALPHA.organizationId}`,
      currentName: document => document.organizations.find(item => item.id === ALPHA.organizationId).name,
      advanceInitiativeId: 'initiative-alpha-zero-mapping'
    },
    {
      label: 'Workspace',
      route: workspaceBase(ALPHA),
      currentName: document => document.workspaces.find(item => item.id === ALPHA.workspaceId).name,
      advanceInitiativeId: 'initiative-alpha-zero-mapping'
    },
    {
      label: 'Initiative',
      route: `${workspaceBase(ALPHA)}/initiatives/initiative-alpha-zero-mapping`,
      currentName: document => document.initiatives.find(item => item.id === 'initiative-alpha-zero-mapping').name,
      advanceInitiativeId: 'initiative-alpha-multiple-mappings'
    },
    {
      label: 'Workstream',
      route: `${workspaceBase(ALPHA)}/initiatives/initiative-alpha-multiple-mappings/workstreams/workstream-alpha-mapped`,
      currentName: document => document.workstreams.find(item => item.id === 'workstream-alpha-mapped').name,
      advanceInitiativeId: 'initiative-alpha-zero-mapping'
    }
  ];

  for (const [index, renameCase] of cases.entries()) {
    const before = await persisted(targetDataFile);
    const originalName = renameCase.currentName(before.document);
    const nextName = `Fictional Stale ${renameCase.label} Rename`;
    const preview = await jsonRequest(app, 'POST', `${renameCase.route}/rename/preview`, { name: nextName });
    assert.equal(preview.status, 200, preview.body);
    const unrelated = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/initiatives/${renameCase.advanceInitiativeId}`, {
      expectedRevision: before.revision,
      actor: ACTOR,
      changes: { description: `Fictional unrelated revision advance ${index}.` }
    });
    assert.equal(unrelated.status, 200, unrelated.body);
    const stale = await jsonRequest(app, 'POST', `${renameCase.route}/rename/apply`, {
      expectedRevision: revisionOf(unrelated),
      actor: ACTOR,
      name: nextName,
      previewHash: preview.json().preview.previewHash
    });
    assert.equal(stale.status, 409, `${renameCase.label}: ${stale.body}`);
    assert.equal(stale.json().error.code, 'PREVIEW_CONFLICT');
    assert.equal(renameCase.currentName((await persisted(targetDataFile)).document), originalName);
  }
});

test('rename routes reject unknown and wrong-parent targets without disclosure', async t => {
  const { app } = await createTargetApiHarness(t);
  const routes = [
    '/api/v2/organizations/org-unknown/rename/preview',
    `/api/v2/organizations/${BETA.organizationId}/workspaces/${ALPHA.workspaceId}/rename/preview`,
    `${workspaceBase(BETA)}/initiatives/initiative-alpha-multiple-mappings/rename/preview`,
    `${workspaceBase(ALPHA)}/initiatives/initiative-alpha-zero-mapping/workstreams/workstream-alpha-mapped/rename/preview`
  ];
  for (const route of routes) {
    const response = await jsonRequest(app, 'POST', route, { name: 'Fictional Rejected Rename' });
    assert.equal(response.status, 404, `${route}: ${response.body}`);
    assert.deepEqual(response.json(), notFoundBody());
  }
});

test('Workstream context is available in Today, search, export, AI context, and Workstream Work Item lists', async t => {
  const { app, services } = await createTargetApiHarness(t);
  const today = await requestApp(app, { url: `${workspaceBase(ALPHA)}/today` });
  const workstreamAssigned = today.json().workItems.find(item => item.id === 'work-item-alpha-assigned');
  assert.deepEqual(workstreamAssigned.workstream, {
    id: 'workstream-alpha-mapped', initiativeId: 'initiative-alpha-multiple-mappings', name: 'Duplicate Fictional Workstream'
  });
  assert.ok(today.json().workstreams.some(workstream => workstream.id === 'workstream-alpha-mapped'));

  const search = await requestApp(app, { url: `${workspaceBase(ALPHA)}/search?q=duplicate` });
  assert.ok(search.json().results.some(result => result.kind === 'workstream' && result.id === 'workstream-alpha-mapped'));

  const list = await requestApp(app, { url: `${workspaceBase(ALPHA)}/initiatives/initiative-alpha-multiple-mappings/workstreams/workstream-alpha-mapped/work-items` });
  assert.deepEqual(list.json().workItems.map(item => item.id), ['work-item-alpha-assigned']);
  assert.deepEqual(list.json().workItems[0].workstream, {
    id: 'workstream-alpha-mapped', initiativeId: 'initiative-alpha-multiple-mappings', name: 'Duplicate Fictional Workstream'
  });
  for (const rawField of ['description', 'notes', 'labels', 'dependencies', 'createdAt', 'updatedAt']) {
    assert.equal(Object.hasOwn(list.json().workItems[0], rawField), false);
  }

  const archive = await requestApp(app, { url: `/api/v2/organizations/${ALPHA.organizationId}/export` });
  assert.ok(archive.json().workstreams.some(workstream => workstream.id === 'workstream-alpha-mapped'));
  const aiContext = (await services.buildAiContext(ALPHA.organizationId, ALPHA.workspaceId)).value;
  assert.ok(aiContext.workstreams.some(workstream => workstream.id === 'workstream-alpha-mapped'));
  assert.equal(aiContext.workItems.find(item => item.id === 'work-item-alpha-assigned').workstreamId, 'workstream-alpha-mapped');
});

test('schema-v5 exposes no Scope or Feature route and action aliases', async t => {
  const { app } = await createTargetApiHarness(t);
  for (const route of [
    `${workspaceBase(ALPHA)}/scopes`,
    `${workspaceBase(ALPHA)}/features`,
    `${workspaceBase(ALPHA)}/scopes/scope-alpha/features`
  ]) {
    const response = await requestApp(app, { url: route });
    assert.equal(response.status, 404, route);
  }

  for (const type of ['assign-scope', 'assign-feature']) {
    const response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/work-item-alpha-assigned/preview`, {
      action: { type, scopeId: null, featureId: null }
    });
    assert.equal(response.status, 400, type);
  }
});
