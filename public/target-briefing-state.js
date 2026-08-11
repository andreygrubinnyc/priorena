'use strict';

function targetStableId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new TypeError('Target Briefing client requires stable opaque IDs');
  }
  return value;
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
    if (briefing.organizationId !== organizationId || !Array.isArray(briefing.workspaces) || !Array.isArray(briefing.scopes)) {
      throw new Error('Target Briefing response crossed its Organization context');
    }
  });
  return value;
}

const targetBriefingApi = {
  categorizeVersions,
  createTargetBriefingApiClient,
  targetStableId,
  validateBriefingResponse
};

if (typeof module !== 'undefined' && module.exports) module.exports = targetBriefingApi;
if (typeof window !== 'undefined') window.PriorenaTargetBriefing = Object.freeze(targetBriefingApi);
