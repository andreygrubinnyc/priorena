'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  commentCaptureLabel,
  createTargetWorkflowApiClient,
  createTargetWorkflowController,
  defaultWorkItemUiState,
  filterWorkItems,
  initiativeChoices,
  workItemControlState,
  workItemEmptyState
} = require('../public/target-workflow-state');

const REVISION_A = 'a'.repeat(64);
const REVISION_B = 'b'.repeat(64);

function payload(organizationId, workspaceId, marker = '', revision = REVISION_A) {
  return {
    revision,
    initiatives: [
      { id: `${workspaceId}-initiative-one`, organizationId, workspaceId, name: 'Duplicate Initiative' },
      { id: `${workspaceId}-initiative-two`, organizationId, workspaceId, name: 'Duplicate Initiative' }
    ],
    workstreams: [
      { id: `${workspaceId}-workstream-one`, organizationId, workspaceId, initiativeId: `${workspaceId}-initiative-one`, name: 'Duplicate Workstream' },
      { id: `${workspaceId}-workstream-two`, organizationId, workspaceId, initiativeId: `${workspaceId}-initiative-two`, name: 'Duplicate Workstream' }
    ],
    jiraEpicMappings: [
      {
        id: `${workspaceId}-jira-epic-one`, organizationId, workspaceId,
        initiativeId: `${workspaceId}-initiative-one`, jiraEpicKey: 'FICT-101', jiraEpicName: 'Duplicate Epic', mappingStatus: 'verified'
      },
      {
        id: `${workspaceId}-jira-epic-two`, organizationId, workspaceId,
        initiativeId: `${workspaceId}-initiative-two`, jiraEpicKey: 'FICT-102', jiraEpicName: 'Duplicate Epic', mappingStatus: 'pending'
      }
    ],
    workItems: [
      {
        id: `${workspaceId}-assigned`, organizationId, workspaceId, initiativeId: `${workspaceId}-initiative-two`, workstreamId: `${workspaceId}-workstream-two`,
        jiraEpicMappingId: `${workspaceId}-jira-epic-two`, jiraEpic: { jiraEpicKey: 'FICT-102', jiraEpicName: 'Duplicate Epic' },
        summary: `${marker} assigned fictional item`, jiraKey: null, itemType: 'Task', canonicalStatus: 'Planned', assignee: null, sprint: null
      },
      {
        id: `${workspaceId}-unassigned`, organizationId, workspaceId, initiativeId: null, workstreamId: null, jiraEpicMappingId: null, jiraEpic: null,
        summary: `${marker} Unassigned fictional item`, jiraKey: null, itemType: 'Task', canonicalStatus: 'Planned', assignee: null, sprint: null
      }
    ],
    milestones: [],
    sources: [],
    findings: [],
    evidence: [],
    proposedChanges: []
  };
}

test('workflow filtering uses stable Initiative IDs and preserves Unassigned semantics', () => {
  const data = payload('org-client', 'workspace-client');
  assert.equal(filterWorkItems(data.workItems, { initiativeId: 'all', search: '' }).length, 2);
  assert.deepEqual(
    filterWorkItems(data.workItems, { initiativeId: 'unassigned', search: '' }).map(item => item.id),
    ['workspace-client-unassigned']
  );
  assert.deepEqual(
    filterWorkItems(data.workItems, { initiativeId: 'workspace-client-initiative-two', search: 'assigned' }).map(item => item.id),
    ['workspace-client-assigned']
  );
  assert.deepEqual(
    filterWorkItems(data.workItems, { initiativeId: 'all', workstreamId: 'workspace-client-workstream-two', itemType: 'all', search: '' }).map(item => item.id),
    ['workspace-client-assigned']
  );
  assert.deepEqual(
    filterWorkItems(data.workItems, { initiativeId: 'all', workstreamId: 'none', itemType: 'Task', search: '' }).map(item => item.id),
    ['workspace-client-unassigned']
  );
  assert.deepEqual(
    filterWorkItems(data.workItems, { initiativeId: 'all', workstreamId: 'all', jiraEpicMappingId: 'workspace-client-jira-epic-two', itemType: 'all', search: '' }).map(item => item.id),
    ['workspace-client-assigned']
  );
  assert.deepEqual(
    filterWorkItems(data.workItems, { initiativeId: 'all', workstreamId: 'all', jiraEpicMappingId: 'none', itemType: 'all', search: '' }).map(item => item.id),
    ['workspace-client-unassigned']
  );
  assert.equal(commentCaptureLabel(null), 'No comment date captured');
  assert.equal(commentCaptureLabel('2026-08-11T12:00:00.000Z'), '2026-08-11T12:00:00.000Z');
});

test('Initiative create, archive, and restore propagate one stable ID across every selector surface', () => {
  const selectorSurfaces = [
    'work-item-filter',
    'bulk-assignment',
    'workstream-parent',
    'jira-epic-parent',
    'briefing'
  ];
  let initiatives = [
    { id: 'initiative-existing', name: 'Existing Initiative', archived: false }
  ];

  const created = { id: 'initiative-server-generated', name: 'New Initiative', archived: false };
  initiatives = [...initiatives, created];
  assert.deepEqual(initiativeChoices(initiatives, 'settings').map(item => item.id), [
    'initiative-existing',
    'initiative-server-generated'
  ]);
  selectorSurfaces.forEach(surface => {
    assert.ok(initiativeChoices(initiatives, surface).some(item => item.id === created.id), surface);
  });

  initiatives = initiatives.map(item => item.id === created.id ? { ...item, archived: true } : item);
  assert.equal(initiativeChoices(initiatives, 'settings').find(item => item.id === created.id).archived, true);
  selectorSurfaces.forEach(surface => {
    assert.equal(initiativeChoices(initiatives, surface).some(item => item.id === created.id), false, surface);
  });

  initiatives = initiatives.map(item => item.id === created.id ? { ...item, archived: false } : item);
  selectorSurfaces.forEach(surface => {
    assert.ok(initiativeChoices(initiatives, surface).some(item => item.id === created.id), surface);
  });
  assert.equal(initiatives.find(item => item.name === 'New Initiative').id, created.id);
});

test('Work Item controls track zero, one, and multiple selections with exact valid enablement', () => {
  assert.deepEqual(workItemControlState([], 'unassigned'), {
    count: 0,
    selectedCountLabel: '0 Work Items selected',
    initiativeDisabled: true,
    workstreamDisabled: true,
    jiraEpicDisabled: true,
    previewDisabled: true,
    helperVisible: true
  });
  assert.deepEqual(workItemControlState(['work-item-one'], 'unassigned'), {
    count: 1,
    selectedCountLabel: '1 Work Item selected',
    initiativeDisabled: false,
    workstreamDisabled: true,
    jiraEpicDisabled: true,
    previewDisabled: false,
    helperVisible: false
  });
  assert.deepEqual(workItemControlState(['work-item-one', 'work-item-two'], 'initiative-one'), {
    count: 2,
    selectedCountLabel: '2 Work Items selected',
    initiativeDisabled: false,
    workstreamDisabled: false,
    jiraEpicDisabled: false,
    previewDisabled: false,
    helperVisible: false
  });
  assert.throws(() => workItemControlState(['work-item-one', 'work-item-one']), /unique selection/);
});

test('filter clearing restores records and Workspace changes discard stale Work Item selection', async () => {
  const data = payload('org-client', 'workspace-client');
  const filtered = filterWorkItems(data.workItems, {
    initiativeId: 'all', workstreamId: 'all', jiraEpicMappingId: 'all', itemType: 'Bug', search: ''
  });
  assert.equal(workItemEmptyState(data.workItems.length, filtered.length), 'filtered-no-results');
  const reset = defaultWorkItemUiState();
  const restored = filterWorkItems(data.workItems, { ...reset.filters, search: '' });
  assert.equal(workItemEmptyState(data.workItems.length, restored.length), 'results');
  assert.equal(restored.length, 2);
  assert.equal(workItemEmptyState(0, 0), 'no-data');

  const controller = createTargetWorkflowController({
    async loadWorkspace(organizationId, workspaceId) { return payload(organizationId, workspaceId); },
    async previewBulkWorkItems() { throw new Error('not used'); },
    async applyBulkWorkItems() { throw new Error('not used'); }
  });
  controller.setContext('org-client', 'workspace-client');
  await controller.load();
  controller.selectWorkItems(['workspace-client-assigned', 'workspace-client-unassigned']);
  assert.equal(controller.snapshot().selectedWorkItemIds.length, 2);
  assert.equal(controller.setInitiativeFilter('unassigned').selectedWorkItemIds.length, 0);
  controller.selectWorkItems(['workspace-client-unassigned']);
  const changed = controller.setContext('org-next', 'workspace-next');
  assert.deepEqual(changed.selectedWorkItemIds, []);
  assert.deepEqual(changed.filters, { ...defaultWorkItemUiState().filters, search: '' });
});

test('workflow API client uses only stable parent-scoped routes and explicit JSON mutations', async () => {
  const calls = [];
  const client = createTargetWorkflowApiClient({
    async request(url, options) {
      calls.push({ url, options });
      const route = url.split('?')[0].split('/').pop();
      const bodies = {
        initiatives: { initiatives: [] },
        workstreams: { workstreams: [] },
        'jira-epic-mappings': { jiraEpicMappings: [] },
        'work-items': { workItems: [] },
        milestones: { milestones: [] },
        sources: { sources: [] },
        findings: { findings: [] },
        evidence: { evidence: [] },
        'proposed-changes': { proposedChanges: [] },
        preview: { preview: { rows: [] } },
        apply: { changedCount: 0, revision: REVISION_B }
      };
      return {
        ok: true,
        headers: { get: () => REVISION_A },
        async json() { return bodies[route]; }
      };
    }
  });
  await client.loadWorkspace('org-client', 'workspace-client');
  await client.previewBulkWorkItems('org-client', 'workspace-client', { workItemIds: ['work-item-one'], action: { type: 'assign-initiative', initiativeId: null } });
  await client.applyBulkWorkItems('org-client', 'workspace-client', {
    expectedRevision: REVISION_A,
    actor: 'local-client',
    workItemIds: ['work-item-one'],
    action: { type: 'assign-initiative', initiativeId: null },
    previewHash: REVISION_A
  });
  assert.equal(calls.length, 11);
  assert.ok(calls.every(call => call.url.startsWith('/api/v2/organizations/org-client/workspaces/workspace-client/')));
  assert.equal(calls.at(-1).options.method, 'POST');
  assert.match(calls.at(-1).options.body, /expectedRevision/);
  await assert.rejects(client.loadWorkspace('org-client', 'Duplicate Workspace'), /stable opaque ID/);
});

test('workflow API client preserves bounded Import Feed validation metadata for UI guidance', async () => {
  const client = createTargetWorkflowApiClient({
    async request() {
      return {
        ok: false,
        headers: { get: () => null },
        async json() {
          return {
            error: {
              code: 'IMPORT_VALIDATION_FAILED',
              message: 'Import feed validation failed',
              validation: { reason: 'invalid-field', recordIndex: 1, field: 'jiraEpicKey' }
            }
          };
        }
      };
    }
  });
  await assert.rejects(
    client.previewImport('org-client', 'workspace-client', { input: {} }),
    error => error.code === 'IMPORT_VALIDATION_FAILED' &&
      error.validation.reason === 'invalid-field' &&
      error.validation.recordIndex === 1 &&
      error.validation.field === 'jiraEpicKey'
  );
});

test('workflow controller renders an accessible confirmation model and refreshes after success', async () => {
  let current = payload('org-client', 'workspace-client');
  const calls = [];
  const controller = createTargetWorkflowController({
    async loadWorkspace() { calls.push('load'); return structuredClone(current); },
    async previewBulkWorkItems(organizationId, workspaceId, value) {
      calls.push('preview');
      return {
        preview: {
          organizationId,
          workspaceId,
          action: value.action.type,
          field: 'initiativeId',
          rows: value.workItemIds.map(workItemId => ({ workItemId, before: null, after: `${workspaceId}-initiative-one` })),
          expectedRevision: REVISION_A,
          previewHash: 'c'.repeat(64)
        }
      };
    },
    async applyBulkWorkItems() {
      calls.push('apply');
      current = payload('org-client', 'workspace-client', '', REVISION_B);
      current.workItems.find(item => item.id.endsWith('-unassigned')).initiativeId = 'workspace-client-initiative-one';
      return { changedCount: 1, revision: REVISION_B };
    }
  });
  controller.setContext('org-client', 'workspace-client');
  await controller.load();
  controller.setInitiativeFilter('unassigned');
  controller.selectWorkItems(['workspace-client-unassigned']);
  let state = await controller.previewBulk({ type: 'assign-initiative', initiativeId: 'workspace-client-initiative-one' });
  assert.equal(state.confirmation.open, true);
  assert.equal(state.confirmation.role, 'dialog');
  assert.equal(state.confirmation.ariaModal, true);
  assert.equal(state.confirmation.label, 'Confirm approved Work Item changes');
  assert.equal(calls.includes('apply'), false);
  state = await controller.confirmBulk('local-client-session');
  assert.equal(state.status.kind, 'success');
  assert.equal(state.revision, REVISION_B);
  assert.equal(state.selectedWorkItemIds.length, 0);
  assert.equal(state.workItems.find(item => item.id === 'workspace-client-unassigned').initiativeId, 'workspace-client-initiative-one');
  assert.deepEqual(calls, ['load', 'preview', 'apply', 'load']);
});

test('cancelling confirmation applies nothing and leaves a clear status', async () => {
  let applied = false;
  const controller = createTargetWorkflowController({
    async loadWorkspace() { return payload('org-client', 'workspace-client'); },
    async previewBulkWorkItems() {
      return { preview: { rows: [{ workItemId: 'workspace-client-unassigned', before: null, after: 'workspace-client-initiative-one' }], expectedRevision: REVISION_A, previewHash: 'd'.repeat(64) } };
    },
    async applyBulkWorkItems() { applied = true; return { changedCount: 1, revision: REVISION_B }; }
  });
  controller.setContext('org-client', 'workspace-client');
  await controller.load();
  controller.selectWorkItems(['workspace-client-unassigned']);
  await controller.previewBulk({ type: 'assign-initiative', initiativeId: 'workspace-client-initiative-one' });
  const state = controller.cancelConfirmation();
  assert.equal(applied, false);
  assert.equal(state.confirmation, null);
  assert.equal(state.status.message, 'No changes were applied.');
});

test('Organization and Workspace changes clear state and discard late foreign responses', async () => {
  let releaseAlpha;
  const alpha = new Promise(resolve => { releaseAlpha = resolve; });
  const controller = createTargetWorkflowController({
    async loadWorkspace(organizationId, workspaceId) {
      if (organizationId === 'org-alpha') return alpha;
      return payload(organizationId, workspaceId, 'BETA CURRENT');
    },
    async previewBulkWorkItems() { throw new Error('not used'); },
    async applyBulkWorkItems() { throw new Error('not used'); }
  });
  controller.setContext('org-alpha', 'workspace-alpha');
  const lateLoad = controller.load();
  controller.setContext('org-beta', 'workspace-beta');
  let state = controller.snapshot();
  assert.equal(state.workItems.length, 0);
  assert.equal(state.preview, null);
  await controller.load();
  releaseAlpha(payload('org-alpha', 'workspace-alpha', 'ALPHA LATE SENTINEL'));
  await lateLoad;
  state = controller.snapshot();
  assert.equal(state.activeOrganizationId, 'org-beta');
  assert.match(JSON.stringify(state), /BETA CURRENT/);
  assert.doesNotMatch(JSON.stringify(state), /ALPHA LATE SENTINEL|org-alpha|workspace-alpha/);
});

test('foreign payloads and stale previews fail closed with inline conflict feedback', async () => {
  let returnForeign = true;
  const controller = createTargetWorkflowController({
    async loadWorkspace() {
      return returnForeign ? payload('org-foreign', 'workspace-foreign', 'FOREIGN SENTINEL') : payload('org-client', 'workspace-client');
    },
    async previewBulkWorkItems() {
      const error = new Error('stale');
      error.code = 'REVISION_CONFLICT';
      throw error;
    },
    async applyBulkWorkItems() { throw new Error('not used'); }
  });
  controller.setContext('org-client', 'workspace-client');
  let state = await controller.load();
  assert.equal(state.workItems.length, 0);
  assert.equal(state.status.kind, 'error');
  assert.doesNotMatch(JSON.stringify(state), /FOREIGN SENTINEL|org-foreign/);

  returnForeign = false;
  await controller.load();
  controller.selectWorkItems(['workspace-client-unassigned']);
  state = await controller.previewBulk({ type: 'assign-initiative', initiativeId: 'workspace-client-initiative-one' });
  assert.equal(state.conflict, true);
  assert.equal(state.status.kind, 'conflict');
  assert.match(state.status.message, /Refresh/);
  assert.equal(state.workItems.length, 0);
});

test('isolated target workflow client contains no blocking native dialog calls', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'target-workflow-state.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(source, /organizationName|workspaceName/);
});
