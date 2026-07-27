const crypto = require('crypto');
const path = require('path');
const { ITEM_TYPES, itemTypeOrUnknown } = require('./public/work-item-types');
const { resolveDeliveryProjectAssociation } = require('./workspaces/workspace-domain');

const SCHEMA_VERSION = 'pm-external-feed/v3';
const SCHEMA_VERSIONS = new Set(['pm-external-feed/v1', 'pm-external-feed/v2', SCHEMA_VERSION]);
const MAX_FEED_BYTES = 1024 * 1024;
const SOURCE_TYPES = new Set(['Story Snapshot', 'Developer Conversation', 'Sprint Planning', 'Backlog Refinement', 'DSU', 'Other External Evidence']);
const V1_FIELD_NAMES = new Set(['summary', 'description', 'status', 'assignee', 'sprint', 'labels', 'dependencies', 'environment', 'acceptanceCriteria', 'lastComment', 'lastCommentedAt']);
const FIELD_NAMES = new Set([...V1_FIELD_NAMES, 'itemType']);
const ARRAY_FIELDS = new Set(['labels', 'acceptanceCriteria']);
const CATEGORIES = new Set([
  'progress_update', 'blocker', 'dependency', 'question', 'decision', 'action', 'ownership', 'risk', 'other',
  'sprint_commitment', 'carryover', 'capacity_constraint', 'scope_change', 'acceptance_criterion', 'open_question',
  'missing_information', 'estimate', 'readiness_gap', 'story_split'
]);
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const TOP_LEVEL_KEYS = new Set(['schemaVersion', 'generatedAt', 'source', 'warnings', 'workItems', 'evidence', 'unlinkedEvidence']);
const SOURCE_KEYS = new Set(['title', 'sourceType', 'visibleDate', 'transcriptionProvider', 'promptVersion', 'sourceDescription']);
const ITEM_KEYS = new Set(['jiraId', 'fields', 'fieldEvidence', 'epicAssociation']);
const EPIC_ASSOCIATION_KEYS = new Set(['jiraEpicKey', 'jiraEpicName', 'evidenceIds']);
const EVIDENCE_KEYS = new Set(['id', 'jiraId', 'category', 'sourceRef', 'speaker', 'visibleTimestamp', 'exactExcerpt', 'reviewNote']);

function fail(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'EXTERNAL_FEED_REJECTED';
  throw error;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, label) {
  if (!isObject(value)) fail(`${label} must be an object`);
}

function assertAllowedKeys(value, allowed, label) {
  Object.keys(value).forEach(key => {
    if (RESERVED_KEYS.has(key) || !allowed.has(key)) fail(`${label} contains unsupported field: ${key}`);
  });
}

function boundedString(value, label, max, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(`${label} is required`);
    return '';
  }
  if (typeof value !== 'string') fail(`${label} must be text`);
  const text = value.trim();
  if (required && !text) fail(`${label} is required`);
  if (text.length > max) fail(`${label} is too long`);
  return text;
}

function boundedStringArray(value, label, maxItems, maxChars) {
  if (!Array.isArray(value) || value.length > maxItems) fail(`${label} must contain at most ${maxItems} items`);
  return value.map((item, index) => boundedString(item, `${label}[${index}]`, maxChars, { required: true }));
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isCompleteTimestamp(value, helpers) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && helpers.isAcceptableTimestamp(value);
}

function parseExternalFeedText(feedText, fileName = 'feed.json') {
  if (typeof feedText !== 'string') fail('Feed content must be text');
  if (!feedText.trim()) fail('Feed content is empty');
  if (Buffer.byteLength(feedText, 'utf8') > MAX_FEED_BYTES) fail('Feed file must be 1 MB or smaller');
  const safeName = boundedString(fileName, 'Feed filename', 255, { required: true });
  if (path.basename(safeName) !== safeName) fail('Feed filename must be a basename');
  const extension = path.extname(safeName).toLowerCase();
  if (!['.json', '.md'].includes(extension)) fail('Feed must be a .json or .md file');
  let jsonText = feedText.replace(/^\uFEFF/, '');
  if (extension === '.md') {
    const blocks = [...jsonText.matchAll(/^```json[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gmi)];
    if (blocks.length !== 1) fail('Markdown feed must contain exactly one fenced json block');
    jsonText = blocks[0][1];
  }
  try {
    return JSON.parse(jsonText);
  } catch (_) {
    fail('Feed must contain one valid JSON object');
  }
}

function normalizeFieldValue(field, value, helpers) {
  if (ARRAY_FIELDS.has(field)) return boundedStringArray(value, field, 100, 1000);
  const limits = {
    summary: 500, description: 10000, status: 100, assignee: 500, sprint: 500,
    dependencies: 5000, environment: 5000, lastComment: 10000, lastCommentedAt: 100
  };
  const text = boundedString(value, field, limits[field] || 1000);
  if (field === 'itemType') {
    if (!ITEM_TYPES.includes(text)) fail(`Unsupported itemType: ${text}`);
    return text;
  }
  if (field === 'status' && text) {
    const resolved = helpers.resolveStatus(text);
    if (!resolved) fail(`Unsupported status: ${text}`);
    return resolved;
  }
  if (field === 'lastCommentedAt' && text && !isCompleteTimestamp(text, helpers)) {
    fail('lastCommentedAt must be a valid timestamp and cannot be in the future');
  }
  return text;
}

function validateEvidence(raw, label, helpers, requireUnlinked = false) {
  assertObject(raw, label);
  assertAllowedKeys(raw, EVIDENCE_KEYS, label);
  const id = boundedString(raw.id, `${label}.id`, 120, { required: true });
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) fail(`${label}.id contains unsupported characters`);
  const jiraId = boundedString(raw.jiraId, `${label}.jiraId`, 100).toUpperCase();
  if (jiraId && !/^[A-Z][A-Z0-9]+-\d+$/.test(jiraId)) fail(`${label}.jiraId is invalid`);
  if (requireUnlinked && jiraId) fail(`${label} must not contain a Jira key`);
  const category = boundedString(raw.category, `${label}.category`, 100, { required: true });
  if (!CATEGORIES.has(category)) fail(`${label}.category is unsupported`);
  const visibleTimestamp = boundedString(raw.visibleTimestamp, `${label}.visibleTimestamp`, 100);
  if (visibleTimestamp && !isCompleteTimestamp(visibleTimestamp, helpers)) fail(`${label}.visibleTimestamp is incomplete, invalid, or in the future`);
  return {
    id,
    jiraId,
    category,
    sourceRef: boundedString(raw.sourceRef, `${label}.sourceRef`, 500),
    speaker: boundedString(raw.speaker, `${label}.speaker`, 500),
    visibleTimestamp,
    exactExcerpt: boundedString(raw.exactExcerpt, `${label}.exactExcerpt`, 10000, { required: true }),
    reviewNote: boundedString(raw.reviewNote, `${label}.reviewNote`, 2000)
  };
}

function validateExternalFeed(raw, helpers) {
  assertObject(raw, 'External feed');
  let encoded;
  try { encoded = JSON.stringify(raw); } catch (_) { fail('External feed cannot be serialized'); }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_FEED_BYTES) fail('External feed must be 1 MB or smaller');
  assertAllowedKeys(raw, TOP_LEVEL_KEYS, 'External feed');
  if (!SCHEMA_VERSIONS.has(raw.schemaVersion)) fail(`schemaVersion must be pm-external-feed/v1, pm-external-feed/v2, or ${SCHEMA_VERSION}`);
  const schemaVersion = raw.schemaVersion;
  const allowedFieldNames = schemaVersion === 'pm-external-feed/v1' ? V1_FIELD_NAMES : FIELD_NAMES;
  const generatedAt = boundedString(raw.generatedAt, 'generatedAt', 100, { required: true });
  if (!isCompleteTimestamp(generatedAt, helpers)) fail('generatedAt must be a complete valid timestamp and cannot be in the future');

  assertObject(raw.source, 'source');
  assertAllowedKeys(raw.source, SOURCE_KEYS, 'source');
  const sourceType = boundedString(raw.source.sourceType, 'source.sourceType', 100, { required: true });
  if (!SOURCE_TYPES.has(sourceType)) fail('source.sourceType is unsupported');
  const visibleDate = boundedString(raw.source.visibleDate, 'source.visibleDate', 20);
  if (visibleDate && !validCalendarDate(visibleDate)) fail('source.visibleDate must use YYYY-MM-DD');
  const today = new Date();
  const todayText = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
  if (visibleDate && visibleDate > todayText) fail('source.visibleDate cannot be in the future');
  const source = {
    title: boundedString(raw.source.title, 'source.title', 500, { required: true }),
    sourceType,
    visibleDate,
    transcriptionProvider: boundedString(raw.source.transcriptionProvider, 'source.transcriptionProvider', 100, { required: true }),
    promptVersion: boundedString(raw.source.promptVersion, 'source.promptVersion', 100, { required: true }),
    sourceDescription: boundedString(raw.source.sourceDescription, 'source.sourceDescription', 1000)
  };

  const warnings = boundedStringArray(raw.warnings || [], 'warnings', 100, 2000);
  if (!Array.isArray(raw.workItems) || raw.workItems.length > 1000) fail('workItems must contain at most 1,000 items');
  const jiraIds = new Set();
  const workItems = raw.workItems.map((item, index) => {
    assertObject(item, `workItems[${index}]`);
    assertAllowedKeys(item, ITEM_KEYS, `workItems[${index}]`);
    const jiraId = boundedString(item.jiraId, `workItems[${index}].jiraId`, 100, { required: true }).toUpperCase();
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(jiraId)) fail(`workItems[${index}].jiraId is invalid`);
    if (jiraIds.has(jiraId)) fail(`Duplicate Jira key: ${jiraId}`);
    jiraIds.add(jiraId);
    assertObject(item.fields, `workItems[${index}].fields`);
    const fields = Object.create(null);
    Object.entries(item.fields).forEach(([field, value]) => {
      if (RESERVED_KEYS.has(field) || !allowedFieldNames.has(field)) fail(`Unsupported proposed field: ${field}`);
      fields[field] = normalizeFieldValue(field, value, helpers);
    });
    let epicAssociation = null;
    if (item.epicAssociation !== undefined) {
      if (schemaVersion !== SCHEMA_VERSION) fail('epicAssociation requires pm-external-feed/v3');
      assertObject(item.epicAssociation, `workItems[${index}].epicAssociation`);
      assertAllowedKeys(item.epicAssociation, EPIC_ASSOCIATION_KEYS, `workItems[${index}].epicAssociation`);
      const jiraEpicKey = boundedString(item.epicAssociation.jiraEpicKey, `workItems[${index}].epicAssociation.jiraEpicKey`, 100).toUpperCase();
      if (jiraEpicKey && !/^[A-Z][A-Z0-9]+-\d+$/.test(jiraEpicKey)) fail(`workItems[${index}].epicAssociation.jiraEpicKey is invalid`);
      const jiraEpicName = boundedString(item.epicAssociation.jiraEpicName, `workItems[${index}].epicAssociation.jiraEpicName`, 500);
      if (!jiraEpicKey && !jiraEpicName) fail(`workItems[${index}].epicAssociation requires a Jira Epic key or name`);
      epicAssociation = {
        jiraEpicKey,
        jiraEpicName,
        evidenceIds: boundedStringArray(item.epicAssociation.evidenceIds, `workItems[${index}].epicAssociation.evidenceIds`, 100, 120)
      };
      if (!epicAssociation.evidenceIds.length) fail(`workItems[${index}].epicAssociation requires evidenceIds`);
    }
    if (!Object.keys(fields).length && !epicAssociation) fail(`workItems[${index}] must propose fields or an epicAssociation`);
    const rawEvidence = item.fieldEvidence === undefined ? {} : item.fieldEvidence;
    assertObject(rawEvidence, `workItems[${index}].fieldEvidence`);
    const fieldEvidence = Object.create(null);
    Object.entries(rawEvidence).forEach(([field, ids]) => {
      if (RESERVED_KEYS.has(field) || !allowedFieldNames.has(field)) fail(`Unsupported fieldEvidence key: ${field}`);
      fieldEvidence[field] = boundedStringArray(ids, `fieldEvidence.${field}`, 100, 120);
    });
    Object.keys(fields).forEach(field => {
      if (!fieldEvidence[field]?.length) fail(`workItems[${index}].${field} requires fieldEvidence`);
    });
    if (fields.lastComment && !fields.lastCommentedAt) fail(`workItems[${index}].lastComment requires a visible lastCommentedAt timestamp`);
    return { jiraId, fields, fieldEvidence, ...(epicAssociation ? { epicAssociation } : {}) };
  });

  if (!Array.isArray(raw.evidence) || !Array.isArray(raw.unlinkedEvidence)) fail('evidence and unlinkedEvidence must be arrays');
  if (raw.evidence.length + raw.unlinkedEvidence.length > 2000) fail('Feed is limited to 2,000 evidence records');
  const evidence = raw.evidence.map((entry, index) => validateEvidence(entry, `evidence[${index}]`, helpers));
  const unlinkedEvidence = raw.unlinkedEvidence.map((entry, index) => validateEvidence(entry, `unlinkedEvidence[${index}]`, helpers, true));
  const evidenceIds = new Set();
  const evidenceById = new Map();
  [...evidence, ...unlinkedEvidence].forEach(entry => {
    if (evidenceIds.has(entry.id)) fail(`Duplicate evidence id: ${entry.id}`);
    evidenceIds.add(entry.id);
    evidenceById.set(entry.id, entry);
  });
  workItems.forEach(item => Object.values(item.fieldEvidence).flat().forEach(id => {
    const record = evidenceById.get(id);
    if (!record) fail(`fieldEvidence references unknown evidence: ${id}`);
    if (record.jiraId !== item.jiraId) fail(`fieldEvidence ${id} does not support ${item.jiraId}`);
    if (/\[UNREADABLE\]/i.test(record.exactExcerpt)) fail(`fieldEvidence ${id} is unreadable and cannot support a proposed field`);
  }));
  workItems.forEach(item => (item.epicAssociation?.evidenceIds || []).forEach(id => {
    const record = evidenceById.get(id);
    if (!record) fail(`epicAssociation references unknown evidence: ${id}`);
    if (record.jiraId !== item.jiraId) fail(`epicAssociation evidence ${id} does not support ${item.jiraId}`);
    if (/\[UNREADABLE\]/i.test(record.exactExcerpt)) fail(`epicAssociation evidence ${id} is unreadable`);
  }));

  const sanitized = { schemaVersion, generatedAt, source, warnings, workItems, evidence, unlinkedEvidence };
  return { sanitized, feedHash: crypto.createHash('sha256').update(JSON.stringify(sanitized)).digest('hex') };
}

function storyFieldValue(story, field, inferStatus) {
  if (field === 'itemType') return itemTypeOrUnknown(story.itemType);
  if (field === 'status') return inferStatus(story);
  if (field === 'assignee') return String(story.assignee || story.owner || '');
  if (field === 'lastComment') return String(story.lastComment || '');
  if (field === 'lastCommentedAt') return story.lastCommentedAt || null;
  if (ARRAY_FIELDS.has(field)) return Array.isArray(story[field]) ? story[field] : [];
  return story[field] == null ? '' : story[field];
}

function valuesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildExternalFeedPreview(projectData, validated, inferStatus) {
  const storyMap = new Map();
  (projectData.stories || []).filter(story => story.jiraId).forEach(story => {
    const key = String(story.jiraId).trim().toUpperCase();
    if (storyMap.has(key)) fail(`Project contains duplicate Jira key: ${key}`);
    storyMap.set(key, story);
  });
  const warnings = [...validated.sanitized.warnings];
  const items = validated.sanitized.workItems.map(item => {
    const story = storyMap.get(item.jiraId);
    const fields = Object.create(null);
    const proposedTimestamp = item.fields.lastCommentedAt ? Date.parse(item.fields.lastCommentedAt) : null;
    const currentTimestamp = story?.lastCommentedAt ? Date.parse(story.lastCommentedAt) : null;
    Object.entries(item.fields).forEach(([field, proposedValue]) => {
      const currentValue = story ? storyFieldValue(story, field, inferStatus) : null;
      const stale = !!story && ['lastComment', 'lastCommentedAt'].includes(field) && Number.isFinite(proposedTimestamp) && Number.isFinite(currentTimestamp) && proposedTimestamp < currentTimestamp;
      if (stale) warnings.push(`${item.jiraId}: externally transcribed comment is older than the current saved comment`);
      fields[field] = {
        currentValue,
        proposedValue,
        changed: !valuesEqual(currentValue, proposedValue),
        blocked: stale,
        evidenceIds: item.fieldEvidence[field] || []
      };
    });
    let epicAssociation = null;
    if (item.epicAssociation) {
      const resolved = resolveDeliveryProjectAssociation(projectData, item.epicAssociation);
      const proposed = (projectData.deliveryProjects || []).find(project => project.id === resolved.deliveryProjectId);
      epicAssociation = {
        currentDeliveryProjectId: story?.deliveryProjectId || '',
        currentDeliveryProjectName: (projectData.deliveryProjects || []).find(project => project.id === story?.deliveryProjectId)?.name || '',
        proposedDeliveryProjectId: resolved.deliveryProjectId,
        proposedDeliveryProjectName: proposed?.name || '',
        jiraEpicKey: item.epicAssociation.jiraEpicKey,
        jiraEpicName: item.epicAssociation.jiraEpicName,
        matchStatus: resolved.status,
        changed: !!resolved.deliveryProjectId && (story?.deliveryProjectId || '') !== resolved.deliveryProjectId,
        blocked: !resolved.deliveryProjectId,
        evidenceIds: item.epicAssociation.evidenceIds
      };
      if (!resolved.deliveryProjectId) warnings.push(`${item.jiraId}: Jira Epic association did not exactly match an active Project and was left for review`);
    }
    return { jiraId: item.jiraId, storyId: story?.id || '', matchType: story ? 'existing' : 'new', fields, epicAssociation };
  });
  return {
    schemaVersion: validated.sanitized.schemaVersion,
    feedHash: validated.feedHash,
    source: validated.sanitized.source,
    warnings: [...new Set(warnings)],
    items,
    evidence: validated.sanitized.evidence,
    unlinkedEvidence: validated.sanitized.unlinkedEvidence
  };
}

module.exports = {
  ARRAY_FIELDS,
  FIELD_NAMES,
  MAX_FEED_BYTES,
  SCHEMA_VERSION,
  SCHEMA_VERSIONS,
  SOURCE_TYPES,
  buildExternalFeedPreview,
  parseExternalFeedText,
  storyFieldValue,
  validateExternalFeed,
  valuesEqual
};
