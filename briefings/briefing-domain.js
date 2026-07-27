const crypto = require('node:crypto');

const AUDIENCE_PROFILES = Object.freeze(['manager', 'product_owner', 'mixed']);
const OUTPUT_FORMATS = Object.freeze(['teams', 'email', 'confluence']);
const BRIEFING_STATUSES = Object.freeze(['draft', 'finalized', 'communicated']);
const FACT_ORIGINS = Object.freeze(['evidence', 'work_item_change', 'manual_pm_input']);
const FACT_CATEGORIES = Object.freeze([
  'progress',
  'risk',
  'blocker',
  'decision',
  'milestone',
  'dependency',
  'next_action',
  'open_question',
  'other'
]);

const LIMITS = Object.freeze({
  streamName: 160,
  projectsPerStream: 50,
  deliveryProjectsPerStream: 250,
  formatsPerStream: OUTPUT_FORMATS.length,
  sectionsPerStream: FACT_CATEGORIES.length,
  factText: 2_000,
  evidenceText: 10_000,
  evidenceIdsPerFact: 100,
  factsPerBriefing: 500,
  workItemsPerSnapshot: 5_000,
  changesPerBriefing: 10_000,
  outputText: 250_000
});

const CATEGORY_LABELS = Object.freeze({
  progress: 'Progress',
  risk: 'Risks',
  blocker: 'Blockers',
  decision: 'Decisions',
  milestone: 'Milestones',
  dependency: 'Dependencies',
  next_action: 'Next actions',
  open_question: 'Open questions',
  other: 'Other'
});

const AUDIENCE_LABELS = Object.freeze({
  manager: 'Manager',
  product_owner: 'Product owner',
  mixed: 'Manager and product owner'
});

const reservedKeys = new Set(['__proto__', 'prototype', 'constructor']);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function fail(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'INVALID_BRIEFING';
  throw error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertAllowedKeys(value, allowed, label) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  Object.keys(value).forEach(key => {
    if (reservedKeys.has(key.toLowerCase())) fail(`${label} contains a reserved key`);
    if (!allowed.has(key)) fail(`${label} contains unsupported field: ${key}`);
  });
}

function requiredString(value, label, maxLength) {
  if (typeof value !== 'string') fail(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized) fail(`${label} is required`);
  if (normalized.length > maxLength) fail(`${label} must be ${maxLength} characters or fewer`);
  return normalized;
}

function optionalString(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') fail(`${label} must be a string`);
  const normalized = value.trim();
  if (normalized.length > maxLength) fail(`${label} must be ${maxLength} characters or fewer`);
  return normalized;
}

function enumValue(value, vocabulary, label) {
  if (!vocabulary.includes(value)) fail(`${label} is not supported`);
  return value;
}

function uniqueStringArray(value, label, { maxItems, vocabulary, allowEmpty = false } = {}) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  if (!allowEmpty && value.length === 0) fail(`${label} must contain at least one value`);
  if (value.length > maxItems) fail(`${label} may contain at most ${maxItems} values`);
  const seen = new Set();
  return value.map((entry, index) => {
    const normalized = requiredString(entry, `${label}[${index}]`, 160);
    if (vocabulary && !vocabulary.includes(normalized)) fail(`${label}[${index}] is not supported`);
    if (seen.has(normalized)) fail(`${label} contains a duplicate value`);
    seen.add(normalized);
    return normalized;
  });
}

function normalizeBriefingCollections(data) {
  if (!isPlainObject(data)) fail('Workspace data must be an object');
  if (data.briefingStreams === undefined) data.briefingStreams = [];
  if (data.briefings === undefined) data.briefings = [];
  if (!Array.isArray(data.briefingStreams)) fail('briefingStreams must be an array');
  if (!Array.isArray(data.briefings)) fail('briefings must be an array');
  data.briefingStreams.forEach(stream => {
    if (isPlainObject(stream) && stream.deliveryProjectIds === undefined) stream.deliveryProjectIds = [];
  });
  data.briefings.forEach(briefing => {
    if (isPlainObject(briefing) && briefing.deliveryProjectIds === undefined) briefing.deliveryProjectIds = [];
  });
  return data;
}

function validateBriefingStreamInput(value, { projectNames = [], deliveryProjectIds = [] } = {}) {
  assertAllowedKeys(value, new Set([
    'name', 'projectNames', 'deliveryProjectIds', 'audienceProfile', 'preferredFormats', 'defaultSections'
  ]), 'Briefing stream');

  const projects = uniqueStringArray(value.projectNames, 'projectNames', {
    maxItems: LIMITS.projectsPerStream
  });
  const knownProjects = new Set(projectNames);
  projects.forEach(projectName => {
    if (!knownProjects.has(projectName)) fail(`Unknown project: ${projectName}`);
  });
  const scopedDeliveryProjects = uniqueStringArray(value.deliveryProjectIds || [], 'deliveryProjectIds', {
    maxItems: LIMITS.deliveryProjectsPerStream,
    allowEmpty: true
  });
  const knownDeliveryProjects = new Set(deliveryProjectIds);
  scopedDeliveryProjects.forEach(id => {
    if (!knownDeliveryProjects.has(id)) fail(`Unknown Project scope: ${id}`);
  });

  return {
    name: requiredString(value.name, 'name', LIMITS.streamName),
    projectNames: projects,
    deliveryProjectIds: scopedDeliveryProjects,
    audienceProfile: enumValue(value.audienceProfile, AUDIENCE_PROFILES, 'audienceProfile'),
    preferredFormats: uniqueStringArray(value.preferredFormats, 'preferredFormats', {
      maxItems: LIMITS.formatsPerStream,
      vocabulary: OUTPUT_FORMATS
    }),
    defaultSections: uniqueStringArray(value.defaultSections, 'defaultSections', {
      maxItems: LIMITS.sectionsPerStream,
      vocabulary: FACT_CATEGORIES
    })
  };
}

function createBriefingStream(value, options = {}) {
  const now = options.now || new Date().toISOString();
  const id = options.id || `briefing-stream-${crypto.randomUUID()}`;
  const validated = validateBriefingStreamInput(value, options);
  return {
    id,
    ...validated,
    lastCommunicatedBriefingId: null,
    createdAt: now,
    updatedAt: now
  };
}

function updateBriefingStream(stream, value, options = {}) {
  if (!isPlainObject(stream) || !stream.id) fail('Briefing stream is invalid');
  const now = options.now || new Date().toISOString();
  return {
    ...stream,
    ...validateBriefingStreamInput(value, options),
    id: stream.id,
    lastCommunicatedBriefingId: stream.lastCommunicatedBriefingId || null,
    createdAt: stream.createdAt,
    updatedAt: now
  };
}

function validateBriefingFactInput(value) {
  assertAllowedKeys(value, new Set([
    'category', 'projectName', 'workItemId', 'jiraId', 'origin', 'sourceEvidenceIds',
    'detectedText', 'editedText', 'included', 'deliveryProjectId', 'deliveryProjectName',
    'sourceKind', 'sourceTitle', 'sourceDate', 'speaker', 'attributionRequired', 'workstream'
  ]), 'Briefing fact');

  if (typeof value.included !== 'boolean') fail('included must be a boolean');
  if (value.attributionRequired !== undefined && typeof value.attributionRequired !== 'boolean') fail('attributionRequired must be a boolean');
  const origin = enumValue(value.origin, FACT_ORIGINS, 'origin');
  const sourceEvidenceIds = uniqueStringArray(value.sourceEvidenceIds || [], 'sourceEvidenceIds', {
    maxItems: LIMITS.evidenceIdsPerFact,
    allowEmpty: true
  });
  if (origin === 'manual_pm_input' && sourceEvidenceIds.length) {
    fail('Manual PM input cannot claim source evidence');
  }
  if (origin !== 'manual_pm_input' && sourceEvidenceIds.length === 0) {
    fail('Evidence-backed facts require at least one source evidence ID');
  }

  const detectedText = optionalString(value.detectedText, 'detectedText', LIMITS.evidenceText);
  const editedText = requiredString(value.editedText, 'editedText', LIMITS.factText);
  if (origin !== 'manual_pm_input' && !detectedText) fail('Evidence-backed facts require detectedText');

  return {
    category: enumValue(value.category, FACT_CATEGORIES, 'category'),
    projectName: requiredString(value.projectName, 'projectName', 160),
    deliveryProjectId: optionalString(value.deliveryProjectId, 'deliveryProjectId', 220),
    deliveryProjectName: optionalString(value.deliveryProjectName, 'deliveryProjectName', 300),
    workItemId: optionalString(value.workItemId, 'workItemId', 200),
    jiraId: optionalString(value.jiraId, 'jiraId', 100),
    sourceKind: optionalString(value.sourceKind, 'sourceKind', 100),
    sourceTitle: optionalString(value.sourceTitle, 'sourceTitle', 500),
    sourceDate: optionalString(value.sourceDate, 'sourceDate', 100),
    speaker: optionalString(value.speaker, 'speaker', 300),
    attributionRequired: !!value.attributionRequired,
    workstream: optionalString(value.workstream, 'workstream', 300),
    origin,
    sourceEvidenceIds,
    detectedText,
    editedText,
    included: value.included
  };
}

function createBriefingFact(value, options = {}) {
  const now = options.now || new Date().toISOString();
  const id = options.id || `briefing-fact-${crypto.randomUUID()}`;
  return {
    id,
    ...validateBriefingFactInput(value),
    createdAt: now,
    updatedAt: now
  };
}

function storySnapshot(story, statusForStory, deliveryProject) {
  return {
    id: optionalString(story && story.id, 'work item id', 200),
    jiraId: optionalString(story && story.jiraId, 'Jira ID', 100),
    itemType: optionalString(story && story.itemType, 'item type', 40),
    summary: optionalString(story && story.summary, 'summary', 1_000),
    status: optionalString(statusForStory ? statusForStory(story) : story && story.status, 'status', 120),
    owner: optionalString(story && (story.assignee !== undefined ? story.assignee : story.owner), 'owner', 300),
    sprint: optionalString(story && story.sprint, 'sprint', 300),
    lastUpdate: optionalString(story && story.lastUpdate, 'last update', 2_000),
    lastComment: optionalString(story && story.lastComment, 'last comment', 10_000),
    lastCommentedAt: optionalString(story && story.lastCommentedAt, 'last commented at', 100),
    deliveryProjectId: optionalString(story && story.deliveryProjectId, 'Project ID', 220),
    deliveryProjectName: optionalString(deliveryProject && deliveryProject.name, 'Project name', 300)
  };
}

function buildBriefingSnapshot(stream, projects, capturedAt = new Date().toISOString(), options = {}) {
  if (!isPlainObject(stream) || !stream.id || !Array.isArray(stream.projectNames)) {
    fail('Briefing stream is invalid');
  }
  if (!isPlainObject(projects)) fail('Projects must be an object');
  let workItemCount = 0;
  const projectSnapshots = stream.projectNames.map(projectName => {
    const project = projects[projectName];
    if (!isPlainObject(project)) fail(`Unknown project: ${projectName}`);
    const selectedIds = new Set(stream.deliveryProjectIds || []);
    const deliveryProjects = Array.isArray(project.deliveryProjects) ? project.deliveryProjects : [];
    const projectMap = new Map(deliveryProjects.map(item => [item.id, item]));
    const stories = (Array.isArray(project.stories) ? project.stories : [])
      .filter(story => !selectedIds.size || selectedIds.has(story.deliveryProjectId));
    workItemCount += stories.length;
    if (workItemCount > LIMITS.workItemsPerSnapshot) {
      fail(`A briefing snapshot may contain at most ${LIMITS.workItemsPerSnapshot} work items`);
    }
    return {
      name: projectName,
      deliveryProjects: deliveryProjects
        .filter(item => !selectedIds.size || selectedIds.has(item.id))
        .map(item => ({
          id: optionalString(item.id, 'Project ID', 220),
          name: optionalString(item.name, 'Project name', 300),
          jiraEpicKey: optionalString(item.jiraEpicKey, 'Jira Epic key', 100),
          owner: optionalString(item.owner, 'Project owner', 300),
          planningTarget: optionalString(item.planningTarget, 'Planning target', 300),
          workstreams: Array.isArray(item.workstreams) ? item.workstreams.slice(0, 50) : []
        })),
      workItems: stories.map(story => storySnapshot(story, options.statusForStory, projectMap.get(story.deliveryProjectId)))
    };
  });
  return { capturedAt, projects: projectSnapshots };
}

const SNAPSHOT_FIELDS = Object.freeze([
  'jiraId', 'itemType', 'summary', 'status', 'owner', 'sprint', 'lastUpdate', 'lastComment', 'lastCommentedAt', 'deliveryProjectId'
]);

function snapshotItemKey(projectName, item, index) {
  return `${projectName}\u0000${item.id || item.jiraId || `position-${index}`}`;
}

function indexSnapshot(snapshot) {
  const indexed = new Map();
  if (!isPlainObject(snapshot) || !Array.isArray(snapshot.projects)) return indexed;
  snapshot.projects.forEach(project => {
    if (!isPlainObject(project) || typeof project.name !== 'string' || !Array.isArray(project.workItems)) return;
    project.workItems.forEach((item, index) => {
      if (!isPlainObject(item)) return;
      indexed.set(snapshotItemKey(project.name, item, index), { projectName: project.name, item });
    });
  });
  return indexed;
}

function detectBriefingChanges(previousSnapshot, currentSnapshot) {
  const previous = indexSnapshot(previousSnapshot);
  const current = indexSnapshot(currentSnapshot);
  const changes = [];
  const add = change => {
    if (changes.length >= LIMITS.changesPerBriefing) fail('Briefing change limit exceeded');
    changes.push({ id: `briefing-change-${changes.length + 1}`, ...change });
  };

  current.forEach((entry, key) => {
    const before = previous.get(key);
    if (!before) {
      add({
        type: 'work_item_added',
        projectName: entry.projectName,
        workItemId: entry.item.id || '',
        jiraId: entry.item.jiraId || '',
        deliveryProjectId: entry.item.deliveryProjectId || '',
        deliveryProjectName: entry.item.deliveryProjectName || '',
        field: '',
        before: '',
        after: entry.item.summary || entry.item.jiraId || entry.item.id || ''
      });
      return;
    }
    SNAPSHOT_FIELDS.forEach(field => {
      const beforeValue = before.item[field] || '';
      const afterValue = entry.item[field] || '';
      if (beforeValue === afterValue) return;
      add({
        type: 'field_changed',
        projectName: entry.projectName,
        workItemId: entry.item.id || '',
        jiraId: entry.item.jiraId || '',
        deliveryProjectId: entry.item.deliveryProjectId || '',
        deliveryProjectName: entry.item.deliveryProjectName || '',
        field,
        before: beforeValue,
        after: afterValue
      });
    });
  });

  previous.forEach((entry, key) => {
    if (current.has(key)) return;
    add({
      type: 'work_item_removed',
      projectName: entry.projectName,
      workItemId: entry.item.id || '',
      jiraId: entry.item.jiraId || '',
      deliveryProjectId: entry.item.deliveryProjectId || '',
      deliveryProjectName: entry.item.deliveryProjectName || '',
      field: '',
      before: entry.item.summary || entry.item.jiraId || entry.item.id || '',
      after: ''
    });
  });

  return changes;
}

function createBriefing(stream, projects, briefings, options = {}) {
  if (!isPlainObject(stream) || !stream.id) fail('Briefing stream is invalid');
  if (!Array.isArray(briefings)) fail('briefings must be an array');
  const now = options.now || new Date().toISOString();
  const currentSnapshot = buildBriefingSnapshot(stream, projects, now, options);
  const baseline = findStreamBaseline(stream, briefings);
  return {
    id: options.id || `briefing-${crypto.randomUUID()}`,
    streamId: stream.id,
    status: 'draft',
    projectNames: [...stream.projectNames],
    deliveryProjectIds: [...(stream.deliveryProjectIds || [])],
    audienceProfile: stream.audienceProfile,
    comparisonBriefingId: baseline ? baseline.id : null,
    currentSnapshot,
    detectedChanges: baseline ? detectBriefingChanges(baseline.currentSnapshot, currentSnapshot) : [],
    facts: [],
    outputs: [],
    createdAt: now,
    updatedAt: now,
    finalizedAt: null,
    communicatedAt: null
  };
}

function replaceDraftFacts(briefing, factInputs, options = {}) {
  if (!isPlainObject(briefing) || !briefing.id) fail('Briefing is invalid');
  if (briefing.status !== 'draft') fail('Only a draft briefing can be edited');
  if (!Array.isArray(factInputs)) fail('facts must be an array');
  if (factInputs.length > LIMITS.factsPerBriefing) {
    fail(`A briefing may contain at most ${LIMITS.factsPerBriefing} facts`);
  }
  const projectNames = new Set(briefing.projectNames || []);
  const scopedDeliveryProjectIds = new Set(briefing.deliveryProjectIds || []);
  const deliveryProjectsByWorkspace = new Map((briefing.currentSnapshot?.projects || []).map(workspace => [
    workspace.name,
    new Map((workspace.deliveryProjects || []).map(project => [project.id, project]))
  ]));
  const now = options.now || new Date().toISOString();
  const facts = factInputs.map((fact, index) => {
    const validated = createBriefingFact(fact, {
      id: options.ids && options.ids[index],
      now
    });
    if (!projectNames.has(validated.projectName)) {
      fail(`Briefing fact references a project outside this briefing: ${validated.projectName}`);
    }
    if (scopedDeliveryProjectIds.size && !validated.deliveryProjectId) {
      fail('A Project-scoped briefing fact requires a Project / Jira Epic');
    }
    if (validated.deliveryProjectId) {
      const deliveryProject = deliveryProjectsByWorkspace.get(validated.projectName)?.get(validated.deliveryProjectId);
      if (!deliveryProject) fail('Briefing fact references an unknown Project / Jira Epic');
      if (scopedDeliveryProjectIds.size && !scopedDeliveryProjectIds.has(validated.deliveryProjectId)) {
        fail('Briefing fact references a Project / Jira Epic outside this briefing');
      }
      if (validated.deliveryProjectName && validated.deliveryProjectName !== deliveryProject.name) {
        fail('Briefing fact Project / Jira Epic name does not match its ID');
      }
      validated.deliveryProjectName = deliveryProject.name;
    }
    const allowedIds = validated.origin === 'work_item_change'
      ? options.allowedChangeIds
      : (validated.origin === 'evidence' ? options.allowedEvidenceIds : null);
    if (allowedIds) {
      const knownIds = allowedIds instanceof Set ? allowedIds : new Set(allowedIds);
      validated.sourceEvidenceIds.forEach(sourceId => {
        if (!knownIds.has(sourceId)) fail(`Briefing fact references unknown supporting source: ${sourceId}`);
      });
    }
    return validated;
  });
  return { ...briefing, facts, outputs: [], updatedAt: now };
}

function finalizeBriefing(briefing, finalizedAt = new Date().toISOString()) {
  if (!isPlainObject(briefing) || !briefing.id) fail('Briefing is invalid');
  if (briefing.status !== 'draft') fail('Only a draft briefing can be finalized');
  if (!(briefing.facts || []).some(fact => fact && fact.included)) {
    fail('A briefing requires at least one included fact before finalization');
  }
  return {
    ...briefing,
    status: 'finalized',
    finalizedAt,
    communicatedAt: null,
    updatedAt: finalizedAt
  };
}

function orderedFactCategories(stream, facts) {
  const present = new Set(facts.map(fact => fact.category));
  const ordered = [];
  [...(stream.defaultSections || []), ...FACT_CATEGORIES].forEach(category => {
    if (present.has(category) && !ordered.includes(category)) ordered.push(category);
  });
  return ordered;
}

function factLine(fact, bullet = '- ') {
  const reference = fact.jiraId || fact.workItemId || '';
  const provenance = fact.origin === 'manual_pm_input' ? '[Manual PM input] ' : '';
  const attribution = fact.attributionRequired && fact.speaker ? ` — ${fact.speaker}` : '';
  return `${bullet}${provenance}${fact.editedText}${reference ? ` (${reference})` : ''}${attribution}`;
}

function themeLines(stream, facts, bullet = '- ') {
  return orderedFactCategories(stream, facts).flatMap(category =>
    facts.filter(fact => fact.category === category).slice(0, 5)
      .map(fact => factLine({ ...fact, editedText: `${CATEGORY_LABELS[category]}: ${fact.editedText}` }, bullet))
  );
}

function projectLines(stream, facts, { headingPrefix = '', bullet = '- ' } = {}) {
  const blocks = [];
  const scopes = [...new Set(facts.map(fact => fact.deliveryProjectName || fact.projectName))];
  scopes.forEach(projectName => {
    const projectFacts = facts.filter(fact => (fact.deliveryProjectName || fact.projectName) === projectName);
    if (!projectFacts.length) return;
    blocks.push(`${headingPrefix}${projectName}`);
    orderedFactCategories(stream, projectFacts).forEach(category => {
      projectFacts.filter(fact => fact.category === category).forEach(fact => {
        blocks.push(factLine({ ...fact, editedText: `[${CATEGORY_LABELS[category]}] ${fact.editedText}` }, bullet));
      });
    });
    blocks.push('');
  });
  return blocks;
}

function categorySection(stream, facts, category, heading) {
  const matches = facts.filter(fact => fact.category === category);
  return matches.length ? [`## ${heading}`, ...matches.map(fact => factLine(fact)), ''] : [];
}

function categoriesSection(facts, categories, heading) {
  const matches = facts.filter(fact => categories.includes(fact.category));
  return matches.length ? [`## ${heading}`, ...matches.map(fact => factLine(fact)), ''] : [];
}

function snapshotProjects(briefing) {
  return (briefing.currentSnapshot?.projects || []).flatMap(workspace =>
    (workspace.deliveryProjects || []).map(item => ({ ...item, workspaceName: workspace.name }))
  );
}

function renderBriefingOutput(format, stream, briefing, facts, generatedAt) {
  const title = stream.name;
  const date = String(briefing.finalizedAt || generatedAt).slice(0, 10);
  const audience = AUDIENCE_LABELS[briefing.audienceProfile] || briefing.audienceProfile;
  const sourceFactIds = facts.map(fact => fact.id);
  let subject = '';
  let content = '';

  if (format === 'confluence') {
    const projectStatus = snapshotProjects(briefing);
    const statusRows = projectStatus.flatMap(item => {
      const workstreams = Array.isArray(item.workstreams) ? item.workstreams : [];
      if (workstreams.length) return workstreams.map(workstream => ({
        name: `${item.name} / ${workstream.name}`,
        epicKey: item.jiraEpicKey,
        status: workstream.health || workstream.stage || 'Not assessed',
        lead: workstream.lead || item.owner || 'Not recorded',
        focus: workstream.currentFocus || item.planningTarget || 'Not recorded'
      }));
      return [{
        name: item.name, epicKey: item.jiraEpicKey, status: 'Not assessed',
        lead: item.owner || 'Not recorded', focus: item.planningTarget || 'Not recorded'
      }];
    });
    const overallTable = projectStatus.length ? [
      '## Overall Status', '',
      '| Workstream / Project | Status | Lead | Current focus |',
      '| --- | --- | --- | --- |',
      ...statusRows.map(row => `| ${row.name}${row.epicKey ? ` (${row.epicKey})` : ''} | ${row.status} | ${row.lead} | ${row.focus} |`), ''
    ] : [];
    content = [
      `# ${title}`,
      '',
      `**Briefing date:** ${date}  `,
      `**Audience:** ${audience}`,
      '',
      '## Executive Summary',
      ...themeLines(stream, facts),
      '',
      ...overallTable,
      '## Progress Since Last Update',
      ...facts.filter(fact => ['progress', 'milestone'].includes(fact.category)).map(fact => factLine(fact)),
      '',
      '## Project Sections',
      ...projectLines(stream, facts, { headingPrefix: '### ' }),
      ...categorySection(stream, facts, 'dependency', 'Current Dependencies'),
      ...categoriesSection(facts, ['risk', 'blocker', 'open_question'], 'Current Risks / Open Items'),
      ...categorySection(stream, facts, 'next_action', 'Next Milestones'),
      '## Notes',
      '- This page is an evidence-grounded leadership summary. Jira remains the system of record for work-item execution.',
      '- Planning targets are not presented as commitments unless the included evidence explicitly states a commitment.'
    ].join('\n').trim();
  } else if (format === 'teams') {
    content = [
      `Here is the ${title} update for ${date}:`, '',
      ...themeLines(stream, facts, '• '), '',
      ...projectLines(stream, facts, { bullet: '• ' })
    ].join('\n').trim();
  } else {
    subject = `${title} — ${date}`;
    content = [
      'Hello,', '', `Here is the ${title} update for ${date}.`, '',
      'Key themes', ...themeLines(stream, facts), '',
      'Project details', ...projectLines(stream, facts),
      'Regards'
    ].join('\n').trim();
  }

  if (content.length > LIMITS.outputText) fail(`Generated ${format} output is too long`);
  return { format, title, subject, content, sourceFactIds, generatedAt };
}

function generateBriefingOutputs(stream, briefing, generatedAt = new Date().toISOString()) {
  if (!isPlainObject(stream) || !stream.id) fail('Briefing stream is invalid');
  if (!isPlainObject(briefing) || !briefing.id) fail('Briefing is invalid');
  if (briefing.streamId !== stream.id) fail('Briefing does not belong to this stream');
  if (briefing.status !== 'finalized') fail('Outputs can be generated only for a finalized briefing');
  const briefingProjects = uniqueStringArray(briefing.projectNames || [], 'briefing.projectNames', {
    maxItems: LIMITS.projectsPerStream
  });
  const facts = (briefing.facts || []).filter(fact => fact && fact.included).map((fact, index) => ({
    ...fact,
    id: requiredString(fact.id, `facts[${index}].id`, 220),
    category: enumValue(fact.category, FACT_CATEGORIES, `facts[${index}].category`),
    projectName: requiredString(fact.projectName, `facts[${index}].projectName`, 160),
    workItemId: optionalString(fact.workItemId, `facts[${index}].workItemId`, 200),
    jiraId: optionalString(fact.jiraId, `facts[${index}].jiraId`, 100),
    deliveryProjectId: optionalString(fact.deliveryProjectId, `facts[${index}].deliveryProjectId`, 220),
    deliveryProjectName: optionalString(fact.deliveryProjectName, `facts[${index}].deliveryProjectName`, 300),
    sourceKind: optionalString(fact.sourceKind, `facts[${index}].sourceKind`, 100),
    sourceTitle: optionalString(fact.sourceTitle, `facts[${index}].sourceTitle`, 500),
    sourceDate: optionalString(fact.sourceDate, `facts[${index}].sourceDate`, 100),
    speaker: optionalString(fact.speaker, `facts[${index}].speaker`, 300),
    attributionRequired: !!fact.attributionRequired,
    workstream: optionalString(fact.workstream, `facts[${index}].workstream`, 300),
    origin: enumValue(fact.origin, FACT_ORIGINS, `facts[${index}].origin`),
    editedText: requiredString(fact.editedText, `facts[${index}].editedText`, LIMITS.factText)
  }));
  if (!facts.length) fail('Briefing outputs require at least one included fact');
  const knownProjects = new Set(briefingProjects);
  facts.forEach(fact => {
    if (!knownProjects.has(fact.projectName)) fail(`Briefing output fact references an unknown project: ${fact.projectName}`);
  });
  const formats = uniqueStringArray(stream.preferredFormats || [], 'preferredFormats', {
    maxItems: LIMITS.formatsPerStream,
    vocabulary: OUTPUT_FORMATS
  });
  const renderStream = { ...stream, projectNames: briefingProjects };
  const outputs = formats.map(format => renderBriefingOutput(format, renderStream, briefing, facts, generatedAt));
  return { ...briefing, outputs, updatedAt: generatedAt };
}

function findStreamBaseline(stream, briefings) {
  if (!isPlainObject(stream)) fail('Briefing stream must be an object');
  if (!Array.isArray(briefings)) fail('briefings must be an array');
  const baselineId = stream.lastCommunicatedBriefingId;
  if (!baselineId) return null;
  const baseline = briefings.find(item => isPlainObject(item) && item.id === baselineId);
  if (!baseline || baseline.streamId !== stream.id || baseline.status !== 'communicated') return null;
  return baseline;
}

function markBriefingCommunicated(stream, briefing, communicatedAt = new Date().toISOString()) {
  if (!isPlainObject(stream) || !stream.id) fail('Briefing stream is invalid');
  if (!isPlainObject(briefing) || !briefing.id) fail('Briefing is invalid');
  if (briefing.streamId !== stream.id) fail('Briefing does not belong to this stream');
  if (briefing.status !== 'finalized') fail('Only a finalized briefing can be communicated');
  const nextBriefing = {
    ...briefing,
    status: 'communicated',
    finalizedAt: briefing.finalizedAt,
    communicatedAt,
    updatedAt: communicatedAt
  };
  const nextStream = {
    ...stream,
    lastCommunicatedBriefingId: briefing.id,
    updatedAt: communicatedAt
  };
  return { stream: nextStream, briefing: nextBriefing };
}

module.exports = {
  AUDIENCE_PROFILES,
  OUTPUT_FORMATS,
  BRIEFING_STATUSES,
  FACT_ORIGINS,
  FACT_CATEGORIES,
  LIMITS,
  normalizeBriefingCollections,
  validateBriefingStreamInput,
  createBriefingStream,
  updateBriefingStream,
  validateBriefingFactInput,
  createBriefingFact,
  buildBriefingSnapshot,
  detectBriefingChanges,
  createBriefing,
  replaceDraftFacts,
  finalizeBriefing,
  generateBriefingOutputs,
  findStreamBaseline,
  markBriefingCommunicated
};
