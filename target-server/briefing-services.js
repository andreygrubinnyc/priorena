'use strict';

const path = require('node:path');

const { AUDIT_ACTIONS } = require('../target-model/schema');
const { invalidRequest, notFound, outputTooLarge, previewConflict } = require('./errors');
const {
  assertBriefingVersionContentIsolation,
  publicBriefing,
  publicBriefingVersion,
  recordsForOrganization
} = require('./projections');
const { createTargetResolvers } = require('./resolvers');
const {
  appendAudit,
  clone,
  createWorkflowRuntime,
  exactKeys,
  readWorkflow,
  requireActor,
  requireArray,
  requireEnum,
  requireIsoTimestamp,
  requireObject,
  requireStableId,
  requireText,
  stateHash,
  writeWorkflow
} = require('./workflow-utils');

const BRIEFING_FORMATS = Object.freeze(['teams', 'email', 'confluence']);
const BRIEFING_TYPES = Object.freeze(['status-update', 'delivery-status', 'general']);
const BRIEFING_SECTIONS = Object.freeze(['summary', 'progress', 'risk', 'milestones', 'follow-up', 'evidence', 'next-actions']);
const COMMUNICATION_CHANNELS = Object.freeze(['teams', 'email', 'confluence', 'other']);
const MAX_CANDIDATE_FACTS = 500;
const MAX_MANUAL_INPUTS = 50;
const MAX_OUTPUT_BYTES = 128 * 1024;

function requireExplicitTargetDataFile(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new TypeError('Target Briefing services require an explicit schema-v5 data-file path');
  return path.resolve(filePath);
}

function uniqueValues(value, options = {}) {
  const values = requireArray(value, options).map(options.ids ? requireStableId : item => requireEnum(item, options.accepted));
  if (new Set(values).size !== values.length) throw invalidRequest();
  return values;
}

function definitionInput(value, existing = null) {
  const fields = [
    'name', 'workspaceIds', 'initiativeIds', 'audienceProfile', 'preferredFormats', 'defaultSections',
    'briefingType', 'draftingGuidance'
  ];
  exactKeys(value, fields, existing ? [] : ['name', 'workspaceIds', 'initiativeIds', 'audienceProfile', 'preferredFormats', 'defaultSections']);
  const next = existing ? {
    name: existing.name,
    workspaceIds: [...existing.workspaceIds],
    initiativeIds: [...existing.initiativeIds],
    audienceProfile: existing.audienceProfile,
    preferredFormats: [...existing.preferredFormats],
    defaultSections: [...existing.defaultSections],
    briefingType: existing.briefingType || 'status-update',
    draftingGuidance: existing.draftingGuidance || ''
  } : {
    briefingType: 'status-update',
    draftingGuidance: ''
  };
  if (Object.hasOwn(value, 'name')) next.name = requireText(value.name, { max: 300 });
  if (Object.hasOwn(value, 'workspaceIds')) next.workspaceIds = uniqueValues(value.workspaceIds, { min: 1, max: 20, ids: true });
  if (Object.hasOwn(value, 'initiativeIds')) next.initiativeIds = uniqueValues(value.initiativeIds, { max: 100, ids: true });
  if (Object.hasOwn(value, 'audienceProfile')) next.audienceProfile = requireText(value.audienceProfile, { max: 500 });
  if (Object.hasOwn(value, 'preferredFormats')) next.preferredFormats = uniqueValues(value.preferredFormats, { min: 1, max: 3, accepted: BRIEFING_FORMATS });
  if (Object.hasOwn(value, 'defaultSections')) next.defaultSections = uniqueValues(value.defaultSections, { min: 1, max: BRIEFING_SECTIONS.length, accepted: BRIEFING_SECTIONS });
  if (Object.hasOwn(value, 'briefingType')) next.briefingType = requireEnum(value.briefingType, BRIEFING_TYPES);
  if (Object.hasOwn(value, 'draftingGuidance')) next.draftingGuidance = requireText(value.draftingGuidance, { allowEmpty: true, max: 4_000 });
  return next;
}

function validateDefinitionParents(resolvers, organizationId, input) {
  resolvers.resolveOrganization(organizationId);
  const workspaceIds = new Set(input.workspaceIds);
  input.workspaceIds.forEach(workspaceId => resolvers.resolveWorkspace(organizationId, workspaceId));
  input.initiativeIds.forEach(initiativeId => {
    const initiative = resolvers.indexes.initiatives.get(requireStableId(initiativeId));
    if (!initiative || initiative.organizationId !== organizationId || !workspaceIds.has(initiative.workspaceId)) throw notFound();
  });
}

function organizationAudit(document, runtime, details) {
  return appendAudit(document, runtime, {
    organizationId: details.organizationId,
    workspaceId: null,
    entityType: details.entityType,
    entityId: details.entityId,
    action: details.action,
    actor: details.actor,
    timestamp: details.timestamp,
    before: details.before,
    after: details.after
  });
}

function safeText(value, maximum = 2_000) {
  const original = String(value ?? '');
  if (original.length <= maximum) return { text: original, truncated: false, originalCharacterCount: original.length };
  return { text: `${original.slice(0, maximum - 1)}…`, truncated: true, originalCharacterCount: original.length };
}

function selectionMap(document, selection) {
  const selectedWorkspaceIds = new Set(selection.workspaceIds);
  const initiativesByWorkspace = new Map(selection.workspaceIds.map(workspaceId => [workspaceId, new Set()]));
  selection.initiativeIds.forEach(initiativeId => {
    const initiative = document.initiatives.find(item => item.id === initiativeId);
    if (!initiative || initiative.organizationId !== selection.organizationId || !selectedWorkspaceIds.has(initiative.workspaceId)) throw notFound();
    initiativesByWorkspace.get(initiative.workspaceId).add(initiative.id);
  });
  return { selectedWorkspaceIds, initiativesByWorkspace };
}

function includesRecord(record, map, options = {}) {
  if (!map.selectedWorkspaceIds.has(record.workspaceId)) return false;
  const selectedInitiatives = map.initiativesByWorkspace.get(record.workspaceId);
  if (!selectedInitiatives || selectedInitiatives.size === 0) return true;
  if (record.initiativeId === null) return options.includeWorkspaceLevel === true;
  return selectedInitiatives.has(record.initiativeId);
}

function candidateSection(preferred, sections) {
  return sections.includes(preferred) ? preferred : sections[0];
}

function candidateBase(selection, record, values) {
  const bounded = safeText(values.text);
  return {
    id: values.id,
    kind: values.kind,
    section: candidateSection(values.section, selection.defaultSections),
    organizationId: selection.organizationId,
    workspaceId: record.workspaceId,
    initiativeId: record.initiativeId,
    recordId: record.id,
    title: safeText(values.title, 500).text,
    text: bounded.text,
    currentness: values.currentness,
    provenance: values.provenance,
    truncated: bounded.truncated,
    originalCharacterCount: bounded.originalCharacterCount
  };
}

function buildCandidateFacts(document, selection) {
  const map = selectionMap(document, selection);
  const initiativeNames = new Map(document.initiatives.map(initiative => [initiative.id, initiative.name]));
  const workstreamNames = new Map(document.workstreams.map(workstream => [workstream.id, workstream.name]));
  const jiraEpicMappings = new Map(document.jiraEpicMappings.map(mapping => [mapping.id, mapping]));
  const sourceNames = new Map(document.sources.map(source => [source.id, source.title]));
  const findingIndex = new Map(document.findings.map(finding => [finding.id, finding]));
  const candidates = [];

  document.workItems
    .filter(item => item.organizationId === selection.organizationId && !item.archived && includesRecord(item, map))
    .forEach(item => {
      const initiativeLabel = item.initiativeId === null ? 'Unassigned' : initiativeNames.get(item.initiativeId);
      const workstreamLabel = item.workstreamId === null ? 'No Workstream' : workstreamNames.get(item.workstreamId);
      const jiraEpicMapping = item.jiraEpicMappingId === null ? null : jiraEpicMappings.get(item.jiraEpicMappingId);
      const jiraEpicLabel = jiraEpicMapping === null
        ? 'No Jira Epic'
        : `${jiraEpicMapping.jiraEpicKey} — ${jiraEpicMapping.jiraEpicName} (${jiraEpicMapping.mappingStatus})`;
      const workItemJiraLabel = item.jiraKey === null ? 'No Work Item Jira key' : item.jiraKey;
      candidates.push(candidateBase(selection, item, {
        id: `fact:current-state:${item.id}`,
        kind: 'current-state',
        section: ['Blocked', 'At risk'].includes(item.canonicalStatus) ? 'risk' : 'progress',
        title: item.summary,
        text: `Status: ${item.canonicalStatus}. Initiative: ${initiativeLabel}. Workstream: ${workstreamLabel}. Jira Epic: ${jiraEpicLabel}. Work Item Jira key: ${workItemJiraLabel}.`,
        currentness: 'current',
        provenance: { type: 'direct-work-item-state', workItemId: item.id, label: item.currentStateProvenance }
      }));
      candidates.at(-1).workstreamId = item.workstreamId;
      candidates.at(-1).workstreamName = workstreamLabel;
      candidates.at(-1).jiraEpicMappingId = item.jiraEpicMappingId;
      candidates.at(-1).jiraEpicKey = jiraEpicMapping?.jiraEpicKey || null;
      candidates.at(-1).jiraEpicName = jiraEpicMapping?.jiraEpicName || null;
      candidates.at(-1).jiraEpicMappingStatus = jiraEpicMapping?.mappingStatus || null;
      candidates.at(-1).workItemJiraKey = item.jiraKey;
      if (['open', 'waiting'].includes(item.followUp.state)) {
        candidates.push(candidateBase(selection, item, {
          id: `fact:follow-up:${item.id}`,
          kind: 'follow-up',
          section: 'follow-up',
          title: item.summary,
          text: item.followUp.nextAction || `Follow-Up is ${item.followUp.state}.`,
          currentness: 'current',
          provenance: { type: 'direct-follow-up-state', workItemId: item.id, label: item.followUp.state }
        }));
      }
    });

  document.milestones
    .filter(item => item.organizationId === selection.organizationId && includesRecord(item, map, { includeWorkspaceLevel: true }))
    .forEach(item => candidates.push(candidateBase(selection, item, {
      id: `fact:milestone:${item.id}`,
      kind: 'milestone',
      section: ['At risk', 'Blocked'].includes(item.status) ? 'risk' : 'milestones',
      title: item.title,
      text: `${item.status}. Due ${item.date}. Applies to: ${item.initiativeId === null ? 'Entire workspace' : initiativeNames.get(item.initiativeId)}.`,
      currentness: 'current',
      provenance: { type: 'direct-milestone-state', milestoneId: item.id }
    })));

  document.evidence
    .filter(item => item.organizationId === selection.organizationId && includesRecord(item, map))
    .forEach(item => {
      const finding = findingIndex.get(item.findingId);
      if (!finding || finding.reviewStatus !== 'accepted' || finding.organizationId !== item.organizationId || finding.workspaceId !== item.workspaceId) return;
      candidates.push(candidateBase(selection, item, {
        id: `fact:accepted-evidence:${item.id}`,
        kind: 'accepted-evidence',
        section: 'evidence',
        title: sourceNames.get(item.sourceId) || 'Accepted Evidence',
        text: item.exactExcerpt,
        currentness: 'historical-support',
        provenance: {
          type: 'accepted-evidence',
          evidenceId: item.id,
          findingId: item.findingId,
          sourceId: item.sourceId,
          sourceDate: item.sourceDate,
          acceptedAt: item.acceptedAt
        }
      }));
    });

  candidates.sort((left, right) => left.id.localeCompare(right.id, 'en-US'));
  if (candidates.length > MAX_CANDIDATE_FACTS) throw outputTooLarge();
  return candidates;
}

function definitionSnapshot(document, briefing) {
  const resolvers = createTargetResolvers(document);
  const organization = resolvers.resolveOrganization(briefing.organizationId);
  const workspaces = briefing.workspaceIds.map(workspaceId => resolvers.resolveWorkspace(briefing.organizationId, workspaceId));
  const initiatives = briefing.initiativeIds.map(initiativeId => resolvers.indexes.initiatives.get(initiativeId));
  return {
    briefingId: briefing.id,
    name: briefing.name,
    briefingType: briefing.briefingType || 'status-update',
    organization: { id: organization.id, name: organization.name },
    audienceProfile: briefing.audienceProfile,
    preferredFormats: [...briefing.preferredFormats],
    defaultSections: [...briefing.defaultSections],
    draftingGuidance: briefing.draftingGuidance || '',
    workspaceIds: [...briefing.workspaceIds],
    initiativeIds: [...briefing.initiativeIds],
    workspaces: workspaces.map(workspace => {
      const selectedInitiatives = initiatives.filter(initiative => initiative.workspaceId === workspace.id);
      return {
        id: workspace.id,
        name: workspace.name,
        selection: selectedInitiatives.length
          ? { kind: 'selected-initiatives', label: selectedInitiatives.map(initiative => initiative.name).join(', '), initiatives: selectedInitiatives.map(initiative => ({ id: initiative.id, name: initiative.name })) }
          : { kind: 'entire-workspace', label: 'Entire workspace', initiatives: [] }
      };
    })
  };
}

function normalizeManualInputs(value, runtime, sections, existing = []) {
  const existingIds = new Set(existing.map(item => item.id));
  const inputs = requireArray(value, { max: MAX_MANUAL_INPUTS }).map(item => {
    exactKeys(item, ['id', 'section', 'text'], ['section', 'text']);
    let id;
    if (item.id === undefined) id = `manual:${runtime.id('briefingVersion')}`;
    else {
      id = requireStableId(item.id);
      if (!existingIds.has(id)) throw invalidRequest();
    }
    return {
      id,
      label: 'Manual PM input',
      section: requireEnum(item.section, sections),
      text: requireText(item.text, { max: 4_000 })
    };
  });
  if (new Set(inputs.map(item => item.id)).size !== inputs.length) throw invalidRequest();
  return inputs;
}

function manualFacts(version, manualInputs) {
  return manualInputs.map(input => ({
    id: `fact:${input.id}`,
    kind: 'manual-input',
    section: input.section,
    organizationId: version.organizationId,
    workspaceId: null,
    initiativeId: null,
    recordId: input.id,
    title: 'Manual PM input',
    text: input.text,
    currentness: 'manual',
    provenance: { type: 'manual-pm-input', label: 'Manual PM input' },
    truncated: false,
    originalCharacterCount: input.text.length
  }));
}

function selectedCandidateFacts(candidates, selectedFactIds) {
  const candidateIndex = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const selected = uniqueValues(selectedFactIds, { max: MAX_CANDIDATE_FACTS, ids: true });
  selected.forEach(id => {
    if (!candidateIndex.has(id)) throw invalidRequest();
  });
  return selected.map(id => clone(candidateIndex.get(id)));
}

function comparisonFromBaseline(document, briefing, candidates, baselineId = briefing.lastCommunicatedVersionId) {
  if (baselineId === null) {
    return { baselineVersionId: null, addedFactIds: candidates.map(candidate => candidate.id), changedFactIds: [], removedFactIds: [] };
  }
  const baseline = document.briefingVersions.find(version => version.id === baselineId && version.briefingId === briefing.id && version.status === 'communicated');
  if (!baseline) throw notFound();
  const previous = new Map(baseline.facts.map(fact => [fact.id, fact]));
  const current = new Map(candidates.map(fact => [fact.id, fact]));
  return {
    baselineVersionId: baseline.id,
    addedFactIds: candidates.filter(fact => !previous.has(fact.id)).map(fact => fact.id),
    changedFactIds: candidates.filter(fact => previous.has(fact.id) && stateHash(previous.get(fact.id)) !== stateHash(fact)).map(fact => fact.id),
    removedFactIds: baseline.facts.filter(fact => !current.has(fact.id)).map(fact => fact.id)
  };
}

function draftSnapshot(document, briefing, runtime, options = {}) {
  const definition = options.definition || definitionSnapshot(document, briefing);
  const selection = { organizationId: briefing.organizationId, workspaceIds: definition.workspaceIds, initiativeIds: definition.initiativeIds, defaultSections: definition.defaultSections };
  const candidates = buildCandidateFacts(document, selection);
  const selectedFactIds = options.selectedFactIds || [];
  const manualInputs = options.manualInputs || [];
  return {
    schema: 'priorena-briefing-draft-v1',
    definition,
    candidates,
    candidateStateHash: stateHash(candidates),
    selectedFactIds: [...selectedFactIds],
    manualInputs: clone(manualInputs),
    comparison: comparisonFromBaseline(
      document,
      briefing,
      candidates,
      Object.hasOwn(options, 'comparisonVersionId') ? options.comparisonVersionId : briefing.lastCommunicatedVersionId
    ),
    preparedAt: runtime.timestamp()
  };
}

function draftStateHash(version) {
  return stateHash({
    organizationId: version.organizationId,
    briefingId: version.briefingId,
    workspaceIds: version.workspaceIds,
    initiativeIds: version.initiativeIds,
    definition: version.frozenSnapshot.definition,
    candidateStateHash: version.frozenSnapshot.candidateStateHash,
    selectedFactIds: version.frozenSnapshot.selectedFactIds,
    manualInputs: version.frozenSnapshot.manualInputs
  });
}

function assertDraftCurrent(document, version) {
  if (version.status !== 'draft') throw invalidRequest();
  const definition = version.frozenSnapshot?.definition;
  if (!definition || version.frozenSnapshot.schema !== 'priorena-briefing-draft-v1') throw invalidRequest();
  const candidates = buildCandidateFacts(document, {
    organizationId: version.organizationId,
    workspaceIds: version.workspaceIds,
    initiativeIds: version.initiativeIds,
    defaultSections: definition.defaultSections
  });
  if (stateHash(candidates) !== version.frozenSnapshot.candidateStateHash) throw previewConflict();
  return candidates;
}

function canonicalContentModel(version) {
  const definition = version.frozenSnapshot.definition;
  const base = {
    schema: 'priorena-briefing-content-v1',
    briefingId: version.briefingId,
    versionId: version.id,
    name: definition.name,
    organization: clone(definition.organization),
    briefingType: definition.briefingType,
    audienceProfile: definition.audienceProfile,
    sections: [...definition.defaultSections],
    formats: [...definition.preferredFormats],
    workspaces: clone(definition.workspaces),
    comparison: clone(version.frozenSnapshot.comparison),
    facts: clone(version.facts),
    factIds: version.facts.map(fact => fact.id),
    manualInputIds: version.facts.filter(fact => fact.kind === 'manual-input').map(fact => fact.recordId)
  };
  return { ...base, contentHash: stateHash(base) };
}

function initiativeSummary(content) {
  return content.workspaces.map(workspace => `${workspace.name}: ${workspace.selection.label}`).join('; ');
}

function factsBySection(content) {
  return content.sections.map(section => ({ section, facts: content.facts.filter(fact => fact.section === section) }));
}

function renderTeams(content) {
  const lines = [`**${content.name}**`, `Audience: ${content.audienceProfile}`, `Initiative: ${initiativeSummary(content)}`];
  factsBySection(content).forEach(group => {
    if (!group.facts.length) return;
    lines.push('', `**${group.section}**`);
    group.facts.forEach(fact => lines.push(`- ${fact.title}: ${fact.text}`));
  });
  return lines.join('\n');
}

function renderEmail(content) {
  const lines = [`Subject: ${content.name}`, `Audience: ${content.audienceProfile}`, `Initiative: ${initiativeSummary(content)}`, ''];
  factsBySection(content).forEach(group => {
    if (!group.facts.length) return;
    lines.push(group.section.toUpperCase());
    group.facts.forEach(fact => lines.push(`• ${fact.title}: ${fact.text}`));
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}

function renderConfluence(content) {
  const lines = [`h1. ${content.name}`, `*Audience:* ${content.audienceProfile}`, `*Initiative:* ${initiativeSummary(content)}`];
  factsBySection(content).forEach(group => {
    if (!group.facts.length) return;
    lines.push('', `h2. ${group.section}`);
    group.facts.forEach(fact => lines.push(`* ${fact.title}: ${fact.text}`));
  });
  return lines.join('\n');
}

function deterministicOutputs(content) {
  const renderers = { teams: renderTeams, email: renderEmail, confluence: renderConfluence };
  return content.formats.map(format => {
    const text = renderers[format](content);
    if (Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES) throw outputTooLarge();
    return {
      format,
      mediaType: 'text/plain',
      contentHash: content.contentHash,
      factIds: [...content.factIds],
      manualInputIds: [...content.manualInputIds],
      text
    };
  });
}

function prepareFinalization(document, briefing, version) {
  assertBriefingVersionContentIsolation(document, version);
  assertDraftCurrent(document, version);
  if (!version.facts.length) throw invalidRequest();
  const content = canonicalContentModel(version);
  const outputs = deterministicOutputs(content);
  return {
    briefing: { id: briefing.id, name: briefing.name, organizationId: briefing.organizationId },
    version: { id: version.id, status: version.status, workspaceIds: [...version.workspaceIds], initiativeIds: [...version.initiativeIds] },
    audienceProfile: content.audienceProfile,
    workspaces: clone(content.workspaces),
    sections: [...content.sections],
    selectedFacts: clone(content.facts),
    manualInputs: clone(version.frozenSnapshot.manualInputs),
    snapshotBasis: { candidateStateHash: version.frozenSnapshot.candidateStateHash, preparedAt: version.frozenSnapshot.preparedAt },
    draftStateHash: draftStateHash(version),
    content,
    outputs
  };
}

function frozenContentHash(version) {
  return stateHash({
    workspaceIds: version.workspaceIds,
    initiativeIds: version.initiativeIds,
    comparisonVersionId: version.comparisonVersionId,
    frozenSnapshot: version.frozenSnapshot,
    facts: version.facts,
    outputs: version.outputs,
    finalizedAt: version.finalizedAt
  });
}

function requireHash(value) {
  const hash = requireText(value, { max: 64 });
  if (!/^[a-f0-9]{64}$/.test(hash)) throw invalidRequest();
  return hash;
}

function createBriefingServices(options = {}) {
  const targetDataFile = requireExplicitTargetDataFile(options.targetDataFile);
  const runtime = createWorkflowRuntime(options);

  function listBriefings(organizationId) {
    return readWorkflow(targetDataFile, document => {
      const resolvers = createTargetResolvers(document);
      const organization = resolvers.resolveOrganization(organizationId);
      return {
        organization: { id: organization.id, name: organization.name },
        briefings: recordsForOrganization(document, 'briefings', organization.id).map(briefing => publicBriefing(briefing, resolvers))
      };
    });
  }

  function getBriefing(organizationId, briefingId) {
    return readWorkflow(targetDataFile, document => {
      const resolvers = createTargetResolvers(document);
      return { briefing: publicBriefing(resolvers.resolveBriefing(organizationId, briefingId), resolvers) };
    });
  }

  function listVersions(organizationId, briefingId, placement = 'all') {
    if (!['all', 'open', 'history'].includes(placement)) throw invalidRequest();
    return readWorkflow(targetDataFile, document => {
      const resolvers = createTargetResolvers(document);
      const briefing = resolvers.resolveBriefing(organizationId, briefingId);
      let versions = document.briefingVersions.filter(version => version.organizationId === briefing.organizationId && version.briefingId === briefing.id);
      if (placement === 'open') versions = versions.filter(version => ['draft', 'finalized'].includes(version.status));
      if (placement === 'history') versions = versions.filter(version => version.status === 'communicated');
      return {
        placement,
        briefing: { id: briefing.id, organizationId: briefing.organizationId, name: briefing.name },
        versions: versions.map(version => publicBriefingVersion(document, resolvers.resolveBriefingVersion(organizationId, briefingId, version.id)))
      };
    });
  }

  return Object.freeze({
    listBriefings,
    getBriefing,
    listBriefingVersions: (organizationId, briefingId) => listVersions(organizationId, briefingId),
    listOpenBriefingVersions: (organizationId, briefingId) => listVersions(organizationId, briefingId, 'open'),
    listBriefingHistory: (organizationId, briefingId) => listVersions(organizationId, briefingId, 'history'),

    getBriefingVersion(organizationId, briefingId, versionId) {
      return readWorkflow(targetDataFile, document => {
        const resolvers = createTargetResolvers(document);
        const version = resolvers.resolveBriefingVersion(organizationId, briefingId, versionId);
        return { version: publicBriefingVersion(document, version, { includeFrozenContent: true }) };
      });
    },

    createBriefing(organizationId, body) {
      exactKeys(body, ['expectedRevision', 'actor', 'briefing'], ['expectedRevision', 'actor', 'briefing']);
      const actor = requireActor(body.actor);
      const input = definitionInput(body.briefing);
      return writeWorkflow(targetDataFile, body.expectedRevision, document => {
        const resolvers = createTargetResolvers(document);
        const organization = resolvers.resolveOrganization(organizationId);
        validateDefinitionParents(resolvers, organization.id, input);
        const timestamp = runtime.timestamp();
        const briefing = {
          id: runtime.id('briefing'),
          organizationId: organization.id,
          ...input,
          lastCommunicatedVersionId: null,
          archived: false,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        document.briefings.push(briefing);
        organizationAudit(document, runtime, {
          organizationId: organization.id, entityType: 'briefing', entityId: briefing.id,
          action: 'briefing-created', actor, timestamp, before: null, after: briefing
        });
        return { briefing: publicBriefing(briefing, createTargetResolvers(document)) };
      });
    },

    updateBriefing(organizationId, briefingId, body) {
      exactKeys(body, ['expectedRevision', 'actor', 'changes'], ['expectedRevision', 'actor', 'changes']);
      const actor = requireActor(body.actor);
      requireObject(body.changes);
      return writeWorkflow(targetDataFile, body.expectedRevision, document => {
        const resolvers = createTargetResolvers(document);
        const briefing = resolvers.resolveBriefing(organizationId, briefingId);
        const before = clone(briefing);
        const input = definitionInput(body.changes, briefing);
        validateDefinitionParents(resolvers, briefing.organizationId, input);
        Object.assign(briefing, input);
        briefing.updatedAt = runtime.timestamp();
        organizationAudit(document, runtime, {
          organizationId: briefing.organizationId, entityType: 'briefing', entityId: briefing.id,
          action: 'briefing-updated', actor, timestamp: briefing.updatedAt, before, after: briefing
        });
        return { briefing: publicBriefing(briefing, createTargetResolvers(document)) };
      });
    },

    prepareBriefingCandidates(organizationId, briefingId, body = {}) {
      exactKeys(body, []);
      return readWorkflow(targetDataFile, (document, revision) => {
        const resolvers = createTargetResolvers(document);
        const briefing = resolvers.resolveBriefing(organizationId, briefingId);
        const definition = definitionSnapshot(document, briefing);
        const candidates = buildCandidateFacts(document, {
          organizationId: briefing.organizationId,
          workspaceIds: briefing.workspaceIds,
          initiativeIds: briefing.initiativeIds,
          defaultSections: briefing.defaultSections
        });
        return {
          briefing: publicBriefing(briefing, resolvers),
          definition,
          candidates,
          comparison: comparisonFromBaseline(document, briefing, candidates),
          candidateStateHash: stateHash(candidates),
          expectedRevision: revision
        };
      });
    },

    createDraft(organizationId, briefingId, body) {
      exactKeys(body, ['expectedRevision', 'actor', 'selectedFactIds', 'manualInputs'], ['expectedRevision', 'actor']);
      const actor = requireActor(body.actor);
      return writeWorkflow(targetDataFile, body.expectedRevision, document => {
        const resolvers = createTargetResolvers(document);
        const briefing = resolvers.resolveBriefing(organizationId, briefingId);
        if (briefing.archived) throw invalidRequest();
        const definition = definitionSnapshot(document, briefing);
        const manualInputs = normalizeManualInputs(body.manualInputs || [], runtime, definition.defaultSections);
        const snapshot = draftSnapshot(document, briefing, runtime, {
          definition,
          selectedFactIds: body.selectedFactIds || [],
          manualInputs
        });
        const version = {
          id: runtime.id('briefingVersion'),
          organizationId: briefing.organizationId,
          briefingId: briefing.id,
          workspaceIds: [...briefing.workspaceIds],
          initiativeIds: [...briefing.initiativeIds],
          status: 'draft',
          comparisonVersionId: briefing.lastCommunicatedVersionId,
          frozenSnapshot: snapshot,
          facts: [],
          outputs: [],
          createdAt: snapshot.preparedAt,
          finalizedAt: null,
          communicatedAt: null,
          communication: null
        };
        version.facts = [
          ...selectedCandidateFacts(snapshot.candidates, snapshot.selectedFactIds),
          ...manualFacts(version, manualInputs)
        ];
        document.briefingVersions.push(version);
        organizationAudit(document, runtime, {
          organizationId: briefing.organizationId, entityType: 'briefingVersion', entityId: version.id,
          action: 'briefing-draft-created', actor, timestamp: version.createdAt, before: null, after: version
        });
        return { version: publicBriefingVersion(document, version, { includeFrozenContent: true }), draftStateHash: draftStateHash(version) };
      });
    },

    editDraft(organizationId, briefingId, versionId, body) {
      exactKeys(body, ['expectedRevision', 'actor', 'selectedFactIds', 'manualInputs'], ['expectedRevision', 'actor', 'selectedFactIds', 'manualInputs']);
      const actor = requireActor(body.actor);
      return writeWorkflow(targetDataFile, body.expectedRevision, document => {
        const resolvers = createTargetResolvers(document);
        const briefing = resolvers.resolveBriefing(organizationId, briefingId);
        const version = resolvers.resolveBriefingVersion(organizationId, briefingId, versionId);
        assertBriefingVersionContentIsolation(document, version);
        const candidates = assertDraftCurrent(document, version);
        const before = clone(version);
        const manualInputs = normalizeManualInputs(body.manualInputs, runtime, version.frozenSnapshot.definition.defaultSections, version.frozenSnapshot.manualInputs);
        const selected = selectedCandidateFacts(candidates, body.selectedFactIds);
        version.frozenSnapshot.selectedFactIds = [...body.selectedFactIds];
        version.frozenSnapshot.manualInputs = clone(manualInputs);
        version.facts = [...selected, ...manualFacts(version, manualInputs)];
        version.outputs = [];
        const timestamp = runtime.timestamp();
        organizationAudit(document, runtime, {
          organizationId: briefing.organizationId, entityType: 'briefingVersion', entityId: version.id,
          action: 'briefing-draft-edited', actor, timestamp, before, after: version
        });
        return { version: publicBriefingVersion(document, version, { includeFrozenContent: true }), draftStateHash: draftStateHash(version) };
      });
    },

    refreshDraft(organizationId, briefingId, versionId, body) {
      exactKeys(body, ['expectedRevision', 'actor'], ['expectedRevision', 'actor']);
      const actor = requireActor(body.actor);
      return writeWorkflow(targetDataFile, body.expectedRevision, document => {
        const resolvers = createTargetResolvers(document);
        const briefing = resolvers.resolveBriefing(organizationId, briefingId);
        const version = resolvers.resolveBriefingVersion(organizationId, briefingId, versionId);
        assertBriefingVersionContentIsolation(document, version);
        if (version.status !== 'draft') throw invalidRequest();
        const before = clone(version);
        const previousSelected = new Set(version.frozenSnapshot.selectedFactIds);
        const previousCandidates = new Set(version.frozenSnapshot.candidates.map(candidate => candidate.id));
        const nextSnapshot = draftSnapshot(document, briefing, runtime, {
          definition: version.frozenSnapshot.definition,
          comparisonVersionId: version.comparisonVersionId,
          selectedFactIds: [],
          manualInputs: version.frozenSnapshot.manualInputs
        });
        const nextCandidateIds = new Set(nextSnapshot.candidates.map(candidate => candidate.id));
        nextSnapshot.selectedFactIds = [...previousSelected].filter(id => nextCandidateIds.has(id));
        version.frozenSnapshot = nextSnapshot;
        version.facts = [
          ...selectedCandidateFacts(nextSnapshot.candidates, nextSnapshot.selectedFactIds),
          ...manualFacts(version, nextSnapshot.manualInputs)
        ];
        version.outputs = [];
        const timestamp = runtime.timestamp();
        organizationAudit(document, runtime, {
          organizationId: briefing.organizationId, entityType: 'briefingVersion', entityId: version.id,
          action: 'briefing-draft-refreshed', actor, timestamp, before, after: version
        });
        return {
          version: publicBriefingVersion(document, version, { includeFrozenContent: true }),
          draftStateHash: draftStateHash(version),
          reconciliation: {
            preservedSelectedFactIds: [...nextSnapshot.selectedFactIds],
            removedSelectedFactIds: [...previousSelected].filter(id => !nextSnapshot.selectedFactIds.includes(id)),
            addedCandidateFactIds: nextSnapshot.candidates.map(candidate => candidate.id).filter(id => !previousCandidates.has(id)),
            manualInputsPreserved: nextSnapshot.manualInputs.length
          }
        };
      });
    },

    previewDraftOutputs(organizationId, briefingId, versionId, body = {}) {
      exactKeys(body, []);
      return readWorkflow(targetDataFile, document => {
        const resolvers = createTargetResolvers(document);
        resolvers.resolveBriefing(organizationId, briefingId);
        const version = resolvers.resolveBriefingVersion(organizationId, briefingId, versionId);
        assertBriefingVersionContentIsolation(document, version);
        assertDraftCurrent(document, version);
        if (!version.facts.length) throw invalidRequest();
        const content = canonicalContentModel(version);
        return { content, outputs: deterministicOutputs(content), lifecycleUnchanged: true };
      });
    },

    previewFinalize(organizationId, briefingId, versionId, body = {}) {
      exactKeys(body, []);
      return readWorkflow(targetDataFile, (document, revision) => {
        const resolvers = createTargetResolvers(document);
        const briefing = resolvers.resolveBriefing(organizationId, briefingId);
        const version = resolvers.resolveBriefingVersion(organizationId, briefingId, versionId);
        return { ...prepareFinalization(document, briefing, version), expectedRevision: revision, writes: 0 };
      });
    },

    finalize(organizationId, briefingId, versionId, body) {
      exactKeys(body, ['expectedRevision', 'actor', 'draftStateHash'], ['expectedRevision', 'actor', 'draftStateHash']);
      const actor = requireActor(body.actor);
      const approvedHash = requireHash(body.draftStateHash);
      return writeWorkflow(targetDataFile, body.expectedRevision, (document, revision) => {
        const resolvers = createTargetResolvers(document);
        const briefing = resolvers.resolveBriefing(organizationId, briefingId);
        const version = resolvers.resolveBriefingVersion(organizationId, briefingId, versionId);
        const prepared = prepareFinalization(document, briefing, version);
        if (prepared.draftStateHash !== approvedHash) throw previewConflict();
        const before = clone(version);
        const timestamp = runtime.timestamp();
        version.status = 'finalized';
        version.finalizedAt = timestamp;
        version.outputs = prepared.outputs;
        version.frozenSnapshot = {
          ...version.frozenSnapshot,
          finalize: { actor, timestamp, basisRevision: revision, draftStateHash: prepared.draftStateHash, contentHash: prepared.content.contentHash }
        };
        organizationAudit(document, runtime, {
          organizationId: briefing.organizationId, entityType: 'briefingVersion', entityId: version.id,
          action: 'briefing-version-finalized', actor, timestamp, before, after: version
        });
        return { version: publicBriefingVersion(document, version, { includeFrozenContent: true }), outputs: clone(version.outputs), baselineAdvanced: false, communicationPerformed: false };
      });
    },

    getFrozenOutput(organizationId, briefingId, versionId, format) {
      const outputFormat = requireEnum(format, BRIEFING_FORMATS);
      return readWorkflow(targetDataFile, document => {
        const resolvers = createTargetResolvers(document);
        const version = resolvers.resolveBriefingVersion(organizationId, briefingId, versionId);
        if (!['finalized', 'communicated'].includes(version.status)) throw invalidRequest();
        assertBriefingVersionContentIsolation(document, version);
        const output = version.outputs.find(item => item.format === outputFormat);
        if (!output) throw notFound();
        return { output: clone(output), lifecycleUnchanged: true };
      });
    },

    previewCommunicate(organizationId, briefingId, versionId, body) {
      exactKeys(body, ['outputFormat'], ['outputFormat']);
      const outputFormat = requireEnum(body.outputFormat, BRIEFING_FORMATS);
      return readWorkflow(targetDataFile, (document, revision) => {
        const resolvers = createTargetResolvers(document);
        const briefing = resolvers.resolveBriefing(organizationId, briefingId);
        const version = resolvers.resolveBriefingVersion(organizationId, briefingId, versionId);
        assertBriefingVersionContentIsolation(document, version);
        if (version.status !== 'finalized') throw invalidRequest();
        const output = version.outputs.find(item => item.format === outputFormat);
        if (!output) throw notFound();
        return {
          briefing: { id: briefing.id, name: briefing.name },
          version: { id: version.id, status: version.status, finalizedAt: version.finalizedAt },
          output: { format: output.format, contentHash: output.contentHash, byteLength: Buffer.byteLength(output.text, 'utf8') },
          statement: 'Priorena will record an external action. It will not send this output.',
          expectedRevision: revision,
          versionContentHash: frozenContentHash(version),
          baselineVersionId: briefing.lastCommunicatedVersionId,
          writes: 0
        };
      });
    },

    markCommunicated(organizationId, briefingId, versionId, body) {
      exactKeys(body, [
        'expectedRevision', 'actor', 'outputFormat', 'channel', 'referenceNote', 'communicatedAt', 'versionContentHash'
      ], [
        'expectedRevision', 'actor', 'outputFormat', 'channel', 'referenceNote', 'communicatedAt', 'versionContentHash'
      ]);
      const actor = requireActor(body.actor);
      const outputFormat = requireEnum(body.outputFormat, BRIEFING_FORMATS);
      const channel = requireEnum(body.channel, COMMUNICATION_CHANNELS);
      const referenceNote = requireText(body.referenceNote, { allowEmpty: true, max: 2_000 });
      const communicatedAt = requireIsoTimestamp(body.communicatedAt);
      const approvedContentHash = requireHash(body.versionContentHash);
      return writeWorkflow(targetDataFile, body.expectedRevision, document => {
        const resolvers = createTargetResolvers(document);
        const briefing = resolvers.resolveBriefing(organizationId, briefingId);
        const version = resolvers.resolveBriefingVersion(organizationId, briefingId, versionId);
        assertBriefingVersionContentIsolation(document, version);
        if (version.status !== 'finalized') throw invalidRequest();
        if (Date.parse(communicatedAt) < Date.parse(version.finalizedAt)) throw invalidRequest();
        if (frozenContentHash(version) !== approvedContentHash) throw previewConflict();
        const output = version.outputs.find(item => item.format === outputFormat);
        if (!output) throw notFound();
        const before = clone(version);
        version.status = 'communicated';
        version.communicatedAt = communicatedAt;
        version.communication = { channel, outputFormat, referenceNote, actor };
        briefing.lastCommunicatedVersionId = version.id;
        briefing.updatedAt = communicatedAt;
        organizationAudit(document, runtime, {
          organizationId: briefing.organizationId, entityType: 'briefingVersion', entityId: version.id,
          action: AUDIT_ACTIONS.BRIEFING_VERSION_COMMUNICATED, actor, timestamp: communicatedAt, before, after: version
        });
        return {
          version: publicBriefingVersion(document, version, { includeFrozenContent: true }),
          briefing: publicBriefing(briefing, createTargetResolvers(document)),
          baselineAdvanced: true,
          sent: false
        };
      });
    }
  });
}

module.exports = {
  BRIEFING_FORMATS,
  BRIEFING_SECTIONS,
  BRIEFING_TYPES,
  COMMUNICATION_CHANNELS,
  MAX_CANDIDATE_FACTS,
  MAX_MANUAL_INPUTS,
  MAX_OUTPUT_BYTES,
  buildCandidateFacts,
  canonicalContentModel,
  createBriefingServices,
  deterministicOutputs,
  draftStateHash,
  frozenContentHash
};
