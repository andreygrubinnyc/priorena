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

const ACTOR = 'local-feature-hierarchy-review';

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

test('Feature CRUD routes remain Scope-scoped, independent from Jira mappings, and non-revealing', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const scopeRoute = `${workspaceBase(ALPHA)}/scopes/scope-alpha-zero-mapping`;
  let response = await requestApp(app, { url: `${scopeRoute}/features` });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json().features.map(item => item.id), ['feature-alpha-zero']);
  response = await requestApp(app, { url: scopeRoute });
  assert.deepEqual(response.json().scope.features.map(item => item.id), ['feature-alpha-zero']);

  let revision = (await persisted(targetDataFile)).revision;
  response = await jsonRequest(app, 'POST', `${scopeRoute}/features`, {
    expectedRevision: revision,
    actor: ACTOR,
    feature: { name: 'Fictional Feature One', description: 'A repository-safe Feature.' }
  });
  assert.equal(response.status, 200, response.body);
  const featureId = response.json().feature.id;
  assert.match(featureId, /^feature-/);
  revision = revisionOf(response);

  response = await jsonRequest(app, 'PATCH', `${scopeRoute}/features/${featureId}`, {
    expectedRevision: revision,
    actor: ACTOR,
    changes: { description: 'A revised repository-safe Feature description.' }
  });
  assert.equal(response.status, 200);
  const renamed = await rename(app, targetDataFile, `${scopeRoute}/features/${featureId}`, 'Fictional Feature Renamed');
  assert.equal(renamed.json().feature.id, featureId);

  response = await requestApp(app, { url: `${scopeRoute}/features/${featureId}` });
  assert.equal(response.status, 200);
  assert.equal(response.json().feature.name, 'Fictional Feature Renamed');
  response = await requestApp(app, { url: `${scopeRoute}/features/${featureId}/work-items` });
  assert.deepEqual(response.json().workItems, []);

  const stored = await persisted(targetDataFile);
  assert.equal(stored.document.jiraEpicMappings.length, 4);
  assert.deepEqual(
    stored.document.auditEvents.filter(event => event.entityId === featureId).map(event => event.action),
    ['feature-created', 'feature-updated', 'feature-renamed']
  );

  const foreign = await requestApp(app, { url: `${workspaceBase(BETA)}/scopes/scope-beta-shared/features/${featureId}` });
  const unknown = await requestApp(app, { url: `${workspaceBase(BETA)}/scopes/scope-beta-shared/features/feature-unknown` });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.json(), notFoundBody());
  assert.deepEqual(foreign.json(), unknown.json());
});

test('Feature assignment and clear require revision-bound preview/apply and exact Scope parents', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const itemId = 'work-item-alpha-unassigned';
  const itemRoute = `${workspaceBase(ALPHA)}/work-items/${itemId}`;
  let revision = (await persisted(targetDataFile)).revision;

  let preview = await jsonRequest(app, 'POST', `${itemRoute}/preview`, {
    action: { type: 'assign-scope', scopeId: 'scope-alpha-zero-mapping', featureId: 'feature-alpha-zero' }
  });
  assert.equal(preview.status, 200, preview.body);
  assert.deepEqual(preview.json().preview.featureChange, {
    effect: 'replaced', beforeFeatureId: null, afterFeatureId: 'feature-alpha-zero'
  });
  let response = await jsonRequest(app, 'POST', `${itemRoute}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-scope', scopeId: 'scope-alpha-zero-mapping', featureId: 'feature-alpha-zero' },
    previewHash: preview.json().preview.previewHash
  });
  assert.equal(response.status, 200, response.body);
  assert.equal(response.json().workItem.scopeId, 'scope-alpha-zero-mapping');
  assert.equal(response.json().workItem.featureId, 'feature-alpha-zero');
  revision = revisionOf(response);

  preview = await jsonRequest(app, 'POST', `${itemRoute}/preview`, {
    action: { type: 'assign-feature', featureId: null }
  });
  assert.equal(preview.status, 200);
  response = await jsonRequest(app, 'POST', `${itemRoute}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-feature', featureId: null },
    previewHash: preview.json().preview.previewHash
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().workItem.featureId, null);

  const wrongScope = await jsonRequest(app, 'POST', `${itemRoute}/preview`, {
    action: { type: 'assign-feature', featureId: 'feature-alpha-mapped' }
  });
  assert.equal(wrongScope.status, 404);
  assert.deepEqual(wrongScope.json(), notFoundBody());

  const oldType = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items`, {
    expectedRevision: revisionOf(response),
    actor: ACTOR,
    workItem: {
      scopeId: null,
      itemType: 'Feature',
      summary: 'Fictional invalid old-type item',
      canonicalStatus: 'Planned',
      currentStateProvenance: 'fictional-manual-entry',
      currentStateConfidence: 'confirmed'
    }
  });
  assert.equal(oldType.status, 400);
});

test('every Scope change previews Feature retention, clearing, or explicit replacement', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const itemRoute = `${workspaceBase(ALPHA)}/work-items/work-item-alpha-assigned`;
  let revision = (await persisted(targetDataFile)).revision;

  let preview = await jsonRequest(app, 'POST', `${itemRoute}/preview`, {
    action: { type: 'assign-scope', scopeId: 'scope-alpha-multiple-mappings' }
  });
  assert.equal(preview.status, 400, 'an unchanged Scope and retained Feature is a no-op');

  preview = await jsonRequest(app, 'POST', `${itemRoute}/preview`, {
    action: { type: 'assign-scope', scopeId: 'scope-alpha-zero-mapping' }
  });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.json().preview.featureChange, {
    effect: 'cleared', beforeFeatureId: 'feature-alpha-mapped', afterFeatureId: null
  });
  let response = await jsonRequest(app, 'POST', `${itemRoute}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-scope', scopeId: 'scope-alpha-zero-mapping' },
    previewHash: preview.json().preview.previewHash
  });
  assert.equal(response.status, 200, response.body);
  assert.equal(response.json().workItem.featureId, null);
  revision = revisionOf(response);

  preview = await jsonRequest(app, 'POST', `${itemRoute}/preview`, {
    action: { type: 'assign-scope', scopeId: 'scope-alpha-multiple-mappings', featureId: 'feature-alpha-mapped' }
  });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.json().preview.featureChange, {
    effect: 'replaced', beforeFeatureId: null, afterFeatureId: 'feature-alpha-mapped'
  });
  response = await jsonRequest(app, 'POST', `${itemRoute}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    action: { type: 'assign-scope', scopeId: 'scope-alpha-multiple-mappings', featureId: 'feature-alpha-mapped' },
    previewHash: preview.json().preview.previewHash
  });
  assert.equal(response.status, 200);

  const retainedPreview = await jsonRequest(app, 'POST', `${itemRoute}/preview`, {
    action: { type: 'assign-scope', scopeId: 'scope-alpha-multiple-mappings', featureId: 'feature-alpha-mapped' }
  });
  assert.equal(retainedPreview.status, 400);
  const stored = await persisted(targetDataFile);
  assert.equal(stored.document.evidence.find(item => item.id === 'evidence-alpha-accepted').scopeId, 'scope-alpha-multiple-mappings');
});

test('bulk same-Scope Feature replacement and clear apply the previewed Feature change', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, ({ document }) => {
    document.features.push({
      id: 'feature-alpha-mapped-alternate',
      organizationId: ALPHA.organizationId,
      workspaceId: ALPHA.workspaceId,
      scopeId: 'scope-alpha-multiple-mappings',
      name: 'Alternate Fictional Feature',
      description: 'A second fictional Feature in the same Scope.'
    });
  });
  const route = `${workspaceBase(ALPHA)}/work-items/bulk`;
  const workItemIds = ['work-item-alpha-assigned'];
  let revision = (await persisted(targetDataFile)).revision;

  let previewResponse = await jsonRequest(app, 'POST', `${route}/preview`, {
    workItemIds,
    action: {
      type: 'assign-scope',
      scopeId: 'scope-alpha-multiple-mappings',
      featureId: 'feature-alpha-mapped-alternate'
    }
  });
  assert.equal(previewResponse.status, 200, previewResponse.body);
  assert.deepEqual(previewResponse.json().preview.rows[0].featureChange, {
    effect: 'replaced',
    beforeFeatureId: 'feature-alpha-mapped',
    afterFeatureId: 'feature-alpha-mapped-alternate'
  });
  let response = await jsonRequest(app, 'POST', `${route}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    workItemIds,
    action: {
      type: 'assign-scope',
      scopeId: 'scope-alpha-multiple-mappings',
      featureId: 'feature-alpha-mapped-alternate'
    },
    previewHash: previewResponse.json().preview.previewHash
  });
  assert.equal(response.status, 200, response.body);
  assert.equal(response.json().changedCount, 1);
  assert.equal(response.json().workItems[0].featureId, 'feature-alpha-mapped-alternate');
  revision = revisionOf(response);

  previewResponse = await jsonRequest(app, 'POST', `${route}/preview`, {
    workItemIds,
    action: { type: 'assign-scope', scopeId: 'scope-alpha-multiple-mappings', featureId: null }
  });
  assert.deepEqual(previewResponse.json().preview.rows[0].featureChange, {
    effect: 'cleared',
    beforeFeatureId: 'feature-alpha-mapped-alternate',
    afterFeatureId: null
  });
  response = await jsonRequest(app, 'POST', `${route}/apply`, {
    expectedRevision: revision,
    actor: ACTOR,
    workItemIds,
    action: { type: 'assign-scope', scopeId: 'scope-alpha-multiple-mappings', featureId: null },
    previewHash: previewResponse.json().preview.previewHash
  });
  assert.equal(response.status, 200, response.body);
  assert.equal(response.json().changedCount, 1);
  assert.equal(response.json().workItems[0].featureId, null);

  const stored = await persisted(targetDataFile);
  const audits = stored.document.auditEvents.filter(event => event.entityId === workItemIds[0] && event.action === 'bulk-assign-scope-applied').slice(-2);
  assert.deepEqual(audits.map(event => event.beforeHash), [
    stateHash({ scopeId: 'scope-alpha-multiple-mappings', featureId: 'feature-alpha-mapped' }),
    stateHash({ scopeId: 'scope-alpha-multiple-mappings', featureId: 'feature-alpha-mapped-alternate' })
  ]);
  assert.deepEqual(audits.map(event => event.afterHash), [
    stateHash({ scopeId: 'scope-alpha-multiple-mappings', featureId: 'feature-alpha-mapped-alternate' }),
    stateHash({ scopeId: 'scope-alpha-multiple-mappings', featureId: null })
  ]);
});

test('controlled renames preserve stable IDs, relationships, and frozen Briefing names', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const briefingRoute = `/api/v2/organizations/${ALPHA.organizationId}/briefings/briefing-alpha`;
  let candidateResponse = await jsonRequest(app, 'POST', `${briefingRoute}/candidates/prepare`, {});
  const oldFeatureCandidate = candidateResponse.json().candidates.find(candidate => candidate.featureId === 'feature-alpha-mapped');
  assert.ok(oldFeatureCandidate);
  let draftResponse = await jsonRequest(app, 'POST', `${briefingRoute}/versions`, {
    expectedRevision: revisionOf(candidateResponse),
    actor: ACTOR,
    selectedFactIds: [oldFeatureCandidate.id],
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
  assert.match(originalFrozenSnapshot.definition.workspaces[0].selection.label, /Mapped Scope/);
  assert.ok(finalized.json().version.facts.some(fact => fact.featureName === 'Duplicate Fictional Feature'));
  assert.ok(originalFrozenOutputs.every(output => output.text.includes('Feature: Duplicate Fictional Feature')));

  const before = await persisted(targetDataFile);
  const originalIds = {
    organization: before.document.organizations[0].id,
    workspace: before.document.workspaces[0].id,
    scope: before.document.scopes.find(item => item.id === 'scope-alpha-multiple-mappings').id,
    feature: before.document.features.find(item => item.id === 'feature-alpha-mapped').id
  };

  await rename(app, targetDataFile, `/api/v2/organizations/${ALPHA.organizationId}`, 'Fictional Organization Renamed');
  await rename(app, targetDataFile, `${workspaceBase(ALPHA)}`, 'Fictional Workspace Renamed');
  await rename(app, targetDataFile, `${workspaceBase(ALPHA)}/scopes/scope-alpha-multiple-mappings`, 'Fictional Scope Renamed');
  await rename(app, targetDataFile, `${workspaceBase(ALPHA)}/scopes/scope-alpha-multiple-mappings/features/feature-alpha-mapped`, 'Fictional Feature Renamed');

  const after = await persisted(targetDataFile);
  assert.deepEqual({
    organization: after.document.organizations[0].id,
    workspace: after.document.workspaces[0].id,
    scope: after.document.scopes.find(item => item.id === originalIds.scope).id,
    feature: after.document.features.find(item => item.id === originalIds.feature).id
  }, originalIds);
  assert.equal(after.document.features.find(item => item.id === originalIds.feature).scopeId, originalIds.scope);
  assert.equal(after.document.workItems.find(item => item.id === 'work-item-alpha-assigned').featureId, originalIds.feature);
  const preservedVersion = after.document.briefingVersions.find(version => version.id === frozenVersionId);
  assert.deepEqual(preservedVersion.frozenSnapshot, originalFrozenSnapshot);
  assert.deepEqual(preservedVersion.outputs, originalFrozenOutputs);
  assert.deepEqual(after.document.auditEvents.slice(-4).map(event => event.action), [
    'organization-renamed', 'workspace-renamed', 'scope-renamed', 'feature-renamed'
  ]);

  candidateResponse = await jsonRequest(app, 'POST', `${briefingRoute}/candidates/prepare`, {});
  assert.equal(candidateResponse.status, 200);
  assert.equal(candidateResponse.json().definition.organization.name, 'Fictional Organization Renamed');
  assert.equal(candidateResponse.json().definition.workspaces[0].name, 'Fictional Workspace Renamed');
  assert.match(candidateResponse.json().definition.workspaces[0].selection.label, /Fictional Scope Renamed/);
  const currentFeatureCandidate = candidateResponse.json().candidates.find(candidate => candidate.featureId === originalIds.feature);
  assert.equal(currentFeatureCandidate.featureName, 'Fictional Feature Renamed');
  assert.match(currentFeatureCandidate.text, /Feature: Fictional Feature Renamed/);
  draftResponse = await jsonRequest(app, 'POST', `${briefingRoute}/versions`, {
    expectedRevision: revisionOf(candidateResponse),
    actor: ACTOR,
    selectedFactIds: [currentFeatureCandidate.id],
    manualInputs: []
  });
  assert.equal(draftResponse.status, 200, draftResponse.body);
  assert.equal(draftResponse.json().version.frozenSnapshot.definition.organization.name, 'Fictional Organization Renamed');
  assert.equal(draftResponse.json().version.frozenSnapshot.definition.workspaces[0].name, 'Fictional Workspace Renamed');
  assert.ok(draftResponse.json().version.facts.some(fact => fact.featureName === 'Fictional Feature Renamed'));

  const organizationRead = await requestApp(app, { url: `/api/v2/organizations/${ALPHA.organizationId}` });
  const workspaceRead = await requestApp(app, { url: workspaceBase(ALPHA) });
  const scopeRead = await requestApp(app, { url: `${workspaceBase(ALPHA)}/scopes/${originalIds.scope}` });
  const featureRead = await requestApp(app, { url: `${workspaceBase(ALPHA)}/scopes/${originalIds.scope}/features/${originalIds.feature}` });
  assert.equal(organizationRead.json().organization.name, 'Fictional Organization Renamed');
  assert.equal(workspaceRead.json().workspace.name, 'Fictional Workspace Renamed');
  assert.equal(scopeRead.json().scope.name, 'Fictional Scope Renamed');
  assert.equal(featureRead.json().feature.name, 'Fictional Feature Renamed');

  const currentExport = await requestApp(app, { url: `/api/v2/organizations/${ALPHA.organizationId}/export` });
  assert.equal(currentExport.json().organizations.find(item => item.id === originalIds.organization).name, 'Fictional Organization Renamed');
  assert.equal(currentExport.json().workspaces.find(item => item.id === originalIds.workspace).name, 'Fictional Workspace Renamed');
  assert.equal(currentExport.json().scopes.find(item => item.id === originalIds.scope).name, 'Fictional Scope Renamed');
  assert.equal(currentExport.json().features.find(item => item.id === originalIds.feature).name, 'Fictional Feature Renamed');
});

test('every rename family rejects stale previews without mutation', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const cases = [
    {
      label: 'Organization',
      route: `/api/v2/organizations/${ALPHA.organizationId}`,
      currentName: document => document.organizations.find(item => item.id === ALPHA.organizationId).name,
      advanceScopeId: 'scope-alpha-zero-mapping'
    },
    {
      label: 'PM Workspace',
      route: workspaceBase(ALPHA),
      currentName: document => document.workspaces.find(item => item.id === ALPHA.workspaceId).name,
      advanceScopeId: 'scope-alpha-zero-mapping'
    },
    {
      label: 'Scope',
      route: `${workspaceBase(ALPHA)}/scopes/scope-alpha-zero-mapping`,
      currentName: document => document.scopes.find(item => item.id === 'scope-alpha-zero-mapping').name,
      advanceScopeId: 'scope-alpha-multiple-mappings'
    },
    {
      label: 'Feature',
      route: `${workspaceBase(ALPHA)}/scopes/scope-alpha-multiple-mappings/features/feature-alpha-mapped`,
      currentName: document => document.features.find(item => item.id === 'feature-alpha-mapped').name,
      advanceScopeId: 'scope-alpha-zero-mapping'
    }
  ];

  for (const [index, renameCase] of cases.entries()) {
    const before = await persisted(targetDataFile);
    const originalName = renameCase.currentName(before.document);
    const nextName = `Fictional Stale ${renameCase.label} Rename`;
    const preview = await jsonRequest(app, 'POST', `${renameCase.route}/rename/preview`, { name: nextName });
    assert.equal(preview.status, 200, preview.body);
    const unrelated = await jsonRequest(app, 'PATCH', `${workspaceBase(ALPHA)}/scopes/${renameCase.advanceScopeId}`, {
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
    `${workspaceBase(BETA)}/scopes/scope-alpha-multiple-mappings/rename/preview`,
    `${workspaceBase(ALPHA)}/scopes/scope-alpha-zero-mapping/features/feature-alpha-mapped/rename/preview`
  ];
  for (const route of routes) {
    const response = await jsonRequest(app, 'POST', route, { name: 'Fictional Rejected Rename' });
    assert.equal(response.status, 404, `${route}: ${response.body}`);
    assert.deepEqual(response.json(), notFoundBody());
  }
});

test('Feature context is available in Today, search, export, AI context, and Feature Work Item lists', async t => {
  const { app, services } = await createTargetApiHarness(t);
  const today = await requestApp(app, { url: `${workspaceBase(ALPHA)}/today` });
  const featured = today.json().workItems.find(item => item.id === 'work-item-alpha-assigned');
  assert.deepEqual(featured.feature, {
    id: 'feature-alpha-mapped', scopeId: 'scope-alpha-multiple-mappings', name: 'Duplicate Fictional Feature'
  });
  assert.ok(today.json().features.some(feature => feature.id === 'feature-alpha-mapped'));

  const search = await requestApp(app, { url: `${workspaceBase(ALPHA)}/search?q=duplicate` });
  assert.ok(search.json().results.some(result => result.kind === 'feature' && result.id === 'feature-alpha-mapped'));

  const list = await requestApp(app, { url: `${workspaceBase(ALPHA)}/scopes/scope-alpha-multiple-mappings/features/feature-alpha-mapped/work-items` });
  assert.deepEqual(list.json().workItems.map(item => item.id), ['work-item-alpha-assigned']);
  assert.deepEqual(list.json().workItems[0].feature, {
    id: 'feature-alpha-mapped', scopeId: 'scope-alpha-multiple-mappings', name: 'Duplicate Fictional Feature'
  });
  for (const rawField of ['description', 'notes', 'labels', 'dependencies', 'createdAt', 'updatedAt']) {
    assert.equal(Object.hasOwn(list.json().workItems[0], rawField), false);
  }

  const archive = await requestApp(app, { url: `/api/v2/organizations/${ALPHA.organizationId}/export` });
  assert.ok(archive.json().features.some(feature => feature.id === 'feature-alpha-mapped'));
  const aiContext = (await services.buildAiContext(ALPHA.organizationId, ALPHA.workspaceId)).value;
  assert.ok(aiContext.features.some(feature => feature.id === 'feature-alpha-mapped'));
  assert.equal(aiContext.workItems.find(item => item.id === 'work-item-alpha-assigned').featureId, 'feature-alpha-mapped');
});
