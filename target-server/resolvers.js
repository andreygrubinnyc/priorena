'use strict';

const { invalidId, notFound } = require('./errors');

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const WORKSPACE_COLLECTIONS = Object.freeze([
  'scopes',
  'jiraEpicMappings',
  'workItems',
  'milestones',
  'sources',
  'findings',
  'evidence',
  'proposedChanges'
]);

function assertStableId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || !STABLE_ID_PATTERN.test(value)) {
    throw invalidId();
  }
  return value;
}

function recordsById(records) {
  return new Map(records.map(record => [record.id, record]));
}

function createTargetResolvers(document) {
  const indexes = Object.fromEntries([
    ['organizations', recordsById(document.organizations)],
    ['workspaces', recordsById(document.workspaces)],
    ...WORKSPACE_COLLECTIONS.map(collection => [collection, recordsById(document[collection])]),
    ['briefings', recordsById(document.briefings)],
    ['briefingVersions', recordsById(document.briefingVersions)]
  ]);

  function resolveOrganization(organizationId) {
    const organization = indexes.organizations.get(assertStableId(organizationId));
    if (!organization) throw notFound();
    return organization;
  }

  function resolveWorkspace(organizationId, workspaceId) {
    const organization = resolveOrganization(organizationId);
    const workspace = indexes.workspaces.get(assertStableId(workspaceId));
    if (!workspace || workspace.organizationId !== organization.id) throw notFound();
    return workspace;
  }

  function resolveWorkspaceChild(collection, organizationId, workspaceId, childId) {
    if (!WORKSPACE_COLLECTIONS.includes(collection)) throw new TypeError(`Unsupported target child collection: ${collection}`);
    const workspace = resolveWorkspace(organizationId, workspaceId);
    const child = indexes[collection].get(assertStableId(childId));
    if (!child || child.organizationId !== workspace.organizationId || child.workspaceId !== workspace.id) throw notFound();
    return child;
  }

  function resolveFinding(organizationId, workspaceId, sourceId, findingId) {
    const source = resolveWorkspaceChild('sources', organizationId, workspaceId, sourceId);
    const finding = resolveWorkspaceChild('findings', organizationId, workspaceId, findingId);
    if (finding.sourceId !== source.id) throw notFound();
    return finding;
  }

  function resolveEvidence(organizationId, workspaceId, evidenceId, options = {}) {
    const evidence = resolveWorkspaceChild('evidence', organizationId, workspaceId, evidenceId);
    if (options.sourceId !== undefined) {
      const source = resolveWorkspaceChild('sources', organizationId, workspaceId, options.sourceId);
      if (evidence.sourceId !== source.id) throw notFound();
    }
    if (options.findingId !== undefined) {
      const finding = resolveWorkspaceChild('findings', organizationId, workspaceId, options.findingId);
      if (evidence.findingId !== finding.id) throw notFound();
    }
    return evidence;
  }

  function resolveBriefing(organizationId, briefingId) {
    const organization = resolveOrganization(organizationId);
    const briefing = indexes.briefings.get(assertStableId(briefingId));
    if (!briefing || briefing.organizationId !== organization.id) throw notFound();
    const selectedWorkspaces = briefing.workspaceIds.map(workspaceId => resolveWorkspace(organization.id, workspaceId));
    const selectedWorkspaceIds = new Set(selectedWorkspaces.map(workspace => workspace.id));
    briefing.scopeIds.forEach(scopeId => {
      const scope = indexes.scopes.get(assertStableId(scopeId));
      if (!scope || scope.organizationId !== organization.id || !selectedWorkspaceIds.has(scope.workspaceId)) throw notFound();
    });
    return briefing;
  }

  function resolveBriefingVersion(organizationId, briefingId, versionId) {
    const briefing = resolveBriefing(organizationId, briefingId);
    const version = indexes.briefingVersions.get(assertStableId(versionId));
    if (!version || version.organizationId !== briefing.organizationId || version.briefingId !== briefing.id) throw notFound();
    const selectedWorkspaceIds = new Set(version.workspaceIds);
    version.workspaceIds.forEach(workspaceId => resolveWorkspace(briefing.organizationId, workspaceId));
    version.scopeIds.forEach(scopeId => {
      const scope = indexes.scopes.get(assertStableId(scopeId));
      if (!scope || scope.organizationId !== briefing.organizationId || !selectedWorkspaceIds.has(scope.workspaceId)) throw notFound();
    });
    return version;
  }

  return Object.freeze({
    indexes,
    resolveBriefing,
    resolveBriefingVersion,
    resolveEvidence,
    resolveFinding,
    resolveOrganization,
    resolveWorkspace,
    resolveWorkspaceChild
  });
}

module.exports = {
  STABLE_ID_PATTERN,
  WORKSPACE_COLLECTIONS,
  assertStableId,
  createTargetResolvers
};
