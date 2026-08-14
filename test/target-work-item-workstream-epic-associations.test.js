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
    ['initiative', 'initiative-alpha-multiple-mappings', null, null],
    ['workstream', 'initiative-alpha-multiple-mappings', 'workstream-alpha-mapped', null],
    ['jira', 'initiative-alpha-multiple-mappings', null, 'jira-mapping-alpha-one'],
    ['both', 'initiative-alpha-multiple-mappings', 'workstream-alpha-mapped', 'jira-mapping-alpha-two']
  ];
  for (const [name, initiativeId, workstreamId, jiraEpicMappingId] of states) {
    const response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items`, {
      expectedRevision: (await persisted(targetDataFile)).revision,
      actor: ACTOR,
      workItem: {
        initiativeId,
        workstreamId,
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
      [response.json().workItem.initiativeId, response.json().workItem.workstreamId, response.json().workItem.jiraEpicMappingId],
      [initiativeId, workstreamId, jiraEpicMappingId]
    );
    assert.equal(response.json().workItem.workstream?.id || null, workstreamId);
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

test('inactive Jira Epic mappings remain assignable through established creation and preview paths', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, ({ document }) => {
    document.jiraEpicMappings.find(mapping => mapping.id === 'jira-mapping-alpha-one').mappingStatus = 'inactive';
  });

  const created = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items`, {
    expectedRevision: (await persisted(targetDataFile)).revision,
    actor: ACTOR,
    workItem: {
      initiativeId: 'initiative-alpha-multiple-mappings',
      workstreamId: null,
      jiraEpicMappingId: 'jira-mapping-alpha-one',
      itemType: 'Task',
      summary: 'Fictional inactive-mapping assignment',
      canonicalStatus: 'Planned',
      currentStateProvenance: 'fictional-manual-review',
      currentStateConfidence: 'confirmed'
    }
  });
  assert.equal(created.status, 200, created.body);
  assert.equal(created.json().workItem.jiraEpic.mappingStatus, 'inactive');

  const directRoute = `${workspaceBase(ALPHA)}/work-items/${created.json().workItem.id}`;
  await previewAndApply(app, directRoute, targetDataFile, {
    type: 'assign-jira-epic', jiraEpicMappingId: 'jira-mapping-alpha-two'
  });
  const directInactive = await previewAndApply(app, directRoute, targetDataFile, {
    type: 'assign-jira-epic', jiraEpicMappingId: 'jira-mapping-alpha-one'
  });
  assert.equal(directInactive.applied.json().workItem.jiraEpicMappingId, 'jira-mapping-alpha-one');
  const current = (await requestApp(app, { url: `${workspaceBase(ALPHA)}/today` })).json();
  assert.equal(current.workItems.find(item => item.id === created.json().workItem.id).jiraEpic.mappingStatus, 'inactive');

  const initiativePreview = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/work-item-alpha-unassigned/preview`, {
    action: {
      type: 'assign-initiative',
      initiativeId: 'initiative-alpha-multiple-mappings',
      jiraEpicMappingId: 'jira-mapping-alpha-one'
    }
  });
  assert.equal(initiativePreview.status, 200, initiativePreview.body);

  const bulkPreview = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/bulk/preview`, {
    workItemIds: ['work-item-alpha-unassigned'],
    action: {
      type: 'assign-initiative',
      initiativeId: 'initiative-alpha-multiple-mappings',
      jiraEpicMappingId: 'jira-mapping-alpha-one'
    }
  });
  assert.equal(bulkPreview.status, 200, bulkPreview.body);
});

test('direct Workstream and Jira Epic actions are revision-bound and independent', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t);
  const route = `${workspaceBase(ALPHA)}/work-items/work-item-alpha-assigned`;

  let result = await previewAndApply(app, route, targetDataFile, {
    type: 'assign-jira-epic', jiraEpicMappingId: null
  });
  assert.equal(result.applied.json().workItem.workstreamId, 'workstream-alpha-mapped');
  assert.equal(result.applied.json().workItem.jiraEpicMappingId, null);

  result = await previewAndApply(app, route, targetDataFile, {
    type: 'assign-jira-epic', jiraEpicMappingId: 'jira-mapping-alpha-two'
  });
  assert.equal(result.applied.json().workItem.workstreamId, 'workstream-alpha-mapped');
  assert.equal(result.applied.json().workItem.jiraEpicMappingId, 'jira-mapping-alpha-two');

  result = await previewAndApply(app, route, targetDataFile, {
    type: 'assign-workstream', workstreamId: null
  });
  assert.equal(result.applied.json().workItem.workstreamId, null);
  assert.equal(result.applied.json().workItem.jiraEpicMappingId, 'jira-mapping-alpha-two');

  const wrongInitiative = await jsonRequest(app, 'POST', `${route}/preview`, {
    action: { type: 'assign-jira-epic', jiraEpicMappingId: 'jira-mapping-alpha-secondary' }
  });
  const foreign = await jsonRequest(app, 'POST', `${route}/preview`, {
    action: { type: 'assign-jira-epic', jiraEpicMappingId: 'jira-mapping-beta-shared-key' }
  });
  const unknown = await jsonRequest(app, 'POST', `${route}/preview`, {
    action: { type: 'assign-jira-epic', jiraEpicMappingId: 'jira-mapping-unknown' }
  });
  assert.equal(wrongInitiative.status, 404);
  assert.equal(foreign.status, 404);
  assert.deepEqual(wrongInitiative.json(), unknown.json());
  assert.deepEqual(foreign.json(), unknown.json());
  assert.deepEqual(unknown.json(), { error: { code: 'NOT_FOUND', message: PUBLIC_ERRORS.NOT_FOUND.message } });

  const stored = await persisted(targetDataFile);
  assert.deepEqual(
    stored.document.auditEvents
      .filter(event => event.entityId === 'work-item-alpha-assigned')
      .slice(-3)
      .map(event => event.action),
    ['work-item-assign-jira-epic-applied', 'work-item-assign-jira-epic-applied', 'work-item-assign-workstream-applied']
  );
});

test('Initiative previews report Workstream and Jira Epic retention, clearing, and explicit replacement separately', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, ({ document }) => {
    document.jiraEpicMappings.push({
      id: 'jira-mapping-alpha-zero',
      organizationId: ALPHA.organizationId,
      workspaceId: ALPHA.workspaceId,
      initiativeId: 'initiative-alpha-zero-mapping',
      jiraProjectKey: 'FICTA',
      jiraEpicKey: 'FICTA-103',
      jiraEpicName: 'Fictional Zero-Initiative Epic',
      mappingStatus: 'pending',
      provenance: 'Synthetic reviewed mapping.',
      verifiedAt: null
    });
  });
  const route = `${workspaceBase(ALPHA)}/work-items/work-item-alpha-assigned`;

  let previewResponse = await jsonRequest(app, 'POST', `${route}/preview`, {
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-zero-mapping' }
  });
  assert.equal(previewResponse.status, 200, previewResponse.body);
  assert.deepEqual(previewResponse.json().preview.workstreamChange, {
    effect: 'cleared', beforeWorkstreamId: 'workstream-alpha-mapped', afterWorkstreamId: null
  });
  assert.deepEqual(previewResponse.json().preview.jiraEpicChange, {
    effect: 'cleared', beforeJiraEpicMappingId: 'jira-mapping-alpha-one', afterJiraEpicMappingId: null
  });

  const replaced = await previewAndApply(app, route, targetDataFile, {
    type: 'assign-initiative',
    initiativeId: 'initiative-alpha-zero-mapping',
    workstreamId: 'workstream-alpha-zero',
    jiraEpicMappingId: 'jira-mapping-alpha-zero'
  });
  assert.equal(replaced.preview.workstreamChange.effect, 'replaced');
  assert.equal(replaced.preview.jiraEpicChange.effect, 'replaced');
  assert.equal(replaced.applied.json().workItem.workstreamId, 'workstream-alpha-zero');
  assert.equal(replaced.applied.json().workItem.jiraEpicMappingId, 'jira-mapping-alpha-zero');

  previewResponse = await jsonRequest(app, 'POST', `${route}/preview`, {
    action: { type: 'assign-initiative', initiativeId: 'initiative-alpha-zero-mapping', workstreamId: null }
  });
  assert.equal(previewResponse.status, 200);
  assert.equal(previewResponse.json().preview.workstreamChange.effect, 'cleared');
  assert.equal(previewResponse.json().preview.jiraEpicChange.effect, 'retained');

  const unassigned = await previewAndApply(app, route, targetDataFile, {
    type: 'assign-initiative', initiativeId: null
  });
  assert.equal(unassigned.applied.json().workItem.initiativeId, null);
  assert.equal(unassigned.applied.json().workItem.workstreamId, null);
  assert.equal(unassigned.applied.json().workItem.jiraEpicMappingId, null);

  const bulk = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items/bulk/preview`, {
    workItemIds: ['work-item-alpha-assigned', 'work-item-alpha-unassigned'],
    action: {
      type: 'assign-initiative',
      initiativeId: 'initiative-alpha-multiple-mappings',
      workstreamId: 'workstream-alpha-mapped',
      jiraEpicMappingId: 'jira-mapping-alpha-two'
    }
  });
  assert.equal(bulk.status, 200, bulk.body);
  assert.equal(bulk.json().preview.rows.length, 2);
  assert.ok(bulk.json().preview.rows.every(row => row.workstreamChange && row.jiraEpicChange));
});

test('Jira Epic metadata updates preserve references and refresh current projections without rewriting frozen history', async t => {
  const { app, targetDataFile, services } = await createTargetApiHarness(t);
  const storedBefore = await persisted(targetDataFile);
  const frozenBefore = structuredClone(storedBefore.document.briefingVersions[0].frozenSnapshot);
  const mappingRoute = `${workspaceBase(ALPHA)}/initiatives/initiative-alpha-multiple-mappings/jira-epic-mappings/jira-mapping-alpha-one`;
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
  assert.equal(item.workstreamId, 'workstream-alpha-mapped');
  assert.equal(item.jiraEpicMappingId, 'jira-mapping-alpha-one');
  assert.equal(item.jiraEpic.jiraEpicName, 'Renamed Fictional Epic Alpha One');
  assert.equal(item.jiraEpic.mappingStatus, 'inactive');
  assert.equal(item.workItemJiraKey, 'FICTA-900');
  assert.ok(today.jiraEpicMappings.some(mapping => mapping.id === 'jira-mapping-alpha-one'));

  const byName = (await requestApp(app, { url: `${workspaceBase(ALPHA)}/search?q=renamed%20fictional%20epic` })).json();
  const searchMapping = byName.results.find(result => result.id === 'jira-mapping-alpha-one');
  assert.equal(searchMapping.kind, 'jiraEpicMapping');
  assert.equal(searchMapping.title, 'FICTA-101 — Renamed Fictional Epic Alpha One');
  assert.equal(searchMapping.mappingStatus, 'inactive');
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
  assert.equal(fact.workstreamId, 'workstream-alpha-mapped');
  assert.equal(fact.jiraEpicMappingId, 'jira-mapping-alpha-one');
  assert.equal(fact.jiraEpicName, 'Renamed Fictional Epic Alpha One');
  assert.equal(fact.jiraEpicMappingStatus, 'inactive');
  assert.match(fact.text, /Workstream: Duplicate Fictional Workstream/);
  assert.match(fact.text, /Jira Epic: FICTA-101/);
  assert.match(fact.text, /Work Item Jira key: FICTA-900/);

  const storedAfter = await persisted(targetDataFile);
  assert.deepEqual(storedAfter.document.briefingVersions[0].frozenSnapshot, frozenBefore);
  const archive = (await requestApp(app, { url: `/api/v2/organizations/${ALPHA.organizationId}/export` })).json();
  assert.equal(archive.schemaVersion, 5);
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
  assert.match(appSource, /Parent Initiative/);
  assert.match(appSource, /Create Jira Epic mapping/);
  assert.match(appSource, /Edit mapping/);
  assert.match(appSource, /Save mapping/);
  assert.match(appSource, /This creates or updates a Priorena mapping only\. It does not create or modify anything in Jira\./);
  assert.match(appSource, /mappingStatus: controls\.status\.value/);
  assert.match(appSource, /Nothing was written to Jira/);
  assert.match(appSource, /filter\(mapping => mapping\.initiativeId === initiativeId\)/);
  assert.match(appSource, /jiraEpicAssignment\.disabled = initiativeId === 'unassigned'/);
  assert.match(appSource, /result\.kind === 'workItem'/);
  assert.match(appSource, /Work Item Jira key: \$\{result\.workItemJiraKey/);
  assert.match(appSource, /Jira Epic: \$\{result\.jiraEpicKey/);
  assert.match(stateSource, /jiraEpicMappingId/);
  assert.doesNotMatch(appSource, /\b(?:alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(workSource, /https?:\/\/|fetch\s*\(|axios|jira-client/i);
  assert.match(appSource, /\['all', 'Story', 'Task', 'Bug', 'Other', 'Unknown'\]/);
  assert.doesNotMatch(appSource, /option\('Workstream'/);
});

test('foreign Jira Epic mapping collections remain parent-scoped', async t => {
  const { app } = await createTargetApiHarness(t);
  const foreign = await requestApp(app, { url: `${workspaceBase(BETA)}/jira-epic-mappings` });
  assert.equal(foreign.status, 200);
  assert.deepEqual(foreign.json().jiraEpicMappings.map(mapping => mapping.id), ['jira-mapping-beta-shared-key']);
  assert.equal(JSON.stringify(foreign.json()).includes('jira-mapping-alpha-one'), false);
});
