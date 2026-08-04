const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyBulkChange,
  buildBulkPreview,
  buildDeletePreview,
  deleteBulkStories,
  saveView,
  undoBulkChange
} = require('../work-items/bulk-domain');

let sequence = 0;
const makeId = prefix => `${prefix}-fictional-${++sequence}`;

function fictionalWorkspace() {
  return {
    deliveryProjects: [{ id: 'delivery-fictional', name: 'Fictional Launch', archived: false }],
    timeline: [{ id: 'milestone-fictional', title: 'Fictional milestone' }],
    stories: [
      {
        id: 'story-fictional-1',
        jiraId: 'DEMO-101',
        summary: 'Prepare fictional launch checklist',
        itemType: 'Story',
        labels: ['planned'],
        assignee: '',
        owner: '',
        sprint: '',
        tracked: false,
        deliveryProjectId: '',
        timelineId: '',
        archived: false
      },
      {
        id: 'story-fictional-2',
        jiraId: 'DEMO-102',
        summary: 'Review fictional readiness notes',
        itemType: 'Task',
        labels: ['ready'],
        assignee: 'Jordan Rivera',
        owner: 'Jordan Rivera',
        sprint: 'Sprint 1',
        tracked: true,
        deliveryProjectId: '',
        timelineId: '',
        archived: false
      }
    ]
  };
}

test('bulk work-item changes preview exact fields and require a current preview', () => {
  const workspace = fictionalWorkspace();
  const request = {
    itemIds: ['story-fictional-1', 'story-fictional-2'],
    patch: {
      deliveryProjectId: 'delivery-fictional',
      assignee: 'Morgan Lee',
      sprint: 'Sprint 2',
      tracked: true,
      timelineId: 'milestone-fictional',
      labelsAdd: ['reviewed'],
      labelsRemove: ['planned']
    }
  };
  const preview = buildBulkPreview(workspace, request);
  assert.equal(preview.changed, 2);
  assert.deepEqual(preview.items[0].changedFields, [
    'deliveryProjectId', 'assignee', 'owner', 'sprint', 'tracked', 'timelineId', 'labels'
  ]);

  const expected = Object.fromEntries(preview.items.map(item => [item.id, item.expectedHash]));
  const result = applyBulkChange(workspace, { ...request, expected, summary: 'Fictional bulk review' }, makeId);
  assert.equal(result.changed, 2);
  assert.equal(workspace.stories[0].assignee, 'Morgan Lee');
  assert.equal(workspace.stories[0].owner, 'Morgan Lee');
  assert.deepEqual(workspace.stories[0].labels, ['reviewed']);
  assert.equal(workspace.workItemChangeHistory[0].kind, 'bulk-update');

  assert.throws(
    () => applyBulkChange(workspace, { ...request, expected }, makeId),
    /changed after preview/
  );
});

test('archive and undo preserve work-item identity and later changes block stale undo', () => {
  const workspace = fictionalWorkspace();
  const request = { itemIds: ['story-fictional-1'], patch: { archived: true } };
  const preview = buildBulkPreview(workspace, request);
  const result = applyBulkChange(workspace, {
    ...request,
    expected: { 'story-fictional-1': preview.items[0].expectedHash },
    summary: 'Archive one fictional item'
  }, makeId, '2026-07-29T12:00:00.000Z');
  assert.equal(workspace.stories[0].archived, true);
  assert.equal(workspace.stories[0].archivedAt, '2026-07-29T12:00:00.000Z');

  undoBulkChange(workspace, result.entry.id, '2026-07-29T12:05:00.000Z');
  assert.equal(workspace.stories[0].archived, false);
  assert.equal(result.entry.undoneAt, '2026-07-29T12:05:00.000Z');
  assert.throws(() => undoBulkChange(workspace, result.entry.id), /already been undone/);
});

test('protected deletion requires typed confirmation and can be restored from history', () => {
  const workspace = fictionalWorkspace();
  const preview = buildDeletePreview(workspace, { itemIds: ['story-fictional-2'] });
  const request = {
    itemIds: ['story-fictional-2'],
    expected: { 'story-fictional-2': preview.items[0].expectedHash },
    confirmation: 'DELETE 1'
  };
  assert.throws(
    () => deleteBulkStories(fictionalWorkspace(), { ...request, confirmation: 'delete' }, makeId),
    /Type DELETE 1/
  );
  const result = deleteBulkStories(workspace, request, makeId);
  assert.equal(workspace.stories.length, 1);
  undoBulkChange(workspace, result.entry.id);
  assert.equal(workspace.stories.length, 2);
  assert.equal(workspace.stories[0].id, 'story-fictional-2');
});

test('saved work-item views are bounded, explicit, and update by case-insensitive name', () => {
  const workspace = fictionalWorkspace();
  const first = saveView(workspace, {
    name: 'Needs ownership',
    filters: { type: 'all', status: 'all', assignee: '__gap__', sprint: 'all', search: '', archive: 'active', gap: 'unassigned' }
  }, makeId);
  const updated = saveView(workspace, {
    name: 'needs ownership',
    filters: { type: 'all', status: 'Blocked', assignee: 'all', sprint: 'all', search: '', archive: 'active' }
  }, makeId);
  assert.equal(first.id, updated.id);
  assert.equal(workspace.workItemSavedViews.length, 1);
  assert.equal(workspace.workItemSavedViews[0].filters.status, 'Blocked');
  assert.throws(() => saveView(workspace, { name: 'Bad', filters: { unexpected: 'value' } }, makeId), /Unsupported/);
});
