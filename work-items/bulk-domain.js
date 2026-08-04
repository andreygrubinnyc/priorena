const crypto = require('node:crypto');
const { ITEM_TYPES, normalizeItemType } = require('../public/work-item-types');

const MAX_BULK_ITEMS = 1000;
const MAX_HISTORY = 500;
const MAX_SAVED_VIEWS = 20;
const MAX_TEXT = 500;
const MAX_LABELS = 50;
const BULK_FIELDS = new Set([
  'deliveryProjectId', 'assignee', 'sprint', 'tracked', 'itemType',
  'timelineId', 'labelsAdd', 'labelsRemove', 'archived'
]);
const SNAPSHOT_FIELDS = [
  'summary', 'description', 'acceptanceCriteria', 'dependencies', 'environment', 'notes',
  'deliveryProjectId', 'assignee', 'owner', 'sprint', 'tracked', 'itemType',
  'timelineId', 'labels', 'jiraId', 'contacted', 'commentAdded', 'lastCommentedAt',
  'lastComment', 'lastUpdate', 'lastUpdateNotes', 'archived', 'archivedAt'
];

function domainError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function boundedString(value, label, maximum = MAX_TEXT) {
  if (typeof value !== 'string') throw domainError(`${label} must be text`);
  const normalized = value.trim();
  if (normalized.length > maximum) throw domainError(`${label} must be ${maximum} characters or fewer`);
  return normalized;
}

function uniqueIds(value) {
  if (!Array.isArray(value) || !value.length) throw domainError('Select at least one work item');
  if (value.length > MAX_BULK_ITEMS) throw domainError(`Bulk actions are limited to ${MAX_BULK_ITEMS} work items`);
  const ids = value.map(id => boundedString(id, 'Work-item id', 200));
  if (ids.some(id => !id)) throw domainError('Every selected work item requires an id');
  if (ids.some(id => ['__proto__', 'prototype', 'constructor'].includes(id.toLowerCase()))) {
    throw domainError('A selected work-item id is reserved');
  }
  if (new Set(ids).size !== ids.length) throw domainError('A work item cannot be selected more than once');
  return ids;
}

function normalizedLabels(value, label) {
  if (!Array.isArray(value)) throw domainError(`${label} must be a list`);
  if (value.length > MAX_LABELS) throw domainError(`${label} is limited to ${MAX_LABELS} labels`);
  const labels = value.map(item => boundedString(item, label, 100)).filter(Boolean);
  return [...new Set(labels)];
}

function normalizePatch(raw, projectData) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw domainError('Bulk changes must be an object');
  const keys = Object.keys(raw);
  if (!keys.length) throw domainError('Choose at least one bulk change');
  keys.forEach(key => {
    if (!BULK_FIELDS.has(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw domainError(`Unsupported bulk field: ${key}`);
    }
  });
  const patch = Object.create(null);
  if ('deliveryProjectId' in raw) {
    patch.deliveryProjectId = boundedString(raw.deliveryProjectId, 'Project id', 200);
    if (patch.deliveryProjectId && !(projectData.deliveryProjects || []).some(item => item && item.id === patch.deliveryProjectId && !item.archived)) {
      throw domainError('Delivery Project not found');
    }
  }
  if ('assignee' in raw) patch.assignee = boundedString(raw.assignee, 'Assignee', 200);
  if ('sprint' in raw) patch.sprint = boundedString(raw.sprint, 'Sprint', 200);
  if ('tracked' in raw) {
    if (typeof raw.tracked !== 'boolean') throw domainError('Tracked must be true or false');
    patch.tracked = raw.tracked;
  }
  if ('itemType' in raw) {
    patch.itemType = normalizeItemType(raw.itemType);
    if (!patch.itemType) throw domainError(`Item type must be one of: ${ITEM_TYPES.join(', ')}`);
  }
  if ('timelineId' in raw) {
    patch.timelineId = boundedString(raw.timelineId, 'Milestone id', 200);
    if (patch.timelineId && !(projectData.timeline || []).some(item => item && item.id === patch.timelineId)) {
      throw domainError('Milestone not found');
    }
  }
  if ('labelsAdd' in raw) patch.labelsAdd = normalizedLabels(raw.labelsAdd, 'Labels to add');
  if ('labelsRemove' in raw) patch.labelsRemove = normalizedLabels(raw.labelsRemove, 'Labels to remove');
  if ('archived' in raw) {
    if (typeof raw.archived !== 'boolean') throw domainError('Archived must be true or false');
    patch.archived = raw.archived;
  }
  return patch;
}

function storySnapshot(story) {
  const snapshot = Object.create(null);
  SNAPSHOT_FIELDS.forEach(field => {
    if (field === 'labels' || field === 'acceptanceCriteria') {
      snapshot[field] = Array.isArray(story[field]) ? [...story[field]] : [];
    }
    else snapshot[field] = story[field] ?? (field === 'tracked' || field === 'archived' ? false : '');
  });
  return snapshot;
}

function snapshotHash(story) {
  return crypto.createHash('sha256').update(JSON.stringify(storySnapshot(story))).digest('hex');
}

function applyPatchToStory(story, patch, now) {
  if ('deliveryProjectId' in patch) story.deliveryProjectId = patch.deliveryProjectId;
  if ('assignee' in patch) {
    story.assignee = patch.assignee;
    story.owner = patch.assignee;
  }
  if ('sprint' in patch) story.sprint = patch.sprint;
  if ('tracked' in patch) story.tracked = patch.tracked;
  if ('itemType' in patch) story.itemType = patch.itemType;
  if ('timelineId' in patch) story.timelineId = patch.timelineId;
  if ('labelsAdd' in patch || 'labelsRemove' in patch) {
    const remove = new Set((patch.labelsRemove || []).map(label => label.toLowerCase()));
    const labels = (Array.isArray(story.labels) ? story.labels : []).filter(label => !remove.has(String(label).toLowerCase()));
    const present = new Set(labels.map(label => String(label).toLowerCase()));
    (patch.labelsAdd || []).forEach(label => {
      if (!present.has(label.toLowerCase())) {
        labels.push(label);
        present.add(label.toLowerCase());
      }
    });
    story.labels = labels;
  }
  if ('archived' in patch) {
    story.archived = patch.archived;
    story.archivedAt = patch.archived ? now : '';
  }
}

function resolveStories(projectData, itemIds) {
  const byId = new Map((projectData.stories || []).filter(Boolean).map(story => [story.id, story]));
  return itemIds.map(id => {
    const story = byId.get(id);
    if (!story) throw domainError(`Work item no longer exists: ${id}`, 409);
    return story;
  });
}

function buildBulkPreview(projectData, request) {
  const itemIds = uniqueIds(request && request.itemIds);
  const patch = normalizePatch(request && request.patch, projectData);
  const stories = resolveStories(projectData, itemIds);
  const now = new Date().toISOString();
  const items = stories.map(story => {
    const before = storySnapshot(story);
    const candidate = { ...story, labels: [...before.labels] };
    applyPatchToStory(candidate, patch, now);
    const after = storySnapshot(candidate);
    const changedFields = SNAPSHOT_FIELDS.filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
    return {
      id: story.id,
      jiraId: String(story.jiraId || ''),
      summary: String(story.summary || ''),
      expectedHash: snapshotHash(story),
      changedFields,
      before,
      after
    };
  });
  return { patch, items, changed: items.filter(item => item.changedFields.length).length };
}

function buildDeletePreview(projectData, request) {
  const itemIds = uniqueIds(request && request.itemIds);
  const stories = resolveStories(projectData, itemIds);
  return {
    items: stories.map(story => ({
      id: story.id,
      jiraId: String(story.jiraId || ''),
      summary: String(story.summary || ''),
      expectedHash: snapshotHash(story)
    }))
  };
}

function normalizeExpected(value, itemIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw domainError('Preview confirmation is required');
  const itemIdSet = new Set(itemIds);
  Object.keys(value).forEach(id => {
    if (!itemIdSet.has(id) || ['__proto__', 'prototype', 'constructor'].includes(id)) {
      throw domainError('Preview confirmation contains an unsupported work-item id');
    }
  });
  const expected = Object.create(null);
  itemIds.forEach(id => {
    const hash = value[id];
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw domainError('Preview confirmation is invalid');
    expected[id] = hash;
  });
  return expected;
}

function ensureCollections(projectData) {
  if (!Array.isArray(projectData.workItemChangeHistory)) projectData.workItemChangeHistory = [];
  if (!Array.isArray(projectData.workItemSavedViews)) projectData.workItemSavedViews = [];
  return projectData;
}

function addHistory(projectData, entry) {
  ensureCollections(projectData);
  projectData.workItemChangeHistory.unshift(entry);
  projectData.workItemChangeHistory = projectData.workItemChangeHistory.slice(0, MAX_HISTORY);
}

function applyBulkChange(projectData, request, makeId, now = new Date().toISOString()) {
  ensureCollections(projectData);
  const preview = buildBulkPreview(projectData, request);
  const itemIds = preview.items.map(item => item.id);
  const expected = normalizeExpected(request.expected, itemIds);
  const stories = resolveStories(projectData, itemIds);
  stories.forEach(story => {
    if (snapshotHash(story) !== expected[story.id]) throw domainError(`Work item changed after preview: ${story.jiraId || story.id}`, 409);
  });
  stories.forEach(story => applyPatchToStory(story, preview.patch, now));
  const entry = {
    id: makeId('work-history'),
    kind: 'bulk-update',
    createdAt: now,
    itemIds,
    summary: boundedString(request.summary || 'Bulk work-item update', 'History summary', 300),
    patch: preview.patch,
    before: Object.fromEntries(preview.items.map(item => [item.id, item.before])),
    after: Object.fromEntries(stories.map(story => [story.id, storySnapshot(story)])),
    undoneAt: ''
  };
  addHistory(projectData, entry);
  return { entry, changed: preview.changed, items: stories };
}

function deleteBulkStories(projectData, request, makeId, now = new Date().toISOString()) {
  ensureCollections(projectData);
  const itemIds = uniqueIds(request && request.itemIds);
  const stories = resolveStories(projectData, itemIds);
  const expected = normalizeExpected(request.expected, itemIds);
  stories.forEach(story => {
    if (snapshotHash(story) !== expected[story.id]) throw domainError(`Work item changed after preview: ${story.jiraId || story.id}`, 409);
  });
  const typedConfirmation = boundedString(request.confirmation || '', 'Delete confirmation', 100);
  if (typedConfirmation !== `DELETE ${itemIds.length}`) throw domainError(`Type DELETE ${itemIds.length} to confirm permanent deletion`);
  const deleted = stories.map(story => structuredClone(story));
  const selected = new Set(itemIds);
  projectData.stories = (projectData.stories || []).filter(story => !selected.has(story.id));
  const entry = {
    id: makeId('work-history'),
    kind: 'bulk-delete',
    createdAt: now,
    itemIds,
    summary: `Permanently deleted ${itemIds.length} work item${itemIds.length === 1 ? '' : 's'}`,
    deleted,
    undoneAt: ''
  };
  addHistory(projectData, entry);
  return { entry, deleted };
}

function undoBulkChange(projectData, historyId, now = new Date().toISOString()) {
  ensureCollections(projectData);
  const entry = projectData.workItemChangeHistory.find(item => item && item.id === historyId);
  if (!entry) throw domainError('Change-history entry not found', 404);
  if (entry.undoneAt) throw domainError('This change has already been undone', 409);
  const byId = new Map((projectData.stories || []).map(story => [story.id, story]));
  if (entry.kind === 'bulk-update' || entry.kind === 'item-update') {
    entry.itemIds.forEach(id => {
      const story = byId.get(id);
      if (!story) throw domainError(`Cannot undo because a work item is missing: ${id}`, 409);
      const expectedAfter = entry.after && entry.after[id];
      if (!expectedAfter || snapshotHash(story) !== crypto.createHash('sha256').update(JSON.stringify(expectedAfter)).digest('hex')) {
        throw domainError(`Cannot undo because a work item changed again: ${story.jiraId || id}`, 409);
      }
    });
    entry.itemIds.forEach(id => Object.assign(byId.get(id), structuredClone(entry.before[id])));
  } else if (entry.kind === 'bulk-delete') {
    if ((entry.deleted || []).some(story => byId.has(story.id))) throw domainError('Cannot restore because one or more ids are already in use', 409);
    projectData.stories.unshift(...structuredClone(entry.deleted || []));
  } else {
    throw domainError('This history entry cannot be undone');
  }
  entry.undoneAt = now;
  return entry;
}

function saveView(projectData, input, makeId, now = new Date().toISOString()) {
  ensureCollections(projectData);
  const name = boundedString(input && input.name, 'View name', 80);
  if (!name) throw domainError('View name is required');
  const filters = input && input.filters;
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw domainError('Saved-view filters are required');
  const allowed = new Set(['type', 'status', 'assignee', 'sprint', 'search', 'archive', 'gap']);
  Object.keys(filters).forEach(key => {
    if (!allowed.has(key)) throw domainError(`Unsupported saved-view filter: ${key}`);
  });
  const normalized = Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, boundedString(value, `${key} filter`, 200)]));
  const existing = projectData.workItemSavedViews.find(view => view && view.name.toLowerCase() === name.toLowerCase());
  if (!existing && projectData.workItemSavedViews.length >= MAX_SAVED_VIEWS) throw domainError(`Save up to ${MAX_SAVED_VIEWS} work-item views`);
  const view = existing || { id: makeId('work-view'), createdAt: now };
  view.name = name;
  view.filters = normalized;
  view.updatedAt = now;
  if (!existing) projectData.workItemSavedViews.push(view);
  return view;
}

module.exports = {
  MAX_BULK_ITEMS,
  addHistory,
  applyBulkChange,
  buildBulkPreview,
  buildDeletePreview,
  deleteBulkStories,
  ensureCollections,
  saveView,
  snapshotHash,
  storySnapshot,
  undoBulkChange
};
