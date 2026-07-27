const crypto = require('node:crypto');

const LIMITS = Object.freeze({
  projectsPerWorkspace: 250,
  projectName: 160,
  epicKey: 100,
  epicName: 500,
  owner: 300,
  planningTarget: 300,
  description: 2_000,
  workstreams: 50,
  workstreamText: 300
});

const reservedKeys = new Set(['__proto__', 'prototype', 'constructor']);

function fail(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'INVALID_DELIVERY_PROJECT';
  throw error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function text(value, label, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') fail(`${label} must be text`);
  const normalized = value.trim();
  if (required && !normalized) fail(`${label} is required`);
  if (normalized.length > max) fail(`${label} must be ${max} characters or fewer`);
  return normalized;
}

function normalizeEpicKey(value, label = 'Jira Epic key') {
  const normalized = text(value, label, LIMITS.epicKey).toUpperCase();
  if (normalized && !/^[A-Z][A-Z0-9]+-\d+$/.test(normalized)) fail(`${label} is invalid`);
  return normalized;
}

function normalizeWorkstreams(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > LIMITS.workstreams) fail(`workstreams may contain at most ${LIMITS.workstreams} items`);
  return value.map((item, index) => {
    if (!isPlainObject(item)) fail(`workstreams[${index}] must be an object`);
    const allowed = new Set(['name', 'lead', 'stage', 'health', 'currentFocus']);
    Object.keys(item).forEach(key => {
      if (reservedKeys.has(key.toLowerCase()) || !allowed.has(key)) fail(`workstreams[${index}] contains unsupported field: ${key}`);
    });
    return {
      name: text(item.name, `workstreams[${index}].name`, LIMITS.workstreamText, true),
      lead: text(item.lead, `workstreams[${index}].lead`, LIMITS.workstreamText),
      stage: text(item.stage, `workstreams[${index}].stage`, LIMITS.workstreamText),
      health: text(item.health, `workstreams[${index}].health`, LIMITS.workstreamText),
      currentFocus: text(item.currentFocus, `workstreams[${index}].currentFocus`, 1_000)
    };
  });
}

function validateDeliveryProjectInput(value) {
  if (!isPlainObject(value)) fail('Delivery project must be an object');
  const allowed = new Set(['name', 'jiraEpicKey', 'jiraEpicName', 'owner', 'planningTarget', 'description', 'workstreams', 'archived']);
  Object.keys(value).forEach(key => {
    if (reservedKeys.has(key.toLowerCase()) || !allowed.has(key)) fail(`Delivery project contains unsupported field: ${key}`);
  });
  if (value.archived !== undefined && typeof value.archived !== 'boolean') fail('archived must be a boolean');
  return {
    name: text(value.name, 'Project name', LIMITS.projectName, true),
    jiraEpicKey: normalizeEpicKey(value.jiraEpicKey),
    jiraEpicName: text(value.jiraEpicName, 'Jira Epic name', LIMITS.epicName),
    owner: text(value.owner, 'Project owner', LIMITS.owner),
    planningTarget: text(value.planningTarget, 'Planning target', LIMITS.planningTarget),
    description: text(value.description, 'Project description', LIMITS.description),
    workstreams: normalizeWorkstreams(value.workstreams),
    archived: !!value.archived
  };
}

function createDeliveryProject(value, options = {}) {
  const now = options.now || new Date().toISOString();
  return {
    id: options.id || `delivery-project-${crypto.randomUUID()}`,
    ...validateDeliveryProjectInput(value),
    createdAt: now,
    updatedAt: now
  };
}

function updateDeliveryProject(current, value, options = {}) {
  if (!isPlainObject(current) || !current.id) fail('Delivery project is invalid');
  return {
    ...current,
    ...validateDeliveryProjectInput(value),
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: options.now || new Date().toISOString()
  };
}

function normalizeWorkspaceCollections(data) {
  if (!isPlainObject(data) || !isPlainObject(data.projects)) fail('Workspace data is invalid');
  Object.entries(data.projects).forEach(([workspaceName, workspace]) => {
    if (!isPlainObject(workspace)) fail(`PM workspace is invalid: ${workspaceName}`);
    if (workspace.deliveryProjects === undefined) workspace.deliveryProjects = [];
    if (!Array.isArray(workspace.deliveryProjects) || workspace.deliveryProjects.length > LIMITS.projectsPerWorkspace) {
      fail(`PM workspace ${workspaceName} has invalid deliveryProjects`);
    }
    const ids = new Set();
    const epicKeys = new Set();
    workspace.deliveryProjects.forEach((project, index) => {
      if (!isPlainObject(project) || typeof project.id !== 'string' || !project.id.trim()) fail(`deliveryProjects[${index}] is invalid`);
      if (ids.has(project.id)) fail(`PM workspace ${workspaceName} contains a duplicate Project ID`);
      ids.add(project.id);
      const key = normalizeEpicKey(project.jiraEpicKey, `deliveryProjects[${index}].jiraEpicKey`);
      if (key && epicKeys.has(key)) fail(`PM workspace ${workspaceName} contains duplicate Jira Epic key: ${key}`);
      if (key) epicKeys.add(key);
      project.jiraEpicKey = key;
      project.name = text(project.name, `deliveryProjects[${index}].name`, LIMITS.projectName, true);
      project.jiraEpicName = text(project.jiraEpicName, `deliveryProjects[${index}].jiraEpicName`, LIMITS.epicName);
      project.owner = text(project.owner, `deliveryProjects[${index}].owner`, LIMITS.owner);
      project.planningTarget = text(project.planningTarget, `deliveryProjects[${index}].planningTarget`, LIMITS.planningTarget);
      project.description = text(project.description, `deliveryProjects[${index}].description`, LIMITS.description);
      project.workstreams = normalizeWorkstreams(project.workstreams);
      project.archived = !!project.archived;
    });
    if (!Array.isArray(workspace.stories)) workspace.stories = [];
    workspace.stories.forEach(story => {
      if (!isPlainObject(story)) return;
      if (story.deliveryProjectId === undefined) story.deliveryProjectId = '';
      if (typeof story.deliveryProjectId !== 'string') fail(`Work item in ${workspaceName} has an invalid Project association`);
      if (story.deliveryProjectId && !ids.has(story.deliveryProjectId)) story.deliveryProjectId = '';
    });
  });
  return data;
}

function assertUniqueDeliveryProject(workspace, candidate, ignoreId = '') {
  const projects = Array.isArray(workspace.deliveryProjects) ? workspace.deliveryProjects : [];
  if (projects.some(item => item.id !== ignoreId && item.name.toLowerCase() === candidate.name.toLowerCase())) fail('A Project with this name already exists');
  if (candidate.jiraEpicKey && projects.some(item => item.id !== ignoreId && item.jiraEpicKey === candidate.jiraEpicKey)) fail('A Project with this Jira Epic key already exists');
}

function findDeliveryProject(workspace, id) {
  return (workspace && Array.isArray(workspace.deliveryProjects) ? workspace.deliveryProjects : []).find(item => item && item.id === id);
}

function resolveDeliveryProjectAssociation(workspace, association) {
  if (!association || !isPlainObject(association)) return { status: 'none', deliveryProjectId: '' };
  const key = normalizeEpicKey(association.jiraEpicKey || '');
  const name = text(association.jiraEpicName, 'Jira Epic name', LIMITS.epicName);
  const projects = (workspace.deliveryProjects || []).filter(item => !item.archived);
  const keyMatches = key ? projects.filter(item => item.jiraEpicKey === key) : [];
  if (keyMatches.length === 1) return { status: 'matched-key', deliveryProjectId: keyMatches[0].id };
  const nameMatches = name ? projects.filter(item => [item.jiraEpicName, item.name].some(value => value && value.toLowerCase() === name.toLowerCase())) : [];
  if (!key && nameMatches.length === 1) return { status: 'matched-name', deliveryProjectId: nameMatches[0].id };
  return { status: keyMatches.length > 1 || nameMatches.length > 1 ? 'ambiguous' : 'unresolved', deliveryProjectId: '' };
}

module.exports = {
  LIMITS,
  normalizeEpicKey,
  normalizeWorkspaceCollections,
  validateDeliveryProjectInput,
  createDeliveryProject,
  updateDeliveryProject,
  assertUniqueDeliveryProject,
  findDeliveryProject,
  resolveDeliveryProjectAssociation
};
