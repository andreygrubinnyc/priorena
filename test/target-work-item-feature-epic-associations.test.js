'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
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

const ACTOR = 'local-work-item-association-review';

function revisionOf(response) {
  return response.headers['x-priorena-target-revision'];
}

async function previewAndApply(app, route, targetDataFile, action) {
  const previewResponse = await jsonRequest(app, 'POST', `${route}/preview`, { action });
  assert.equal(previewResponse.status, 200, previewResponse.body);
  const preview = previewResponse.json().preview;
  const applied = await jsonRequest(app, 'POST', `${route}/apply`, {
    expectedRevision: (await persisted(targetDataFile)).revision,
    actor: ACTOR,
    action,
    previewHash: preview.previewHash
  });
  assert.equal(applied.status, 200, applied.body);
  return { preview, applied };
}

test('Work Item creation accepts all independent association states with explicit nullable fields', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const states = [
    ['unassigned', null, null, null],
    ['scope', 'scope-alpha-multiple-mappings', null, null],
    ['feature', 'scope-alpha-multiple-mappings', 'feature-alpha-mapped', null],
    ['jira', 'scope-alpha-multiple-mappings', null, 'jira-mapping-alpha-one'],
    ['both', 'scope-alpha-multiple-mappings', 'feature-alpha-mapped', 'jira-mapping-alpha-two']
  ];
  for (const [name, scopeId, featureId, jiraEpicMappingId] of states) {
    const response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items`, {
      expectedRevision: (await persisted(targetDataFile)).revision,
      actor: ACTOR,
      workItem: {
        scopeId,
        featureId,
        jiraEpicMappingId,
        itemType: 'Task',
        summary: `Fictional ${name} association state`,
        canonicalStatus: 'Planned',
        currentStateProvenance: 'fictional-manual-review',
        currentStateConfidence: 'confirmed'
      }
    });
    assert.equal(response.status, 200, response.body);
    assert.deepEqual(
      [response.json().workItem.scopeId, response.json().workItem.featureId, response.json().workItem.jiraEpicMappingId],
      [scopeId, featureId, jiraEpicMappingId]
    );
    assert.equal(response.json().workItem.feature?.id || null, featureId);
    assert.equal(response.json().workItem.jiraEpic?.id || null, jiraEpicMappingId);
    assert.equal(response.json().workItem.workItemJiraKey, null);
    if (jiraEpicMappingId !== null) {
      assert.match(response.json().workItem.jiraEpic.jiraEpicKey, /^FICTA-/);
      assert.equal(response.json().workItem.jiraEpic.jiraProjectKey, 'FICTA');
      assert.match(response.json().workItem.jiraEpic.mappingStatus, /^(?:pending|verified|inactive)$/);
    }
    for (const rawField of ['description', 'notes', 'labels', 'dependencies', 'createdAt', 'updatedAt']) {
      assert.equal(Object.hasOwn(response.json().workItem, rawField), false);
    }
  }
});

test('direct Feature and Jira Epic actions are revision-bound and independent', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const route = `${workspaceBase(ALPHA)}/work-items/work-item-alpha-assigned`;

  let result = await previewAndApply(app, route, targetDataFile, {
    type: 'assign-jira-epic', jiraEpicMappingId: null
  });
  assert.equal(result.applied.json().workItem.featureId, 'feature-alpha-mapped');
  assert.equal(result.applied.json().workItem.jiraEpicMappingId, null);

  result = await previewAndApply(app, route, targetDataFile, {
    type: 'assign-jira-epic', jiraEpicMappingId: 'jira-mapping-alpha-two'
  });
  assert.equal(result.applied.json().workItem.featureId, 'feature-alpha-mapped');
  assert.equal(result.applied.json().workItem.jiraEpicMappingId, 'jira-mapping-alpha-two');

  result = await previewAndApply(app, route, targetDataFile, {
    type: 'assign-feature', featureId: null
  });
  assert.equal(result.applied.json().workItem.featureId, null);
  assert.equal(result.applied.json().workItem.jiraEpicMappingId, 'jira-mapping-alpha-two');

  const wrongScope = await jsonRequest(app, 'POST', `${route}/preview`, {
    action: { type: 'assign-jira-epic', jiraEpicMappingId: 'jira-mapping-alpha-secondary' }
  });
  const foreign = await jsonRequest(app, 'POST', `${route}/preview`, {
    action: { type: 'assign-jira-epic', jiraEpicMappingId: 'jira-mapping-beta-shared-key' }
  });
  const unknown = await jsonRequest(app, 'POST', `${route}/preview`, {
    action: { type: 'assign-jira-epic', jiraEpicMappingId: 'jira-mapping-unknown' }
  });
  assert.equal(wrongScope.status, 404);
  assert.equal(foreign.status, 404);
  assert.deepEqual(wrongScope.json(), unknown.json());
  assert.deepEqual(foreign.json(), unknown.json());
  assert.deepEqual(unknown.json(), { error: { code: 'NOT_FOUND', message: PUBLIC_ERRORS.NOT_FOUND.message } });

  const stored = await persisted(targetDataFile);
  assert.deepEqual(
    stored.document.auditEvents
      .filter(event => event.entityId === 'work-item-alpha-assigned')
      .slice(-3)
      .map(event => event.action),
    ['work-item-assign-jira-epic-applied', 'work-item-assign-jira-epic-applied', 'work-item-assign-feature-applied']
  );
});

test('Scope previews report Feature and Jira Epic retention, clearing, and explicit replacement separately', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, ({ document }) => {
    document.jiraEpicMappings.push({
      id: 'jira-mapping-alpha-zero',
      organizationId: ALPHA.organizationId,
      workspaceId: ALPHA.workspaceId,
      scopeId: 'scope-alpha-zero-mapping',
      jiraProjectKey: 'FICTA',
      jiraEpicKey: 'FICTA-103',
      jiraEpicName: 'Fictional Zero-Scope Epic',
      mappingStatus: 'pending',
      provenance: 'Synthetic reviewed mapping.',
      verifiedAt: null
    });
  });
  const route = `${workspaceBase(ALPHA)}/work-items/work-item-alpha-assigned`;

  let previewResponse = await jsonRequest(app, 'POST', `${route}/preview`, {
    action: { type: 'assign-scope', scopeId: 'scope-alpha-zero-mapping' }
  });
  assert.equal(previewResponse.status, 200, previewResponse.body);
  assert.deepEqual(previewResponse.json().preview.featureChange, {
    effect: 'cleared', beforeFeatureId: 'feature-alpha-mapped', afterFeatureId: null
  });
  assert.deepEqual(previewResponse.json().preview.jiraEpicChange, {
    effect: 'cleared', beforeJiraEpicMappingId: 'jira-mapping-alpha-one', afterJiraEpicMappingId: null
  });

  const replaced = await previewAndApply(app, route, targetDataFile, {
    type: 'assign-scope',
    scopeId: 'scope-alpha-zero-mapping',
    featureId: 'feature-alpha-zero',
    jiraEpicMappingId: 'jira-mapping-alpha-zero'
  });
  assert.equal(replaced.preview.featureChange.effect, 'replaced');
  assert.equal(replaced.preview.jiraEpicChange.effect, 'replaced');
  assert.equal(replaced.applied.json().workItem.featureId, 'feature-alpha-zero');
  assert.equal(replaced.applied.json().workItem.jiraEpicMappingId, 'jira-mapping-alpha-zero');

  previewResponse = await jsonRequest(app, 'POST', `${route}/preview`, {
    action: { type: 'assign-scope', scopeId: 'scope-alpha-zero-mapping', featureId: null }
  });
  assert.equal(previewResponse.status, 200);
  assert.equal(previewResponse.json().preview.featureChange.effect, 'cleared');
  assert.equal(previewResponse.json().preview.jiraEpicChange.effect, 'retained');

  const unassigned = await previewAndApply(app, route, targetDataFile, {
    type: 'assign-scope', scopeId: null
  });
  assert.equal(unassigned.applied.json().workItem.scopeId, null);
  assert.equal(unassigned.applied.json().workItem.featureId, null);
  assert.equal(unassigned.applied.json().workItem.jiraEpicMappingId, null);

  const bulk = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/bulk/preview`, {
    workItemIds: ['work-item-alpha-assigned', 'work-item-alpha-unassigned'],
    action: {
      type: 'assign-scope',
      scopeId: 'scope-alpha-multiple-mappings',
      featureId: 'feature-alpha-mapped',
      jiraEpicMappingId: 'jira-mapping-alpha-two'
    }
  });
  assert.equal(bulk.status, 200, bulk.body);
  assert.equal(bulk.json().preview.rows.length, 2);
  assert.ok(bulk.json().preview.rows.every(row => row.featureChange && row.jiraEpicChange));
});

test('Jira Epic metadata updates preserve references and refresh current projections without rewriting frozen history', async t => {
  const { app, targetDataFile, services } = await createTargetApiHarness(t);
  const storedBefore = await persisted(targetDataFile);
  const frozenBefore = structuredClone(storedBefore.document.briefingVersions[0].frozenSnapshot);
  const mappingRoute = `${workspaceBase(ALPHA)}/scopes/scope-alpha-multiple-mappings/jira-epic-mappings/jira-mapping-alpha-one`;
  const update = await jsonRequest(app, 'PATCH', mappingRoute, {
    expectedRevision: storedBefore.revision,
    actor: ACTOR,
    changes: {
      jiraEpicName: 'Renamed Fictional Epic Alpha One',
      mappingStatus: 'inactive'
    }
  });
  assert.equal(update.status, 200, update.body);
  assert.equal(update.json().jiraEpicMapping.id, 'jira-mapping-alpha-one');

  const today = (await requestApp(app, { url: `${workspaceBase(ALPHA)}/today` })).json();
  const item = today.workItems.find(candidate => candidate.id === 'work-item-alpha-assigned');
  assert.equal(item.featureId, 'feature-alpha-mapped');
  assert.equal(item.jiraEpicMappingId, 'jira-mapping-alpha-one');
  assert.equal(item.jiraEpic.jiraEpicName, 'Renamed Fictional Epic Alpha One');
  assert.equal(item.jiraEpic.mappingStatus, 'inactive');
  assert.equal(item.workItemJiraKey, 'FICTA-900');
  assert.ok(today.jiraEpicMappings.some(mapping => mapping.id === 'jira-mapping-alpha-one'));

  const byName = (await requestApp(app, { url: `${workspaceBase(ALPHA)}/search?q=renamed%20fictional%20epic` })).json();
  const searchItem = byName.results.find(result => result.id === item.id);
  assert.equal(searchItem.jiraEpicKey, 'FICTA-101');
  assert.equal(searchItem.workItemJiraKey, 'FICTA-900');

  const candidates = await jsonRequest(
    app,
    'POST',
    `/api/v2/organizations/${ALPHA.organizationId}/briefings/briefing-alpha/candidates/prepare`,
    {}
  );
  assert.equal(candidates.status, 200, candidates.body);
  const fact = candidates.json().candidates.find(candidate => candidate.recordId === item.id && candidate.kind === 'current-state');
  assert.equal(fact.featureId, 'feature-alpha-mapped');
  assert.equal(fact.jiraEpicMappingId, 'jira-mapping-alpha-one');
  assert.equal(fact.jiraEpicName, 'Renamed Fictional Epic Alpha One');
  assert.equal(fact.jiraEpicMappingStatus, 'inactive');
  assert.match(fact.text, /Feature: Duplicate Fictional Feature/);
  assert.match(fact.text, /Jira Epic: FICTA-101/);
  assert.match(fact.text, /Work Item Jira key: FICTA-900/);

  const storedAfter = await persisted(targetDataFile);
  assert.deepEqual(storedAfter.document.briefingVersions[0].frozenSnapshot, frozenBefore);
  const archive = (await requestApp(app, { url: `/api/v2/organizations/${ALPHA.organizationId}/export` })).json();
  assert.equal(archive.schemaVersion, 4);
  assert.equal(archive.workItems.find(candidate => candidate.id === item.id).jiraEpicMappingId, 'jira-mapping-alpha-one');
  const aiContext = (await services.buildAiContext(ALPHA.organizationId, ALPHA.workspaceId)).value;
  assert.equal(aiContext.workItems.find(candidate => candidate.id === item.id).jiraEpicMappingId, 'jira-mapping-alpha-one');
  assert.ok(aiContext.jiraEpicMappings.some(mapping => mapping.id === 'jira-mapping-alpha-one'));
});

test('target UI exposes independent stable-ID Jira Epic controls without native dialogs or Jira calls', () => {
  const appSource = fs.readFileSync(require.resolve('../public/target/app.js'), 'utf8');
  const stateSource = fs.readFileSync(require.resolve('../public/target-workflow-state.js'), 'utf8');
  const workSource = fs.readFileSync(require.resolve('../target-server/work-services.js'), 'utf8');
  assert.match(appSource, /jira-epic-filter/);
  assert.match(appSource, /jira-epic-assignment/);
  assert.match(appSource, /No Jira Epic/);
  assert.match(appSource, /Keep compatible Jira Epic/);
  assert.match(appSource, /mapping\.mappingStatus/);
  assert.match(appSource, /mapping\.id/);
  assert.match(appSource, /jiraEpicAssignment\.disabled = scopeId === 'unassigned'/);
  assert.match(appSource, /result\.kind === 'workItem'/);
  assert.match(appSource, /Work Item Jira key: \$\{result\.workItemJiraKey/);
  assert.match(appSource, /Jira Epic: \$\{result\.jiraEpicKey/);
  assert.match(stateSource, /jiraEpicMappingId/);
  assert.doesNotMatch(appSource, /\b(?:alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(workSource, /https?:\/\/|fetch\s*\(|axios|jira-client/i);
  assert.match(appSource, /\['all', 'Story', 'Task', 'Bug', 'Other', 'Unknown'\]/);
  assert.doesNotMatch(appSource, /option\('Feature'/);
});

test('foreign Jira Epic mapping collections remain parent-scoped', async t => {
  const { app } = await createTargetApiHarness(t);
  const foreign = await requestApp(app, { url: `${workspaceBase(BETA)}/jira-epic-mappings` });
  assert.equal(foreign.status, 200);
  assert.deepEqual(foreign.json().jiraEpicMappings.map(mapping => mapping.id), ['jira-mapping-beta-shared-key']);
  assert.equal(JSON.stringify(foreign.json()).includes('jira-mapping-alpha-one'), false);
});
