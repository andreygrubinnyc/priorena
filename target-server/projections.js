'use strict';

const path = require('node:path');

const { invalidQuery, notFound } = require('./errors');
const { createTargetResolvers } = require('./resolvers');
const { MAX_SOURCE_FILE_BYTES, MEDIA_TYPES_BY_EXTENSION, safeDownloadName } = require('./source-files');

const MAX_SEARCH_QUERY_CHARACTERS = 200;
const MIN_SEARCH_QUERY_CHARACTERS = 2;
const MAX_SEARCH_RESULTS = 50;
const SAFE_BRIEFING_FORMATS = new Set(['teams', 'email', 'confluence']);
const SAFE_BRIEFING_MEDIA_TYPES = new Set([
  'application/json',
  'text/html',
  'text/markdown',
  'text/plain'
]);
const WORKSPACE_OWNED_COLLECTIONS = Object.freeze([
  'initiatives',
  'workstreams',
  'jiraEpicMappings',
  'workItems',
  'milestones',
  'sources',
  'findings',
  'evidence',
  'proposedChanges'
]);

function clone(value) {
  return structuredClone(value);
}

function publicOrganization(organization) {
  return {
    id: organization.id,
    name: organization.name,
    description: organization.description,
    archived: organization.archived
  };
}

function publicWorkspace(workspace) {
  return {
    id: workspace.id,
    organizationId: workspace.organizationId,
    name: workspace.name,
    description: workspace.description,
    archived: workspace.archived
  };
}

function publicInitiative(initiative) {
  return {
    id: initiative.id,
    organizationId: initiative.organizationId,
    workspaceId: initiative.workspaceId,
    name: initiative.name,
    description: initiative.description,
    owner: initiative.owner,
    archived: initiative.archived,
    primaryMilestoneId: initiative.primaryMilestoneId
  };
}

function publicWorkstream(workstream) {
  return {
    id: workstream.id,
    organizationId: workstream.organizationId,
    workspaceId: workstream.workspaceId,
    initiativeId: workstream.initiativeId,
    name: workstream.name,
    description: workstream.description
  };
}

function publicJiraEpicMapping(mapping) {
  return {
    id: mapping.id,
    organizationId: mapping.organizationId,
    workspaceId: mapping.workspaceId,
    initiativeId: mapping.initiativeId,
    jiraProjectKey: mapping.jiraProjectKey,
    jiraEpicKey: mapping.jiraEpicKey,
    jiraEpicName: mapping.jiraEpicName,
    mappingStatus: mapping.mappingStatus,
    provenance: mapping.provenance,
    verifiedAt: mapping.verifiedAt
  };
}

function publicWorkItem(workItem, initiativeIndex, workstreamIndex = new Map(), jiraEpicMappingIndex = new Map()) {
  const initiative = workItem.initiativeId === null ? null : initiativeIndex.get(workItem.initiativeId);
  const workstream = workItem.workstreamId === null ? null : workstreamIndex.get(workItem.workstreamId);
  const jiraEpicMapping = workItem.jiraEpicMappingId === null ? null : jiraEpicMappingIndex.get(workItem.jiraEpicMappingId);
  return {
    id: workItem.id,
    organizationId: workItem.organizationId,
    workspaceId: workItem.workspaceId,
    initiativeId: workItem.initiativeId,
    initiative: initiative ? { id: initiative.id, name: initiative.name } : null,
    workstreamId: workItem.workstreamId,
    workstream: workstream ? { id: workstream.id, initiativeId: workstream.initiativeId, name: workstream.name } : null,
    jiraEpicMappingId: workItem.jiraEpicMappingId,
    jiraEpic: jiraEpicMapping ? {
      id: jiraEpicMapping.id,
      initiativeId: jiraEpicMapping.initiativeId,
      jiraProjectKey: jiraEpicMapping.jiraProjectKey,
      jiraEpicKey: jiraEpicMapping.jiraEpicKey,
      jiraEpicName: jiraEpicMapping.jiraEpicName,
      mappingStatus: jiraEpicMapping.mappingStatus
    } : null,
    jiraId: workItem.jiraId,
    jiraKey: workItem.jiraKey,
    workItemJiraKey: workItem.jiraKey,
    itemType: workItem.itemType,
    summary: workItem.summary,
    canonicalStatus: workItem.canonicalStatus,
    currentStateProvenance: workItem.currentStateProvenance,
    currentStateConfidence: workItem.currentStateConfidence,
    assignee: workItem.assignee,
    sprint: workItem.sprint,
    archived: workItem.archived,
    followUp: clone(workItem.followUp)
  };
}

function milestoneTiming(date, options = {}) {
  const referenceDate = options.referenceDate || new Date().toISOString().slice(0, 10);
  const dueSoonDays = Number.isInteger(options.dueSoonDays) && options.dueSoonDays >= 0 ? options.dueSoonDays : 14;
  const dueAt = Date.parse(`${date}T00:00:00.000Z`);
  const referenceAt = Date.parse(`${referenceDate}T00:00:00.000Z`);
  const dueInDays = Math.round((dueAt - referenceAt) / 86_400_000);
  return {
    referenceDate,
    dueSoonDays,
    dueInDays,
    pressure: dueInDays < 0 ? 'overdue' : (dueInDays <= dueSoonDays ? 'due-soon' : 'scheduled')
  };
}

function milestoneOptions(workspace, options = {}) {
  const configuredDays = workspace?.settings?.milestoneDueSoonDays;
  const dueSoonDays = Number.isInteger(configuredDays) && configuredDays >= 0 && configuredDays <= 365
    ? configuredDays
    : 14;
  return { ...options, dueSoonDays };
}

function publicMilestone(milestone, initiativeIndex, options = {}) {
  const initiative = milestone.initiativeId === null ? null : initiativeIndex.get(milestone.initiativeId);
  return {
    id: milestone.id,
    organizationId: milestone.organizationId,
    workspaceId: milestone.workspaceId,
    initiativeId: milestone.initiativeId,
    initiative: initiative ? { id: initiative.id, name: initiative.name } : null,
    applicability: initiative ? { kind: 'initiative', initiativeId: initiative.id, label: initiative.name } : { kind: 'workspace', initiativeId: null, label: 'Entire workspace' },
    title: milestone.title,
    date: milestone.date,
    timing: milestoneTiming(milestone.date, options),
    status: milestone.status,
    notes: milestone.notes,
    linkedWorkItemIds: [...milestone.linkedWorkItemIds]
  };
}

function sourceFileMetadata(source) {
  const file = source.metadata && source.metadata.file;
  if (!file || typeof file !== 'object' || Array.isArray(file)) return null;
  if (typeof file.displayName !== 'string'
    || typeof file.mediaType !== 'string'
    || !Number.isSafeInteger(file.byteLength)
    || file.byteLength < 0
    || file.byteLength > MAX_SOURCE_FILE_BYTES) {
    return null;
  }
  const displayName = safeDownloadName(file.displayName);
  const approvedMediaType = MEDIA_TYPES_BY_EXTENSION[path.extname(displayName).toLowerCase()];
  const normalizedMediaType = approvedMediaType?.split(';')[0] || null;
  if (normalizedMediaType === null || file.mediaType.toLowerCase() !== normalizedMediaType) return null;
  return {
    displayName,
    mediaType: normalizedMediaType,
    byteLength: file.byteLength
  };
}

function publicSource(source, options = {}) {
  const result = {
    id: source.id,
    organizationId: source.organizationId,
    workspaceId: source.workspaceId,
    title: source.title,
    type: source.type,
    sourceKind: source.sourceKind,
    date: source.date,
    provenance: source.provenance,
    processingState: source.processingState,
    createdAt: source.createdAt,
    file: sourceFileMetadata(source)
  };
  if (options.includeContent) result.content = source.content;
  return result;
}

function publicFinding(finding) {
  return clone(finding);
}

function publicEvidence(evidence) {
  return clone(evidence);
}

function publicProposedChange(change) {
  return clone(change);
}

function publicBriefing(briefing, resolvers) {
  const workspaces = briefing.workspaceIds.map(workspaceId => resolvers.resolveWorkspace(briefing.organizationId, workspaceId));
  const initiatives = briefing.initiativeIds.map(initiativeId => resolvers.indexes.initiatives.get(initiativeId));
  return {
    id: briefing.id,
    organizationId: briefing.organizationId,
    name: briefing.name,
    workspaces: workspaces.map(workspace => ({ id: workspace.id, name: workspace.name })),
    initiatives: initiatives.map(initiative => ({ id: initiative.id, workspaceId: initiative.workspaceId, name: initiative.name })),
    audienceProfile: briefing.audienceProfile,
    briefingType: briefing.briefingType || 'status-update',
    draftingGuidance: briefing.draftingGuidance || '',
    preferredFormats: [...briefing.preferredFormats],
    defaultSections: [...briefing.defaultSections],
    lastCommunicatedVersionId: briefing.lastCommunicatedVersionId,
    archived: briefing.archived,
    createdAt: briefing.createdAt,
    updatedAt: briefing.updatedAt
  };
}

function outputMetadata(outputs) {
  return outputs.map((output, index) => {
    if (typeof output === 'string') {
      return { index, format: null, mediaType: 'text/plain', byteLength: Buffer.byteLength(output, 'utf8') };
    }
    const serialized = JSON.stringify(output);
    const format = SAFE_BRIEFING_FORMATS.has(output?.format) ? output.format : null;
    const mediaType = SAFE_BRIEFING_MEDIA_TYPES.has(output?.mediaType) ? output.mediaType : 'application/json';
    return {
      index,
      format,
      mediaType,
      byteLength: Buffer.byteLength(serialized, 'utf8')
    };
  });
}

function disallowedBriefingReferenceIds(document, version) {
  const selectedWorkspaceIds = new Set(version.workspaceIds);
  const disallowed = new Set(
    document.organizations
      .filter(organization => organization.id !== version.organizationId)
      .map(organization => organization.id)
  );
  document.workspaces.forEach(workspace => {
    if (workspace.organizationId !== version.organizationId || !selectedWorkspaceIds.has(workspace.id)) {
      disallowed.add(workspace.id);
    }
  });
  WORKSPACE_OWNED_COLLECTIONS.forEach(collection => {
    document[collection].forEach(record => {
      if (record.organizationId !== version.organizationId || !selectedWorkspaceIds.has(record.workspaceId)) {
        disallowed.add(record.id);
      }
    });
  });
  document.briefings.forEach(briefing => {
    if (briefing.organizationId !== version.organizationId) disallowed.add(briefing.id);
  });
  document.briefingVersions.forEach(candidate => {
    if (candidate.organizationId !== version.organizationId) disallowed.add(candidate.id);
  });
  document.auditEvents.forEach(event => {
    if (event.organizationId !== version.organizationId || (event.workspaceId !== null && !selectedWorkspaceIds.has(event.workspaceId))) {
      disallowed.add(event.id);
    }
  });
  return disallowed;
}

function containsDisallowedReference(value, disallowedIds) {
  if (typeof value === 'string') {
    if (disallowedIds.has(value)) return true;
    for (const id of disallowedIds) {
      if (id.length >= 8 && value.includes(id)) return true;
    }
    return false;
  }
  if (Array.isArray(value)) return value.some(item => containsDisallowedReference(item, disallowedIds));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, item]) => (
      containsDisallowedReference(key, disallowedIds) || containsDisallowedReference(item, disallowedIds)
    ));
  }
  return false;
}

function assertBriefingVersionContentIsolation(document, version) {
  const disallowedIds = disallowedBriefingReferenceIds(document, version);
  if (containsDisallowedReference(version.frozenSnapshot, disallowedIds)
    || containsDisallowedReference(version.facts, disallowedIds)
    || containsDisallowedReference(version.outputs, disallowedIds)) {
    throw notFound();
  }
}

function publicBriefingVersion(document, version, options = {}) {
  assertBriefingVersionContentIsolation(document, version);
  const result = {
    id: version.id,
    organizationId: version.organizationId,
    briefingId: version.briefingId,
    workspaceIds: [...version.workspaceIds],
    initiativeIds: [...version.initiativeIds],
    status: version.status,
    comparisonVersionId: version.comparisonVersionId,
    outputMetadata: outputMetadata(version.outputs),
    createdAt: version.createdAt,
    finalizedAt: version.finalizedAt,
    communicatedAt: version.communicatedAt
  };
  if (version.communication) result.communication = clone(version.communication);
  if (options.includeFrozenContent) {
    result.frozenSnapshot = clone(version.frozenSnapshot);
    result.facts = clone(version.facts);
  }
  return result;
}

function recordsForWorkspace(document, collection, organizationId, workspaceId) {
  return document[collection].filter(record => record.organizationId === organizationId && record.workspaceId === workspaceId);
}

function recordsForOrganization(document, collection, organizationId) {
  return document[collection].filter(record => record.organizationId === organizationId);
}

function listOrganizations(document) {
  return { organizations: document.organizations.map(publicOrganization) };
}

function getOrganization(document, organizationId) {
  const resolvers = createTargetResolvers(document);
  return { organization: publicOrganization(resolvers.resolveOrganization(organizationId)) };
}

function listWorkspaces(document, organizationId) {
  const resolvers = createTargetResolvers(document);
  const organization = resolvers.resolveOrganization(organizationId);
  return {
    organization: publicOrganization(organization),
    workspaces: recordsForOrganization(document, 'workspaces', organization.id).map(publicWorkspace)
  };
}

function getWorkspace(document, organizationId, workspaceId) {
  const resolvers = createTargetResolvers(document);
  return { workspace: publicWorkspace(resolvers.resolveWorkspace(organizationId, workspaceId)) };
}

function resolveActiveContext(document, organizationId, requestedWorkspaceId = null) {
  const resolvers = createTargetResolvers(document);
  const organization = resolvers.resolveOrganization(organizationId);
  let workspace = null;
  if (requestedWorkspaceId !== null && requestedWorkspaceId !== undefined && requestedWorkspaceId !== '') {
    workspace = resolvers.resolveWorkspace(organization.id, requestedWorkspaceId);
  } else {
    const savedWorkspaceId = document.userPreferences.activeWorkspaceIdsByOrganization[organization.id];
    if (savedWorkspaceId) {
      try {
        workspace = resolvers.resolveWorkspace(organization.id, savedWorkspaceId);
      } catch (_) {
        workspace = null;
      }
    }
  }
  return {
    organization: publicOrganization(organization),
    workspace: workspace ? publicWorkspace(workspace) : null,
    selectionRequired: workspace === null
  };
}

function buildPortfolio(document, organizationId) {
  const resolvers = createTargetResolvers(document);
  const organization = resolvers.resolveOrganization(organizationId);
  const workspaces = recordsForOrganization(document, 'workspaces', organization.id);
  const workspaceRows = workspaces.map(workspace => {
    const initiatives = recordsForWorkspace(document, 'initiatives', organization.id, workspace.id);
    const workstreams = recordsForWorkspace(document, 'workstreams', organization.id, workspace.id);
    const workItems = recordsForWorkspace(document, 'workItems', organization.id, workspace.id).filter(item => !item.archived);
    const milestones = recordsForWorkspace(document, 'milestones', organization.id, workspace.id);
    const sources = recordsForWorkspace(document, 'sources', organization.id, workspace.id);
    const findings = recordsForWorkspace(document, 'findings', organization.id, workspace.id);
    const evidence = recordsForWorkspace(document, 'evidence', organization.id, workspace.id);
    return {
      ...publicWorkspace(workspace),
      counts: {
        initiatives: initiatives.filter(initiative => !initiative.archived).length,
        workstreams: workstreams.length,
        workItems: workItems.length,
        unassignedWorkItems: workItems.filter(item => item.initiativeId === null).length,
        openFollowUps: workItems.filter(item => ['open', 'waiting'].includes(item.followUp.state)).length,
        milestones: milestones.length,
        sources: sources.length,
        findingsToReview: findings.filter(finding => finding.reviewStatus === 'pending').length,
        acceptedEvidence: evidence.length
      }
    };
  });
  const total = field => workspaceRows.reduce((sum, workspace) => sum + workspace.counts[field], 0);
  return {
    organization: publicOrganization(organization),
    counts: {
      workspaces: workspaceRows.length,
      activeWorkspaces: workspaceRows.filter(workspace => !workspace.archived).length,
      workItems: total('workItems'),
      workstreams: total('workstreams'),
      unassignedWorkItems: total('unassignedWorkItems'),
      openFollowUps: total('openFollowUps'),
      milestones: total('milestones'),
      sources: total('sources'),
      findingsToReview: total('findingsToReview'),
      acceptedEvidence: total('acceptedEvidence'),
      briefings: recordsForOrganization(document, 'briefings', organization.id).filter(briefing => !briefing.archived).length
    },
    workspaces: workspaceRows
  };
}

function buildToday(document, organizationId, workspaceId) {
  const resolvers = createTargetResolvers(document);
  const organization = resolvers.resolveOrganization(organizationId);
  const workspace = resolvers.resolveWorkspace(organization.id, workspaceId);
  const initiatives = recordsForWorkspace(document, 'initiatives', organization.id, workspace.id);
  const initiativeIndex = new Map(initiatives.map(initiative => [initiative.id, initiative]));
  const workstreams = recordsForWorkspace(document, 'workstreams', organization.id, workspace.id);
  const workstreamIndex = new Map(workstreams.map(workstream => [workstream.id, workstream]));
  const jiraEpicMappings = recordsForWorkspace(document, 'jiraEpicMappings', organization.id, workspace.id);
  const jiraEpicMappingIndex = new Map(jiraEpicMappings.map(mapping => [mapping.id, mapping]));
  const workItems = recordsForWorkspace(document, 'workItems', organization.id, workspace.id).filter(item => !item.archived);
  const milestones = recordsForWorkspace(document, 'milestones', organization.id, workspace.id);
  const findings = recordsForWorkspace(document, 'findings', organization.id, workspace.id);
  const evidence = recordsForWorkspace(document, 'evidence', organization.id, workspace.id);
  const blockedStatuses = new Set(['blocked', 'at risk']);
  return {
    organization: publicOrganization(organization),
    workspace: publicWorkspace(workspace),
    counts: {
      workItems: workItems.length,
      workstreams: workstreams.length,
      assignedWorkItems: workItems.filter(item => item.initiativeId !== null).length,
      unassignedWorkItems: workItems.filter(item => item.initiativeId === null).length,
      blockedWorkItems: workItems.filter(item => blockedStatuses.has(item.canonicalStatus.trim().toLowerCase())).length,
      openFollowUps: workItems.filter(item => ['open', 'waiting'].includes(item.followUp.state)).length,
      milestones: milestones.length,
      findingsToReview: findings.filter(finding => finding.reviewStatus === 'pending').length,
      acceptedEvidence: evidence.length
    },
    initiatives: initiatives.map(publicInitiative),
    workstreams: workstreams.map(publicWorkstream),
    jiraEpicMappings: jiraEpicMappings.map(publicJiraEpicMapping),
    workItems: workItems.map(item => publicWorkItem(item, initiativeIndex, workstreamIndex, jiraEpicMappingIndex)),
    attention: {
      blockedWorkItems: workItems
        .filter(item => blockedStatuses.has(item.canonicalStatus.trim().toLowerCase()))
        .map(item => publicWorkItem(item, initiativeIndex, workstreamIndex, jiraEpicMappingIndex)),
      followUps: workItems
        .filter(item => ['open', 'waiting'].includes(item.followUp.state))
        .map(item => publicWorkItem(item, initiativeIndex, workstreamIndex, jiraEpicMappingIndex)),
      milestones: milestones.map(milestone => publicMilestone(milestone, initiativeIndex, milestoneOptions(workspace))),
      findingsToReview: findings.filter(finding => finding.reviewStatus === 'pending').map(publicFinding)
    }
  };
}

function normalizeSearchQuery(query) {
  if (typeof query !== 'string' || query !== query.trim()) throw invalidQuery();
  if (query.length < MIN_SEARCH_QUERY_CHARACTERS || query.length > MAX_SEARCH_QUERY_CHARACTERS) throw invalidQuery();
  return query.toLocaleLowerCase('en-US');
}

function excerpt(value, maximum = 240) {
  const text = String(value || '');
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

function searchWorkspace(document, organizationId, workspaceId, query) {
  const resolvers = createTargetResolvers(document);
  const workspace = resolvers.resolveWorkspace(organizationId, workspaceId);
  const needle = normalizeSearchQuery(query);
  const initiativeIndex = new Map(recordsForWorkspace(document, 'initiatives', organizationId, workspace.id).map(initiative => [initiative.id, initiative]));
  const workstreamIndex = new Map(recordsForWorkspace(document, 'workstreams', organizationId, workspace.id).map(workstream => [workstream.id, workstream]));
  const jiraEpicMappingIndex = new Map(recordsForWorkspace(document, 'jiraEpicMappings', organizationId, workspace.id).map(mapping => [mapping.id, mapping]));
  const contains = values => values.some(value => String(value || '').toLocaleLowerCase('en-US').includes(needle));
  const results = [];
  const add = result => {
    if (results.length < MAX_SEARCH_RESULTS) results.push(result);
  };

  recordsForWorkspace(document, 'initiatives', organizationId, workspace.id).forEach(initiative => {
    if (contains([initiative.name, initiative.description, initiative.owner])) add({ kind: 'initiative', id: initiative.id, title: initiative.name, workspaceId: workspace.id, initiativeId: initiative.id });
  });
  recordsForWorkspace(document, 'workstreams', organizationId, workspace.id).forEach(workstream => {
    if (contains([workstream.name, workstream.description])) add({ kind: 'workstream', id: workstream.id, title: workstream.name, workspaceId: workspace.id, initiativeId: workstream.initiativeId });
  });
  recordsForWorkspace(document, 'jiraEpicMappings', organizationId, workspace.id).forEach(mapping => {
    if (contains([
      mapping.jiraProjectKey,
      mapping.jiraEpicKey,
      mapping.jiraEpicName,
      mapping.mappingStatus,
      mapping.provenance
    ])) {
      add({
        kind: 'jiraEpicMapping',
        id: mapping.id,
        title: `${mapping.jiraEpicKey} — ${mapping.jiraEpicName}`,
        workspaceId: workspace.id,
        initiativeId: mapping.initiativeId,
        jiraProjectKey: mapping.jiraProjectKey,
        jiraEpicKey: mapping.jiraEpicKey,
        jiraEpicName: mapping.jiraEpicName,
        mappingStatus: mapping.mappingStatus,
        provenance: mapping.provenance
      });
    }
  });
  recordsForWorkspace(document, 'workItems', organizationId, workspace.id).forEach(item => {
    const mapping = jiraEpicMappingIndex.get(item.jiraEpicMappingId);
    if (contains([
      item.summary,
      item.jiraKey,
      item.canonicalStatus,
      item.assignee,
      item.sprint,
      workstreamIndex.get(item.workstreamId)?.name,
      mapping?.jiraEpicKey,
      mapping?.jiraEpicName
    ])) {
      add({
        kind: 'workItem',
        id: item.id,
        title: item.summary,
        workspaceId: workspace.id,
        initiativeId: item.initiativeId,
        initiativeName: initiativeIndex.get(item.initiativeId)?.name || null,
        workstreamId: item.workstreamId,
        workstreamName: workstreamIndex.get(item.workstreamId)?.name || null,
        jiraEpicMappingId: item.jiraEpicMappingId,
        jiraEpicKey: mapping?.jiraEpicKey || null,
        jiraEpicName: mapping?.jiraEpicName || null,
        jiraEpicMappingStatus: mapping?.mappingStatus || null,
        workItemJiraKey: item.jiraKey
      });
    }
  });
  recordsForWorkspace(document, 'milestones', organizationId, workspace.id).forEach(milestone => {
    if (contains([milestone.title, milestone.status, milestone.notes])) add({ kind: 'milestone', id: milestone.id, title: milestone.title, workspaceId: workspace.id, initiativeId: milestone.initiativeId });
  });
  recordsForWorkspace(document, 'sources', organizationId, workspace.id).forEach(source => {
    if (contains([source.title, source.type, source.sourceKind, source.date])) add({ kind: 'source', id: source.id, title: source.title, workspaceId: workspace.id, initiativeId: null, date: source.date });
  });
  recordsForWorkspace(document, 'evidence', organizationId, workspace.id).forEach(evidence => {
    if (contains([evidence.exactExcerpt, evidence.currentness])) add({ kind: 'evidence', id: evidence.id, title: excerpt(evidence.exactExcerpt), workspaceId: workspace.id, initiativeId: evidence.initiativeId, sourceId: evidence.sourceId });
  });
  return { organizationId, workspaceId: workspace.id, query, results };
}

function listWorkspaceCollection(document, collection, organizationId, workspaceId) {
  const resolvers = createTargetResolvers(document);
  const workspace = resolvers.resolveWorkspace(organizationId, workspaceId);
  const initiativeIndex = new Map(recordsForWorkspace(document, 'initiatives', organizationId, workspace.id).map(initiative => [initiative.id, initiative]));
  const workstreamIndex = new Map(recordsForWorkspace(document, 'workstreams', organizationId, workspace.id).map(workstream => [workstream.id, workstream]));
  const jiraEpicMappingIndex = new Map(recordsForWorkspace(document, 'jiraEpicMappings', organizationId, workspace.id).map(mapping => [mapping.id, mapping]));
  const serializers = {
    initiatives: publicInitiative,
    workstreams: publicWorkstream,
    jiraEpicMappings: publicJiraEpicMapping,
    workItems: item => publicWorkItem(item, initiativeIndex, workstreamIndex, jiraEpicMappingIndex),
    milestones: milestone => publicMilestone(milestone, initiativeIndex, milestoneOptions(workspace)),
    sources: source => publicSource(source),
    findings: publicFinding,
    evidence: publicEvidence,
    proposedChanges: publicProposedChange
  };
  return { [collection]: recordsForWorkspace(document, collection, organizationId, workspace.id).map(serializers[collection]) };
}

function getWorkspaceChild(document, collection, organizationId, workspaceId, childId) {
  const resolvers = createTargetResolvers(document);
  const workspace = resolvers.resolveWorkspace(organizationId, workspaceId);
  const child = resolvers.resolveWorkspaceChild(collection, organizationId, workspaceId, childId);
  const initiativeIndex = resolvers.indexes.initiatives;
  const workstreamIndex = resolvers.indexes.workstreams;
  const jiraEpicMappingIndex = resolvers.indexes.jiraEpicMappings;
  const serializers = {
    initiatives: initiative => ({
      ...publicInitiative(initiative),
      workstreams: recordsForWorkspace(document, 'workstreams', organizationId, workspace.id)
        .filter(workstream => workstream.initiativeId === initiative.id)
        .map(publicWorkstream),
      jiraEpicMappings: recordsForWorkspace(document, 'jiraEpicMappings', organizationId, workspace.id)
        .filter(mapping => mapping.initiativeId === initiative.id)
        .map(publicJiraEpicMapping)
    }),
    workstreams: publicWorkstream,
    jiraEpicMappings: publicJiraEpicMapping,
    workItems: item => publicWorkItem(item, initiativeIndex, workstreamIndex, jiraEpicMappingIndex),
    milestones: milestone => publicMilestone(milestone, initiativeIndex, milestoneOptions(workspace)),
    sources: source => publicSource(source, { includeContent: true }),
    findings: publicFinding,
    evidence: publicEvidence,
    proposedChanges: publicProposedChange
  };
  const singularKeys = {
    initiatives: 'initiative',
    workstreams: 'workstream',
    jiraEpicMappings: 'jiraEpicMapping',
    workItems: 'workItem',
    milestones: 'milestone',
    sources: 'source',
    findings: 'finding',
    evidence: 'evidence',
    proposedChanges: 'proposedChange'
  };
  return { [singularKeys[collection]]: serializers[collection](child) };
}

function listFindingsForSource(document, organizationId, workspaceId, sourceId) {
  const resolvers = createTargetResolvers(document);
  const source = resolvers.resolveWorkspaceChild('sources', organizationId, workspaceId, sourceId);
  return { findings: recordsForWorkspace(document, 'findings', organizationId, workspaceId).filter(finding => finding.sourceId === source.id).map(publicFinding) };
}

function getFindingForSource(document, organizationId, workspaceId, sourceId, findingId) {
  const resolvers = createTargetResolvers(document);
  return { finding: publicFinding(resolvers.resolveFinding(organizationId, workspaceId, sourceId, findingId)) };
}

function listEvidenceForSource(document, organizationId, workspaceId, sourceId) {
  const resolvers = createTargetResolvers(document);
  const source = resolvers.resolveWorkspaceChild('sources', organizationId, workspaceId, sourceId);
  return { evidence: recordsForWorkspace(document, 'evidence', organizationId, workspaceId).filter(item => item.sourceId === source.id).map(publicEvidence) };
}

function getEvidenceForSource(document, organizationId, workspaceId, sourceId, evidenceId) {
  const resolvers = createTargetResolvers(document);
  return { evidence: publicEvidence(resolvers.resolveEvidence(organizationId, workspaceId, evidenceId, { sourceId })) };
}

function listBriefings(document, organizationId) {
  const resolvers = createTargetResolvers(document);
  const organization = resolvers.resolveOrganization(organizationId);
  const briefings = recordsForOrganization(document, 'briefings', organization.id).map(briefing => {
    resolvers.resolveBriefing(organization.id, briefing.id);
    return publicBriefing(briefing, resolvers);
  });
  return { organization: publicOrganization(organization), briefings };
}

function getBriefing(document, organizationId, briefingId) {
  const resolvers = createTargetResolvers(document);
  return { briefing: publicBriefing(resolvers.resolveBriefing(organizationId, briefingId), resolvers) };
}

function listBriefingVersions(document, organizationId, briefingId) {
  const resolvers = createTargetResolvers(document);
  const briefing = resolvers.resolveBriefing(organizationId, briefingId);
  return {
    briefing: { id: briefing.id, organizationId: briefing.organizationId, name: briefing.name },
    versions: recordsForOrganization(document, 'briefingVersions', briefing.organizationId)
      .filter(version => version.briefingId === briefing.id)
      .map(version => {
        resolvers.resolveBriefingVersion(briefing.organizationId, briefing.id, version.id);
        return publicBriefingVersion(document, version);
      })
  };
}

function getBriefingVersion(document, organizationId, briefingId, versionId) {
  const resolvers = createTargetResolvers(document);
  return {
    version: publicBriefingVersion(
      document,
      resolvers.resolveBriefingVersion(organizationId, briefingId, versionId),
      { includeFrozenContent: true }
    )
  };
}

function archiveSource(source) {
  return publicSource(source, { includeContent: true });
}

function buildOrganizationArchive(document, organizationId, kind) {
  const resolvers = createTargetResolvers(document);
  const organization = resolvers.resolveOrganization(organizationId);
  const workspaces = recordsForOrganization(document, 'workspaces', organization.id);
  const workspaceIds = new Set(workspaces.map(workspace => workspace.id));
  const savedWorkspaceId = document.userPreferences.activeWorkspaceIdsByOrganization[organization.id];
  return {
    schemaVersion: document.schemaVersion,
    exportContext: { kind, organizationId: organization.id },
    organizations: [clone(organization)],
    workspaces: clone(workspaces),
    initiatives: clone(recordsForOrganization(document, 'initiatives', organization.id)),
    workstreams: clone(recordsForOrganization(document, 'workstreams', organization.id)),
    jiraEpicMappings: clone(recordsForOrganization(document, 'jiraEpicMappings', organization.id)),
    workItems: clone(recordsForOrganization(document, 'workItems', organization.id)),
    milestones: clone(recordsForOrganization(document, 'milestones', organization.id)),
    sources: recordsForOrganization(document, 'sources', organization.id).map(archiveSource),
    findings: clone(recordsForOrganization(document, 'findings', organization.id)),
    evidence: clone(recordsForOrganization(document, 'evidence', organization.id)),
    proposedChanges: clone(recordsForOrganization(document, 'proposedChanges', organization.id)),
    briefings: clone(recordsForOrganization(document, 'briefings', organization.id)),
    briefingVersions: recordsForOrganization(document, 'briefingVersions', organization.id)
      .map(version => publicBriefingVersion(document, version, { includeFrozenContent: true })),
    auditEvents: clone(recordsForOrganization(document, 'auditEvents', organization.id)),
    userPreferences: {
      activeOrganizationId: document.userPreferences.activeOrganizationId === organization.id ? organization.id : null,
      activeWorkspaceId: savedWorkspaceId && workspaceIds.has(savedWorkspaceId) ? savedWorkspaceId : null
    }
  };
}

function buildAiContext(document, organizationId, workspaceId) {
  const resolvers = createTargetResolvers(document);
  const organization = resolvers.resolveOrganization(organizationId);
  const workspace = resolvers.resolveWorkspace(organization.id, workspaceId);
  const initiatives = recordsForWorkspace(document, 'initiatives', organization.id, workspace.id);
  const initiativeIndex = new Map(initiatives.map(initiative => [initiative.id, initiative]));
  const workstreams = recordsForWorkspace(document, 'workstreams', organization.id, workspace.id);
  const workstreamIndex = new Map(workstreams.map(workstream => [workstream.id, workstream]));
  const jiraEpicMappings = recordsForWorkspace(document, 'jiraEpicMappings', organization.id, workspace.id);
  const jiraEpicMappingIndex = new Map(jiraEpicMappings.map(mapping => [mapping.id, mapping]));
  const briefings = recordsForOrganization(document, 'briefings', organization.id)
    .filter(briefing => briefing.workspaceIds.length === 1 && briefing.workspaceIds[0] === workspace.id)
    .map(briefing => {
      resolvers.resolveBriefing(organization.id, briefing.id);
      return publicBriefing(briefing, resolvers);
    });
  const briefingIds = new Set(briefings.map(briefing => briefing.id));
  const briefingVersions = recordsForOrganization(document, 'briefingVersions', organization.id)
    .filter(version => briefingIds.has(version.briefingId) && version.workspaceIds.length === 1 && version.workspaceIds[0] === workspace.id)
    .map(version => {
      resolvers.resolveBriefingVersion(organization.id, version.briefingId, version.id);
      return publicBriefingVersion(document, version, { includeFrozenContent: true });
    });
  return {
    schemaVersion: document.schemaVersion,
    organization: publicOrganization(organization),
    workspace: {
      ...publicWorkspace(workspace),
      promptOverrides: clone(workspace.promptOverrides),
      draftingGuidance: workspace.draftingGuidance
    },
    initiatives: initiatives.map(publicInitiative),
    workstreams: workstreams.map(publicWorkstream),
    jiraEpicMappings: jiraEpicMappings.map(publicJiraEpicMapping),
    workItems: recordsForWorkspace(document, 'workItems', organization.id, workspace.id)
      .map(item => publicWorkItem(item, initiativeIndex, workstreamIndex, jiraEpicMappingIndex)),
    milestones: recordsForWorkspace(document, 'milestones', organization.id, workspace.id)
      .map(milestone => publicMilestone(milestone, initiativeIndex, milestoneOptions(workspace))),
    sources: recordsForWorkspace(document, 'sources', organization.id, workspace.id).map(source => publicSource(source, { includeContent: true })),
    evidence: recordsForWorkspace(document, 'evidence', organization.id, workspace.id).map(publicEvidence),
    briefings,
    briefingVersions
  };
}

module.exports = {
  MAX_SEARCH_QUERY_CHARACTERS,
  MAX_SEARCH_RESULTS,
  MIN_SEARCH_QUERY_CHARACTERS,
  buildAiContext,
  buildOrganizationArchive,
  buildPortfolio,
  buildToday,
  assertBriefingVersionContentIsolation,
  getBriefing,
  getBriefingVersion,
  getEvidenceForSource,
  getFindingForSource,
  getOrganization,
  getWorkspace,
  getWorkspaceChild,
  listBriefingVersions,
  listBriefings,
  listEvidenceForSource,
  listFindingsForSource,
  listOrganizations,
  listWorkspaceCollection,
  listWorkspaces,
  normalizeSearchQuery,
  publicOrganization,
  publicBriefing,
  publicBriefingVersion,
  publicWorkstream,
  publicMilestone,
  publicSource,
  publicWorkItem,
  publicWorkspace,
  milestoneTiming,
  recordsForOrganization,
  recordsForWorkspace,
  resolveActiveContext,
  searchWorkspace,
  sourceFileMetadata
};
