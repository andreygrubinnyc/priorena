'use strict';

const BRIEFING_SECTION_ORDER = Object.freeze([
  'summary', 'progress', 'risk', 'milestones', 'follow-up', 'evidence', 'next-actions'
]);

const BRIEFING_PRESETS = Object.freeze([
  Object.freeze({
    id: 'weekly-delivery',
    label: 'Weekly delivery update',
    description: 'A concise operating update for delivery stakeholders.',
    name: 'Weekly Delivery Update',
    audienceProfile: 'Delivery stakeholders',
    briefingType: 'delivery-status',
    preferredFormats: Object.freeze(['teams', 'email']),
    defaultSections: Object.freeze(['summary', 'progress', 'risk', 'milestones', 'follow-up', 'next-actions']),
    draftingGuidance: ''
  }),
  Object.freeze({
    id: 'executive-snapshot',
    label: 'Executive snapshot',
    description: 'A high-level summary of progress, pressure, and next actions.',
    name: 'Executive Delivery Snapshot',
    audienceProfile: 'Executive stakeholders',
    briefingType: 'status-update',
    preferredFormats: Object.freeze(['email', 'confluence']),
    defaultSections: Object.freeze(['summary', 'progress', 'risk', 'milestones', 'next-actions']),
    draftingGuidance: ''
  }),
  Object.freeze({
    id: 'team-coordination',
    label: 'Team coordination',
    description: 'A working update focused on follow-through and grounded context.',
    name: 'Team Coordination Update',
    audienceProfile: 'Delivery team',
    briefingType: 'general',
    preferredFormats: Object.freeze(['teams']),
    defaultSections: Object.freeze(['progress', 'risk', 'follow-up', 'evidence', 'next-actions']),
    draftingGuidance: ''
  })
]);

function targetStableId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new TypeError('Target Briefing client requires stable opaque IDs');
  }
  return value;
}

function briefingPreset(presetId) {
  const preset = BRIEFING_PRESETS.find(item => item.id === presetId);
  if (!preset) throw new TypeError('Briefing preset is unavailable');
  return preset;
}

function stringSet(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new TypeError(`${label} must be an array of strings`);
  }
  return new Set(value);
}

function briefingCandidateReview(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.candidates) || !Array.isArray(snapshot.selectedFactIds) || !snapshot.definition) {
    throw new TypeError('Briefing candidate snapshot is invalid');
  }
  const comparison = snapshot.comparison || {};
  const selected = stringSet(snapshot.selectedFactIds, 'Selected Briefing facts');
  const added = stringSet(comparison.addedFactIds || [], 'Added Briefing facts');
  const changed = stringSet(comparison.changedFactIds || [], 'Changed Briefing facts');
  const removed = stringSet(comparison.removedFactIds || [], 'Removed Briefing facts');
  const hasBaseline = typeof comparison.baselineVersionId === 'string' && comparison.baselineVersionId.length > 0;
  const sectionOrder = Array.isArray(snapshot.definition.defaultSections)
    ? snapshot.definition.defaultSections.filter(section => BRIEFING_SECTION_ORDER.includes(section))
    : [];
  const groups = new Map();
  snapshot.candidates.forEach(candidate => {
    if (!candidate || typeof candidate.id !== 'string' || typeof candidate.section !== 'string' ||
      typeof candidate.kind !== 'string' || typeof candidate.provenance?.type !== 'string') {
      throw new TypeError('Briefing candidate is invalid');
    }
    const baselineState = !hasBaseline
      ? 'available'
      : (changed.has(candidate.id) ? 'changed' : (added.has(candidate.id) ? 'added' : 'unchanged'));
    const items = groups.get(candidate.section) || [];
    items.push({ candidate, baselineState, selected: selected.has(candidate.id) });
    groups.set(candidate.section, items);
  });
  const orderedSections = [
    ...sectionOrder,
    ...[...groups.keys()].filter(section => !sectionOrder.includes(section)).sort((left, right) => left.localeCompare(right, 'en-US'))
  ];
  const candidates = snapshot.candidates;
  return {
    hasBaseline,
    baselineVersionId: hasBaseline ? comparison.baselineVersionId : null,
    counts: {
      total: candidates.length,
      selected: candidates.filter(candidate => selected.has(candidate.id)).length,
      currentState: candidates.filter(candidate => candidate.provenance.type === 'direct-work-item-state').length,
      acceptedEvidence: candidates.filter(candidate => candidate.provenance.type === 'accepted-evidence').length,
      added: hasBaseline ? candidates.filter(candidate => added.has(candidate.id)).length : 0,
      changed: hasBaseline ? candidates.filter(candidate => changed.has(candidate.id)).length : 0,
      removed: hasBaseline ? removed.size : 0
    },
    actionableCandidateIds: hasBaseline
      ? candidates.filter(candidate => added.has(candidate.id) || changed.has(candidate.id)).map(candidate => candidate.id)
      : [],
    groups: orderedSections.filter(section => groups.has(section)).map(section => ({
      section,
      items: groups.get(section)
    }))
  };
}

function encodedId(value) {
  return encodeURIComponent(targetStableId(value));
}

function responseRevision(response) {
  if (!response?.headers) return null;
  if (typeof response.headers.get === 'function') return response.headers.get('x-priorena-target-revision');
  return response.headers['x-priorena-target-revision'] || null;
}

async function responseJson(response) {
  const body = response && typeof response.json === 'function' ? await response.json() : response;
  if (response?.ok === false) {
    const error = new Error(body?.error?.message || 'Target Briefing request failed');
    error.code = body?.error?.code || 'REQUEST_FAILED';
    throw error;
  }
  return { body, revision: responseRevision(response) || body?.revision || null };
}

function createTargetBriefingApiClient(options = {}) {
  if (typeof options.request !== 'function') throw new TypeError('Target Briefing API client requires an injected request function');
  const request = options.request;
  const root = organizationId => `/api/v2/organizations/${encodedId(organizationId)}/briefings`;
  const briefing = (organizationId, briefingId) => `${root(organizationId)}/${encodedId(briefingId)}`;
  const version = (organizationId, briefingId, versionId) => `${briefing(organizationId, briefingId)}/versions/${encodedId(versionId)}`;
  const read = url => request(url, { method: 'GET' }).then(responseJson);
  const write = (url, value, method = 'POST') => request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value)
  }).then(responseJson);

  return Object.freeze({
    listBriefings: organizationId => read(root(organizationId)),
    getBriefing: (organizationId, briefingId) => read(briefing(organizationId, briefingId)),
    createBriefing: (organizationId, value) => write(root(organizationId), value),
    updateBriefing: (organizationId, briefingId, value) => write(briefing(organizationId, briefingId), value, 'PATCH'),
    prepareCandidates: (organizationId, briefingId) => write(`${briefing(organizationId, briefingId)}/candidates/prepare`, {}),
    listOpen: (organizationId, briefingId) => read(`${briefing(organizationId, briefingId)}/versions/open`),
    listHistory: (organizationId, briefingId) => read(`${briefing(organizationId, briefingId)}/versions/history`),
    getVersion: (organizationId, briefingId, versionId) => read(version(organizationId, briefingId, versionId)),
    createDraft: (organizationId, briefingId, value) => write(`${briefing(organizationId, briefingId)}/versions`, value),
    editDraft: (organizationId, briefingId, versionId, value) => write(version(organizationId, briefingId, versionId), value, 'PATCH'),
    refreshDraft: (organizationId, briefingId, versionId, value) => write(`${version(organizationId, briefingId, versionId)}/refresh`, value),
    previewOutputs: (organizationId, briefingId, versionId) => write(`${version(organizationId, briefingId, versionId)}/outputs/preview`, {}),
    getOutput: (organizationId, briefingId, versionId, format) => read(`${version(organizationId, briefingId, versionId)}/outputs/${encodedId(format)}`),
    previewFinalize: (organizationId, briefingId, versionId) => write(`${version(organizationId, briefingId, versionId)}/finalize/preview`, {}),
    finalize: (organizationId, briefingId, versionId, value) => write(`${version(organizationId, briefingId, versionId)}/finalize`, value),
    previewCommunicate: (organizationId, briefingId, versionId, outputFormat) => write(`${version(organizationId, briefingId, versionId)}/communicate/preview`, { outputFormat }),
    markCommunicated: (organizationId, briefingId, versionId, value) => write(`${version(organizationId, briefingId, versionId)}/communicate`, value)
  });
}

function categorizeVersions(versions) {
  if (!Array.isArray(versions)) throw new TypeError('Briefing Versions must be an array');
  const result = { open: [], history: [] };
  versions.forEach(version => {
    if (!version || !['draft', 'finalized', 'communicated'].includes(version.status)) throw new TypeError('Briefing Version lifecycle state is invalid');
    if (version.status === 'communicated') result.history.push(version);
    else result.open.push(version);
  });
  return result;
}

function validateBriefingResponse(value, organizationId) {
  if (!value || !Array.isArray(value.briefings)) throw new Error('Target Briefing response is invalid');
  value.briefings.forEach(briefing => {
    if (briefing.organizationId !== organizationId || !Array.isArray(briefing.workspaces) || !Array.isArray(briefing.initiatives)) {
      throw new Error('Target Briefing response crossed its Organization context');
    }
  });
  return value;
}

const targetBriefingApi = {
  BRIEFING_PRESETS,
  briefingCandidateReview,
  briefingPreset,
  categorizeVersions,
  createTargetBriefingApiClient,
  targetStableId,
  validateBriefingResponse
};

if (typeof module !== 'undefined' && module.exports) module.exports = targetBriefingApi;
if (typeof window !== 'undefined') window.PriorenaTargetBriefing = Object.freeze(targetBriefingApi);
