'use strict';

const crypto = require('node:crypto');

const { TARGET_SCHEMA_VERSION, validateTargetData } = require('./schema');

const BOOTSTRAP_TIMESTAMP = '2026-08-11T00:00:00.000Z';
const MAX_BOOTSTRAP_SCOPES = 100;

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter(key => !allowed.has(key));
  if (unexpected.length) throw new TypeError(`${label} contains unsupported fields`);
}

function boundedText(value, label, { optional = false, maximum = 300 } = {}) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} must be bounded, trimmed text`);
  }
  return value;
}

function normalizeBootstrapDefinition(input) {
  const root = plainObject(input, 'Bootstrap input');
  exactKeys(root, new Set(['organization', 'workspace', 'scopes']), 'Bootstrap input');
  const organization = plainObject(root.organization, 'Organization');
  const workspace = plainObject(root.workspace, 'Workspace');
  exactKeys(organization, new Set(['name', 'description']), 'Organization');
  exactKeys(workspace, new Set(['name', 'description']), 'Workspace');
  if (!Array.isArray(root.scopes) || root.scopes.length > MAX_BOOTSTRAP_SCOPES) {
    throw new TypeError(`Scopes must be an array with at most ${MAX_BOOTSTRAP_SCOPES} entries`);
  }
  const scopes = root.scopes.map((value, index) => {
    const scope = plainObject(value, `Scope ${index + 1}`);
    exactKeys(scope, new Set(['name', 'description', 'owner']), `Scope ${index + 1}`);
    return {
      name: boundedText(scope.name, `Scope ${index + 1} name`),
      description: boundedText(scope.description, `Scope ${index + 1} description`, { optional: true, maximum: 2_000 }),
      owner: scope.owner === undefined || scope.owner === null
        ? null
        : boundedText(scope.owner, `Scope ${index + 1} owner`)
    };
  });
  const names = scopes.map(scope => scope.name.toLocaleLowerCase('en-US'));
  if (new Set(names).size !== names.length) throw new TypeError('Scope names must be unique within the bootstrap Workspace');
  return {
    organization: {
      name: boundedText(organization.name, 'Organization name'),
      description: boundedText(organization.description, 'Organization description', { optional: true, maximum: 2_000 })
    },
    workspace: {
      name: boundedText(workspace.name, 'Workspace name'),
      description: boundedText(workspace.description, 'Workspace description', { optional: true, maximum: 2_000 })
    },
    scopes
  };
}

function deterministicId(prefix, canonical, index = 0) {
  const digest = crypto.createHash('sha256').update(`${prefix}\u0000${index}\u0000${canonical}`).digest('hex').slice(0, 24);
  return `${prefix}-seed-${digest}`;
}

function createBootstrapSeed(input) {
  const normalized = normalizeBootstrapDefinition(input);
  const canonical = JSON.stringify(normalized);
  const organizationId = deterministicId('org', canonical);
  const workspaceId = deterministicId('workspace', canonical);
  const document = {
    schemaVersion: TARGET_SCHEMA_VERSION,
    organizations: [{
      id: organizationId,
      name: normalized.organization.name,
      description: normalized.organization.description,
      archived: false,
      createdAt: BOOTSTRAP_TIMESTAMP,
      updatedAt: BOOTSTRAP_TIMESTAMP
    }],
    workspaces: [{
      id: workspaceId,
      organizationId,
      name: normalized.workspace.name,
      description: normalized.workspace.description,
      archived: false,
      createdAt: BOOTSTRAP_TIMESTAMP,
      updatedAt: BOOTSTRAP_TIMESTAMP,
      settings: {
        sprintCatalog: [],
        currentSprint: null,
        commentFreshnessDays: 7,
        milestoneDueSoonDays: 14
      },
      promptOverrides: {},
      draftingGuidance: '',
      assigneeDirectory: [],
      jiraStatusMapping: {},
      savedViews: []
    }],
    scopes: normalized.scopes.map((scope, index) => ({
      id: deterministicId('scope', canonical, index),
      organizationId,
      workspaceId,
      name: scope.name,
      description: scope.description,
      owner: scope.owner,
      archived: false,
      primaryMilestoneId: null,
      createdAt: BOOTSTRAP_TIMESTAMP,
      updatedAt: BOOTSTRAP_TIMESTAMP
    })),
    jiraEpicMappings: [],
    workItems: [],
    milestones: [],
    sources: [],
    findings: [],
    evidence: [],
    proposedChanges: [],
    briefings: [],
    briefingVersions: [],
    auditEvents: [],
    userPreferences: {
      activeOrganizationId: organizationId,
      activeWorkspaceIdsByOrganization: { [organizationId]: workspaceId }
    },
    globalTechnicalSettings: {}
  };
  validateTargetData(document);
  return document;
}

module.exports = {
  BOOTSTRAP_TIMESTAMP,
  MAX_BOOTSTRAP_SCOPES,
  createBootstrapSeed,
  deterministicId,
  normalizeBootstrapDefinition
};
