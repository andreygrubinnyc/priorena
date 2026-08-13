'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const test = require('node:test');

const { AUDIT_ACTIONS } = require('../target-model/schema');
const { buildCandidateFacts, frozenContentHash } = require('../target-server/briefing-services');
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
const { createPhase3WorkflowFixture } = require('../test-support/target-v3-fixtures');

const NOW = '2026-08-09T12:00:00.000Z';
const COMMUNICATED_AT = '2026-08-10T12:00:00.000Z';

function runtimeOptions() {
  let id = 0;
  return {
    fixtureFactory: createPhase3WorkflowFixture,
    now: () => new Date(NOW),
    idFactory: entityType => `phase4-${entityType}-${++id}`
  };
}

function briefingBase(organizationId = ALPHA.organizationId) {
  return `/api/v2/organizations/${organizationId}/briefings`;
}

function definition(overrides = {}) {
  return {
    name: 'Fictional Weekly Delivery Briefing',
    workspaceIds: [ALPHA.workspaceId],
    scopeIds: [],
    audienceProfile: 'Fictional delivery stakeholders',
    preferredFormats: ['teams', 'email', 'confluence'],
    defaultSections: ['progress', 'risk', 'milestones', 'follow-up', 'evidence'],
    briefingType: 'status-update',
    draftingGuidance: 'Use concise fictional delivery language.',
    ...overrides
  };
}

async function currentRevision(targetDataFile) {
  return (await persisted(targetDataFile)).revision;
}

async function createDefinition(app, targetDataFile, overrides = {}) {
  const response = await jsonRequest(app, 'POST', briefingBase(), {
    expectedRevision: await currentRevision(targetDataFile),
    actor: 'phase4-test-reviewer',
    briefing: definition(overrides)
  });
  assert.equal(response.status, 200);
  return { briefing: response.json().briefing, revision: response.headers['x-priorena-target-revision'] };
}

async function createPreparedDraft(app, targetDataFile) {
  const created = await createDefinition(app, targetDataFile);
  const prepare = await jsonRequest(app, 'POST', `${briefingBase()}/${created.briefing.id}/candidates/prepare`, {});
  assert.equal(prepare.status, 200);
  const candidates = prepare.json().candidates;
  const current = candidates.find(candidate => candidate.kind === 'current-state');
  const evidence = candidates.find(candidate => candidate.kind === 'accepted-evidence');
  assert.ok(current);
  assert.ok(evidence);
  const draftResponse = await jsonRequest(app, 'POST', `${briefingBase()}/${created.briefing.id}/versions`, {
    expectedRevision: prepare.headers['x-priorena-target-revision'],
    actor: 'phase4-test-reviewer',
    selectedFactIds: [current.id, evidence.id],
    manualInputs: [{ section: 'progress', text: 'A fictional <img src=x onerror=fictional()> review checkpoint is scheduled.' }]
  });
  assert.equal(draftResponse.status, 200);
  return {
    briefing: created.briefing,
    candidates,
    draft: draftResponse.json().version,
    draftStateHash: draftResponse.json().draftStateHash,
    revision: draftResponse.headers['x-priorena-target-revision']
  };
}

test('Briefing definitions are Organization-owned, stable-ID selected, revision-aware, and audited', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, () => {}, runtimeOptions());
  const created = await createDefinition(app, targetDataFile, {
    workspaceIds: ['workspace-alpha-shared', 'workspace-alpha-secondary'],
    scopeIds: ['scope-alpha-multiple-mappings', 'scope-alpha-secondary']
  });
  assert.equal(created.briefing.organizationId, ALPHA.organizationId);
  assert.deepEqual(created.briefing.workspaces.map(item => item.id), ['workspace-alpha-shared', 'workspace-alpha-secondary']);
  assert.deepEqual(created.briefing.scopes.map(item => item.id), ['scope-alpha-multiple-mappings', 'scope-alpha-secondary']);
  assert.equal(created.briefing.briefingType, 'status-update');

  let response = await jsonRequest(app, 'PATCH', `${briefingBase()}/${created.briefing.id}`, {
    expectedRevision: created.revision,
    actor: 'phase4-test-reviewer',
    changes: { name: 'Fictional Updated Delivery Briefing' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().briefing.id, created.briefing.id);
  assert.equal(response.json().briefing.name, 'Fictional Updated Delivery Briefing');

  response = await jsonRequest(app, 'PATCH', `${briefingBase()}/${created.briefing.id}`, {
    expectedRevision: created.revision,
    actor: 'phase4-test-reviewer',
    changes: { name: 'Stale overwrite attempt' }
  });
  assert.equal(response.status, 409);
  assert.equal(response.json().error.code, 'REVISION_CONFLICT');

  response = await jsonRequest(app, 'POST', briefingBase(), {
    expectedRevision: await currentRevision(targetDataFile),
    actor: 'phase4-test-reviewer',
    briefing: definition({ workspaceIds: [BETA.workspaceId] })
  });
  assert.equal(response.status, 404);
  assert.equal(response.json().error.code, 'NOT_FOUND');
  assert.doesNotMatch(response.body, /Beta|workspace-beta/i);

  response = await jsonRequest(app, 'POST', briefingBase(), {
    expectedRevision: await currentRevision(targetDataFile),
    actor: 'phase4-test-reviewer',
    briefing: definition({ scopeIds: ['scope-alpha-secondary'] })
  });
  assert.equal(response.status, 404);

  const { document } = await persisted(targetDataFile);
  const definitionAudits = document.auditEvents.filter(event => event.entityId === created.briefing.id);
  assert.deepEqual(definitionAudits.map(event => event.action), ['briefing-created', 'briefing-updated']);
  assert.ok(definitionAudits.every(event => event.organizationId === ALPHA.organizationId && event.workspaceId === null));
});

test('candidate preparation is deterministic, grounded, bounded, and excludes unreviewed or foreign content', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, () => {}, runtimeOptions());
  const created = await createDefinition(app, targetDataFile);
  const first = await jsonRequest(app, 'POST', `${briefingBase()}/${created.briefing.id}/candidates/prepare`, {});
  const second = await jsonRequest(app, 'POST', `${briefingBase()}/${created.briefing.id}/candidates/prepare`, {});
  assert.equal(first.status, 200);
  assert.deepEqual(first.json().candidates, second.json().candidates);
  assert.equal(first.json().candidateStateHash, second.json().candidateStateHash);
  assert.equal(first.json().definition.workspaces[0].selection.label, 'Entire workspace');

  const candidates = first.json().candidates;
  assert.ok(candidates.some(candidate => candidate.kind === 'accepted-evidence' && candidate.provenance.type === 'accepted-evidence'));
  assert.ok(candidates.some(candidate => candidate.kind === 'current-state' && candidate.provenance.type === 'direct-work-item-state'));
  assert.ok(candidates.some(candidate => candidate.kind === 'follow-up'));
  assert.deepEqual(candidates.map(item => item.id), [...candidates.map(item => item.id)].sort((a, b) => a.localeCompare(b, 'en-US')));
  const serialized = JSON.stringify(candidates);
  assert.doesNotMatch(serialized, /IGNORE PRIOR INSTRUCTIONS|obsolete statement/i);
  assert.doesNotMatch(serialized, /BETA BRIEFING SENTINEL|BETA PROMPT SENTINEL|workspace-beta|org-fixture-beta/i);
  assert.ok(candidates.every(candidate => candidate.text.length <= 2_000));

  const before = await fs.readFile(targetDataFile);
  assert.deepEqual(await fs.readFile(targetDataFile), before);
  assert.equal(first.json().comparison.baselineVersionId, null);
});

test('Draft edit, explicit refresh, and deterministic previews preserve Manual PM input and one content model', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, () => {}, runtimeOptions());
  const prepared = await createPreparedDraft(app, targetDataFile);
  let manual = prepared.draft.facts.find(fact => fact.kind === 'manual-input');
  assert.equal(manual.title, 'Manual PM input');
  assert.equal(manual.provenance.label, 'Manual PM input');
  assert.equal(Object.hasOwn(manual.provenance, 'evidenceId'), false);

  let response = await requestApp(app, { url: `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}` });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json().version.frozenSnapshot.selectedFactIds, prepared.draft.frozenSnapshot.selectedFactIds);
  response = await jsonRequest(app, 'PATCH', `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}`, {
    expectedRevision: prepared.revision,
    actor: 'phase4-test-reviewer',
    selectedFactIds: [...prepared.draft.frozenSnapshot.selectedFactIds].reverse(),
    manualInputs: [{ id: manual.recordId, section: 'risk', text: `${manual.text} Updated after explicit PM review.` }]
  });
  assert.equal(response.status, 200);
  prepared.revision = response.headers['x-priorena-target-revision'];
  prepared.draft = response.json().version;
  manual = prepared.draft.facts.find(fact => fact.kind === 'manual-input');
  assert.equal(manual.section, 'risk');
  assert.match(manual.text, /Updated after explicit PM review/);

  response = await jsonRequest(app, 'POST', `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}/outputs/preview`, {});
  assert.equal(response.status, 200);
  const preview = response.json();
  assert.equal(preview.lifecycleUnchanged, true);
  assert.equal(new Set(preview.outputs.map(output => output.contentHash)).size, 1);
  assert.deepEqual(preview.outputs.map(output => output.format), ['teams', 'email', 'confluence']);
  assert.ok(preview.outputs.every(output => JSON.stringify(output.factIds) === JSON.stringify(preview.content.factIds)));
  assert.ok(preview.outputs.every(output => JSON.stringify(output.manualInputIds) === JSON.stringify(preview.content.manualInputIds)));
  assert.ok(preview.outputs.every(output => output.text.includes('Manual PM input')));
  assert.ok(preview.outputs.every(output => output.text.includes('<img src=x onerror=fictional()>')));
  assert.doesNotMatch(JSON.stringify(preview), /workspace-beta|org-fixture-beta|IGNORE PRIOR INSTRUCTIONS/i);

  response = await jsonRequest(app, 'POST', `${workspaceBase(ALPHA)}/work-items`, {
    expectedRevision: prepared.revision,
    actor: 'phase4-test-reviewer',
    workItem: {
      scopeId: null,
      itemType: 'Task',
      summary: 'Fictional newly captured delivery item',
      canonicalStatus: 'Planned',
      currentStateProvenance: 'fictional-manual-review',
      currentStateConfidence: 'confirmed'
    }
  });
  assert.equal(response.status, 200);

  response = await jsonRequest(app, 'POST', `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}/outputs/preview`, {});
  assert.equal(response.status, 409);
  assert.equal(response.json().error.code, 'PREVIEW_CONFLICT');

  response = await jsonRequest(app, 'POST', `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}/refresh`, {
    expectedRevision: await currentRevision(targetDataFile),
    actor: 'phase4-test-reviewer'
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().reconciliation.manualInputsPreserved, 1);
  assert.ok(response.json().reconciliation.addedCandidateFactIds.length >= 1);
  assert.ok(response.json().version.facts.some(fact => fact.kind === 'manual-input' && fact.text === manual.text));
  assert.deepEqual(response.json().version.frozenSnapshot.selectedFactIds, prepared.draft.frozenSnapshot.selectedFactIds);
  assert.equal(response.json().version.comparisonVersionId, null);
});

test('Finalize is previewed, freezes one content model, remains Open, and does not advance baseline', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, () => {}, runtimeOptions());
  const prepared = await createPreparedDraft(app, targetDataFile);
  const beforePreview = await fs.readFile(targetDataFile);
  let response = await jsonRequest(app, 'POST', `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}/finalize/preview`, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await fs.readFile(targetDataFile), beforePreview);
  const preview = response.json();
  assert.equal(preview.writes, 0);
  assert.equal(preview.version.status, 'draft');
  assert.equal(preview.audienceProfile, prepared.briefing.audienceProfile);
  assert.equal(preview.manualInputs[0].label, 'Manual PM input');
  assert.ok(preview.snapshotBasis.candidateStateHash);

  response = await jsonRequest(app, 'POST', `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}/finalize`, {
    expectedRevision: preview.expectedRevision,
    actor: 'phase4-test-reviewer',
    draftStateHash: '0'.repeat(64)
  });
  assert.equal(response.status, 409);
  let unchanged = await persisted(targetDataFile);
  assert.equal(unchanged.document.briefingVersions.find(item => item.id === prepared.draft.id).status, 'draft');
  assert.equal(unchanged.document.auditEvents.some(event => event.entityId === prepared.draft.id && event.action === 'briefing-version-finalized'), false);

  response = await jsonRequest(app, 'POST', `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}/finalize`, {
    expectedRevision: preview.expectedRevision,
    actor: 'phase4-test-reviewer',
    draftStateHash: preview.draftStateHash
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().version.status, 'finalized');
  assert.equal(response.json().baselineAdvanced, false);
  assert.equal(response.json().communicationPerformed, false);
  assert.equal(response.json().outputs.length, 3);

  const finalRevision = response.headers['x-priorena-target-revision'];
  const open = await requestApp(app, { url: `${briefingBase()}/${prepared.briefing.id}/versions/open` });
  assert.equal(open.status, 200);
  assert.ok(open.json().versions.some(version => version.id === prepared.draft.id && version.status === 'finalized'));
  const history = await requestApp(app, { url: `${briefingBase()}/${prepared.briefing.id}/versions/history` });
  assert.equal(history.status, 200);
  assert.equal(history.json().versions.some(version => version.id === prepared.draft.id), false);

  const beforeOutputRead = await fs.readFile(targetDataFile);
  const frozenOutput = await requestApp(app, { url: `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}/outputs/teams` });
  assert.equal(frozenOutput.status, 200);
  assert.equal(frozenOutput.json().output.format, 'teams');
  assert.equal(frozenOutput.json().lifecycleUnchanged, true);
  assert.deepEqual(await fs.readFile(targetDataFile), beforeOutputRead);

  response = await jsonRequest(app, 'PATCH', `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}`, {
    expectedRevision: finalRevision,
    actor: 'phase4-test-reviewer',
    selectedFactIds: [],
    manualInputs: []
  });
  assert.equal(response.status, 400);

  const { document } = await persisted(targetDataFile);
  const briefing = document.briefings.find(item => item.id === prepared.briefing.id);
  assert.equal(briefing.lastCommunicatedVersionId, null);
  assert.equal(document.auditEvents.filter(event => event.entityId === prepared.draft.id && event.action === 'briefing-version-finalized').length, 1);
});

test('Mark Communicated records but never sends, advances baseline atomically, and moves immutable output to History', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, () => {}, runtimeOptions());
  const prepared = await createPreparedDraft(app, targetDataFile);
  let response = await jsonRequest(app, 'POST', `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}/finalize/preview`, {});
  const finalizePreview = response.json();
  response = await jsonRequest(app, 'POST', `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}/finalize`, {
    expectedRevision: finalizePreview.expectedRevision,
    actor: 'phase4-test-reviewer',
    draftStateHash: finalizePreview.draftStateHash
  });
  const finalizedRevision = response.headers['x-priorena-target-revision'];
  const outputBefore = response.json().outputs;

  const beforePreview = await fs.readFile(targetDataFile);
  response = await jsonRequest(app, 'POST', `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}/communicate/preview`, { outputFormat: 'teams' });
  assert.equal(response.status, 200);
  assert.deepEqual(await fs.readFile(targetDataFile), beforePreview);
  const communicatePreview = response.json();
  assert.match(communicatePreview.statement, /record an external action/i);
  assert.match(communicatePreview.statement, /not send/i);
  assert.equal(communicatePreview.writes, 0);

  response = await jsonRequest(app, 'POST', `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}/communicate`, {
    expectedRevision: finalizedRevision,
    actor: 'phase4-test-reviewer',
    outputFormat: 'teams',
    channel: 'teams',
    referenceNote: '',
    communicatedAt: '2026-08-08T12:00:00.000Z',
    versionContentHash: communicatePreview.versionContentHash
  });
  assert.equal(response.status, 400);

  response = await jsonRequest(app, 'POST', `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}/communicate`, {
    expectedRevision: finalizedRevision,
    actor: 'phase4-test-reviewer',
    outputFormat: 'teams',
    channel: 'teams',
    referenceNote: 'Copied into a fictional delivery channel.',
    communicatedAt: COMMUNICATED_AT,
    versionContentHash: '0'.repeat(64)
  });
  assert.equal(response.status, 409);
  let current = await persisted(targetDataFile);
  assert.equal(current.document.briefings.find(item => item.id === prepared.briefing.id).lastCommunicatedVersionId, null);
  assert.equal(current.document.briefingVersions.find(item => item.id === prepared.draft.id).status, 'finalized');
  assert.equal(current.document.auditEvents.some(event => event.entityId === prepared.draft.id && event.action === AUDIT_ACTIONS.BRIEFING_VERSION_COMMUNICATED), false);

  response = await jsonRequest(app, 'POST', `${briefingBase()}/${prepared.briefing.id}/versions/${prepared.draft.id}/communicate`, {
    expectedRevision: finalizedRevision,
    actor: 'phase4-test-reviewer',
    outputFormat: 'teams',
    channel: 'teams',
    referenceNote: 'Copied into a fictional delivery channel.',
    communicatedAt: COMMUNICATED_AT,
    versionContentHash: communicatePreview.versionContentHash
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().version.status, 'communicated');
  assert.equal(response.json().baselineAdvanced, true);
  assert.equal(response.json().sent, false);
  assert.deepEqual(response.json().version.communication, {
    channel: 'teams', outputFormat: 'teams', referenceNote: 'Copied into a fictional delivery channel.', actor: 'phase4-test-reviewer'
  });

  current = await persisted(targetDataFile);
  const version = current.document.briefingVersions.find(item => item.id === prepared.draft.id);
  assert.deepEqual(version.outputs, outputBefore);
  assert.equal(current.document.briefings.find(item => item.id === prepared.briefing.id).lastCommunicatedVersionId, version.id);
  const events = current.document.auditEvents.filter(event => event.entityId === version.id && event.action === AUDIT_ACTIONS.BRIEFING_VERSION_COMMUNICATED);
  assert.equal(events.length, 1);
  assert.equal(events[0].timestamp, COMMUNICATED_AT);

  const open = await requestApp(app, { url: `${briefingBase()}/${prepared.briefing.id}/versions/open` });
  const history = await requestApp(app, { url: `${briefingBase()}/${prepared.briefing.id}/versions/history` });
  assert.equal(open.json().versions.some(item => item.id === version.id), false);
  assert.ok(history.json().versions.some(item => item.id === version.id && item.status === 'communicated'));

  const nextCandidates = await jsonRequest(app, 'POST', `${briefingBase()}/${prepared.briefing.id}/candidates/prepare`, {});
  assert.equal(nextCandidates.status, 200);
  assert.equal(nextCandidates.json().comparison.baselineVersionId, version.id);
  const nextDraft = await jsonRequest(app, 'POST', `${briefingBase()}/${prepared.briefing.id}/versions`, {
    expectedRevision: nextCandidates.headers['x-priorena-target-revision'],
    actor: 'phase4-test-reviewer',
    selectedFactIds: [nextCandidates.json().candidates[0].id],
    manualInputs: []
  });
  assert.equal(nextDraft.status, 200);
  assert.equal(nextDraft.json().version.comparisonVersionId, version.id);
  assert.equal(nextDraft.json().version.frozenSnapshot.comparison.baselineVersionId, version.id);

  response = await jsonRequest(app, 'POST', `${briefingBase()}/${prepared.briefing.id}/versions/${version.id}/communicate`, {
    expectedRevision: nextDraft.headers['x-priorena-target-revision'],
    actor: 'phase4-test-reviewer',
    outputFormat: 'teams',
    channel: 'teams',
    referenceNote: '',
    communicatedAt: COMMUNICATED_AT,
    versionContentHash: communicatePreview.versionContentHash
  });
  assert.equal(response.status, 400);
});

test('wrong-parent Briefing and Version routes remain non-revealing and unsupported methods fail closed', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, () => {}, runtimeOptions());
  const prepared = await createPreparedDraft(app, targetDataFile);
  let response = await jsonRequest(app, 'POST', `${briefingBase(BETA.organizationId)}/${prepared.briefing.id}/candidates/prepare`, {});
  assert.equal(response.status, 404);
  assert.doesNotMatch(response.body, /Alpha|briefing-phase4/i);
  response = await jsonRequest(app, 'POST', `${briefingBase(BETA.organizationId)}/briefing-beta/versions/${prepared.draft.id}/refresh`, {
    expectedRevision: await currentRevision(targetDataFile),
    actor: 'phase4-test-reviewer'
  });
  assert.equal(response.status, 404);
  assert.doesNotMatch(response.body, /Alpha|phase4-briefingVersion/i);
  response = await jsonRequest(app, 'PUT', `${briefingBase()}/${prepared.briefing.id}`, {});
  assert.equal(response.status, 405);
  assert.equal(response.json().error.code, 'METHOD_NOT_ALLOWED');
});

test('every Briefing lifecycle and output command rejects recursively nested foreign content', async t => {
  let finalizedContentHash;
  const { app, targetDataFile } = await createTargetApiHarness(t, ({ document }) => {
    const briefing = document.briefings.find(item => item.id === 'briefing-alpha');
    const foreignWorkItem = document.workItems.find(item => item.id === 'work-item-beta-assigned');
    const candidates = buildCandidateFacts(document, {
      organizationId: briefing.organizationId,
      workspaceIds: briefing.workspaceIds,
      scopeIds: briefing.scopeIds,
      defaultSections: briefing.defaultSections
    });
    const definitionSnapshot = {
      briefingId: briefing.id,
      name: briefing.name,
      briefingType: 'status-update',
      audienceProfile: briefing.audienceProfile,
      preferredFormats: [...briefing.preferredFormats],
      defaultSections: [...briefing.defaultSections],
      draftingGuidance: '',
      workspaceIds: [...briefing.workspaceIds],
      scopeIds: [...briefing.scopeIds],
      workspaces: briefing.workspaceIds.map(workspaceId => {
        const workspace = document.workspaces.find(item => item.id === workspaceId);
        const selectedScopes = document.scopes.filter(scope => briefing.scopeIds.includes(scope.id) && scope.workspaceId === workspaceId);
        return {
          id: workspace.id,
          name: workspace.name,
          selection: selectedScopes.length
            ? { kind: 'selected-scopes', label: selectedScopes.map(scope => scope.name).join(', '), scopes: selectedScopes.map(scope => ({ id: scope.id, name: scope.name })) }
            : { kind: 'entire-workspace', label: 'Entire workspace', scopes: [] }
        };
      })
    };
    document.briefingVersions.push({
      id: 'briefing-version-alpha-foreign-draft',
      organizationId: briefing.organizationId,
      briefingId: briefing.id,
      workspaceIds: [...briefing.workspaceIds],
      scopeIds: [...briefing.scopeIds],
      status: 'draft',
      comparisonVersionId: null,
      frozenSnapshot: {
        schema: 'priorena-briefing-draft-v1',
        definition: definitionSnapshot,
        candidates,
        candidateStateHash: stateHash(candidates),
        selectedFactIds: [],
        manualInputs: [],
        comparison: { baselineVersionId: null, addedFactIds: [], changedFactIds: [], removedFactIds: [] },
        preparedAt: NOW
      },
      facts: [{ id: 'fact:foreign-nested', nestedRecord: structuredClone(foreignWorkItem) }],
      outputs: [],
      createdAt: NOW,
      finalizedAt: null,
      communicatedAt: null,
      communication: null
    });
    const finalized = document.briefingVersions.find(item => item.id === 'briefing-version-alpha-communicated');
    finalized.frozenSnapshot = { fixture: 'ALPHA BRIEFING SENTINEL', nestedRecord: structuredClone(foreignWorkItem) };
    finalized.facts = [{ id: 'fact:foreign-finalized', nestedRecord: structuredClone(foreignWorkItem) }];
    finalized.outputs = [{
      format: 'teams', mediaType: 'text/plain', contentHash: 'a'.repeat(64),
      factIds: ['fact:foreign-finalized'], manualInputIds: [], text: 'Fictional bounded output.'
    }];
    finalizedContentHash = frozenContentHash(finalized);
  }, runtimeOptions());

  const before = await fs.readFile(targetDataFile);
  const draftBase = `${briefingBase()}/briefing-alpha/versions/briefing-version-alpha-foreign-draft`;
  const finalizedBase = `${briefingBase()}/briefing-alpha/versions/briefing-version-alpha-communicated`;
  const cases = [
    await jsonRequest(app, 'PATCH', draftBase, {
      expectedRevision: await currentRevision(targetDataFile),
      actor: 'phase4-test-reviewer',
      selectedFactIds: [],
      manualInputs: []
    }),
    await jsonRequest(app, 'POST', `${draftBase}/refresh`, {
      expectedRevision: await currentRevision(targetDataFile),
      actor: 'phase4-test-reviewer'
    }),
    await jsonRequest(app, 'POST', `${draftBase}/outputs/preview`, {}),
    await jsonRequest(app, 'POST', `${draftBase}/finalize/preview`, {}),
    await jsonRequest(app, 'POST', `${finalizedBase}/communicate/preview`, { outputFormat: 'teams' }),
    await jsonRequest(app, 'POST', `${finalizedBase}/communicate`, {
      expectedRevision: await currentRevision(targetDataFile),
      actor: 'phase4-test-reviewer',
      outputFormat: 'teams',
      channel: 'teams',
      referenceNote: '',
      communicatedAt: COMMUNICATED_AT,
      versionContentHash: finalizedContentHash
    })
  ];
  cases.forEach(response => {
    assert.equal(response.status, 404);
    assert.equal(response.json().error.code, 'NOT_FOUND');
    assert.doesNotMatch(response.body, /BETA|work-item-beta|workspace-beta|org-fixture-beta/i);
  });
  assert.deepEqual(await fs.readFile(targetDataFile), before);
});
