'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  commentCaptureLabel,
  createTargetWorkflowApiClient,
  createTargetWorkflowController,
  filterWorkItems
} = require('../public/target-workflow-state');

const REVISION_A = 'a'.repeat(64);
const REVISION_B = 'b'.repeat(64);

function payload(organizationId, workspaceId, marker = '', revision = REVISION_A) {
  return {
    revision,
    scopes: [
      { id: `${workspaceId}-scope-one`, organizationId, workspaceId, name: 'Duplicate Scope' },
      { id: `${workspaceId}-scope-two`, organizationId, workspaceId, name: 'Duplicate Scope' }
    ],
    workItems: [
      {
        id: `${workspaceId}-assigned`, organizationId, workspaceId, scopeId: `${workspaceId}-scope-two`,
        summary: `${marker} assigned fictional item`, jiraKey: null, canonicalStatus: 'Planned', assignee: null, sprint: null
      },
      {
        id: `${workspaceId}-unassigned`, organizationId, workspaceId, scopeId: null,
        summary: `${marker} Unassigned fictional item`, jiraKey: null, canonicalStatus: 'Planned', assignee: null, sprint: null
      }
    ],
    milestones: [],
    sources: [],
    findings: [],
    evidence: [],
    proposedChanges: []
  };
}

test('workflow filtering uses stable Scope IDs and preserves Unassigned semantics', () => {
  const data = payload('org-client', 'workspace-client');
  assert.equal(filterWorkItems(data.workItems, { scopeId: 'all', search: '' }).length, 2);
  assert.deepEqual(
    filterWorkItems(data.workItems, { scopeId: 'unassigned', search: '' }).map(item => item.id),
    ['workspace-client-unassigned']
  );
  assert.deepEqual(
    filterWorkItems(data.workItems, { scopeId: 'workspace-client-scope-two', search: 'assigned' }).map(item => item.id),
    ['workspace-client-assigned']
  );
  assert.equal(commentCaptureLabel(null), 'No comment date captured');
  assert.equal(commentCaptureLabel('2026-08-11T12:00:00.000Z'), '2026-08-11T12:00:00.000Z');
});

test('workflow API client uses only stable parent-scoped routes and explicit JSON mutations', async () => {
  const calls = [];
  const client = createTargetWorkflowApiClient({
    async request(url, options) {
      calls.push({ url, options });
      const route = url.split('?')[0].split('/').pop();
      const bodies = {
        scopes: { scopes: [] },
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
  await client.previewBulkWorkItems('org-client', 'workspace-client', { workItemIds: ['work-item-one'], action: { type: 'assign-scope', scopeId: null } });
  await client.applyBulkWorkItems('org-client', 'workspace-client', {
    expectedRevision: REVISION_A,
    actor: 'local-client',
    workItemIds: ['work-item-one'],
    action: { type: 'assign-scope', scopeId: null },
    previewHash: REVISION_A
  });
  assert.equal(calls.length, 9);
  assert.ok(calls.every(call => call.url.startsWith('/api/v2/organizations/org-client/workspaces/workspace-client/')));
  assert.equal(calls.at(-1).options.method, 'POST');
  assert.match(calls.at(-1).options.body, /expectedRevision/);
  await assert.rejects(client.loadWorkspace('org-client', 'Duplicate Workspace'), /stable opaque ID/);
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
          field: 'scopeId',
          rows: value.workItemIds.map(workItemId => ({ workItemId, before: null, after: `${workspaceId}-scope-one` })),
          expectedRevision: REVISION_A,
          previewHash: 'c'.repeat(64)
        }
      };
    },
    async applyBulkWorkItems() {
      calls.push('apply');
      current = payload('org-client', 'workspace-client', '', REVISION_B);
      current.workItems.find(item => item.id.endsWith('-unassigned')).scopeId = 'workspace-client-scope-one';
      return { changedCount: 1, revision: REVISION_B };
    }
  });
  controller.setContext('org-client', 'workspace-client');
  await controller.load();
  controller.setScopeFilter('unassigned');
  controller.selectWorkItems(['workspace-client-unassigned']);
  let state = await controller.previewBulk({ type: 'assign-scope', scopeId: 'workspace-client-scope-one' });
  assert.equal(state.confirmation.open, true);
  assert.equal(state.confirmation.role, 'dialog');
  assert.equal(state.confirmation.ariaModal, true);
  assert.equal(state.confirmation.label, 'Confirm approved Work Item changes');
  assert.equal(calls.includes('apply'), false);
  state = await controller.confirmBulk('local-client-session');
  assert.equal(state.status.kind, 'success');
  assert.equal(state.revision, REVISION_B);
  assert.equal(state.selectedWorkItemIds.length, 0);
  assert.equal(state.workItems.find(item => item.id === 'workspace-client-unassigned').scopeId, 'workspace-client-scope-one');
  assert.deepEqual(calls, ['load', 'preview', 'apply', 'load']);
});

test('cancelling confirmation applies nothing and leaves a clear status', async () => {
  let applied = false;
  const controller = createTargetWorkflowController({
    async loadWorkspace() { return payload('org-client', 'workspace-client'); },
    async previewBulkWorkItems() {
      return { preview: { rows: [{ workItemId: 'workspace-client-unassigned', before: null, after: 'workspace-client-scope-one' }], expectedRevision: REVISION_A, previewHash: 'd'.repeat(64) } };
    },
    async applyBulkWorkItems() { applied = true; return { changedCount: 1, revision: REVISION_B }; }
  });
  controller.setContext('org-client', 'workspace-client');
  await controller.load();
  controller.selectWorkItems(['workspace-client-unassigned']);
  await controller.previewBulk({ type: 'assign-scope', scopeId: 'workspace-client-scope-one' });
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
  state = await controller.previewBulk({ type: 'assign-scope', scopeId: 'workspace-client-scope-one' });
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
