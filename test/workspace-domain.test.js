const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeWorkspaceCollections,
  createDeliveryProject,
  assertUniqueDeliveryProject,
  resolveDeliveryProjectAssociation
} = require('../workspaces/workspace-domain');

test('legacy containers become PM workspaces without guessing Epic associations', () => {
  const data = { projects: { 'Fictional Workspace': { stories: [{ id: 'story-1', itemType: 'Story' }] } } };
  normalizeWorkspaceCollections(data);
  assert.deepEqual(data.projects['Fictional Workspace'].deliveryProjects, []);
  assert.equal(data.projects['Fictional Workspace'].stories[0].deliveryProjectId, '');
});

test('Projects map to unique Jira Epics and associations require exact reviewed values', () => {
  const project = createDeliveryProject({
    name: 'Fictional ingestion', jiraEpicKey: 'demo-10', jiraEpicName: 'Fictional Ingestion Epic',
    owner: 'Taylor', planningTarget: 'Q4 planning target', description: '', workstreams: []
  }, { id: 'project-1', now: '2026-07-20T12:00:00.000Z' });
  const workspace = { deliveryProjects: [project] };
  assert.equal(project.jiraEpicKey, 'DEMO-10');
  assert.deepEqual(resolveDeliveryProjectAssociation(workspace, { jiraEpicKey: 'DEMO-10' }), { status: 'matched-key', deliveryProjectId: 'project-1' });
  assert.deepEqual(resolveDeliveryProjectAssociation(workspace, { jiraEpicName: 'Fictional Ingestion Epic' }), { status: 'matched-name', deliveryProjectId: 'project-1' });
  assert.equal(resolveDeliveryProjectAssociation(workspace, { jiraEpicName: 'Similar ingestion title' }).status, 'unresolved');
  assert.throws(() => assertUniqueDeliveryProject(workspace, { ...project, id: 'project-2' }), /already exists/);
});

test('orphaned legacy Project references are cleared rather than silently reassigned', () => {
  const data = { projects: { Demo: { deliveryProjects: [], stories: [{ id: 'story-1', deliveryProjectId: 'missing' }] } } };
  normalizeWorkspaceCollections(data);
  assert.equal(data.projects.Demo.stories[0].deliveryProjectId, '');
});
